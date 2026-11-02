import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TextGenerationError,
  ThreadId,
} from "@t3tools/contracts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { FetchWorkerCoordinator, FetchWorkerCoordinatorLive } from "./FetchWorkerCoordinator.ts";

const instanceId = ProviderInstanceId.make("codex");
const spark = { instanceId, model: "gpt-5.3-codex-spark" };
const luna = { instanceId, model: "gpt-5.6-luna" };
const testLayer = ProviderReplayHarness.layerWithRegistry(
  { name: "fetch-fallback" },
  ProviderAdapterRegistry.layerFromAdapters([
    {
      instanceId,
      driver: ProviderDriverKind.make("codex"),
      getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
      planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
      openSession: () => Effect.die("No provider process is needed"),
    } as ProviderAdapter.ProviderAdapterV2["Service"],
  ]),
  { runEffectWorker: false },
);

it.effect(
  "retries Auto Spark with Luna only for typed model failures and preserves the selected model",
  () =>
    Effect.gen(function* () {
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
        interactionMode: "default",
        branch: null,
        worktreePath: cwd,
        createdBy: "user",
        creationSource: "web",
      });
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
      const base = {
        threadId,
        cwd,
        userRequest: "Inspect the implementation",
        modelSelection: spark,
        providerDriver: ProviderDriverKind.make("codex"),
        maxRecommendedWorkers: 2,
        commandExecutionPolicy: "deny" as const,
      };
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
