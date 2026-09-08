import {
  McpRuntimeServerKey,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type McpRuntimeChange,
  type McpRuntimeServer,
  type McpRuntimeSnapshot,
  type McpRuntimeSnapshotInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyMcpRuntimeChange } from "./runtimeProjection.ts";

const selector = {
  providerInstanceId: ProviderInstanceId.make("codex-work"),
  threadId: ThreadId.make("thread-one"),
  runtimeSessionId: RuntimeSessionId.make("runtime-one"),
} satisfies McpRuntimeSnapshotInput;

function server(providerKey: string, overrides: Partial<McpRuntimeServer> = {}): McpRuntimeServer {
  return {
    providerKey: McpRuntimeServerKey.make(providerKey),
    source: "t3-managed",
    providerInstanceId: selector.providerInstanceId,
    threadId: selector.threadId,
    runtimeSessionId: selector.runtimeSessionId,
    name: providerKey,
    state: "connected",
    statusSource: "provider-query",
    observedAt: "2026-08-03T10:00:00.000Z",
    authState: "authenticated",
    availableActions: ["refresh"],
    reportsTools: true,
    configDrift: "none",
    ...overrides,
  };
}

function snapshot(
  revision: number,
  servers: readonly McpRuntimeServer[],
  observedAt = "2026-08-03T10:00:00.000Z",
  input: McpRuntimeSnapshotInput = selector,
): McpRuntimeSnapshot {
  return {
    context: {
      ...input,
      driver: ProviderDriverKind.make("codex"),
      state: "active",
      updatedAt: observedAt,
    },
    revision,
    observedAt,
    servers,
  };
}

function snapshotChange(value: McpRuntimeSnapshot): McpRuntimeChange {
  return { type: "snapshot", snapshot: value };
}

describe("MCP runtime projection", () => {
  it("waits for an authoritative snapshot before exposing runtime state", () => {
    const delta: McpRuntimeChange = {
      type: "server-upserted",
      revision: 1,
      observedAt: "2026-08-03T10:00:01.000Z",
      server: server("notion"),
    };

    expect(applyMcpRuntimeChange(null, delta, selector)).toBeNull();
    expect(
      applyMcpRuntimeChange(null, snapshotChange(snapshot(1, [server("notion")])), selector),
    ).toEqual(snapshot(1, [server("notion")]));
  });

  it("accumulates upserts and removals into a complete late-consumer snapshot", () => {
    const initial = applyMcpRuntimeChange(
      null,
      snapshotChange(snapshot(1, [server("notion"), server("linear")])),
      selector,
    );
    const upserted = applyMcpRuntimeChange(
      initial,
      {
        type: "server-upserted",
        revision: 2,
        observedAt: "2026-08-03T10:00:02.000Z",
        server: server("github"),
      },
      selector,
    );
    const removed = applyMcpRuntimeChange(
      upserted,
      {
        type: "server-removed",
        revision: 3,
        observedAt: "2026-08-03T10:00:03.000Z",
        providerKey: McpRuntimeServerKey.make("notion"),
      },
      selector,
    );

    expect(removed?.revision).toBe(3);
    expect(removed?.servers.map((entry) => entry.providerKey)).toEqual(["linear", "github"]);
  });

  it("rejects stale deltas and older equal-revision snapshots", () => {
    const current = snapshot(3, [server("current")], "2026-08-03T10:00:03.000Z");

    expect(
      applyMcpRuntimeChange(
        current,
        {
          type: "server-upserted",
          revision: 3,
          observedAt: "2026-08-03T10:00:04.000Z",
          server: server("stale"),
        },
        selector,
      ),
    ).toBe(current);
    expect(
      applyMcpRuntimeChange(
        current,
        snapshotChange(snapshot(3, [server("older")], "2026-08-03T10:00:02.000Z")),
        selector,
      ),
    ).toBe(current);
  });

  it("accepts an equal-revision authoritative snapshot when it is not older", () => {
    const current = snapshot(3, [server("stale")], "2026-08-03T10:00:03.000Z");
    const replacement = snapshot(3, [server("current")], "2026-08-03T10:00:04.000Z");

    expect(applyMcpRuntimeChange(current, snapshotChange(replacement), selector)).toBe(replacement);
  });

  it("replaces the complete accumulated server set on a reconnect snapshot", () => {
    const current = snapshot(4, [server("notion"), server("linear")]);
    const replacement = snapshot(5, [server("github")], "2026-08-03T10:00:05.000Z");

    expect(applyMcpRuntimeChange(current, snapshotChange(replacement), selector)).toBe(replacement);
  });

  it("accepts a lower-revision snapshot from a newer server epoch", () => {
    const current = snapshot(12, [server("before-restart")], "2026-08-03T10:00:12.000Z");
    const replacement = snapshot(1, [server("after-restart")], "2026-08-03T10:01:00.000Z");

    expect(applyMcpRuntimeChange(current, snapshotChange(replacement), selector)).toBe(replacement);
  });

  it("rejects snapshots and server updates from another runtime selector", () => {
    const current = snapshot(1, [server("notion")]);
    const otherRuntime = RuntimeSessionId.make("runtime-two");
    const wrongSelector = { ...selector, runtimeSessionId: otherRuntime };

    expect(
      applyMcpRuntimeChange(
        current,
        snapshotChange(snapshot(2, [server("wrong")], undefined, wrongSelector)),
        selector,
      ),
    ).toBe(current);
    expect(
      applyMcpRuntimeChange(
        current,
        {
          type: "server-upserted",
          revision: 2,
          observedAt: "2026-08-03T10:00:02.000Z",
          server: server("wrong", { runtimeSessionId: otherRuntime }),
        },
        selector,
      ),
    ).toBe(current);
  });
});
