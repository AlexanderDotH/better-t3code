import {
  SubagentId,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  SUBAGENT_ARCHIVE_AFTER_MS,
  SUBAGENT_TERMINAL_COLOR_MS,
  partitionSubagentsByLifecycle,
} from "./subagentLifecycle";

const TERMINAL_AT_MS = Date.parse("2026-07-30T10:00:00.000Z");
const TERMINAL_AT = new Date(TERMINAL_AT_MS).toISOString();

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make(id),
    providerThreadId: `provider-${id}`,
    parentId: null,
    path: null,
    name: id,
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: "2026-07-30T09:00:00.000Z",
    updatedAt: TERMINAL_AT,
    completedAt: status === "completed" ? TERMINAL_AT : null,
    ...overrides,
  };
}

function stageAt(status: OrchestrationSubagentStatus, elapsedMs: number) {
  const agent = makeSubagent("agent", status, {
    completedAt: TERMINAL_AT,
    updatedAt: TERMINAL_AT,
  });
  return partitionSubagentsByLifecycle({
    subagents: [agent],
    nowMs: TERMINAL_AT_MS + elapsedMs,
  });
}

describe("partitionSubagentsByLifecycle", () => {
  it("keeps every active status working regardless of old timestamps", () => {
    for (const status of ["starting", "running", "waiting"] as const) {
      const result = stageAt(status, SUBAGENT_ARCHIVE_AFTER_MS * 2);
      expect(result.visible[0]?.stage).toBe("working");
      expect(result.archived).toEqual([]);
      expect(result.nextTransitionAtMs).toBeNull();
    }
  });

  it("keeps a completion green for 30 seconds before making it stale", () => {
    expect(stageAt("completed", 0).visible[0]?.stage).toBe("success");
    expect(stageAt("completed", SUBAGENT_TERMINAL_COLOR_MS - 1).visible[0]?.stage).toBe("success");
    expect(stageAt("completed", SUBAGENT_TERMINAL_COLOR_MS).visible[0]?.stage).toBe("stale");
  });

  it("archives a terminal agent only after 30 colored and 120 grey seconds", () => {
    const justVisible = stageAt("completed", SUBAGENT_ARCHIVE_AFTER_MS - 1);
    expect(justVisible.visible[0]?.stage).toBe("stale");
    expect(justVisible.archived).toEqual([]);

    const archived = stageAt("completed", SUBAGENT_ARCHIVE_AFTER_MS);
    expect(archived.visible).toEqual([]);
    expect(archived.archived.map((agent) => agent.id)).toEqual([SubagentId.make("agent")]);
  });

  it("uses the same red lifecycle for every unsuccessful terminal status", () => {
    for (const status of ["error", "interrupted", "unavailable"] as const) {
      expect(stageAt(status, 0).visible[0]?.stage).toBe("failure");
      expect(stageAt(status, SUBAGENT_TERMINAL_COLOR_MS).visible[0]?.stage).toBe("stale");
      expect(stageAt(status, SUBAGENT_ARCHIVE_AFTER_MS).archived).toHaveLength(1);
    }
  });

  it("falls back to updatedAt when completedAt is absent", () => {
    const result = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("fallback", "completed", {
          completedAt: null,
          updatedAt: TERMINAL_AT,
        }),
      ],
      nowMs: TERMINAL_AT_MS + SUBAGENT_TERMINAL_COLOR_MS,
    });

    expect(result.visible[0]?.stage).toBe("stale");
  });

  it("keeps terminal agents with invalid timestamps visible instead of deleting them", () => {
    const result = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("invalid", "error", {
          completedAt: "not-a-date",
          updatedAt: "also-not-a-date",
        }),
      ],
      nowMs: TERMINAL_AT_MS + SUBAGENT_ARCHIVE_AFTER_MS,
    });

    expect(result.visible[0]?.stage).toBe("failure");
    expect(result.archived).toEqual([]);
    expect(result.nextTransitionAtMs).toBeNull();
  });

  it("returns the earliest pending lifecycle transition", () => {
    const firstTerminalAt = new Date(TERMINAL_AT_MS - 10_000).toISOString();
    const result = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("first", "completed", {
          completedAt: firstTerminalAt,
          updatedAt: firstTerminalAt,
        }),
        makeSubagent("second", "error", {
          completedAt: TERMINAL_AT,
          updatedAt: TERMINAL_AT,
        }),
      ],
      nowMs: TERMINAL_AT_MS,
    });

    expect(result.nextTransitionAtMs).toBe(TERMINAL_AT_MS - 10_000 + SUBAGENT_TERMINAL_COLOR_MS);
  });

  it("sorts visible agents newest-first and History by terminal time", () => {
    const result = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("visible-old", "running", {
          startedAt: "2026-07-30T09:00:00.000Z",
        }),
        makeSubagent("visible-new", "waiting", {
          startedAt: "2026-07-30T09:30:00.000Z",
        }),
        makeSubagent("archive-old", "completed", {
          completedAt: "2026-07-30T08:00:00.000Z",
          updatedAt: "2026-07-30T08:00:00.000Z",
        }),
        makeSubagent("archive-new", "error", {
          completedAt: "2026-07-30T08:30:00.000Z",
          updatedAt: "2026-07-30T08:30:00.000Z",
        }),
      ],
      nowMs: TERMINAL_AT_MS,
    });

    expect(result.visible.map((entry) => entry.agent.id)).toEqual([
      SubagentId.make("visible-new"),
      SubagentId.make("visible-old"),
    ]);
    expect(result.archived.map((agent) => agent.id)).toEqual([
      SubagentId.make("archive-new"),
      SubagentId.make("archive-old"),
    ]);
  });

  it("returns an archived agent to the working stack when it becomes active again", () => {
    const revived = makeSubagent("revived", "running", {
      completedAt: null,
      updatedAt: new Date(TERMINAL_AT_MS + SUBAGENT_ARCHIVE_AFTER_MS).toISOString(),
    });
    const result = partitionSubagentsByLifecycle({
      subagents: [revived],
      nowMs: TERMINAL_AT_MS + SUBAGENT_ARCHIVE_AFTER_MS,
    });

    expect(result.visible[0]).toMatchObject({ agent: revived, stage: "working" });
    expect(result.archived).toEqual([]);
  });
});
