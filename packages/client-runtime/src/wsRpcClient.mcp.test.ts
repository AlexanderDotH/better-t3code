import {
  ProviderInstanceId,
  McpRuntimeServerKey,
  RuntimeSessionId,
  ThreadId,
  WS_METHODS,
  type McpRuntimeActionInput,
  type McpRuntimeChange,
  type McpRuntimeContextChange,
  type McpRuntimeContextChangesInput,
  type McpRuntimeSnapshotInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import { createWsRpcClient, type WsTransport } from "./wsRpcClient.ts";

const selector = {
  providerInstanceId: ProviderInstanceId.make("codex_work"),
  threadId: ThreadId.make("thread-1"),
  runtimeSessionId: RuntimeSessionId.make("runtime-1"),
} satisfies McpRuntimeSnapshotInput;

describe("MCP WebSocket client", () => {
  it("routes runtime actions through the generation-fenced method", async () => {
    const input = {
      ...selector,
      providerKey: McpRuntimeServerKey.make("notion"),
      action: "authorize",
    } satisfies McpRuntimeActionInput;
    let capturedInput: McpRuntimeActionInput | undefined;

    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      request: async <TSuccess>(
        useClient: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, never, never>,
      ) => {
        void useClient({
          [WS_METHODS.mcpRuntimeAction]: (receivedInput: McpRuntimeActionInput) => {
            capturedInput = receivedInput;
            return Effect.succeed({
              accepted: true,
              action: receivedInput.action,
              providerKey: receivedInput.providerKey,
              authorizationUrl: "https://example.com/oauth",
            });
          },
        } as unknown as WsRpcProtocolClient);
        return {
          accepted: true,
          action: input.action,
          providerKey: input.providerKey,
          authorizationUrl: "https://example.com/oauth",
        } as TSuccess;
      },
    } as unknown as WsTransport;

    const result = await createWsRpcClient(transport).mcp.runtimeAction(input);

    expect(capturedInput).toEqual(input);
    expect(result.authorizationUrl).toBe("https://example.com/oauth");
  });

  it("subscribes to runtime changes with the exact runtime selector", () => {
    let capturedInput: McpRuntimeSnapshotInput | undefined;
    let capturedTag: string | undefined;
    const changes: McpRuntimeChange[] = [];

    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      subscribe: <TEvent>(
        useClient: (client: WsRpcProtocolClient) => Stream.Stream<TEvent, never, never>,
        listener: (event: TEvent) => void,
        options: { readonly tag: string },
      ) => {
        const stream = useClient({
          [WS_METHODS.mcpRuntimeChanges]: (receivedInput: McpRuntimeSnapshotInput) => {
            capturedInput = receivedInput;
            return Stream.empty;
          },
        } as unknown as WsRpcProtocolClient);
        void stream;
        void listener;
        capturedTag = options.tag;
        return () => undefined;
      },
    } as unknown as WsTransport;

    const unsubscribe = createWsRpcClient(transport).mcp.runtimeChanges(selector, (change) => {
      changes.push(change);
    });

    expect(capturedInput).toEqual(selector);
    expect(capturedTag).toBe(WS_METHODS.mcpRuntimeChanges);
    expect(changes).toEqual([]);
    unsubscribe();
  });

  it("subscribes to provider context lifecycle changes by provider account", () => {
    const input = {
      providerInstanceId: selector.providerInstanceId,
    } satisfies McpRuntimeContextChangesInput;
    let capturedInput: McpRuntimeContextChangesInput | undefined;
    let capturedTag: string | undefined;

    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      subscribe: <TEvent>(
        useClient: (client: WsRpcProtocolClient) => Stream.Stream<TEvent, never, never>,
        listener: (event: TEvent) => void,
        options: { readonly tag: string },
      ) => {
        const stream = useClient({
          [WS_METHODS.mcpRuntimeContextChanges]: (receivedInput: McpRuntimeContextChangesInput) => {
            capturedInput = receivedInput;
            return Stream.empty as Stream.Stream<McpRuntimeContextChange>;
          },
        } as unknown as WsRpcProtocolClient);
        void stream;
        void listener;
        capturedTag = options.tag;
        return () => undefined;
      },
    } as unknown as WsTransport;

    const unsubscribe = createWsRpcClient(transport).mcp.runtimeContextChanges(input, () => {});

    expect(capturedInput).toEqual(input);
    expect(capturedTag).toBe(WS_METHODS.mcpRuntimeContextChanges);
    unsubscribe();
  });
});
