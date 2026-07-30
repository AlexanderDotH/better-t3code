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

function partitionAt(status: OrchestrationSubagentStatus, elapsedMs: number) {
  return partitionSubagentsByLifecycle({
    subagents: [
      makeSubagent("agent", status, {
        completedAt: TERMINAL_AT,
        updatedAt: TERMINAL_AT,
      }),
    ],
    nowMs: TERMINAL_AT_MS + elapsedMs,
  });
}

describe("partitionSubagentsByLifecycle", () => {
  it("keeps starting, running, and waiting agents in the blue working stage", () => {
    for (const status of ["starting", "running", "waiting"] as const) {
      const result = partitionAt(status, SUBAGENT_TERMINAL_COLOR_MS * 2);

      expect(result.visible[0]?.stage).toBe("working");
      expect(result.archived).toEqual([]);
      expect(result.nextTransitionAtMs).toBeNull();
    }
  });

  it("keeps successful completion green through 29,999ms and archives at 30,000ms", () => {
    expect(partitionAt("completed", 0).visible[0]?.stage).toBe("success");
    expect(partitionAt("completed", SUBAGENT_TERMINAL_COLOR_MS - 1).visible[0]?.stage).toBe(
      "success",
    );

    const boundary = partitionAt("completed", SUBAGENT_TERMINAL_COLOR_MS);
    expect(boundary.visible).toEqual([]);
    expect(boundary.archived.map((agent) => agent.id)).toEqual([SubagentId.make("agent")]);
    expect(SUBAGENT_ARCHIVE_AFTER_MS).toBe(SUBAGENT_TERMINAL_COLOR_MS);
  });

  it("uses the same 30-second red lifecycle for every unsuccessful terminal status", () => {
    for (const status of ["error", "interrupted", "unavailable"] as const) {
      expect(partitionAt(status, SUBAGENT_TERMINAL_COLOR_MS - 1).visible[0]?.stage).toBe("failure");
      expect(partitionAt(status, SUBAGENT_TERMINAL_COLOR_MS).archived).toHaveLength(1);
    }
  });

  it("falls back to updatedAt and leaves invalid terminal timestamps visible", () => {
    const fallback = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("fallback", "completed", {
          completedAt: null,
          updatedAt: TERMINAL_AT,
        }),
      ],
      nowMs: TERMINAL_AT_MS + SUBAGENT_TERMINAL_COLOR_MS,
    });
    expect(fallback.archived).toHaveLength(1);

    const invalid = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("invalid", "error", {
          completedAt: "not-a-date",
          updatedAt: "also-not-a-date",
        }),
      ],
      nowMs: TERMINAL_AT_MS + SUBAGENT_TERMINAL_COLOR_MS * 2,
    });
    expect(invalid.visible[0]?.stage).toBe("failure");
    expect(invalid.archived).toEqual([]);
    expect(invalid.nextTransitionAtMs).toBeNull();
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
});
