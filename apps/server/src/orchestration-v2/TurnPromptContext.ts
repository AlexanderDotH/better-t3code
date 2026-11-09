import {
  DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type ProjectMemoryMode,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import { resolveCodexContextWindowTokens } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DecisionGeneration from "../decisionGeneration/DecisionGeneration.ts";
import { applyProjectAgentInstructionsToProviderInput } from "../projectAgent/ProjectAgentInstructions.ts";
import { hasActiveProjectAgentPeer, isRootThread } from "../projectAgent/projectAgentThreads.ts";
import { resolveProjectIndexContextDecision } from "../projectIndexing/integration/ProjectIndexContextDecision.ts";
import {
  prepareProjectIndexTurnContext,
  retrieveProjectIndexTurnContextCandidate,
} from "../projectIndexing/integration/ProjectIndexTurnContext.ts";
import * as ProjectContextQuery from "../projectIndexing/query/ProjectContextQuery.ts";
import * as ProjectMemoryStore from "../projectMemory/ProjectMemoryStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SkillEngine } from "../skills/Services/SkillEngine.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const PROJECT_INDEX_DECISION_TIMEOUT = "15 seconds";

/** Providers parse a leading slash themselves, so nothing may be placed before such a prompt. */
export const isProviderCommandText = (text: string, attachmentCount: number) =>
  attachmentCount === 0 && text.trimStart().startsWith("/");

interface TurnPromptInput {
  readonly thread: OrchestrationV2AppThread;
  readonly workspaceRoot: string | undefined;
  readonly cwd: string | null;
  readonly modelSelection: ModelSelection;
  readonly text: string;
  readonly attachmentCount: number;
  readonly expandSkills: boolean;
}

interface TurnPrompt {
  readonly text: string;
  readonly projectContext: string | undefined;
  /** Sent only with the first prompt of a native conversation. */
  readonly memory: string | undefined;
  readonly projectMemoryMode: ProjectMemoryMode | undefined;
}

export class TurnPromptContext extends Context.Service<
  TurnPromptContext,
  { readonly prepare: (input: TurnPromptInput) => Effect.Effect<TurnPrompt> }
>()("t3/orchestration-v2/TurnPromptContext") {}

const make = Effect.gen(function* () {
  const skills = yield* SkillEngine;
  const memoryStore = yield* ProjectMemoryStore.ProjectMemoryStore;
  const projectContext = yield* ProjectContextQuery.ProjectContextQuery;
  const decisions = yield* DecisionGeneration.DecisionGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  // Every source is optional context: a broken one must not fail the user's turn.
  const orElse =
    <A>(message: string, input: TurnPromptInput, fallback: A) =>
    <E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning(message, { threadId: input.thread.id, cause }).pipe(
                Effect.as(fallback),
              ),
        ),
      );

  const readMemory = Effect.fn("TurnPromptContext.readMemory")(function* (
    input: TurnPromptInput,
    root: boolean,
  ) {
    if (input.workspaceRoot === undefined) return { mode: undefined, memory: undefined };
    const projectId = input.thread.projectId;
    const scope = {
      projectId,
      workspaceRoot: input.workspaceRoot,
      threadId: input.thread.id,
      actor: root ? ("root" as const) : ("child" as const),
    };
    if (!root) {
      const { settings } = yield* memoryStore.getSettings(scope, { projectId });
      return { mode: settings.memoryMode, memory: undefined };
    }
    const read = yield* memoryStore.read(scope, {
      projectId,
      query: input.text,
      contextWindowTokens:
        resolveCodexContextWindowTokens(input.modelSelection) ??
        DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS,
    });
    return {
      mode: read.mode,
      memory:
        read.entries.length === 0
          ? undefined
          : `<t3code_project_memory>\n${read.markdown.trim()}\n</t3code_project_memory>`,
    };
  });

  const readProjectContext = Effect.fn("TurnPromptContext.readProjectContext")(function* (
    input: TurnPromptInput,
    decisionModel: ModelSelection | null | undefined,
  ) {
    if (decisionModel === undefined) return undefined;
    const scope = { projectId: input.thread.projectId, threadId: input.thread.id };
    if (decisionModel === null)
      return yield* prepareProjectIndexTurnContext(projectContext, scope, input.text);
    const candidate = yield* retrieveProjectIndexTurnContextCandidate(
      projectContext,
      scope,
      input.text,
    );
    if (candidate === undefined) return undefined;
    const decided = yield* resolveProjectIndexContextDecision(decisions, {
      cwd: input.cwd ?? input.workspaceRoot ?? process.cwd(),
      modelSelection: decisionModel,
      task: input.text,
      candidate,
    }).pipe(Effect.timeoutOption(PROJECT_INDEX_DECISION_TIMEOUT));
    // A slow router must not cost the turn its context, matching a failed decision.
    return Option.match(decided, {
      onNone: () => candidate.context,
      onSome: (decision) => decision.context,
    });
  });

  const prepare: TurnPromptContext["Service"]["prepare"] = Effect.fn("TurnPromptContext.prepare")(
    function* (input) {
      const root = isRootThread(input.thread);
      const settings = Option.getOrUndefined(yield* serverSettings.getSettings.pipe(Effect.option));
      const coordinationEnabled =
        root &&
        settings !== undefined &&
        resolveBetterT3FeatureFlag(settings.betterT3Environment, "agent.projectCoordination");
      const [expanded, memory, context, peerActive] = yield* Effect.all(
        [
          input.expandSkills
            ? skills
                .rewritePromptForProvider({
                  providerInstanceId: input.modelSelection.instanceId,
                  projectCwd: input.workspaceRoot,
                  prompt: input.text,
                })
                .pipe(orElse("Could not expand skills for a turn.", input, input.text))
            : Effect.succeed(input.text),
          readMemory(input, root).pipe(
            orElse<{
              readonly mode: ProjectMemoryMode | undefined;
              readonly memory: string | undefined;
            }>("Could not read project memory for a turn.", input, {
              mode: undefined,
              memory: undefined,
            }),
          ),
          readProjectContext(
            input,
            root ? settings?.projectIndexingDecisionModelSelection : undefined,
          ).pipe(
            orElse<string | undefined>(
              "Could not read project index context for a turn.",
              input,
              undefined,
            ),
          ),
          coordinationEnabled
            ? projections.getShellSnapshot({ projectId: input.thread.projectId }).pipe(
                Effect.map(({ threads }) => hasActiveProjectAgentPeer(input.thread.id, threads)),
                orElse("Could not read project agents for a turn.", input, false),
              )
            : Effect.succeed(false),
        ],
        { concurrency: "unbounded" },
      );
      if (!peerActive || isProviderCommandText(expanded, input.attachmentCount))
        return {
          text: expanded,
          projectContext: context,
          memory: memory.memory,
          projectMemoryMode: memory.mode,
        };
      const coordinated = applyProjectAgentInstructionsToProviderInput({ providerInput: expanded });
      if (coordinated.outcome === "omitted")
        yield* Effect.logWarning("Project-agent coordination instructions omitted from a turn.", {
          threadId: input.thread.id,
        });
      return {
        text: coordinated.providerInput ?? expanded,
        projectContext: context,
        memory: memory.memory,
        projectMemoryMode: memory.mode,
      };
    },
  );

  return TurnPromptContext.of({ prepare });
});

export const layer = Layer.effect(TurnPromptContext, make);
