import {
  SubagentId,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { SUBAGENT_TERMINAL_COLOR_MS, partitionSubagentsByLifecycle } from "./subagentLifecycle";

const TERMINAL_AT_MS = Date.parse("2026-07-30T10:00:00.000Z");
const TERMINAL_AT = new Date(TERMINAL_AT_MS).toISOString();

function makeSubagent(
  id: string,
  status: OrchestrationSubagentStatus,
  overrides: Partial<OrchestrationSubagentSummary> = {},
): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make(id),
    origin: "provider-native",
    providerInstanceId: null,
    providerDriver: null,
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
  it("keeps active agents blue and sorts the visible stack newest-first", () => {
    const result = partitionSubagentsByLifecycle({
      subagents: [
        makeSubagent("older", "running"),
        makeSubagent("newer", "waiting", {
          startedAt: "2026-07-30T09:30:00.000Z",
        }),
      ],
      nowMs: TERMINAL_AT_MS + SUBAGENT_TERMINAL_COLOR_MS * 2,
    });

    expect(result.visible.map((entry) => [entry.agent.id, entry.stage])).toEqual([
      [SubagentId.make("newer"), "working"],
      [SubagentId.make("older"), "working"],
    ]);
    expect(result.nextTransitionAtMs).toBeNull();
  });

  it("keeps success green and failures red for 30 seconds, then archives them", () => {
    expect(partitionAt("completed", SUBAGENT_TERMINAL_COLOR_MS - 1).visible[0]?.stage).toBe(
      "success",
    );
    expect(partitionAt("completed", SUBAGENT_TERMINAL_COLOR_MS).archived).toHaveLength(1);

    for (const status of ["error", "interrupted", "unavailable"] as const) {
      expect(partitionAt(status, SUBAGENT_TERMINAL_COLOR_MS - 1).visible[0]?.stage).toBe("failure");
      expect(partitionAt(status, SUBAGENT_TERMINAL_COLOR_MS).archived).toHaveLength(1);
    }
  });

  it("falls back to updatedAt and keeps invalid terminal timestamps visible", () => {
    const fallback = partitionSubagentsByLifecycle({
      subagents: [makeSubagent("fallback", "completed", { completedAt: null })],
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
  });
});
