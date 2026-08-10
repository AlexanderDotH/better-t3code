import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ServerProvider } from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding provider snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.versionAdvisory).toBeUndefined();
    expect(parsed.updateState).toBeUndefined();
    expect(parsed.nativeSubagents).toBeUndefined();
    expect(parsed.fetchWorkers).toBeUndefined();
  });

  it("decodes Fetch worker capabilities", () => {
    const parsed = decodeServerProvider({
      instanceId: "claude_work",
      driver: "claudeAgent",
      fetchWorkers: {
        maxRecommendedWorkers: 12,
        commandExecutionPolicy: "deny",
      },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.fetchWorkers).toEqual({
      maxRecommendedWorkers: 12,
      commandExecutionPolicy: "deny",
    });
  });

  it("rejects invalid Fetch worker budgets and policies", () => {
    const provider = {
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    };

    expect(() =>
      decodeServerProvider({
        ...provider,
        fetchWorkers: {
          maxRecommendedWorkers: 0,
          commandExecutionPolicy: "read-only-sandbox",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerProvider({
        ...provider,
        fetchWorkers: {
          maxRecommendedWorkers: 1.5,
          commandExecutionPolicy: "read-only-sandbox",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerProvider({
        ...provider,
        fetchWorkers: {
          maxRecommendedWorkers: 8,
          commandExecutionPolicy: "allow",
        },
      }),
    ).toThrow();
  });

  it("decodes native subagent capabilities", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      nativeSubagents: {
        toolName: "spawn_agent",
        maxRecommendedSubagents: 4,
      },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.nativeSubagents).toEqual({
      toolName: "spawn_agent",
      maxRecommendedSubagents: 4,
    });
  });

  it("rejects invalid native subagent capabilities", () => {
    const provider = {
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    };

    expect(() =>
      decodeServerProvider({
        ...provider,
        nativeSubagents: {
          toolName: " ",
          maxRecommendedSubagents: 4,
        },
      }),
    ).toThrow();
    expect(() =>
      decodeServerProvider({
        ...provider,
        nativeSubagents: {
          toolName: "spawn_agent",
          maxRecommendedSubagents: 0,
        },
      }),
    ).toThrow();
  });

  it("defaults one-click update support when decoding older advisory snapshots", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        updateCommand: "npm install -g @openai/codex@latest",
        checkedAt: "2026-04-10T00:00:00.000Z",
        message: "Update available.",
      },
    });

    expect(parsed.versionAdvisory?.canUpdate).toBe(false);
  });

  it("decodes continuation group metadata", () => {
    const parsed = decodeServerProvider({
      instanceId: "codex_personal",
      driver: "codex",
      continuation: { groupKey: "codex:home:/Users/julius/.codex" },
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.continuation?.groupKey).toBe("codex:home:/Users/julius/.codex");
  });
});
