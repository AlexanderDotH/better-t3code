import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { CommandId, DeepPlanError, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProviderAdapterRegistryV2 } from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { layerTest } from "../serverSettings.ts";
import { DeepPlanChatReferences } from "./DeepPlanChatReferences.ts";
import { DeepPlanWorkflow, DeepPlanWorkflowLive } from "./DeepPlanWorkflow.ts";

it.effect("refuses to start a Deep Plan before writing if its chats cannot be read", () => {
  const threadId = ThreadId.make("deep-plan-local");
  const denied = new DeepPlanError({
    code: "target-unavailable",
    message: "Link to the selected chat first.",
  });
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.mock(OrchestratorV2)({
      getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      dispatch: () => Effect.die("A Deep Plan was written with inaccessible chats."),
    }),
    Layer.mock(ThreadManagementService)({ hasReceipt: () => Effect.succeed(false) }),
    Layer.mock(ProviderAdapterRegistryV2)({}),
    Layer.mock(DeepPlanChatReferences)({ assertReadable: () => Effect.fail(denied) }),
    layerTest(),
  );
  return Effect.gen(function* () {
    const workflow = yield* DeepPlanWorkflow;
    const error = yield* Effect.flip(
      workflow.dispatch({
        type: "thread.deep-plan.start",
        commandId: CommandId.make("start-plan"),
        threadId,
        chats: [
          {
            environmentId: EnvironmentId.make("linked"),
            projectId: ProjectId.make("linked-project"),
            threadId: ThreadId.make("linked-chat"),
          },
        ],
        includeProjectChats: true,
        createdAt: "2026-11-19T10:00:00.000Z",
      }),
    );
    assert.strictEqual(error, denied);
  }).pipe(Effect.provide(DeepPlanWorkflowLive.pipe(Layer.provide(dependencies))));
});
