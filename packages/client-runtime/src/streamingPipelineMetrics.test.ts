import { EventId, type OrchestrationV2ThreadStreamItem } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import { describe, expect, it } from "vite-plus/test";
import { createStreamingPipelineMetrics } from "./streamingPipelineMetrics.ts";
import { applyOrchestrationV2ProjectionEvent } from "./state/orchestrationV2Projection.ts";
import { v2Now, v2Projection, v2ThreadId } from "./state/orchestrationV2TestFixtures.ts";

function event(sequence: number, title: string): OrchestrationV2ThreadStreamItem {
  return {
    kind: "event",
    sequence,
    event: {
      id: EventId.make(`event-${sequence}`),
      occurredAt: v2Now,
      threadId: v2ThreadId,
      type: "thread.metadata-updated",
      payload: { ...v2Projection.thread, title },
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
      let thread = v2Projection;
      let sequence = 0;
      const metrics = makeMetrics(() => time);
      const snapshot: OrchestrationV2ThreadStreamItem = {
        kind: "snapshot",
        projection: v2Projection,
        snapshotSequence: 4,
      };
      const items = [snapshot, event(4, "Stale replay"), event(5, "Live"), event(5, "Duplicate")];
      for (const item of items) {
        metrics.receive(item);
        time += 2;
        const finish = metrics.beginApply([item], sequence);
        if (item.kind === "snapshot") {
          thread = item.projection;
          sequence = item.snapshotSequence;
        } else if (item.kind === "event" && item.sequence > sequence) {
          thread = applyOrchestrationV2ProjectionEvent(thread, item.event) ?? thread;
          sequence = item.sequence;
        }
        time += 1;
        finish(sequence);
      }
      return { thread, sequence, snapshot: metrics.snapshot() };
    }
    const first = client(0);
    const second = client(100000000);
    expect(first.thread.thread.title).toBe("Live");
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
