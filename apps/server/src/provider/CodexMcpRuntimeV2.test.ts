import { assert, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  McpRuntimeServerKey,
} from "@t3tools/contracts";
import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as CodexReplay from "effect-codex-app-server/replay";
import { makeCodexMcpRuntimeV2 } from "./CodexMcpRuntimeV2.ts";

const status: CodexSchema.V2ListMcpServerStatusResponse__McpServerStatus = {
  name: "docs",
  authStatus: "notLoggedIn",
  runtimeStatus: "authenticationRequired",
  tools: {
    lookup: {
      name: "lookup",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    },
  },
  resources: [],
  resourceTemplates: [],
};
it.effect("queries native Codex MCP inventory, starts OAuth, and fences retired V2 contexts", () =>
  Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    const instanceId = ProviderInstanceId.make("codex-work");
    const target = {
      providerInstanceId: instanceId,
      threadId: ThreadId.make("codex-mcp-thread"),
      runtimeSessionId: RuntimeSessionId.make("codex-v2-session"),
    };
    const owner = Symbol();
    const runtime = makeCodexMcpRuntimeV2(instanceId, undefined);
    yield* runtime.bind({
      owner,
      target,
      nativeThreadId: "native-codex-thread",
      cwd: "/workspace",
      model: "test-model",
      runtimePolicy: { runtimeMode: "full-access", interactionMode: "default", cwd: "/workspace" },
      client,
      isRunning: Effect.succeed(false),
      configuredServers: [],
      builtInExpected: false,
      createdAt: yield* DateTime.now,
    });
    const inventory = yield* runtime.adapter.getSnapshot(target);
    assert.equal(inventory[0]?.state, "auth-required");
    const details = yield* runtime.adapter.getServerDetails!({
      ...target,
      providerKey: McpRuntimeServerKey.make("docs"),
    });
    assert.equal(details.tools[0]?.name, "lookup");
    assert.equal(details.tools[0]?.readOnly, true);
    const authorization = yield* runtime.adapter.runAction!({
      ...target,
      providerKey: McpRuntimeServerKey.make("docs"),
      action: "authorize",
    });
    assert.equal(authorization.authorizationUrl, "https://mcp.example.test/authorize");
    yield* runtime.release(owner);
    assert.equal(
      (yield* runtime.adapter.getSnapshot(target).pipe(Effect.flip))._tag,
      "ProviderAdapterProtocolError",
    );
  }).pipe(
    Effect.provide(
      CodexReplay.layerReplay({
        provider: "codex",
        protocol: "codex.app-server",
        version: "1",
        scenario: "mcp-runtime-v2",
        entries: [
          {
            type: "expect_outbound",
            frame: {
              id: 1,
              method: "mcpServerStatus/list",
              params: { threadId: "native-codex-thread", detail: "toolsAndAuthOnly" },
            },
          },
          { type: "emit_inbound", frame: { id: 1, result: { data: [status], nextCursor: null } } },
          {
            type: "expect_outbound",
            frame: {
              id: 2,
              method: "mcpServerStatus/list",
              params: { threadId: "native-codex-thread", detail: "full", serverName: "docs" },
            },
          },
          { type: "emit_inbound", frame: { id: 2, result: { data: [status], nextCursor: null } } },
          {
            type: "expect_outbound",
            frame: {
              id: 3,
              method: "mcpServer/oauth/login",
              params: { threadId: "native-codex-thread", name: "docs" },
            },
          },
          {
            type: "emit_inbound",
            frame: { id: 3, result: { authorizationUrl: "https://mcp.example.test/authorize" } },
          },
        ],
      }),
    ),
  ),
);
