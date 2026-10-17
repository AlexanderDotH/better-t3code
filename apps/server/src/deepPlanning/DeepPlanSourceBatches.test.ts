import { describe, expect, it } from "vite-plus/test";
import {
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type DeepPlanSourceSnapshot,
} from "@t3tools/contracts";
import { selectDeepPlanSourceBatches } from "./DeepPlanSourceBatches.ts";

function sources(count: number): Array<DeepPlanSourceSnapshot> {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: DeepPlanSourceId.make(`source-${index}`),
    origin: {
      environmentId: EnvironmentId.make("local"),
      projectId: ProjectId.make("project"),
      threadId: ThreadId.make(`chat-${index}`),
    },
    projectTitle: "Project",
    threadTitle: `Chat ${index}`,
    archived: index % 2 === 0,
    capturedAt: "2026-10-16T10:00:00.000Z",
    contentVersion: "version-1",
    contentHash: `hash-${index}`,
    messageCount: index + 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: index + 1,
    forkOrigin: null,
  }));
}

describe("Deep Plan source batches", () => {
  it("fully covers large manifests over bounded, disjoint parallel waves, including archives", () => {
    let pending = sources(101);
    const analyzed: DeepPlanSourceId[] = [];
    while (pending.length > 0) {
      const wave = selectDeepPlanSourceBatches(pending, []);
      expect(wave.length).toBeGreaterThan(0);
      expect(wave.length).toBeLessThanOrEqual(4);
      for (const batch of wave) expect(batch.length).toBeLessThanOrEqual(4);
      const ids = wave.flat().map((source) => source.sourceId);
      expect(new Set(ids).size).toBe(ids.length);
      analyzed.push(...ids);
      pending = pending.filter((source) => !ids.includes(source.sourceId));
    }
    expect(analyzed).toEqual(sources(101).map((source) => source.sourceId));
  });

  it("refills only free slots without reassigning chats still being analyzed", () => {
    const pending = sources(33);
    const active = [
      pending.slice(0, 4).map((source) => source.sourceId),
      pending.slice(4, 8).map((source) => source.sourceId),
    ];
    const batches = selectDeepPlanSourceBatches(pending, active);
    expect(batches).toEqual([pending.slice(8, 12), pending.slice(12, 16)]);
    expect(
      selectDeepPlanSourceBatches(pending, [
        ...active,
        ...batches.map((batch) => batch.map((source) => source.sourceId)),
      ]),
    ).toEqual([]);
  });

  it("starts interrupted unfinished sources again after their workers have settled", () => {
    const pending = sources(7);
    expect(selectDeepPlanSourceBatches(pending, [])).toEqual([
      pending.slice(0, 4),
      pending.slice(4),
    ]);
    expect(selectDeepPlanSourceBatches([], [])).toEqual([]);
  });
});
