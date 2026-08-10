import { WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Rpc, RpcMessage, RpcSchema, RpcSerialization, RpcServer } from "effect/unstable/rpc";

type RpcServerInstance = RpcServer.RpcServer<any>;

type BrowserWsClient = {
  readonly url: URL;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
};

export interface BrowserWsRpcConnection {
  readonly url: URL;
}

export type NormalizedWsRpcRequestBody = {
  _tag: string;
  [key: string]: unknown;
};

type UnaryResolverResult = unknown | Promise<unknown>;

interface BrowserWsRpcHarnessOptions {
  readonly resolveUnary?: (
    request: NormalizedWsRpcRequestBody,
    connection: BrowserWsRpcConnection,
  ) => UnaryResolverResult;
  readonly getInitialStreamValues?: (
    request: NormalizedWsRpcRequestBody,
    connection: BrowserWsRpcConnection,
  ) => ReadonlyArray<unknown> | undefined;
}

interface BrowserWsRpcClientConnection {
  readonly scope: Scope.Closeable;
  readonly serverReady: Promise<RpcServerInstance>;
  readonly requestTags: Map<string | number, string>;
}

const STREAM_METHODS = new Set(
  Array.from(WsRpcGroup.requests.entries())
    .filter(([, rpc]) => RpcSchema.isStreamSchema(rpc.successSchema))
    .map(([method]) => method),
);

const ALL_RPC_METHODS = Array.from(WsRpcGroup.requests.keys());
const SERVER_DISCOVER_SOURCE_CONTROL_RPC = WsRpcGroup.requests.get(
  WS_METHODS.serverDiscoverSourceControl,
)!;
const encodeServerDiscoverSourceControlExit = Schema.encodeUnknownSync(
  Schema.toCodecJson(Rpc.exitSchema(SERVER_DISCOVER_SOURCE_CONTROL_RPC)),
);

function normalizeRequest(tag: string, payload: unknown): NormalizedWsRpcRequestBody {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      _tag: tag,
      ...(payload as Record<string, unknown>),
    };
  }
  return { _tag: tag, payload };
}

function asEffect(result: UnaryResolverResult): Effect.Effect<unknown> {
  if (result instanceof Promise) {
    return Effect.promise(() => result);
  }
  return Effect.succeed(result);
}

export class BrowserWsRpcHarness {
  readonly requests: Array<NormalizedWsRpcRequestBody> = [];

  private readonly parser = RpcSerialization.json.makeUnsafe();
  private connections = new Map<BrowserWsClient, BrowserWsRpcClientConnection>();
  private resolveUnary: NonNullable<BrowserWsRpcHarnessOptions["resolveUnary"]> = () => ({});
  private getInitialStreamValues: NonNullable<
    BrowserWsRpcHarnessOptions["getInitialStreamValues"]
  > = () => [];
  private streamPubSubs = new Map<string, PubSub.PubSub<unknown>>();

  async reset(options?: BrowserWsRpcHarnessOptions): Promise<void> {
    await this.disconnect();
    this.requests.length = 0;
    this.resolveUnary = options?.resolveUnary ?? (() => ({}));
    this.getInitialStreamValues = options?.getInitialStreamValues ?? (() => []);
    this.initializeStreamPubSubs();
  }

  connect(client: BrowserWsClient): void {
    if (this.streamPubSubs.size === 0) {
      this.initializeStreamPubSubs();
    }
    const existing = this.connections.get(client);
    if (existing) {
      void Effect.runPromise(Scope.close(existing.scope, Exit.void)).catch(() => undefined);
    }
    const scope = Effect.runSync(Scope.make());
    const requestTags = new Map<string | number, string>();
    const serverReady = Effect.runPromise(
      Scope.provide(scope)(
        RpcServer.makeNoSerialization(WsRpcGroup, this.makeServerOptions(client, requestTags)),
      ).pipe(Effect.provide(this.makeLayer(client))),
    ) as Promise<RpcServerInstance>;
    this.connections.set(client, { scope, serverReady, requestTags });
  }

