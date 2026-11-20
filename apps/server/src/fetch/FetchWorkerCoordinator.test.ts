import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  isDeepPlanRun,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TextGenerationError,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as DeepPlanExploration from "../deepPlanning/DeepPlanExploration.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { FetchWorkerCoordinator, FetchWorkerCoordinatorLive } from "./FetchWorkerCoordinator.ts";

const instanceId = ProviderInstanceId.make("codex");
const spark = { instanceId, model: "gpt-5.3-codex-spark" };
const luna = { instanceId, model: "gpt-5.6-luna" };
const registryLayer = ProviderAdapterRegistry.layerFromAdapters([
  {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: () => Effect.die("No provider process is needed"),
  } as ProviderAdapter.ProviderAdapterV2["Service"],
]);
const testLayer = ProviderReplayHarness.layerWithRegistry(
  { name: "fetch-fallback" },
  registryLayer,
  {
    runEffectWorker: false,
  },
);

const prepareParent = Effect.fn("FetchWorkerCoordinator.test.prepareParent")(function* (
  deepPlan = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fetch-fallback-" });
  const orchestration = yield* OrchestratorV2;
  const threadId = ThreadId.make("fetch-fallback-parent");
  yield* orchestration.dispatch({
    type: "thread.create",
    commandId: CommandId.make("fetch-create"),
    threadId,
    projectId: ProjectId.make("fetch-project"),
    title: "Fetch parent",
    modelSelection: spark,
    runtimeMode: "full-access",
    interactionMode: deepPlan ? "plan" : "default",
    branch: null,
    worktreePath: cwd,
    createdBy: "user",
    creationSource: "web",
  });
  if (deepPlan) {
    yield* orchestration.dispatch({
      type: "thread.deep-plan.start",
      commandId: CommandId.make("fetch-deep-plan-start"),
      threadId,
      chats: [],
      includeProjectChats: false,
      createdAt: "2026-11-19T10:00:00.000Z",
    });
  }
  yield* orchestration.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("fetch-parent-run"),
    threadId,
    messageId: MessageId.make("fetch-parent-message"),
    text: "Inspect the implementation",
    attachments: [],
    createdBy: "user",
    creationSource: "web",
    dispatchMode: { type: "start_immediately" },
  });
  return {
    orchestration,
    base: {
      threadId,
      cwd,
      userRequest: "Inspect the implementation",
      modelSelection: spark,
      providerDriver: ProviderDriverKind.make("codex"),
      maxRecommendedWorkers: 2,
      commandExecutionPolicy: "deny" as const,
    },
  };
});

it.effect(
  "starts explicit Deep Plan assignments on the planner model when Fetch is unavailable",
  () =>
    Effect.gen(function* () {
      const { orchestration, base } = yield* prepareParent(true);
      const parent = yield* orchestration.getThreadRecords(base.threadId, ["runs"]);
      const run = parent.thread.deepPlan;
      assert(isDeepPlanRun(run));
      const runId = run.id;
      const dependencies = Layer.merge(
        Layer.mock(ThreadManagementService)({
          waitForThread: ({ threadId }) => Effect.succeed({ threadId, run: null, timedOut: false }),
        }),
        Layer.mock(TextGeneration)({
          planFetchExploration: () => Effect.succeed({ decision: "skip", workers: [] }),
        }),
      );
      const exploration = DeepPlanExploration.layer.pipe(
        Layer.provide(FetchWorkerCoordinatorLive.pipe(Layer.provide(dependencies))),
        Layer.provide(
          Layer.mergeAll(
            registryLayer,
            Layer.mock(ProjectStoreV2)({}),
            Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) }),
            ServerSettings.layerTest({
              fetchModelSelection: { instanceId, model: "unavailable-fetch-model" },
            }),
          ),
        ),
      );
      const result = yield* Effect.gen(function* () {
        const worker = yield* DeepPlanExploration.DeepPlanExploration;
        return yield* worker.explore({
          threadId: base.threadId,
          run,
          assignments: [{ scope: "Chat selection", questions: ["How are chat IDs stored?"] }],
        });
      }).pipe(Effect.provide(exploration));

      assert.equal(result.plannedWorkers, 1);
      assert.deepEqual(result.modelSelection, spark);
      const { subagents } = yield* orchestration.getThreadRecords(base.threadId, ["subagents"]);
      const task = subagents[0]!;
      assert.include(task.prompt ?? "", "How are chat IDs stored?");
      const child = yield* orchestration.getThreadRecords(task.childThreadId!, []);
      assert.deepEqual(child.thread.fetchWorker, {
        commandExecutionPolicy: "deny",
        deepPlanRunId: runId,
      });
    }).pipe(Effect.provide(Layer.merge(testLayer, NodeServices.layer))),
);

