import { describe, expect, it } from "vite-plus/test";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import type { WorkLogEntry } from "../../session-logic";
import { deriveAgentSpawnSummary, selectAgentDisplayWorkLogEntries } from "./agentSpawnSummary";

it("switches native launch summaries without losing work history or errors", () => {
  const entries: WorkLogEntry[] = [
    {
      id: "spawn",
      createdAt: "2026-09-08T00:00:00.000Z",
      label: "Launched a subagent",
      tone: "info",
      agentSpawn: { workflowId: null, agentTaskIds: ["agent-1"] },
    },
    {
      id: "work",
      createdAt: "2026-09-08T00:00:01.000Z",
      label: "Read a file",
      tone: "tool",
    },
    {
      id: "error",
      createdAt: "2026-09-08T00:00:02.000Z",
      label: "Tool failed",
      tone: "error",
    },
  ];

  expect(selectAgentDisplayWorkLogEntries(entries, true)).toBe(entries);
  expect(selectAgentDisplayWorkLogEntries(entries, false)).toEqual(entries.slice(1));
  expect(selectAgentDisplayWorkLogEntries(entries, true).map(({ id }) => id)).toEqual([
    "spawn",
    "work",
    "error",
  ]);
});

const batch = (status: RuntimeSubagent["status"]) => ({ kind: "subagent_batch" as const, status });
const agent = (status: RuntimeSubagent["status"]) => ({ kind: "subagent" as const, status });

describe("deriveAgentSpawnSummary", () => {
  it("counts a native batch without claiming the number of children", () => {
    expect(deriveAgentSpawnSummary({ agents: [batch("running")], agentCount: 1 })).toEqual({
      live: true,
      lead: "Launched 1 subagent batch",
      status: "1 working",
      tone: "working",
    });
    expect(deriveAgentSpawnSummary({ agents: [batch("idle")], agentCount: 1 })).toEqual({
      live: false,
      lead: "Launched 1 subagent batch",
      status: "1 idle",
      tone: "inactive",
    });
  });

  it("keeps individual agents and batches separate in a mixed group", () => {
    expect(
      deriveAgentSpawnSummary({
        agents: [agent("running"), batch("running"), batch("idle")],
        agentCount: 3,
      }).lead,
    ).toBe("Launched 1 subagent and 2 batches");
  });

  it.each([
    ["idle", "1 idle", "inactive"],
    ["cancelled", "1 stopped", "inactive"],
    ["interrupted", "1 stopped", "inactive"],
    ["failed", "1 failed", "failed"],
    ["completed", "✓ completed", "completed"],
  ] as const)("reports %s accurately alongside a completed agent", (state, status, tone) => {
    expect(
      deriveAgentSpawnSummary({ agents: [agent("completed"), agent(state)], agentCount: 2 }),
    ).toMatchObject({ live: false, status, tone });
  });

  it("does not claim completion when the roster is missing a member", () => {
    expect(deriveAgentSpawnSummary({ agents: [agent("completed")], agentCount: 2 })).toMatchObject({
      status: "Status unavailable",
      tone: "inactive",
    });
  });

  it("keeps a workflow active between child launches", () => {
    expect(
      deriveAgentSpawnSummary({
        agents: [agent("completed")],
        agentCount: 1,
        coordinatorStatus: "running",
      }),
    ).toMatchObject({ live: true, status: "working", tone: "working" });
  });

  it.each([
    ["failed", "Workflow failed", "failed"],
    ["cancelled", "Workflow stopped", "inactive"],
  ] as const)(
    "preserves a %s workflow outcome when its children completed",
    (coordinatorStatus, status, tone) => {
      expect(
        deriveAgentSpawnSummary({ agents: [agent("completed")], agentCount: 1, coordinatorStatus }),
      ).toMatchObject({ live: false, status, tone });
    },
  );
});
