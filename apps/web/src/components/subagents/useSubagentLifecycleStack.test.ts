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

  it("adds a newly observed agent at the top and leaves existing pills in place", () => {
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

  it("paints a removed terminal pill gray before starting its exit on the next frame", () => {
    const current = initializeSubagentPresence(
      [makeEntry("leaving", "2026-07-30T09:00:00.000Z")],
      1_000,
    );

    const ready = reconcileSubagentPresence(current, [], 2_000);
    expect(ready[0]).toMatchObject({
      stage: "stale",
      phase: "exit-ready",
      phaseStartedAtMs: 2_000,
    });

    const exiting = beginReadySubagentExits(ready, 2_001);
    expect(exiting[0]).toMatchObject({
      stage: "stale",
      phase: "exiting",
      phaseStartedAtMs: 2_001,
    });
  });

  it("retains a gray pill through its 300ms exit and 180ms slot collapse", () => {
    const current = initializeSubagentPresence(
      [makeEntry("leaving", "2026-07-30T09:00:00.000Z")],
      1_000,
    );
    const ready = reconcileSubagentPresence(current, [], 2_000);
    const exiting = beginReadySubagentExits(ready, 2_001);

    expect(advanceSubagentPresence(exiting, 2_001 + SUBAGENT_EXIT_MS - 1)[0]?.phase).toBe(
      "exiting",
    );
    const collapsing = advanceSubagentPresence(exiting, 2_001 + SUBAGENT_EXIT_MS);
    expect(collapsing[0]).toMatchObject({
      phase: "collapsing",
      phaseStartedAtMs: 2_001 + SUBAGENT_EXIT_MS,
    });
    expect(
      advanceSubagentPresence(collapsing, 2_001 + SUBAGENT_EXIT_MS + SUBAGENT_SLOT_COLLAPSE_MS),
    ).toEqual([]);
  });

  it("uses a 420ms fallback for a missed entrance animation event", () => {
    const entering = reconcileSubagentPresence(
      [],
      [makeEntry("new", "2026-07-30T09:00:00.000Z")],
      2_000,
    );

    expect(SUBAGENT_ENTER_MS).toBe(420);
    expect(advanceSubagentPresence(entering, 2_000 + SUBAGENT_ENTER_MS - 1)[0]?.phase).toBe(
      "entering",
    );
    expect(advanceSubagentPresence(entering, 2_000 + SUBAGENT_ENTER_MS)[0]?.phase).toBe("present");
  });

  it("revives an exiting agent as a fresh entrance", () => {
    const entry = makeEntry("revived", "2026-07-30T09:00:00.000Z");
    const current = initializeSubagentPresence([entry], 1_000);
    const exiting = beginReadySubagentExits(reconcileSubagentPresence(current, [], 2_000), 2_001);
    const revived = reconcileSubagentPresence(exiting, [entry], 2_100);

    expect(revived[0]).toMatchObject({
      phase: "entering",
      stage: "working",
      phaseStartedAtMs: 2_100,
    });
  });
});
