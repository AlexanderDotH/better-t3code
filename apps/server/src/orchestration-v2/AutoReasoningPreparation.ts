import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CODEX_REASONING_EFFORT_OPTION_ID,
  CommandId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { isAutoReasoningEnabled } from "@t3tools/shared/model";
import {
  applyAutoReasoningDecisionResult,
  resolveAutoReasoningDecision,
  resolveAutoReasoningDecisionModelSelection,
  type AutoReasoningMessage,
} from "@t3tools/provider-core/server/autoReasoning";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { DecisionGeneration } from "../decisionGeneration/DecisionGeneration.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { ProjectStoreV2 } from "./ProjectStore.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestration = yield* OrchestratorV2;
    const projects = yield* ProjectStoreV2;
    const providers = yield* ProviderRegistry;
    const settings = yield* ServerSettingsService;
    const decisions = yield* DecisionGeneration;
    const scope = yield* Scope.Scope;
    const active = new Set<RunId>();
    const prepare = Effect.fn("AutoReasoningPreparation.prepare")(function* (
      threadId: ThreadId,
      runId: RunId,
    ) {
      const projection = yield* orchestration.getThreadRecords(threadId, ["runs", "messages"], {
        runIds: [runId],
        messageRunIds: [runId],
      });
      const run = projection.runs[0];
      const message = projection.messages.find((message) => message.id === run?.userMessageId);
      if (
        !run ||
        run.status !== "starting" ||
        run.resolvedModelSelection !== undefined ||
        !isAutoReasoningEnabled(run.modelSelection) ||
        !message
      )
        return;
      const current = resolveProjectSettings(
        yield* settings.getSettings,
        projection.thread.projectId,
      ).settings;
      const provider = (yield* providers.getProviders).find(
        (provider) => provider.instanceId === run.providerInstanceId,
      );
      const model = provider?.models.find(
        (model) => model.slug === run.modelSelection.model && model.isSelectable !== false,
      );
      const descriptor = model?.capabilities?.optionDescriptors?.find(
        (descriptor) =>
          descriptor.id === CODEX_REASONING_EFFORT_OPTION_ID && descriptor.type === "select",
      );
      const allowedEfforts =
        provider?.driver === "codex" &&
        provider.enabled &&
        provider.installed &&
        provider.availability !== "unavailable" &&
        provider.status !== "error" &&
        provider.status !== "disabled" &&
        provider.auth.status !== "unauthenticated" &&
        descriptor?.type === "select"
          ? descriptor.options.map((option) => option.id)
          : [];
      const project = yield* projects.get(projection.thread.projectId);
      const cwd = projection.thread.worktreePath ?? Option.getOrNull(project)?.workspaceRoot;
      const recent = yield* orchestration.getThreadSnapshotWindow(threadId, { rowLimit: 4 });
      const conversation = recent.projection.messages
        .flatMap<AutoReasoningMessage>((candidate) =>
          candidate.id === message.id
            ? []
            : candidate.role === "user"
              ? [{ role: "user" as const, text: candidate.text }]
              : candidate.role === "assistant"
                ? [{ role: "assistant" as const, text: candidate.text }]
                : [],
        )
        .slice(-3);
      const resolution = yield* resolveAutoReasoningDecision(
        {
          agentModelSelection: run.modelSelection,
          decisionModelSelection: resolveAutoReasoningDecisionModelSelection(current),
          cwd: cwd ?? "",
          userPrompt: message.text,
          attachments: message.attachments,
          interactionMode: projection.thread.interactionMode,
          allowedEfforts: cwd === undefined ? [] : allowedEfforts,
          conversation,
        },
        decisions.decide,
      );
      if (!resolution) return;
      yield* orchestration.dispatch({
        type: "prepared-run.reasoning.complete",
        commandId: CommandId.make(`reasoning-ready:${runId}`),
        threadId,
        runId,
        selection: resolution.effectiveSelection,
        ...(resolution.diagnostic === undefined ? {} : { diagnostic: resolution.diagnostic }),
      });
    });
    const enqueue = Effect.fn("AutoReasoningPreparation.enqueue")(function* (
      threadId: ThreadId,
      runId: RunId,
    ) {
      if (active.has(runId)) return;
      active.add(runId);
      yield* prepare(threadId, runId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.gen(function* () {
                yield* Effect.logWarning("Automatic reasoning preparation failed", {
                  threadId,
                  runId,
                  cause,
                });
                const projection = yield* orchestration.getThreadRecords(threadId, ["runs"], {
                  runIds: [runId],
                });
                const run = projection.runs[0];
                if (!run || run.status !== "starting" || run.resolvedModelSelection !== undefined)
                  return;
                const fallback = applyAutoReasoningDecisionResult({
                  agentModelSelection: run.modelSelection,
                  decisionModelSelection: run.modelSelection,
                  allowedEfforts: [],
                  durationMs: 0,
                });
                yield* orchestration.dispatch({
                  type: "prepared-run.reasoning.complete",
                  commandId: CommandId.make(`reasoning-ready:${runId}`),
                  threadId,
                  runId,
                  selection: fallback.effectiveSelection,
                  ...(fallback.diagnostic === undefined ? {} : { diagnostic: fallback.diagnostic }),
                });
              }).pipe(
                Effect.catchCause((failure) =>
                  Effect.logError("Automatic reasoning fallback could not be persisted", {
                    threadId,
                    runId,
                    failure,
                  }),
                ),
              ),
        ),
        Effect.ensuring(Effect.sync(() => active.delete(runId))),
        Effect.forkIn(scope),
      );
    });
    const snapshot = yield* orchestration.getShellSnapshot();
    yield* forkParked(
      orchestration.streamStoredEventsFrom({ afterSequence: snapshot.snapshotSequence }).pipe(
        Stream.runForEach((stored) => {
          const event = stored.event;
          return (event.type === "run.created" || event.type === "run.updated") &&
            event.payload.status === "starting" &&
            event.payload.resolvedModelSelection === undefined &&
            isAutoReasoningEnabled(event.payload.modelSelection)
            ? enqueue(event.threadId, event.payload.id)
            : Effect.void;
        }),
      ),
    );
    for (const thread of snapshot.threads)
      if (thread.activeRunId !== null) yield* enqueue(thread.id, thread.activeRunId);
  }),
);
