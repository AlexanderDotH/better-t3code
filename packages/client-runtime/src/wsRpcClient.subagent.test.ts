import { ORCHESTRATION_WS_METHODS, SubagentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Stream from "effect/Stream";

import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import { createWsRpcClient, type WsTransport } from "./wsRpcClient.ts";

describe("subagent WebSocket client", () => {
  it("subscribes with the dedicated method tag and routing input", () => {
    const input = {
      threadId: ThreadId.make("thread-transport"),
      subagentId: SubagentId.make("agent-contracts"),
      afterSequence: 42,
    };
    let capturedInput: unknown;
    let capturedTag: string | undefined;

    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      subscribe: (
        useClient: (client: WsRpcProtocolClient) => unknown,
        _listener: (event: unknown) => void,
        options: { readonly tag: string },
      ) => {
        capturedTag = options.tag;
        useClient({
          [ORCHESTRATION_WS_METHODS.subscribeSubagent]: (receivedInput: unknown) => {
            capturedInput = receivedInput;
            return Stream.empty;
          },
        } as unknown as WsRpcProtocolClient);
        return () => undefined;
      },
    } as unknown as WsTransport;

    createWsRpcClient(transport).orchestration.subscribeSubagent(input, () => undefined);

    expect(capturedTag).toBe(ORCHESTRATION_WS_METHODS.subscribeSubagent);
    expect(capturedInput).toEqual(input);
  });
});
