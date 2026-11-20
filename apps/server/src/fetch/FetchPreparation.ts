import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type ModelSelection,
  type RunId,
  type ServerProvider,
  type ServerSettings,
  type ThreadId,
} from "@t3tools/contracts";
import {
  fetchUltrafastModelCandidates,
  isFetchCapableProvider,
  resolveFetchLunaFallback,
  resolveFetchModelSelection,
} from "@t3tools/shared/fetchMode";
import { supportsModelSelectionPurpose } from "@t3tools/shared/model";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { usageHardBudgetBlockReason } from "../provider/usageHardBudget.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { FetchWorkerCoordinator } from "./FetchWorkerCoordinator.ts";
import type { FetchWorkerModel } from "./FetchWorkerState.ts";
import { forkParked } from "../serverActivation.ts";

export function workerModel(candidate: {
  readonly selection: ModelSelection;
  readonly provider: ServerProvider;
}): FetchWorkerModel {
  return {
    modelSelection: candidate.selection,
    providerDriver: candidate.provider.driver,
    maxRecommendedWorkers: candidate.provider.fetchWorkers?.maxRecommendedWorkers ?? 1,
    commandExecutionPolicy: "deny",
  };
}

export function resolveFetchProviderSelection(input: {
  readonly available: ReadonlyArray<ServerProvider>;
  readonly settings: Pick<
    ServerSettings,
    "fetchModelSelection" | "textGenerationModelSelection" | "usageHardBudgetEnabled"
  >;
  readonly now: number;
  readonly requireAgentModel?: boolean;
}) {
  const { available, settings, now, requireAgentModel } = input;
  const eligible =
    settings.fetchModelSelection && !requireAgentModel
      ? available
      : available
          .filter(
            (provider) =>
              isFetchCapableProvider(provider) &&
              provider.auth.status !== "unauthenticated" &&
              (!settings.usageHardBudgetEnabled ||
                usageHardBudgetBlockReason(provider.usageLimits, now) === null),
          )
          .map((provider) => {
            const exhausted = exhaustedUsageWindow(provider, now);
            if (!requireAgentModel && !exhausted) return provider;
            return {
              ...provider,
              models: provider.models.filter(
                (model) =>
                  (!requireAgentModel || supportsModelSelectionPurpose(model, "agent")) &&
                  (!exhausted || !exhaustedUsageWindow(provider, now, model.slug)),
              ),
            };
          });
  const selection = resolveFetchModelSelection({
    providers: eligible,
    fetchModelSelection: settings.fetchModelSelection,
    textGenerationModelSelection: settings.textGenerationModelSelection,
  });
  return { eligible, selection };
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestration = yield* OrchestratorV2;
    const projects = yield* ProjectStoreV2;
    const providers = yield* ProviderRegistry;
    const settings = yield* ServerSettingsService;
    const workers = yield* FetchWorkerCoordinator;
    const scope = yield* Scope.Scope;
    const active = new Set<RunId>();
    const prepare = Effect.fn("FetchPreparation.prepare")(function* (
      threadId: ThreadId,
      runId: RunId,
    ) {
      const projection = yield* orchestration.getThreadRecords(threadId, ["runs", "messages"]);
      const run = projection.runs.find((run) => run.id === runId);
      const message = projection.messages.find((message) => message.id === run?.userMessageId);
      if (
        !run ||
        run.status !== "starting" ||
        run.fetchContext !== undefined ||
        message?.fetchMode !== "repository-exploration"
      )
        return;
      const current = resolveProjectSettings(
        yield* settings.getSettings,
        projection.thread.projectId,
      ).settings;
      let context = "";
      const available = yield* providers.getProviders;
      const now = yield* Clock.currentTimeMillis;
      const { eligible, selection } = resolveFetchProviderSelection({
        available,
        settings: current,
        now,
      });
      if (selection.status === "resolved") {
        const luna =
          selection.source === "auto-spark" ? resolveFetchLunaFallback(eligible) : undefined;
        const project = yield* projects.get(projection.thread.projectId);
        const cwd = projection.thread.worktreePath ?? Option.getOrNull(project)?.workspaceRoot;
        if (cwd !== undefined) {
          const ultrafastWorkers =
            selection.source === "manual"
              ? []
              : fetchUltrafastModelCandidates(eligible, run.modelSelection).map(workerModel);
          const result = yield* workers
            .run({
              threadId,
              cwd,
              userRequest: message.text,
              ...workerModel(selection),
              ...(luna?.status === "resolved" ? { lunaFallback: workerModel(luna) } : {}),
              ...(ultrafastWorkers.length > 0 ? { ultrafastWorkers } : {}),
            })
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Repository exploration failed", {
                  threadId,
                  runId,
                  cause,
                }).pipe(Effect.as(null)),
              ),
            );
          context =
            result === null
              ? "Repository exploration was unavailable. Continue without preloaded findings."
              : [...result.warnings, result.context]
                  .filter((value) => value !== undefined && value.length > 0)
                  .join("\n\n")
                  .slice(0, 64_000);
        }
      } else if (selection.source === "manual") {
        context = "The configured Fetch model is unavailable. Continue without preloaded findings.";
      }
      yield* orchestration.dispatch({
        type: "prepared-run.fetch.complete",
        commandId: CommandId.make(`fetch-ready:${runId}`),
        threadId,
        runId,
        context,
      });
    });
    const enqueue = Effect.fn("FetchPreparation.enqueue")(function* (
      threadId: ThreadId,
      runId: RunId,
    ) {
      if (active.has(runId)) return;
      active.add(runId);
      yield* prepare(threadId, runId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Fetch preparation failed", { threadId, runId, cause }).pipe(
                Effect.andThen(
                  orchestration.dispatch({
                    type: "prepared-run.fetch.complete",
                    commandId: CommandId.make(`fetch-ready:${runId}`),
                    threadId,
                    runId,
                    context:
                      "Repository exploration was unavailable. Continue without preloaded findings.",
                  }),
                ),
                Effect.catchCause((failure) =>
                  Effect.logError("Fetch fallback could not be persisted", {
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
            event.payload.fetchContext === undefined
            ? enqueue(event.threadId, event.payload.id)
            : Effect.void;
        }),
      ),
    );
    for (const thread of snapshot.threads)
      if (thread.activeRunId !== null) yield* enqueue(thread.id, thread.activeRunId);
  }),
);
