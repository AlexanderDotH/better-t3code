import { SubagentId, type OrchestrationSubagentSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SubagentLifecycleEntry } from "./subagentLifecycle";
import {
  SUBAGENT_ENTER_MS,
  SUBAGENT_EXIT_MS,
  SUBAGENT_SLOT_COLLAPSE_MS,
  advanceSubagentPresence,
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
  it("initializes existing agents in place without replaying entrance motion", () => {
    const presence = initializeSubagentPresence(
      [makeEntry("existing", "2026-07-30T09:00:00.000Z")],
      1_000,
    );

    expect(presence[0]).toMatchObject({
      phase: "present",
      phaseStartedAtMs: 1_000,
    });
  });

  it("adds newly observed agents at the top in the entering phase", () => {
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

  it("retains removed agents through exit and slot collapse before removing them", () => {
    const current = initializeSubagentPresence(
      [makeEntry("leaving", "2026-07-30T09:00:00.000Z")],
      1_000,
    );
    const exiting = reconcileSubagentPresence(current, [], 2_000);

    expect(exiting[0]?.phase).toBe("exiting");
    expect(advanceSubagentPresence(exiting, 2_000 + SUBAGENT_EXIT_MS - 1)[0]?.phase).toBe(
      "exiting",
    );

    const collapsing = advanceSubagentPresence(exiting, 2_000 + SUBAGENT_EXIT_MS);
    expect(collapsing[0]).toMatchObject({
      phase: "collapsing",
      phaseStartedAtMs: 2_000 + SUBAGENT_EXIT_MS,
    });

    expect(
      advanceSubagentPresence(collapsing, 2_000 + SUBAGENT_EXIT_MS + SUBAGENT_SLOT_COLLAPSE_MS),
    ).toEqual([]);
  });

  it("uses fallback deadlines to settle missed entrance animation events", () => {
    const entering = reconcileSubagentPresence(
      [],
      [makeEntry("new", "2026-07-30T09:00:00.000Z")],
      2_000,
    );

    expect(advanceSubagentPresence(entering, 2_000 + SUBAGENT_ENTER_MS - 1)[0]?.phase).toBe(
      "entering",
    );
    expect(advanceSubagentPresence(entering, 2_000 + SUBAGENT_ENTER_MS)[0]?.phase).toBe("present");
  });

  it("revives an exiting agent as a fresh entrance when it becomes active again", () => {
    const entry = makeEntry("revived", "2026-07-30T09:00:00.000Z");
    const current = initializeSubagentPresence([entry], 1_000);
    const exiting = reconcileSubagentPresence(current, [], 2_000);
    const revived = reconcileSubagentPresence(exiting, [entry], 2_100);

    expect(revived[0]).toMatchObject({
      phase: "entering",
      phaseStartedAtMs: 2_100,
    });
  });
});
