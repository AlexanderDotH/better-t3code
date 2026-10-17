import * as Context from "effect/Context";
import * as Metric from "effect/Metric";

const DURATION_BOUNDARIES_MS = [0, 0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];
const PROVIDERS = new Set([
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "openCode",
  "antigravity",
  "chatgpt",
  "gemini",
  "openai",
  "openrouter",
  "openaiCompatible",
  "lmstudio",
]);
const DEFAULT_TRACE_SAMPLE_INTERVAL = 256;
const DEFAULT_TRACE_LIMIT = 32;
const QUEUE_FIELDS = [
  "queuedItems",
  "queuedBytes",
  "runningItems",
  "runningBytes",
  "waitingOffers",
  "activeKeys",
  "keyCount",
] as const;

export class CurrentProviderEvent extends Context.Reference<object | undefined>(
  "t3/observability/CurrentProviderEvent",
  { defaultValue: () => undefined },
) {}

export type ProviderPipelineStage =
  | "provider_queue_wait"
  | "ingestion_queue_wait"
  | "ingestion_process"
  | "engine_queue_wait"
  | "db_commit"
  | "ingress_to_commit"
  | "ingress_to_observation"
  | "provider_observed_ttft"
  | "provider_observed_response"
  | "observed_tool_wait"
  | "blocked_publication";

export interface ProviderPipelineQueueUsage {
  readonly queuedItems: number;
  readonly queuedBytes: number;
  readonly runningItems: number;
  readonly runningBytes: number;
  readonly waitingOffers: number;
  readonly activeKeys: number;
  readonly keyCount: number;
}

export type ProviderPipelineQueue = "provider" | "ingestion" | "engine";

export interface ProviderPipelineTrace {
  readonly ingressAt: number;
  readonly eventId?: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly durations: Partial<Readonly<Record<ProviderPipelineStage, number>>>;
}

interface IngressObservation {
  readonly ingressAt: number;
  readonly trace: ProviderPipelineTrace | undefined;
}

const ingressObservations = new WeakMap<object, IngressObservation>();

function traceIdentifiers(event: object) {
  const identifiers: { eventId?: string; threadId?: string; turnId?: string } = {};
  for (const key of ["eventId", "threadId", "turnId"] as const) {
    const value: unknown = Reflect.get(event, key);
    if (typeof value === "string") identifiers[key] = value.slice(0, 256);
  }
  return identifiers;
}

/** Transfer the original process clock through event normalization and lease stamping. */
export function transferProviderIngress<T extends object>(source: object, target: T): T {
  const observation = ingressObservations.get(source);
  if (observation !== undefined) {
    ingressObservations.set(target, observation);
    if (observation.trace !== undefined) Object.assign(observation.trace, traceIdentifiers(target));
  }
  return target;
}

export function getProviderIngressTime(event: object): number | undefined {
  return ingressObservations.get(event)?.ingressAt;
}

