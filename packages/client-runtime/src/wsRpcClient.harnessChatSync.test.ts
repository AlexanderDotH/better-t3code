import {
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  WS_METHODS,
  type HarnessChatSyncListInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import { createWsRpcClient, type WsTransport } from "./wsRpcClient.ts";

describe("harness chat sync WebSocket client", () => {
  it("routes all four operations through their dedicated methods", async () => {
    const calls: Array<{ readonly tag: string; readonly input: unknown }> = [];
    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      request: async <TSuccess>(
        useClient: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, never, never>,
      ) => {
        void useClient(
          new Proxy(
            {},
            {
              get: (_target, tag: string) => (input: unknown) => {
                calls.push({ tag, input });
                return Effect.succeed({});
              },
            },
          ) as WsRpcProtocolClient,
        );
        return {} as TSuccess;
      },
    } as unknown as WsTransport;
    const client = createWsRpcClient(transport).harnessChatSync;
    const sourceId = HarnessChatSyncSourceId.make("source-1");
    const sessionId = HarnessChatSessionId.make("session-1");
    const listInput = {
      sourceId,
      query: "release",
      includeArchived: false,
      limit: 50,
    } satisfies HarnessChatSyncListInput;

    await client.sources();
    await client.list(listInput);
    await client.run({
      sourceId,
      selection: {
        mode: "allMatching",
        query: "release",
        includeArchived: false,
        excludedSessionIds: [],
      },
      targetResolutions: [],
    });
    await client.status({ sourceId, sessionIds: [sessionId] });

    expect(calls).toEqual([
      { tag: WS_METHODS.harnessChatSyncSources, input: {} },
      { tag: WS_METHODS.harnessChatSyncList, input: listInput },
      {
        tag: WS_METHODS.harnessChatSyncRun,
        input: {
          sourceId,
          selection: {
            mode: "allMatching",
            query: "release",
            includeArchived: false,
            excludedSessionIds: [],
          },
          targetResolutions: [],
        },
      },
      { tag: WS_METHODS.harnessChatSyncStatus, input: { sourceId, sessionIds: [sessionId] } },
    ]);
  });
});
