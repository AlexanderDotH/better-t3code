import type { OrchestrationThreadStreamItem } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Metric from "effect/Metric";

const DURATION_BOUNDARIES_MS = [0, 0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
const TRACE_SAMPLE_INTERVAL = 256;
const TRACE_LIMIT = 32;

interface ClientPipelineTrace {
  readonly receiveToApplyMs?: number;
  readonly applyDurationMs: number;
  readonly itemCount: number;
  readonly appliedEvents: number;
  readonly replayedEvents: number;
  readonly snapshots: number;
}

/** Both timestamps come from the client process; server timestamps are never subtracted. */
export function createStreamingPipelineMetrics(options?: {
  readonly now?: () => number;
  readonly traceSampleInterval?: number;
  readonly traceLimit?: number;
  readonly context?: Context.Context<never>;
}) {
  const now = options?.now ?? (() => performance.now());
  const context = options?.context ?? Context.empty();
  const sampleInterval = Math.max(
    1,
    Math.floor(options?.traceSampleInterval ?? TRACE_SAMPLE_INTERVAL),
  );
  const traceLimit = Math.max(0, Math.floor(options?.traceLimit ?? TRACE_LIMIT));
  let received = new WeakMap<object, number>();
  let batchCount = 0;
  const traces: ClientPipelineTrace[] = [];
  const counters = {
    receivedItems: 0,
    appliedEvents: 0,
    replayedEvents: 0,
    snapshots: 0,
    appliedBatches: 0,
  };
  let receiveWait = Metric.histogram("t3_client_pipeline_receive_to_apply_ms", {
    boundaries: DURATION_BOUNDARIES_MS,
  });
  let applyDuration = Metric.histogram("t3_client_pipeline_state_apply_ms", {
    boundaries: DURATION_BOUNDARIES_MS,
  });

  function receive<T extends object>(item: T): T {
    received.set(item, now());
    counters.receivedItems += 1;
    return item;
  }

  function beginApply(
    items: ReadonlyArray<OrchestrationThreadStreamItem>,
    previousSequence: number,
  ) {
    const startedAt = now();
    let finished = false;
    return (appliedSequence: number): void => {
      if (finished) return;
      finished = true;
      const duration = Math.max(0, now() - startedAt);
      let firstReceiveAt: number | undefined;
      let sequence = previousSequence;
      let appliedEvents = 0;
      let replayedEvents = 0;
      let snapshots = 0;
      for (const item of items) {
        const receivedAt = received.get(item);
        received.delete(item);
        if (receivedAt !== undefined && startedAt >= receivedAt) {
          receiveWait.updateUnsafe(startedAt - receivedAt, context);
          firstReceiveAt =
            firstReceiveAt === undefined ? receivedAt : Math.min(firstReceiveAt, receivedAt);
        }
        if (item.kind === "snapshot") {
          snapshots += 1;
          sequence = item.snapshot.snapshotSequence;
        } else if (item.kind === "cursor") {
          sequence = Math.max(sequence, item.sequence);
        } else if (item.kind === "event") {
          if (item.event.sequence <= sequence) replayedEvents += 1;
          else if (item.event.sequence <= appliedSequence) {
            appliedEvents += 1;
            sequence = item.event.sequence;
          }
        }
      }
      counters.appliedEvents += appliedEvents;
      counters.replayedEvents += replayedEvents;
      counters.snapshots += snapshots;
      counters.appliedBatches += 1;
      applyDuration.updateUnsafe(duration, context);
      batchCount += 1;
      if (traceLimit > 0 && batchCount % sampleInterval === 0) {
        if (traces.length === traceLimit) traces.shift();
        traces.push({
          ...(firstReceiveAt !== undefined ? { receiveToApplyMs: startedAt - firstReceiveAt } : {}),
          applyDurationMs: duration,
          itemCount: items.length,
          appliedEvents,
          replayedEvents,
          snapshots,
        });
      }
    };
  }

  return {
    receive,
    beginApply,
    snapshot: () => ({
      counters: { ...counters },
      receiveToApply: receiveWait.valueUnsafe(context),
      stateApply: applyDuration.valueUnsafe(context),
      traces: traces.map((trace) => ({ ...trace })),
    }),
    reset: () => {
      const registry = Context.get(context, Metric.MetricRegistry);
      for (const [key, metadata] of registry) {
        if (metadata.id.startsWith("t3_client_pipeline_")) registry.delete(key);
      }
      receiveWait = Metric.histogram("t3_client_pipeline_receive_to_apply_ms", {
        boundaries: DURATION_BOUNDARIES_MS,
      });
      applyDuration = Metric.histogram("t3_client_pipeline_state_apply_ms", {
        boundaries: DURATION_BOUNDARIES_MS,
      });
      received = new WeakMap();
      batchCount = 0;
      traces.length = 0;
      counters.receivedItems = 0;
      counters.appliedEvents = 0;
      counters.replayedEvents = 0;
      counters.snapshots = 0;
      counters.appliedBatches = 0;
    },
  };
}

export const streamingPipelineMetrics = createStreamingPipelineMetrics();
