import {
  ProviderInstanceId,
  WS_METHODS,
  type ProviderAuthConnectEvent,
  type ProviderAuthConnectInput,
  type ProviderAuthDisconnectInput,
  type ProviderAuthDisconnectResult,
  type ProviderAuthSetCredentialInput,
  type ProviderAuthSetCredentialResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { WsRpcProtocolClient } from "./rpc/protocol.ts";
import { createWsRpcClient, type WsTransport } from "./wsRpcClient.ts";

describe("provider auth WebSocket client", () => {
  it("routes connect as a finite event stream and credential changes as unary requests", async () => {
    const instanceId = ProviderInstanceId.make("chatgpt_personal");
    const connectInput = { instanceId, flow: "device-code" } satisfies ProviderAuthConnectInput;
    const disconnectInput = { instanceId } satisfies ProviderAuthDisconnectInput;
    const setCredentialInput = {
      instanceId,
      credential: "sk-or-v1-secret",
    } satisfies ProviderAuthSetCredentialInput;
    const emitted = {
      type: "starting",
      flow: "device-code",
    } satisfies ProviderAuthConnectEvent;
    const disconnected = {
      instanceId,
      auth: { status: "unauthenticated" },
    } satisfies ProviderAuthDisconnectResult;
    const credentialSet = {
      instanceId,
      auth: { status: "authenticated", label: "sk-or-v1-...cret" },
    } satisfies ProviderAuthSetCredentialResult;
    let capturedConnect: ProviderAuthConnectInput | undefined;
    let capturedDisconnect: ProviderAuthDisconnectInput | undefined;
    let capturedSetCredential: ProviderAuthSetCredentialInput | undefined;
    const events: ProviderAuthConnectEvent[] = [];

    const transport = {
      dispose: async () => undefined,
      reconnect: async () => undefined,
      isHeartbeatFresh: () => true,
      requestStream: async <TEvent>(
        useClient: (client: WsRpcProtocolClient) => Stream.Stream<TEvent, never, never>,
        listener: (event: TEvent) => void,
      ) => {
        void useClient({
          [WS_METHODS.serverProviderAuthConnect]: (input: ProviderAuthConnectInput) => {
            capturedConnect = input;
            return Stream.empty;
          },
        } as unknown as WsRpcProtocolClient);
        listener(emitted as TEvent);
      },
      request: async <TSuccess>(
        useClient: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, never, never>,
      ) => {
        let requested: "set-credential" | "disconnect" | undefined;
        void useClient({
          [WS_METHODS.serverProviderAuthSetCredential]: (input: ProviderAuthSetCredentialInput) => {
            capturedSetCredential = input;
            requested = "set-credential";
            return Effect.succeed(credentialSet);
          },
          [WS_METHODS.serverProviderAuthDisconnect]: (input: ProviderAuthDisconnectInput) => {
            capturedDisconnect = input;
            requested = "disconnect";
            return Effect.succeed(disconnected);
          },
        } as unknown as WsRpcProtocolClient);
        if (requested === "set-credential") return credentialSet as TSuccess;
        return disconnected as TSuccess;
      },
    } as unknown as WsTransport;

    const client = createWsRpcClient(transport).server;
    await client.connectProviderAuth(connectInput, (event) => events.push(event));
    const setResult = await client.setProviderAuthCredential(setCredentialInput);
    const result = await client.disconnectProviderAuth(disconnectInput);

    expect(capturedConnect).toEqual(connectInput);
    expect(capturedDisconnect).toEqual(disconnectInput);
    expect(capturedSetCredential).toEqual(setCredentialInput);
    expect(events).toEqual([emitted]);
    expect(result).toEqual(disconnected);
    expect(setResult).toEqual(credentialSet);
  });
});
