import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  resolveBetterT3FeatureFlag,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveFetchLunaFallback, resolveFetchModelSelection } from "@t3tools/shared/fetchMode";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { FetchWorkerCoordinator } from "./FetchWorkerCoordinator.ts";
import { forkParked } from "../serverActivation.ts";

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
      if (resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.fetch")) {
        const available = yield* providers.getProviders;
        const selection = resolveFetchModelSelection({
          providers: available,
          fetchModelSelection: current.fetchModelSelection,
          textGenerationModelSelection: current.textGenerationModelSelection,
        });
        if (selection.status === "resolved") {
          const luna =
            selection.source === "auto-spark" ? resolveFetchLunaFallback(available) : undefined;
          const project = yield* projects.get(projection.thread.projectId);
          const cwd = projection.thread.worktreePath ?? Option.getOrNull(project)?.workspaceRoot;
          if (cwd !== undefined) {
            const result = yield* workers
              .run({
                threadId,
                cwd,
                userRequest: message.text,
                modelSelection: selection.selection,
                providerDriver: selection.provider.driver,
                maxRecommendedWorkers: selection.provider.fetchWorkers?.maxRecommendedWorkers ?? 1,
                commandExecutionPolicy: "deny",
                ...(luna?.status === "resolved"
                  ? {
                      lunaFallback: {
                        modelSelection: luna.selection,
                        providerDriver: luna.provider.driver,
                        maxRecommendedWorkers:
                          luna.provider.fetchWorkers?.maxRecommendedWorkers ?? 1,
                        commandExecutionPolicy: "deny" as const,
                      },
                    }
                  : {}),
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
        }
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