  async disconnect(): Promise<void> {
    const connections = Array.from(this.connections.entries());
    this.connections.clear();
    for (const [client] of connections) {
      client.close(1000, "Browser test harness reset");
    }
    await Promise.all(
      connections.map(([, { scope }]) =>
        Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined),
      ),
    );
    for (const pubsub of this.streamPubSubs.values()) {
      Effect.runSync(PubSub.shutdown(pubsub));
    }
    this.streamPubSubs.clear();
  }

  private initializeStreamPubSubs(): void {
    this.streamPubSubs = new Map(
      Array.from(STREAM_METHODS, (method) => [method, Effect.runSync(PubSub.unbounded<unknown>())]),
    );
  }

  async onMessage(client: BrowserWsClient, rawData: string): Promise<void> {
    const connection = this.connections.get(client);
    if (!connection) {
      return;
    }
    const server = await connection.serverReady;
    const messages = this.parser.decode(rawData);
    for (const message of messages) {
      if (message && typeof message === "object" && "_tag" in message && message._tag === "Ping") {
        const encoded = this.parser.encode(RpcMessage.constPong);
        if (typeof encoded === "string") {
          client.send(encoded);
        }
        continue;
      }
      if (
        message &&
        typeof message === "object" &&
        "_tag" in message &&
        message._tag === "Request" &&
        "id" in message &&
        "tag" in message &&
        (typeof message.id === "string" || typeof message.id === "number") &&
        typeof message.tag === "string"
      ) {
        connection.requestTags.set(message.id, message.tag);
      }
      const clientId =
        message &&
        typeof message === "object" &&
        "clientId" in message &&
        typeof message.clientId === "number"
          ? message.clientId
          : 0;
      try {
        await Effect.runPromise(server.write(clientId, message as never));
      } catch (error) {
        if (this.connections.get(client) !== connection) {
          return;
        }
        throw error;
      }
    }
  }

  emitStreamValue(method: string, value: unknown): void {
    const pubsub = this.streamPubSubs.get(method);
    if (!pubsub) {
      throw new Error(`No stream registered for ${method}`);
    }
    Effect.runSync(PubSub.publish(pubsub, value));
  }

  private makeLayer(connection: BrowserWsRpcConnection) {
    const handlers: Record<string, (payload: unknown) => unknown> = {};
    for (const method of ALL_RPC_METHODS) {
      handlers[method] = STREAM_METHODS.has(method)
        ? (payload) => this.handleStream(method, payload, connection)
        : (payload) => this.handleUnary(method, payload, connection);
    }
    return WsRpcGroup.toLayer(handlers as never);
  }

  private makeServerOptions(client: BrowserWsClient, requestTags: Map<string | number, string>) {
    return {
      onFromServer: (response: unknown) =>
        Effect.sync(() => {
          const encoded = this.parser.encode(this.encodeResponse(response, requestTags));
          if (typeof encoded === "string") {
            client.send(encoded);
          }
        }),
    };
  }

  private encodeResponse(response: unknown, requestTags: Map<string | number, string>): unknown {
    if (
      !response ||
      typeof response !== "object" ||
      !("_tag" in response) ||
      response._tag !== "Exit" ||
      !("requestId" in response) ||
      !("exit" in response) ||
      (typeof response.requestId !== "string" && typeof response.requestId !== "number")
    ) {
      return response;
    }
    const tag = requestTags.get(response.requestId);
    if (tag !== WS_METHODS.serverDiscoverSourceControl) {
      requestTags.delete(response.requestId);
      return response;
    }
    const exit = encodeServerDiscoverSourceControlExit(response.exit);
    requestTags.delete(response.requestId);
    return { ...response, exit };
  }

  private handleUnary(method: string, payload: unknown, connection: BrowserWsRpcConnection) {
    const request = normalizeRequest(method, payload);
    this.requests.push(request);
    return asEffect(this.resolveUnary(request, connection));
  }

  private handleStream(method: string, payload: unknown, connection: BrowserWsRpcConnection) {
    const request = normalizeRequest(method, payload);
    this.requests.push(request);
    const pubsub = this.streamPubSubs.get(method);
    if (!pubsub) {
      throw new Error(`No stream registered for ${method}`);
    }
    return Stream.fromIterable(this.getInitialStreamValues(request, connection) ?? []).pipe(
      Stream.concat(Stream.fromPubSub(pubsub)),
    );
  }
}
