import type {
  EnvironmentId,
  McpRuntimeContext,
  McpRuntimeServer,
  McpRuntimeServerDetailsResult,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createMcpRuntimeDetailsTarget,
  isMcpRuntimeDetailsTargetCurrent,
  mcpRuntimeContextId,
  toMcpRuntimeContextView,
  toMcpRuntimeServerView,
} from "./mcpManagementView";

const context: McpRuntimeContext = {
  providerInstanceId: "codex" as ProviderInstanceId,
  driver: "codex" as McpRuntimeContext["driver"],
  threadId: "thread-1" as ThreadId,
  runtimeSessionId: "runtime-1" as RuntimeSessionId,
  projectCwd: "/workspace/better-t3code",
  threadTitle: "MCP repair",
  state: "active",
  updatedAt: "2026-08-03T12:00:00.000Z",
};

const runtimeServer: McpRuntimeServer = {
  providerInstanceId: context.providerInstanceId,
  threadId: context.threadId,
  runtimeSessionId: context.runtimeSessionId,
  providerKey: "notion" as McpRuntimeServer["providerKey"],
  serverId: "notion" as NonNullable<McpRuntimeServer["serverId"]>,
  name: "Notion",
  source: "t3-managed",
  transport: "http",
  state: "auth-required",
  statusSource: "provider-query",
  observedAt: context.updatedAt,
  authState: "required",
  availableActions: ["authorize", "refresh"],
  reportsTools: true,
  configDrift: "pending-enable",
};

describe("MCP management view mapping", () => {
  it("uses the thread and exact runtime session as the context identity", () => {
    expect(mcpRuntimeContextId(context)).toBe("thread-1:runtime-1");
    expect(toMcpRuntimeContextView(context)).toMatchObject({
      id: "thread-1:runtime-1",
      label: "better-t3code · MCP repair",
      live: true,
    });
  });

  it("keeps host-only authorization visible but unavailable on remote clients", () => {
    expect(toMcpRuntimeServerView(runtimeServer, undefined, false, false)).toMatchObject({
      authLabel: "Authorization required · complete sign-in on the environment host",
      capabilities: { authorize: false, refresh: true },
    });
  });

  it("projects the complete lazy inventory without dropping resources or templates", () => {
    const view = toMcpRuntimeServerView(runtimeServer, {
      server: runtimeServer,
      tools: [{ name: "search" }],
      resources: [{ uri: "notion://readme", name: "readme" }],
      templates: [{ uriTemplate: "notion://database/{id}", name: "database" }],
    });

    expect(view.tools).toEqual([{ name: "search" }]);
    expect(view.resources).toEqual([{ uri: "notion://readme", name: "readme" }]);
    expect(view.templates).toEqual([{ uriTemplate: "notion://database/{id}", name: "database" }]);
  });
});

describe("MCP runtime detail fencing", () => {
  const target = createMcpRuntimeDetailsTarget({
    environmentId: "env-1" as EnvironmentId,
    providerInstanceId: context.providerInstanceId,
    threadId: context.threadId,
    runtimeSessionId: context.runtimeSessionId,
    providerKey: runtimeServer.providerKey,
  });

  it("accepts details only for the complete current selector and provider key", () => {
    const details = {
      server: runtimeServer,
      tools: [],
      resources: [],
      templates: [],
    } as McpRuntimeServerDetailsResult;
    expect(isMcpRuntimeDetailsTargetCurrent(target, { target, details })).toBe(true);
    expect(
      isMcpRuntimeDetailsTargetCurrent(
        { ...target, runtimeSessionId: "runtime-2" as RuntimeSessionId },
        { target, details },
      ),
    ).toBe(false);
    expect(
      isMcpRuntimeDetailsTargetCurrent(
        { ...target, providerKey: "github" as McpRuntimeServer["providerKey"] },
        { target, details },
      ),
    ).toBe(false);
  });
});
