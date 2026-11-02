import { modelSelectionsEqual } from "@t3tools/shared/model";
import {
  CommandId,
  EventId,
  RuntimeSessionId,
  resolveBetterT3FeatureFlag,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { DecisionGeneration } from "../decisionGeneration/DecisionGeneration.ts";
import {
  ContextCompactionError,
  makeContextCompactionEngine,
  type ContextCompactionSource,
} from "./ContextCompactionEngine.ts";
import {
  CONTEXT_CHECKPOINT_ACTIVITY,
  CONTEXT_APPLIED_ACTIVITY,
  resolveContextCompactionModel,
} from "./contextCompactionPolicy.ts";
import { forkParked } from "../serverActivation.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestration = yield* OrchestratorV2;
    const projects = yield* ProjectStoreV2;
    const providers = yield* ProviderRegistry;
    const settings = yield* ServerSettingsService;
    const text = yield* TextGeneration;
    const decisions = yield* DecisionGeneration;
    const crypto = yield* Crypto.Crypto;
    const failure = (cause: unknown) =>
      new ContextCompactionError({
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    const configuration = Effect.gen(function* () {
      const current = yield* settings.getSettings;
      return {
        enabled: resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.contextCompaction"),
        model: resolveContextCompactionModel({
          selection: current.contextCompactionModelSelection,
          fallbackSelection: current.textGenerationModelSelection,
          providers: yield* providers.getProviders,
        }),
      };
    }).pipe(Effect.mapError(failure));
    const load: (
      threadId: ThreadId,
    ) => Effect.Effect<ContextCompactionSource | undefined, ContextCompactionError> = Effect.fn(
      "ContextCompactionRuntime.load",
    )(function* (threadId: ThreadId) {
      const projection = yield* orchestration.getThreadRecords(threadId, [
        "messages",
        "runs",
        "providerTurns",
        "providerThreads",
      ]);
      const thread = projection.thread;
      if (
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.lineage.relationshipToParent === "subagent"
      )
        return undefined;
      const provider = projection.providerThreads.find(
        (provider) => provider.id === thread.activeProviderThreadId,
      );
      const project = yield* projects.get(thread.projectId);
      const cwd = thread.worktreePath ?? Option.getOrNull(project)?.workspaceRoot;
      if (!cwd) return undefined;
      const usage = projection.providerTurns
        .flatMap((turn) => (turn.tokenUsage ? [turn.tokenUsage] : []))
        .at(-1);
      const saved = thread.contextCompaction;
      return {
        threadId,
        provider: provider?.driver ?? null,
        runtimeSessionId: provider?.providerSessionId
          ? RuntimeSessionId.make(provider.providerSessionId)
          : null,
        busy: projection.runs.some((run) =>
          ["preparing", "starting", "running", "waiting"].includes(run.status),
        ),
        agentModelSelection: thread.modelSelection,
        cwd,
        messages: projection.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          attachments: message.attachments,
          context: message.context,
          streaming: message.streaming,
          turnId: null,
          createdAt: DateTime.formatIso(message.createdAt),
          updatedAt: DateTime.formatIso(message.updatedAt),
        })),
        activities: [
          ...(usage === undefined
            ? []
            : [
                {
                  id: EventId.make(`context-usage:${threadId}`),
                  tone: "info" as const,
                  kind: "context-window.updated",
                  summary: "Context usage",
                  payload: {
                    ...usage,
                    ...(usage.maxTokens == null
                      ? { maxTokens: undefined }
                      : { maxTokens: usage.maxTokens }),
                  },
                  turnId: null,
                  createdAt: usage.updatedAt,
                },
              ]),
          ...(saved === undefined
            ? []
            : [
                {
                  id: EventId.make(`context-checkpoint:${threadId}`),
                  tone: "info" as const,
                  kind:
                    saved.state === "prepared"
                      ? CONTEXT_CHECKPOINT_ACTIVITY
                      : CONTEXT_APPLIED_ACTIVITY,
                  summary: "Context summary",
                  payload: saved.checkpoint,
                  turnId: null,
                  createdAt: DateTime.formatIso(thread.updatedAt),
                },
              ]),
        ],
      };
    }, Effect.mapError(failure));
    const engine = yield* makeContextCompactionEngine({
      load,
      configuration,
      summarize: (input) => text.summarizeContext(input).pipe(Effect.mapError(failure)),
      decide: (input) => decisions.decide(input).pipe(Effect.mapError(failure)),
      publish: Effect.fn("ContextCompactionRuntime.publish")(
        function* (threadId, kind, checkpoint) {
          yield* orchestration
            .dispatch({
              type: "thread.context-compaction.update",
              commandId: CommandId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie)),
              threadId,
              checkpoint,
              savedState: kind === CONTEXT_APPLIED_ACTIVITY ? "applied" : "prepared",
            })
            .pipe(Effect.mapError(failure));
        },
      ),
    });
    const snapshot = yield* orchestration.getShellSnapshot();
    const knownThreads = new Set(snapshot.threads.map((thread) => thread.id));
    yield* forkParked(
      settings.streamChanges.pipe(
        Stream.map((current) => ({
          enabled: resolveBetterT3FeatureFlag(
            current.betterT3Environment,
            "agent.contextCompaction",
          ),
          selection: current.contextCompactionModelSelection,
          fallback: current.textGenerationModelSelection,
        })),
        Stream.changesWith(
          (left, right) =>
            left.enabled === right.enabled &&
            (left.selection === null || right.selection === null
              ? left.selection === right.selection
              : modelSelectionsEqual(left.selection, right.selection)) &&
            modelSelectionsEqual(left.fallback, right.fallback),
        ),
        Stream.runForEach(
          Effect.fn("ContextCompactionRuntime.resetConfiguration")(function* () {
            for (const threadId of knownThreads) yield* engine.forget(threadId);
          }),
        ),
      ),
    );
    yield* forkParked(
      orchestration.streamStoredEventsFrom({ afterSequence: snapshot.snapshotSequence }).pipe(
        Stream.runForEach((stored) => {
          if (stored.event.type === "thread.deleted") {
            knownThreads.delete(stored.event.threadId);
            return engine.forget(stored.event.threadId);
          }
          knownThreads.add(stored.event.threadId);
          return stored.event.type === "provider-turn.updated" && stored.event.payload.tokenUsage
            ? engine.observe(stored.event.threadId, stored.event.payload.tokenUsage)
            : stored.event.type === "thread.metadata-updated" &&
                (stored.event.payload.pendingHistoryEdit !== undefined ||
                  stored.event.payload.contextCompaction?.state === "applied")
              ? engine.forget(stored.event.threadId)
              : Effect.void;
        }),
      ),
    );
    yield* forkParked(
      Effect.gen(function* () {
        if (!(yield* configuration).enabled) return;
        for (const thread of snapshot.threads) {
          const source = yield* load(thread.id);
          const usage = source?.activities.find(
            (activity) => activity.kind === "context-window.updated",
          );
          if (usage) yield* engine.observe(thread.id, usage.payload);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Context compaction recovery failed", { cause }),
        ),
      ),
    );
  }),
);
