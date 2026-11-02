import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  McpRuntimeServerKey,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ClaudeAgentSdkQuerySession } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { makeClaudeMcpRuntimeV2 } from "./ClaudeMcpRuntimeV2.ts";

const emptyQuery: ClaudeAgentSdkQuerySession = {
  messages: Stream.empty,
  offer: () => Effect.void,
  setModel: () => Effect.void,
  applyFlagSettings: () => Effect.void,
  setPermissionMode: () => Effect.void,
  stopTask: () => Effect.void,
  backgroundTasks: () => Effect.succeed(false),
  interrupt: Effect.void,
  close: Effect.void,
  mcpServerStatus: Effect.succeed([]),
};

it.effect("uses native Claude status and reconnect APIs and replaces configured servers live", () =>
  Effect.gen(function* () {
    const reconnected: Array<string> = [];
    let configured = false;
    const query: ClaudeAgentSdkQuerySession = {
      ...emptyQuery,
      mcpServerStatus: Effect.succeed([
        {
          name: "docs",
          status: "connected",
          tools: [{ name: "lookup", annotations: { readOnly: true } }],
        },
      ]),
      reconnectMcpServer: (name) =>
        Effect.sync(() => {
          reconnected.push(name);
        }),
      setMcpServers: (servers) =>
        Effect.sync(() => {
          configured = Object.hasOwn(servers, "docs");
          return "applied" as const;
        }),
    };
    const instanceId = ProviderInstanceId.make("claude-work");
    const target = {
      providerInstanceId: instanceId,
      threadId: ThreadId.make("claude-mcp-thread"),
      runtimeSessionId: RuntimeSessionId.make("claude-v2-session"),
    };
    const runtime = makeClaudeMcpRuntimeV2(instanceId, undefined);
    yield* runtime.bind({
      owner: Symbol(),
      target,
      query,
      cwd: "/workspace",
      model: "test-model",
      runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: "/workspace" },
      configuredServers: [],
      builtInExpected: false,
      isRunning: Effect.succeed(false),
      resolveServers: Effect.succeed({
        servers: { docs: { type: "http", url: "https://mcp.example.test" } },
        definitions: [],
      }),
      createdAt: yield* DateTime.now,
    });
    assert.equal((yield* runtime.adapter.getSnapshot(target))[0]?.state, "connected");
    const details = yield* runtime.adapter.getServerDetails!({
      ...target,
      providerKey: McpRuntimeServerKey.make("docs"),
    });
    assert.isTrue(details.tools[0]?.readOnly === true);
    assert.isTrue(
      (yield* runtime.adapter.runAction!({
        ...target,
        providerKey: McpRuntimeServerKey.make("docs"),
        action: "reconnect",
      })).accepted,
    );
    assert.deepEqual(reconnected, ["docs"]);
    assert.equal(yield* runtime.adapter.applyConfiguration!(target), "applied");
    assert.isTrue(configured);
    yield* runtime.releaseQuery(query);
    assert.equal(
      (yield* runtime.adapter.getSnapshot(target).pipe(Effect.flip))._tag,
      "ProviderAdapterProtocolError",
    );
  }),
);

it.effect("rejects configuration results from a query replaced during resolution", () =>
  Effect.gen(function* () {
    const instanceId = ProviderInstanceId.make("claude-work");
    const target = {
      providerInstanceId: instanceId,
      threadId: ThreadId.make("claude-mcp-thread"),
      runtimeSessionId: RuntimeSessionId.make("claude-v2-session"),
    };
    const runtime = makeClaudeMcpRuntimeV2(instanceId, undefined);
    const owner = Symbol();
    let configured = false;
    const binding = {
      owner,
      target,
      query: {
        ...emptyQuery,
        setMcpServers: () =>
          Effect.sync(() => {
            configured = true;
            return "applied" as const;
          }),
      },
      cwd: "/workspace",
      model: "test-model",
      runtimePolicy: {
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        cwd: "/workspace",
      },
      configuredServers: [],
      builtInExpected: false,
      isRunning: Effect.succeed(false),
      resolveServers: Effect.succeed({ servers: {}, definitions: [] }),
      createdAt: yield* DateTime.now,
    };
    yield* runtime.bind({
      ...binding,
      resolveServers: Effect.gen(function* () {
        yield* runtime.bind({ ...binding, owner: Symbol(), query: emptyQuery });
        return { servers: {}, definitions: [] };
      }),
    });
    const failure = yield* runtime.adapter.applyConfiguration!(target).pipe(Effect.flip);
    assert.equal(failure._tag, "ProviderAdapterProtocolError");
    assert.isFalse(configured);
    yield* runtime.release(owner);
    assert.deepEqual(yield* runtime.adapter.getSnapshot(target), []);
  }),
);
