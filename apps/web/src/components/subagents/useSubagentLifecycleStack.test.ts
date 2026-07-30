import { SubagentId, type OrchestrationSubagentSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SubagentLifecycleEntry } from "./subagentLifecycle";
import {
  SUBAGENT_ENTER_MS,
  SUBAGENT_EXIT_MS,
  SUBAGENT_SLOT_COLLAPSE_MS,
  advanceSubagentPresence,
  beginReadySubagentExits,
  initializeSubagentPresence,
  reconcileSubagentPresence,
} from "./useSubagentLifecycleStack";

function makeEntry(id: string, startedAt: string): SubagentLifecycleEntry {
  const agent: OrchestrationSubagentSummary = {
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
    status: "running",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  };
  return {
    agent,
    stage: "working",
    terminalAtMs: null,
    transitionAtMs: null,
  };
}

describe("subagent stack presence", () => {
  it("adds newly observed agents at the top without replaying existing entrances", () => {
    const oldEntry = makeEntry("old", "2026-07-30T09:00:00.000Z");
    const newEntry = makeEntry("new", "2026-07-30T09:01:00.000Z");
    const current = initializeSubagentPresence([oldEntry], 1_000);
    const reconciled = reconcileSubagentPresence(current, [newEntry, oldEntry], 2_000);

    expect(reconciled.map((entry) => entry.agent.id)).toEqual([
      SubagentId.make("new"),
      SubagentId.make("old"),
    ]);
    expect(reconciled[0]).toMatchObject({ phase: "entering", phaseStartedAtMs: 2_000 });
    expect(reconciled[1]?.phase).toBe("present");
  });

  it("paints a removed terminal pill gray before exit and slot collapse", () => {
    const current = initializeSubagentPresence(
      [makeEntry("leaving", "2026-07-30T09:00:00.000Z")],
      1_000,
    );
    const ready = reconcileSubagentPresence(current, [], 2_000);
    const exiting = beginReadySubagentExits(ready, 2_001);

    expect(ready[0]).toMatchObject({ stage: "stale", phase: "exit-ready" });
    expect(advanceSubagentPresence(exiting, 2_001 + SUBAGENT_EXIT_MS - 1)[0]?.phase).toBe(
      "exiting",
    );
    const collapsing = advanceSubagentPresence(exiting, 2_001 + SUBAGENT_EXIT_MS);
    expect(collapsing[0]?.phase).toBe("collapsing");
    expect(
      advanceSubagentPresence(collapsing, 2_001 + SUBAGENT_EXIT_MS + SUBAGENT_SLOT_COLLAPSE_MS),
    ).toEqual([]);
  });

  it("uses a bounded fallback for missed entrance animation events and revives exiting agents", () => {
    const entry = makeEntry("agent", "2026-07-30T09:00:00.000Z");
    const entering = reconcileSubagentPresence([], [entry], 2_000);
    expect(advanceSubagentPresence(entering, 2_000 + SUBAGENT_ENTER_MS)[0]?.phase).toBe("present");

    const current = initializeSubagentPresence([entry], 1_000);
    const exiting = beginReadySubagentExits(reconcileSubagentPresence(current, [], 2_000), 2_001);
    expect(reconcileSubagentPresence(exiting, [entry], 2_100)[0]).toMatchObject({
      phase: "entering",
      stage: "working",
    });
  });
});