export function createProviderPipelineMetrics(options?: {
  readonly now?: () => number;
  readonly traceSampleInterval?: number;
  readonly traceLimit?: number;
  readonly context?: Context.Context<never>;
}) {
  const now = options?.now ?? (() => performance.now());
  const context = options?.context ?? Context.empty();
  const traceSampleInterval = Math.max(
    1,
    Math.floor(options?.traceSampleInterval ?? DEFAULT_TRACE_SAMPLE_INTERVAL),
  );
  const traceLimit = Math.max(0, Math.floor(options?.traceLimit ?? DEFAULT_TRACE_LIMIT));
  const traces: ProviderPipelineTrace[] = [];
  let observed = 0;

  const duration = Metric.histogram("t3_provider_pipeline_duration_ms", {
    description: "Process-local provider pipeline stage duration in milliseconds.",
    boundaries: DURATION_BOUNDARIES_MS,
  });
  const observations = Metric.counter("t3_provider_pipeline_observations_total");
  const queueSize = Metric.gauge("t3_provider_pipeline_queue_size");
  const durations = new Map<string, Metric.Histogram<number>>();
  const counters = new Map<string, Metric.Counter<number>>();
  const queues = new Map<string, Metric.Gauge<number>>();
  const queueOwners = new Map<ProviderPipelineQueue, Map<object, ProviderPipelineQueueUsage>>();
  const queueTotals = new Map<string, number>();
  const implicitOwner = {};

  function stampIngress<T extends object>(event: T, at = now()): T {
    if (ingressObservations.has(event) || !Number.isFinite(at)) return event;
    observed += 1;
    const trace =
      traceLimit > 0 && observed % traceSampleInterval === 0
        ? { ingressAt: at, ...traceIdentifiers(event), durations: {} }
        : undefined;
    if (trace !== undefined) {
      if (traces.length === traceLimit) traces.shift();
      traces.push(trace);
    }
    ingressObservations.set(event, { ingressAt: at, trace });
    return event;
  }

  function recordDuration(
    stage: ProviderPipelineStage,
    durationMs: number,
    provider?: string,
    event?: object,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const driver = provider !== undefined && PROVIDERS.has(provider) ? provider : "unknown";
    const key = `${stage}:${driver}`;
    let histogram = durations.get(key);
    let counter = counters.get(key);
    if (histogram === undefined || counter === undefined) {
      const attributes = { stage, provider: driver };
      histogram = Metric.withAttributes(duration, attributes);
      counter = Metric.withAttributes(observations, attributes);
      durations.set(key, histogram);
      counters.set(key, counter);
    }
    histogram.updateUnsafe(durationMs, context);
    counter.updateUnsafe(1, context);
    const trace = event === undefined ? undefined : ingressObservations.get(event)?.trace;
    if (trace !== undefined) {
      // Only sampled events retain stage detail; the histograms retain no events.
      Object.assign(trace.durations, { [stage]: durationMs });
    }
  }

  function updateQueueGauges(
    queue: ProviderPipelineQueue,
    usage: ProviderPipelineQueueUsage | undefined,
    previous: ProviderPipelineQueueUsage | undefined,
  ): void {
    for (const field of QUEUE_FIELDS) {
      const key = `${queue}:${field}`;
      const value = Math.max(
        0,
        (queueTotals.get(key) ?? 0) + (usage?.[field] ?? 0) - (previous?.[field] ?? 0),
      );
      queueTotals.set(key, value);
      let gauge = queues.get(key);
      if (gauge === undefined) {
        gauge = Metric.withAttributes(queueSize, { queue, field });
        queues.set(key, gauge);
      }
      gauge.updateUnsafe(value, context);
    }
  }

  function recordQueue(
    queue: ProviderPipelineQueue,
    usage: ProviderPipelineQueueUsage,
    owner = implicitOwner,
  ): void {
    if (QUEUE_FIELDS.some((field) => !Number.isFinite(usage[field]) || usage[field] < 0)) return;
    let owners = queueOwners.get(queue);
    if (owners === undefined) {
      owners = new Map();
      queueOwners.set(queue, owners);
    }
    const previous = owners.get(owner);
    owners.set(owner, { ...usage });
    updateQueueGauges(queue, usage, previous);
  }

  function releaseQueue(queue: ProviderPipelineQueue, owner: object): void {
    const owners = queueOwners.get(queue);
    const previous = owners?.get(owner);
    if (previous === undefined) return;
    owners?.delete(owner);
    updateQueueGauges(queue, undefined, previous);
  }

  return {
    stampIngress,
    recordDuration,
    recordQueue,
    releaseQueue,
    snapshot: () => ({
      durations: Array.from(durations, ([key, histogram]) => ({
        key,
        ...histogram.valueUnsafe(context),
      })),
      counters: Array.from(counters, ([key, counter]) => ({
        key,
        count: counter.valueUnsafe(context).count,
      })),
      queues: Array.from(queues, ([key, gauge]) => ({
        key,
        value: gauge.valueUnsafe(context).value,
      })),
      traces: traces.map((trace) => ({ ...trace, durations: { ...trace.durations } })),
    }),
    reset: () => {
      for (const [key, metadata] of Context.get(context, Metric.MetricRegistry)) {
        if (metadata.id.startsWith("t3_provider_pipeline_")) {
          Context.get(context, Metric.MetricRegistry).delete(key);
        }
      }
      durations.clear();
      counters.clear();
      queues.clear();
      queueOwners.clear();
      queueTotals.clear();
      traces.length = 0;
      observed = 0;
    },
  };
}

export const providerPipelineMetrics = createProviderPipelineMetrics();

/** Stamp at the native adapter callback, before any provider publication queue. */
export const stampProviderIngress = providerPipelineMetrics.stampIngress;
export const recordProviderPipelineDuration = providerPipelineMetrics.recordDuration;
export const recordProviderPipelineQueue = providerPipelineMetrics.recordQueue;
export const releaseProviderPipelineQueue = providerPipelineMetrics.releaseQueue;
export const readProviderPipelineMetrics = providerPipelineMetrics.snapshot;
export const resetProviderPipelineMetrics = providerPipelineMetrics.reset;
