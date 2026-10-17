import * as Context from "effect/Context";
import * as Metric from "effect/Metric";
import { describe, expect, it } from "vite-plus/test";

import {
  createProviderPipelineMetrics,
  getProviderIngressTime,
  transferProviderIngress,
} from "./ProviderPipelineMetrics.ts";

function makeMetrics(options?: {
  readonly now?: () => number;
  readonly traceSampleInterval?: number;
  readonly traceLimit?: number;
}) {
  return createProviderPipelineMetrics({
    ...options,
    context: Context.make(Metric.MetricRegistry, new Map()),
  });
}

describe("provider pipeline measurements", () => {
  it("preserves native ingress through buffering and event clones without wire metadata", () => {
    let time = 0;
    const metrics = makeMetrics({ now: () => time, traceSampleInterval: 1 });
    const native = metrics.stampIngress({ type: "native" });
    time = 200;
    metrics.stampIngress(native);
    const normalized = transferProviderIngress(native, {
      eventId: "event-a",
      threadId: "thread-a",
    });
    time = 250;
    metrics.recordDuration(
      "provider_queue_wait",
      time - getProviderIngressTime(normalized)!,
      "codex",
      normalized,
    );

    expect(getProviderIngressTime(normalized)).toBe(0);
    expect(getProviderIngressTime({})).toBeUndefined();
    expect(JSON.parse(JSON.stringify(normalized))).toEqual({
      eventId: "event-a",
      threadId: "thread-a",
    });
    expect(metrics.snapshot().traces).toEqual([
      {
        ingressAt: 0,
        eventId: "event-a",
        threadId: "thread-a",
        durations: { provider_queue_wait: 250 },
      },
    ]);
  });

  it("separates local stages and counts measured zero durations", () => {
    const metrics = makeMetrics();
    metrics.recordDuration("provider_queue_wait", 10, "codex");
    metrics.recordDuration("ingestion_queue_wait", 20, "codex");
    metrics.recordDuration("ingestion_process", 30, "codex");
    metrics.recordDuration("engine_queue_wait", 40, "codex");
    metrics.recordDuration("db_commit", 0, "codex");
    metrics.recordDuration("blocked_publication", 50, "codex");
    metrics.recordDuration("ingress_to_commit", 100, "codex");
    metrics.recordDuration("db_commit", Number.NaN, "codex");
    metrics.recordDuration("db_commit", -1, "codex");

    expect(
      metrics.snapshot().durations.map(({ key, count, sum }) => ({ key, count, sum })),
    ).toEqual([
      { key: "provider_queue_wait:codex", count: 1, sum: 10 },
      { key: "ingestion_queue_wait:codex", count: 1, sum: 20 },
      { key: "ingestion_process:codex", count: 1, sum: 30 },
      { key: "engine_queue_wait:codex", count: 1, sum: 40 },
      { key: "db_commit:codex", count: 1, sum: 0 },
      { key: "blocked_publication:codex", count: 1, sum: 50 },
      { key: "ingress_to_commit:codex", count: 1, sum: 100 },
    ]);
  });

  it("bounds labels, histogram buckets, and sampled trace retention", () => {
    const metrics = makeMetrics({ traceSampleInterval: 2, traceLimit: 3 });
    for (let index = 0; index < 1000; index += 1) {
      const event = metrics.stampIngress(
        { eventId: `event-${index}`, threadId: `thread-${index}` },
        index,
      );
      metrics.recordDuration("db_commit", index, `custom-provider-${index}`, event);
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.durations).toHaveLength(1);
    expect(snapshot.durations[0]).toMatchObject({ key: "db_commit:unknown", count: 1000 });
    expect(snapshot.durations[0]?.buckets.length).toBeLessThanOrEqual(16);
    expect(snapshot.traces.map((trace) => trace.eventId)).toEqual([
      "event-995",
      "event-997",
      "event-999",
    ]);
    expect(snapshot.traces.every((trace) => trace.durations.db_commit !== undefined)).toBe(true);
  });

  it("keeps built-in driver labels distinct while collapsing arbitrary instance names", () => {
    const metrics = makeMetrics();
    for (const provider of [
      "claudeAgent",
      "opencode",
      "chatgpt",
      "openaiCompatible",
      "lmstudio",
      "personal-instance",
    ]) {
      metrics.recordDuration("provider_queue_wait", 1, provider);
    }
    expect(metrics.snapshot().durations.map(({ key }) => key)).toEqual([
      "provider_queue_wait:claudeAgent",
      "provider_queue_wait:opencode",
      "provider_queue_wait:chatgpt",
      "provider_queue_wait:openaiCompatible",
      "provider_queue_wait:lmstudio",
      "provider_queue_wait:unknown",
    ]);
  });

  it("records queue item and byte gauges and resets benchmark snapshots", () => {
    const metrics = makeMetrics({ traceSampleInterval: 1 });
    metrics.recordQueue("ingestion", {
      queuedItems: 2,
      queuedBytes: 4096,
      runningItems: 1,
      runningBytes: 1024,
      waitingOffers: 3,
      activeKeys: 2,
      keyCount: 4,
    });
    metrics.recordDuration("db_commit", 2);
    metrics.stampIngress({});
    const before = metrics.snapshot();
    expect(before.queues).toContainEqual({ key: "ingestion:queuedBytes", value: 4096 });
    expect(before.queues).toContainEqual({ key: "ingestion:queuedItems", value: 2 });
    metrics.reset();
    expect(metrics.snapshot()).toEqual({ durations: [], counters: [], queues: [], traces: [] });
    metrics.recordDuration("db_commit", 1);
    expect(metrics.snapshot().durations[0]).toMatchObject({ count: 1, sum: 1 });
    expect(before.durations[0]).toMatchObject({ count: 1, sum: 2 });
  });

  it("aggregates live delivery lanes and releases their contribution on scope close", () => {
    const metrics = makeMetrics();
    const first = {};
    const second = {};
    const usage = {
      queuedItems: 1,
      queuedBytes: 100,
      runningItems: 0,
      runningBytes: 0,
      waitingOffers: 0,
      activeKeys: 1,
      keyCount: 1,
    };
    metrics.recordQueue("provider", usage, first);
    metrics.recordQueue("provider", { ...usage, queuedItems: 2, queuedBytes: 200 }, second);
    expect(metrics.snapshot().queues).toContainEqual({ key: "provider:queuedItems", value: 3 });
    expect(metrics.snapshot().queues).toContainEqual({ key: "provider:queuedBytes", value: 300 });
    metrics.recordQueue("provider", { ...usage, queuedItems: 0, queuedBytes: 0 }, first);
    expect(metrics.snapshot().queues).toContainEqual({ key: "provider:queuedBytes", value: 200 });
    metrics.releaseQueue("provider", second);
    metrics.releaseQueue("provider", second);
    expect(metrics.snapshot().queues).toContainEqual({ key: "provider:queuedItems", value: 0 });
    expect(metrics.snapshot().queues).toContainEqual({ key: "provider:queuedBytes", value: 0 });
  });
});
