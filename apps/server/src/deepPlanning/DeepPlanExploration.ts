import {
  DeepPlanError,
  isDeepPlanRun,
  resolveProjectProviderInstanceEnabled,
  type DeepPlanRun,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveFetchProviderSelection, workerModel } from "../fetch/FetchPreparation.ts";
import * as FetchWorkers from "../fetch/FetchWorkerCoordinator.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapters from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

export class DeepPlanExploration extends Context.Service<
  DeepPlanExploration,
  {
    readonly explore: (input: {
      readonly threadId: ThreadId;
      readonly run: DeepPlanRun;
      readonly assignments: ReadonlyArray<FetchWorkers.FetchWorkerAssignment>;
    }) => Effect.Effect<FetchWorkers.FetchRunResult, DeepPlanError>;
  }
>()("t3/deepPlanning/DeepPlanExploration") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const providers = yield* Providers.ProviderRegistry;
  const adapters = yield* ProviderAdapters.ProviderAdapterRegistryV2;
  const workers = yield* FetchWorkers.FetchWorkerCoordinator;

  const explore: DeepPlanExploration["Service"]["explore"] = Effect.fn(
    "DeepPlanExploration.explore",
  )(function* ({ threadId, run, assignments }) {
    const unavailable = new DeepPlanError({
      code: "target-unavailable",
      message: "Could not start Deep Plan exploration.",
    });
    const thread = yield* engine.getThreadShell(threadId).pipe(Effect.mapError(() => unavailable));
    const current = thread?.deepPlan;
    const notPlanner = new DeepPlanError({
      code: "actor-mismatch",
      message: "Exploration requires the active Deep Plan planning turn.",
    });
    if (
      thread === null ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.activeRunId === null ||
      !isDeepPlanRun(current) ||
      current.threadId !== threadId ||
      current.id !== run.id ||
      (current.phase !== "planning" &&
        current.phase !== "awaitingApproval" &&
        current.phase !== "paused")
    )
      return yield* notPlanner;

    const { runs, messages } = yield* engine
      .getThreadRecords(threadId, ["runs", "messages"], {
        runIds: [thread.activeRunId],
        messageRunIds: [thread.activeRunId],
        messageRoles: ["user"],
      })
      .pipe(Effect.mapError(() => unavailable));
    const parent = runs[0];
    const message = messages.find((candidate) => candidate.id === parent?.userMessageId);
    if (
      parent === undefined ||
      message === undefined ||
      parent.deepPlanRunId !== run.id ||
      (parent.status !== "starting" && parent.status !== "running" && parent.status !== "waiting")
    )
      return yield* notPlanner;

    const { projectId, worktreePath } = thread;
    const cwd =
      worktreePath ??
      Option.getOrNull(yield* projects.get(projectId).pipe(Effect.mapError(() => unavailable)))
        ?.workspaceRoot;
    if (cwd === undefined) return yield* unavailable;

    const configured = yield* settings.getSettings.pipe(Effect.mapError(() => unavailable));
    const readsChats = current.chats.length > 0 || current.includeProjectChats;
    const available = yield* Effect.filter(
      yield* providers.getProviders,
      (provider) =>
        resolveProjectProviderInstanceEnabled(configured, projectId, provider.instanceId)
          ? adapters.get(provider.instanceId).pipe(
              Effect.flatMap((adapter) => adapter.getCapabilities()),
              Effect.map(
                (capabilities) => !readsChats || capabilities.deepPlan?.supported === true,
              ),
              Effect.orElseSucceed(() => false),
            )
          : Effect.succeed(false),
      { concurrency: 4 },
    );
    const { selection } = resolveFetchProviderSelection({
      available,
      settings: resolveProjectSettings(configured, projectId).settings,
      now: yield* Clock.currentTimeMillis,
      requireAgentModel: true,
    });
    const planner = parent.resolvedModelSelection ?? parent.modelSelection;
    const model =
      selection.status === "resolved"
        ? workerModel(selection)
        : {
            modelSelection: planner,
            providerDriver: (yield* adapters
              .get(planner.instanceId)
              .pipe(Effect.mapError(() => unavailable))).driver,
            maxRecommendedWorkers: assignments.length,
            commandExecutionPolicy: "deny" as const,
          };

    return yield* workers
      .run({
        ...model,
        threadId,
        cwd,
        userRequest: message.text,
        exploration: { runId: run.id, parentRunId: parent.id, assignments, chats: current.chats },
      })
      .pipe(Effect.mapError(() => unavailable));
  });

  return DeepPlanExploration.of({ explore });
});

export const layer = Layer.effect(DeepPlanExploration, make);
