import type { McpRuntimeServer, McpRuntimeSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveMcpManagementSummary } from "./mcpManagementSummary";

function runtimeServer(
  overrides: Partial<McpRuntimeServer> & Pick<McpRuntimeServer, "providerKey" | "name" | "source">,
): McpRuntimeServer {
  return {
    providerInstanceId: "codex" as McpRuntimeServer["providerInstanceId"],
    threadId: "thread-1" as McpRuntimeServer["threadId"],
    runtimeSessionId: "runtime-1" as McpRuntimeServer["runtimeSessionId"],
    state: "connected",
    statusSource: "provider-query",
    observedAt: "2026-08-03T12:00:00.000Z",
    authState: "authenticated",
    availableActions: [],
    reportsTools: true,
    configDrift: "none",
    ...overrides,
  };
}

function snapshot(servers: ReadonlyArray<McpRuntimeServer>): McpRuntimeSnapshot {
  return {
    context: {
      providerInstanceId: "codex" as McpRuntimeSnapshot["context"]["providerInstanceId"],
      driver: "codex" as McpRuntimeSnapshot["context"]["driver"],
      threadId: "thread-1" as McpRuntimeSnapshot["context"]["threadId"],
      runtimeSessionId: "runtime-1" as McpRuntimeSnapshot["context"]["runtimeSessionId"],
      state: "active",
      updatedAt: "2026-08-03T12:00:00.000Z",
    },
    revision: 3,
    observedAt: "2026-08-03T12:00:00.000Z",
    servers,
  };
}

describe("deriveMcpManagementSummary", () => {
  it("excludes the locked T3 server from user-server health and tool totals", () => {
    const summary = deriveMcpManagementSummary({
      applicableConfiguredCount: 1,
      runtimeSupported: true,
      snapshot: snapshot([
        runtimeServer({
          providerKey: "notion" as McpRuntimeServer["providerKey"],
          name: "Notion",
          source: "t3-managed",
          toolCount: 7,
        }),
        runtimeServer({
          providerKey: "t3-code" as McpRuntimeServer["providerKey"],
          name: "T3 Code",
          source: "t3-built-in",
          toolCount: 12,
        }),
      ]),
    });

    expect(summary).toMatchObject({
      mode: "live",
      connectedCount: 1,
      expectedCount: 1,
      attentionCount: 0,
      knownToolCount: 7,
    });
  });

  it("counts authentication, failures, stale state, and drift as textual attention", () => {
    const summary = deriveMcpManagementSummary({
      applicableConfiguredCount: 3,
      runtimeSupported: true,
      snapshot: snapshot([
        runtimeServer({
          providerKey: "auth" as McpRuntimeServer["providerKey"],
          name: "Auth",
          source: "t3-managed",
          state: "auth-required",
        }),
        runtimeServer({
          providerKey: "failed" as McpRuntimeServer["providerKey"],
          name: "Failed",
          source: "provider-native",
          state: "failed",
        }),
        runtimeServer({
          providerKey: "drift" as McpRuntimeServer["providerKey"],
          name: "Drift",
          source: "t3-managed",
          state: "connected",
          configDrift: "pending-disable",
        }),
      ]),
    });

    expect(summary.attentionCount).toBe(3);
    expect(summary.statusLabel).toBe("3 need attention");
  });

  it("reports unknown tools instead of a false zero when telemetry is incomplete", () => {
    const summary = deriveMcpManagementSummary({
      applicableConfiguredCount: 1,
      runtimeSupported: true,
      snapshot: snapshot([
        runtimeServer({
          providerKey: "notion" as McpRuntimeServer["providerKey"],
          name: "Notion",
          source: "t3-managed",
          reportsTools: false,
        }),
      ]),
    });

    expect(summary.knownToolCount).toBeNull();
  });

  it("keeps the expected denominator at least as large as applicable configuration", () => {
    const summary = deriveMcpManagementSummary({
      applicableConfiguredCount: 3,
      runtimeSupported: true,
      snapshot: snapshot([
        runtimeServer({
          providerKey: "notion" as McpRuntimeServer["providerKey"],
          name: "Notion",
          source: "t3-managed",
          toolCount: 7,
        }),
      ]),
    });

    expect(summary).toMatchObject({
      connectedCount: 1,
      expectedCount: 3,
      knownToolCount: null,
      statusLabel: "1/3 connected",
    });
  });

  it("does not present unsupported runtime rows as observed connection health", () => {
    const summary = deriveMcpManagementSummary({
      applicableConfiguredCount: 2,
      runtimeSupported: true,
      snapshot: snapshot([
        runtimeServer({
          providerKey: "native" as McpRuntimeServer["providerKey"],
          name: "Provider native",
          source: "provider-native",
          state: "unsupported",
        }),
      ]),
    });

    expect(summary).toMatchObject({
      connectedCount: 0,
      expectedCount: 2,
      attentionCount: 0,
      knownToolCount: null,
      statusLabel: "2 configured · runtime status unavailable",
    });
  });

  it("distinguishes next-session configuration from old-server upgrade state", () => {
    expect(
      deriveMcpManagementSummary({
        applicableConfiguredCount: 2,
        runtimeSupported: true,
        snapshot: null,
      }),
    ).toMatchObject({ mode: "next-session", statusLabel: "2 configured · next session" });

    expect(
      deriveMcpManagementSummary({
        applicableConfiguredCount: 2,
        runtimeSupported: false,
        snapshot: null,
      }),
    ).toMatchObject({ mode: "upgrade-required", statusLabel: "2 configured · upgrade required" });
  });
});
