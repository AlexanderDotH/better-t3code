import {
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  McpRuntimeServerKey,
  McpServerId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type McpRuntimeActionInput,
  type McpRuntimeChange,
  type McpRuntimeSnapshotInput,
  type McpSetProviderEnabledInput,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { WsRpcClient } from "@t3tools/client-runtime/wsRpcClient";
import { createEnvironmentApi } from "./environmentApi";

const selector = {
  providerInstanceId: ProviderInstanceId.make("codex_work"),
  threadId: ThreadId.make("thread-1"),
  runtimeSessionId: RuntimeSessionId.make("runtime-1"),
} satisfies McpRuntimeSnapshotInput;

function rpcClientWithMcp(mcp: Record<string, unknown>): WsRpcClient {
  return {
    terminal: {},
    projects: {},
    filesystem: {},
    assets: {},
    sourceControl: {},
    vcs: {},
    git: {},
    review: {},
    chatImport: {},
    harnessChatSync: {},
    skills: {},
    mcp,
    orchestration: {},
    plan: {},
    preview: {},
  } as unknown as WsRpcClient;
}

describe("MCP environment API", () => {
  it("forwards provider mutations and runtime actions to the environment client", async () => {
    const providerInput = {
      serverId: McpServerId.make("notion"),
      providerInstanceId: ProviderInstanceId.make("codex_work"),
      enabled: true,
    } satisfies McpSetProviderEnabledInput;
    const actionInput = {
      ...selector,
      providerKey: McpRuntimeServerKey.make("notion"),
      action: "authorize",
    } satisfies McpRuntimeActionInput;
    const setProviderEnabled = vi.fn(async () => ({ servers: [], liveApplyResults: [] }));
    const runtimeAction = vi.fn(async () => ({
      accepted: true,
      action: actionInput.action,
      providerKey: actionInput.providerKey,
      authorizationUrl: "https://example.com/oauth",
    }));
    const api = createEnvironmentApi(rpcClientWithMcp({ setProviderEnabled, runtimeAction }));

    await expect(api.mcp.setProviderEnabled(providerInput)).resolves.toEqual({
      servers: [],
      liveApplyResults: [],
    });
    await expect(api.mcp.runtimeAction(actionInput)).resolves.toMatchObject({ accepted: true });
    expect(setProviderEnabled).toHaveBeenCalledWith(providerInput);
    expect(runtimeAction).toHaveBeenCalledWith(actionInput);
  });

  it("forwards the exact runtime selector to the change subscription", () => {
    const change = { type: "server-removed", revision: 3 } as unknown as McpRuntimeChange;
    const unsubscribe = vi.fn();
    const runtimeChanges = vi.fn(
      (input: McpRuntimeSnapshotInput, callback: (next: McpRuntimeChange) => void) => {
        callback(change);
        return unsubscribe;
      },
    );
    const api = createEnvironmentApi(rpcClientWithMcp({ runtimeChanges }));
    const listener = vi.fn();

    const stop = api.mcp.runtimeChanges(selector, listener);

    expect(runtimeChanges).toHaveBeenCalledWith(selector, listener);
    expect(listener).toHaveBeenCalledWith(change);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("harness chat sync environment API", () => {
  it("forwards every history operation to the selected environment client", async () => {
    const sourceId = HarnessChatSyncSourceId.make("codex-home");
    const sessionId = HarnessChatSessionId.make("session-1");
    const sources = vi.fn(async () => ({ sources: [] }));
    const list = vi.fn(async () => ({
      chats: [],
      nextCursor: null,
      totalMatching: 0,
      changedMatching: 0,
    }));
    const run = vi.fn(async () => ({
      selectedCount: 0,
      syncedCount: 0,
      failedCount: 0,
      threadsCreated: 0,
      threadsUpdated: 0,
      messagesImported: 0,
      attachmentsImported: 0,
      attachmentsSkipped: 0,
      items: [],
      failures: [],
    }));
    const status = vi.fn(async () => ({ statuses: [] }));
    const api = createEnvironmentApi({
      terminal: {},
      projects: {},
      filesystem: {},
      assets: {},
      sourceControl: {},
      vcs: {},
      git: {},
      review: {},
      chatImport: {},
      harnessChatSync: { sources, list, run, status },
      skills: {},
      mcp: {},
      orchestration: {},
      plan: {},
      preview: {},
    } as unknown as WsRpcClient);
    const listInput = {
      sourceId,
      query: "release",
      includeArchived: false,
      limit: 25,
    } as const;
    const runInput = {
      sourceId,
      selection: {
        mode: "only" as const,
        sessionIds: [sessionId],
      },
      targetResolutions: [],
    };
    const statusInput = { sourceId, sessionIds: [sessionId] };

    await api.harnessChatSync.sources({});
    await api.harnessChatSync.list(listInput);
    await api.harnessChatSync.run(runInput);
    await api.harnessChatSync.status(statusInput);

    expect(sources).toHaveBeenCalledWith({});
    expect(list).toHaveBeenCalledWith(listInput);
    expect(run).toHaveBeenCalledWith(runInput);
    expect(status).toHaveBeenCalledWith(statusInput);
  });
});
