import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
  type OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import { describe, expect, it } from "vite-plus/test";

import { createStreamingPipelineMetrics } from "./streamingPipelineMetrics.ts";
import { applyThreadDetailEvent } from "./state/threadReducer.ts";

const THREAD_ID = ThreadId.make("thread-a");
const BASE_THREAD: OrchestrationThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-a"),
  title: "Initial",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-10-16T08:00:00.000Z",
  updatedAt: "2026-10-16T08:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  pullRequests: [],
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  subagents: [],
  activities: [],
  checkpoints: [],
  session: null,
};

function event(sequence: number, title: string): OrchestrationThreadStreamItem {
  return {
    kind: "event",
    event: {
      eventId: EventId.make(`event-${sequence}`),
      sequence,
      occurredAt: "2026-10-16T08:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      aggregateKind: "thread",
      aggregateId: THREAD_ID,
      type: "thread.meta-updated",
      payload: { threadId: THREAD_ID, title, updatedAt: "2026-10-16T08:00:00.000Z" },
    },
  };
}

function makeMetrics(now: () => number, traceLimit = 32) {
  return createStreamingPipelineMetrics({
    now,
    traceSampleInterval: 1,
    traceLimit,
    context: Context.make(Metric.MetricRegistry, new Map()),
  });
}

describe("client streaming pipeline measurements", () => {
  it("measures receive wait separately from state application on the local clock", () => {
    let time = 0;
    const metrics = makeMetrics(() => time);
    const item = metrics.receive(event(2, "Live"));
    time = 8;
    const finish = metrics.beginApply([item], 1);
    time = 11;
    finish(2);
    finish(2);
    expect(metrics.snapshot().receiveToApply).toMatchObject({ count: 1, sum: 8 });
    expect(metrics.snapshot().stateApply).toMatchObject({ count: 1, sum: 3 });
    expect(metrics.snapshot().counters).toMatchObject({
      receivedItems: 1,
      appliedEvents: 1,
      appliedBatches: 1,
    });
    expect(metrics.snapshot().traces).toEqual([
      {
        receiveToApplyMs: 8,
        applyDurationMs: 3,
        itemCount: 1,
        appliedEvents: 1,
        replayedEvents: 0,
        snapshots: 0,
      },
    ]);
  });

  it("does not invent missing receipt times and records known zero", () => {
    const metrics = makeMetrics(() => 0);
    metrics.beginApply([event(2, "No receipt")], 1)(2);
    expect(metrics.snapshot().receiveToApply.count).toBe(0);
    const item = metrics.receive(event(3, "Zero"));
    metrics.beginApply([item], 2)(3);
    expect(metrics.snapshot().receiveToApply).toMatchObject({ count: 1, sum: 0 });
  });

  it("keeps independent clients consistent across snapshots, duplicate replay, and live events", () => {
    function client(offset: number) {
      let time = offset;
      let thread = BASE_THREAD;
      let sequence = 0;
      const metrics = makeMetrics(() => time);
      const snapshot: OrchestrationThreadStreamItem = {
        kind: "snapshot",
        snapshot: { thread: BASE_THREAD, snapshotSequence: 4 },
      };
      const items = [snapshot, event(4, "Stale replay"), event(5, "Live"), event(5, "Duplicate")];
      for (const item of items) {
        metrics.receive(item);
        time += 2;
        const finish = metrics.beginApply([item], sequence);
        if (item.kind === "snapshot") {
          thread = item.snapshot.thread;
          sequence = item.snapshot.snapshotSequence;
        } else if (item.kind === "event" && item.event.sequence > sequence) {
          const result = applyThreadDetailEvent(thread, item.event);
          if (result.kind === "updated") thread = result.thread;
          sequence = item.event.sequence;
        }
        time += 1;
        finish(sequence);
      }
      return { thread, sequence, snapshot: metrics.snapshot() };
    }
    const first = client(0);
    const second = client(100000000);
    expect(first.thread.title).toBe("Live");
    expect(first.thread).toEqual(second.thread);
    expect(first.sequence).toBe(5);
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.snapshot.counters).toEqual({
      receivedItems: 4,
      appliedEvents: 1,
      replayedEvents: 2,
      snapshots: 1,
      appliedBatches: 4,
    });
  });

  it("bounds retained traces and resets measurements without retaining stream items", () => {
    const metrics = makeMetrics(() => 0, 3);
    for (let sequence = 1; sequence <= 1000; sequence += 1) {
      const item = metrics.receive(event(sequence, "Live"));
      metrics.beginApply([item], sequence - 1)(sequence);
    }
    const before = metrics.snapshot();
    expect(before.traces).toHaveLength(3);
    expect(before.stateApply.count).toBe(1000);
    expect(before.stateApply.buckets.length).toBeLessThanOrEqual(15);
    metrics.reset();
    expect(metrics.snapshot().stateApply.count).toBe(0);
    expect(metrics.snapshot().receiveToApply.count).toBe(0);
    expect(metrics.snapshot().traces).toEqual([]);
    expect(before.stateApply.count).toBe(1000);
  });
});
