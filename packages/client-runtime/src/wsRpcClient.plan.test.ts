import {
  ProviderInstanceId,
  OrchestrationProposedPlanId,
  ThreadId,
  WS_METHODS,
  type PlanParallelismReviewInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import { createWsRpcClient, type WsTransport } from "./wsRpcClient.ts";

describe("plan review WebSocket client", () => {
  it("routes plan parallelism reviews through the dedicated method", async () => {
    const input = {
      threadId: ThreadId.make("thread-review"),
      planId: OrchestrationProposedPlanId.make("plan-review"),
      expectedPlanUpdatedAt: "2026-07-31T12:00:00.000Z",
      implementationProviderInstanceId: ProviderInstanceId.make("codex"),
    } satisfies PlanParallelismReviewInput;
    let capturedInput: PlanParallelismReviewInput | undefined;

    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      request: async <TSuccess>(
        useClient: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, never, never>,
      ) => {
        void useClient({
          [WS_METHODS.planReviewParallelism]: (receivedInput: PlanParallelismReviewInput) => {
            capturedInput = receivedInput;
            return Effect.succeed({
              planId: receivedInput.planId,
              planUpdatedAt: receivedInput.expectedPlanUpdatedAt,
              implementationProviderInstanceId: receivedInput.implementationProviderInstanceId,
              recommendedSubagents: 5,
            });
          },
        } as unknown as WsRpcProtocolClient);
        return {
          planId: input.planId,
          planUpdatedAt: input.expectedPlanUpdatedAt,
          implementationProviderInstanceId: input.implementationProviderInstanceId,
          recommendedSubagents: 5,
        } as TSuccess;
      },
    } as unknown as WsTransport;

    const result = await createWsRpcClient(transport).plan.reviewParallelism(input);

    expect(capturedInput).toEqual(input);
    expect(result.recommendedSubagents).toBe(5);
  });
});
