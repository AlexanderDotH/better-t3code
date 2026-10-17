import type {
  ProviderRuntimeEvent,
  ResponseMetricsSnapshot,
  ThreadId,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";
import { isToolLifecycleItemType, TurnId as CanonicalTurnId } from "@t3tools/contracts";

import {
  getProviderIngressTime,
  recordProviderPipelineDuration,
  type ProviderPipelineStage,
} from "../observability/ProviderPipelineMetrics.ts";

const MAX_TRACKED_THREADS = 256;
const MAX_TOOL_INTERVALS = 128;

interface TimeInterval {
  readonly start: number;
  readonly end: number;
}

interface ResponseMeasurement {
  readonly turnId: TurnId;
  startedAt: number | undefined;
  firstTokenAt: number | undefined;
  completedAt: number | undefined;
  terminalObserved: boolean;
  ingressToObservationMs: number | undefined;
  tokenUsage: ResponseMetricsSnapshot["tokenUsage"];
  context: ThreadTokenUsageSnapshot | undefined;
  readonly activeTools: Map<string, number>;
  readonly completedTools: Set<string>;
  toolIntervals: TimeInterval[];
  toolTimingIncomplete: boolean;
  readonly recordedTimings: Set<ProviderPipelineStage>;
}

export interface ResponseTimingDiagnostics {
  /** Time from the terminal event's native ingress to this local observation. */
  readonly ingressToObservationMs?: number;
  /** Union of observed tool lifetimes inside the measured response window. */
  readonly observedToolWaitMs?: number;
}

function elapsed(start: number | undefined, end: number | undefined): number | undefined {
  return start !== undefined && end !== undefined && end >= start
    ? Math.round(end - start)
    : undefined;
}

function makeMeasurement(turnId: TurnId): ResponseMeasurement {
  return {
    turnId,
    startedAt: undefined,
    firstTokenAt: undefined,
    completedAt: undefined,
    terminalObserved: false,
    ingressToObservationMs: undefined,
    tokenUsage: undefined,
    context: undefined,
    activeTools: new Map(),
    completedTools: new Set(),
    toolIntervals: [],
    toolTimingIncomplete: false,
    recordedTimings: new Set(),
  };
}

function addToolInterval(turn: ResponseMeasurement, interval: TimeInterval): void {
  const merged: TimeInterval[] = [];
  let pending = interval;
  for (const current of turn.toolIntervals) {
    if (current.end < pending.start) merged.push(current);
    else if (pending.end < current.start) {
      merged.push(pending);
      pending = current;
    } else {
      pending = {
        start: Math.min(pending.start, current.start),
        end: Math.max(pending.end, current.end),
      };
    }
  }
  merged.push(pending);
  if (merged.length > MAX_TOOL_INTERVALS) {
    turn.toolTimingIncomplete = true;
    return;
  }
  turn.toolIntervals = merged;
}

function observeTool(
  turn: ResponseMeasurement,
  event: ProviderRuntimeEvent,
  at: number | undefined,
) {
  if (
    (event.type !== "item.started" && event.type !== "item.completed") ||
    !isToolLifecycleItemType(event.payload.itemType) ||
    event.payload.agentId !== undefined
  ) {
    return;
  }
  const key = event.itemId ?? event.providerRefs?.providerItemId;
  if (key === undefined || at === undefined) {
    turn.toolTimingIncomplete = true;
    return;
  }
  if (turn.completedTools.has(key)) return;
  if (event.type === "item.started") {
    if (turn.activeTools.size >= MAX_TOOL_INTERVALS) turn.toolTimingIncomplete = true;
    else if (!turn.activeTools.has(key)) turn.activeTools.set(key, at);
    return;
  }
  const startedAt = turn.activeTools.get(key);
  turn.activeTools.delete(key);
  if (startedAt === undefined || at < startedAt) {
    turn.toolTimingIncomplete = true;
    return;
  }
  addToolInterval(turn, { start: startedAt, end: at });
  if (turn.completedTools.size < MAX_TOOL_INTERVALS) turn.completedTools.add(key);
  else turn.toolTimingIncomplete = true;
}

function diagnostics(turn: ResponseMeasurement): ResponseTimingDiagnostics {
  const responseStart = turn.firstTokenAt;
  const responseEnd = turn.completedAt;
  const canMeasureTools =
    responseStart !== undefined &&
    responseEnd !== undefined &&
    responseEnd >= responseStart &&
    turn.toolIntervals.length > 0 &&
    !turn.toolTimingIncomplete &&
    turn.activeTools.size === 0;
  return {
    ...(turn.ingressToObservationMs !== undefined
      ? { ingressToObservationMs: turn.ingressToObservationMs }
      : {}),
    ...(canMeasureTools
      ? {
          observedToolWaitMs: Math.round(
            turn.toolIntervals.reduce(
              (total, interval) =>
                total +
                Math.max(
                  0,
                  Math.min(interval.end, responseEnd) - Math.max(interval.start, responseStart),
                ),
              0,
            ),
          ),
        }
      : {}),
  };
}

/** Uses process-local native ingress; recovered events with no observation stay untimed. */
export function createResponseMetricsTracker(options?: {
  readonly maxTrackedThreads?: number;
  readonly now?: () => number;
}) {
  const turns = new Map<ThreadId, ResponseMeasurement>();
  const limit = Math.max(1, Math.floor(options?.maxTrackedThreads ?? MAX_TRACKED_THREADS));
  const now = options?.now ?? (() => performance.now());

  function retain(threadId: ThreadId, turn: ResponseMeasurement) {
    if (!turns.has(threadId) && turns.size >= limit) {
      const oldest = turns.keys().next().value;
      if (oldest !== undefined) turns.delete(oldest);
    }
    turns.set(threadId, turn);
  }

  return {
    observe(event: ProviderRuntimeEvent, observedAt?: number) {
      if (event.subagentId !== undefined) return null;
      if (event.type === "session.exited" || event.type === "session.started") {
        turns.delete(event.threadId);
        return null;
      }
      const ingressAt = getProviderIngressTime(event);
      const at = ingressAt ?? (Number.isFinite(observedAt) ? observedAt : undefined);
      const eventTurnId = event.turnId ? CanonicalTurnId.make(String(event.turnId)) : null;
      let turn = turns.get(event.threadId);
      if (event.type === "turn.started" && eventTurnId !== null) {
        if (turn?.turnId !== eventTurnId) {
          if (turn?.startedAt !== undefined && at !== undefined && at < turn.startedAt) return null;
          turn = makeMeasurement(eventTurnId);
          retain(event.threadId, turn);
        }
        if (at !== undefined) {
          turn.startedAt = turn.startedAt === undefined ? at : Math.min(turn.startedAt, at);
        }
        return null;
      }
      const terminal = event.type === "turn.completed" || event.type === "turn.aborted";
      if (!turn && terminal && eventTurnId !== null) {
        turn = makeMeasurement(eventTurnId);
        retain(event.threadId, turn);
      }
      if (!turn || (eventTurnId !== null && eventTurnId !== turn.turnId)) return null;

      if (
        event.type === "content.delta" &&
        event.payload.delta.length > 0 &&
        ["assistant_text", "reasoning_text", "reasoning_summary_text"].includes(
          event.payload.streamKind,
        ) &&
        at !== undefined &&
        (turn.completedAt === undefined || at <= turn.completedAt)
      ) {
        turn.firstTokenAt = turn.firstTokenAt === undefined ? at : Math.min(turn.firstTokenAt, at);
      }
      observeTool(turn, event, at);
      if (event.type === "thread.token-usage.updated") turn.context = event.payload.usage;
      if (terminal) {
        if (!turn.terminalObserved) {
          turn.completedAt = at;
          if (ingressAt !== undefined) turn.ingressToObservationMs = elapsed(ingressAt, now());
          turn.terminalObserved = true;
        }
        turn.tokenUsage = event.payload.tokenUsage ?? turn.tokenUsage;
      }
      if (
        !turn.terminalObserved ||
        (!terminal && event.type !== "thread.token-usage.updated" && event.type !== "content.delta")
      ) {
        return null;
      }
      const timeToFirstTokenMs = elapsed(turn.startedAt, turn.firstTokenAt);
      // Arrival spans include tools and upstream waits, so they are not model decode durations.
      const responseDurationMs = elapsed(turn.firstTokenAt, turn.completedAt);
      const snapshot: ResponseMetricsSnapshot = {
        ...(timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs } : {}),
        ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
        ...(turn.tokenUsage ? { tokenUsage: turn.tokenUsage } : {}),
        ...(turn.context ? { contextUsedTokens: turn.context.usedTokens } : {}),
        ...(turn.context?.maxTokens ? { contextLimitTokens: turn.context.maxTokens } : {}),
      };
      const timingDiagnostics = diagnostics(turn);
      if (ingressAt !== undefined) {
        const measurements: ReadonlyArray<readonly [ProviderPipelineStage, number | undefined]> = [
          ["provider_observed_ttft", timeToFirstTokenMs],
          ["provider_observed_response", responseDurationMs],
          ["ingress_to_observation", timingDiagnostics.ingressToObservationMs],
          ["observed_tool_wait", timingDiagnostics.observedToolWaitMs],
        ];
        for (const [stage, duration] of measurements) {
          if (duration !== undefined && !turn.recordedTimings.has(stage)) {
            recordProviderPipelineDuration(stage, duration, event.provider, event);
            turn.recordedTimings.add(stage);
          }
        }
      }
      return { turnId: turn.turnId, snapshot, diagnostics: timingDiagnostics };
    },
  };
}