it.effect(
  "retries Auto Spark with Luna only for typed model failures and preserves the selected model",
  () =>
    Effect.gen(function* () {
      const { base } = yield* prepareParent();
      for (const reason of ["model-unavailable", "entitlement", "rate-limited"] as const) {
        const dependencies = Layer.merge(
          Layer.mock(ThreadManagementService)({}),
          Layer.mock(TextGeneration)({
            planFetchExploration: (input) =>
              input.modelSelection.model === spark.model
                ? Effect.fail(
                    new TextGenerationError({
                      operation: "planFetchExploration",
                      detail: "Unavailable model",
                      reason,
                    }),
                  )
                : Effect.succeed({ decision: "skip", workers: [] }),
          }),
        );
        yield* Effect.gen(function* () {
          const coordinator = yield* FetchWorkerCoordinator;
          const automatic = yield* coordinator.run({
            ...base,
            lunaFallback: {
              modelSelection: luna,
              providerDriver: base.providerDriver,
              maxRecommendedWorkers: 2,
              commandExecutionPolicy: "deny",
            },
          });
          assert.equal(automatic.modelSelection.model, luna.model);
          assert.equal(automatic.status, "skipped");
          assert.include(automatic.warnings.join(" "), "Luna");
          const manual = yield* coordinator.run(base);
          assert.equal(manual.modelSelection.model, spark.model);
          assert.equal(manual.status, "unavailable");
        }).pipe(Effect.provide(FetchWorkerCoordinatorLive.pipe(Layer.provide(dependencies))));
      }
      const genericFailure = Layer.merge(
        Layer.mock(ThreadManagementService)({}),
        Layer.mock(TextGeneration)({
          planFetchExploration: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "planFetchExploration",
                detail: "rate limit mentioned without a typed reason",
              }),
            ),
        }),
      );
      yield* Effect.gen(function* () {
        const coordinator = yield* FetchWorkerCoordinator;
        const result = yield* coordinator.run({
          ...base,
          lunaFallback: {
            modelSelection: luna,
            providerDriver: base.providerDriver,
            maxRecommendedWorkers: 2,
            commandExecutionPolicy: "deny",
          },
        });
        assert.equal(result.modelSelection.model, spark.model);
      }).pipe(Effect.provide(FetchWorkerCoordinatorLive.pipe(Layer.provide(genericFailure))));
    }).pipe(Effect.provide(Layer.merge(testLayer, NodeServices.layer))),
);

it.effect.each([
  { automatic: true, workers: 1, questions: 1, useUltrafast: false },
  { automatic: true, workers: 3, questions: 1, useUltrafast: true },
  { automatic: true, workers: 1, questions: 6, useUltrafast: true },
  { automatic: false, workers: 3, questions: 1, useUltrafast: false },
])("keeps the planner model and selects Fetch worker traits by workload: %j", (scenario) =>
  Effect.gen(function* () {
    const { orchestration, base } = yield* prepareParent();
    const plannedSelections: ModelSelection[] = [];
    const workerSelections: ModelSelection[] = [];
    const manualSelection = { ...luna, options: [{ id: "reasoningEffort", value: "high" }] };
    const plannerSelection = scenario.automatic ? luna : manualSelection;
    const ultrafast = {
      ...base,
      modelSelection: {
        instanceId,
        model: "gpt-6.2-sol",
        options: [{ id: "serviceTier", value: "ultrafast" }],
      },
      maxRecommendedWorkers: 8,
    };
    const dependencies = Layer.merge(
      Layer.mock(ThreadManagementService)({
        waitForThread: Effect.fnUntraced(function* ({ threadId }) {
          const projection = yield* orchestration
            .getThreadRecords(threadId, ["runs"])
            .pipe(Effect.orDie);
          workerSelections.push(projection.thread.modelSelection);
          return { threadId, run: null, timedOut: false };
        }),
      }),
      Layer.mock(TextGeneration)({
        planFetchExploration: (input) =>
          Effect.sync(() => {
            plannedSelections.push(input.modelSelection);
            return {
              decision: "run" as const,
              workers: Array.from({ length: scenario.workers }, (_, index) => ({
                scope: `Area ${index + 1}`,
                questions: Array.from(
                  { length: scenario.questions },
                  (_, question) => `Check item ${question + 1}`,
                ),
              })),
            };
          }),
      }),
    );
    const result = yield* Effect.gen(function* () {
      const coordinator = yield* FetchWorkerCoordinator;
      return yield* coordinator.run({
        ...base,
        modelSelection: plannerSelection,
        maxRecommendedWorkers: 8,
        ...(scenario.automatic
          ? {
              ultrafastWorkers: [{ ...ultrafast, maxRecommendedWorkers: 0 }, ultrafast],
            }
          : {}),
      });
    }).pipe(Effect.provide(FetchWorkerCoordinatorLive.pipe(Layer.provide(dependencies))));

    const expected = scenario.useUltrafast ? ultrafast.modelSelection : plannerSelection;
    assert.deepStrictEqual(plannedSelections, [plannerSelection]);
    assert.lengthOf(workerSelections, scenario.workers);
    assert.deepStrictEqual(
      workerSelections,
      Array.from({ length: scenario.workers }, () => expected),
    );
    assert.deepStrictEqual(result.modelSelection, expected);
  }).pipe(Effect.provide(Layer.merge(testLayer, NodeServices.layer))),
);
