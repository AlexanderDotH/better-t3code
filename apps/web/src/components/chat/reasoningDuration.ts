import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

interface ReasoningInterval {
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

/** Count recorded reasoning intervals once, excluding tool gaps and overlapping traces. */
export function reasoningDurationMs(traces: readonly ReasoningInterval[]): number | null {
  if (traces.length === 0) return null;
  const intervals: { start: number; end: number }[] = [];
  for (const trace of traces) {
    if (!trace.createdAt || !trace.updatedAt) return null;
    const start = Date.parse(trace.createdAt);
    const end = Date.parse(trace.updatedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    intervals.push({ start, end });
  }
  intervals.sort((left, right) => left.start - right.start);
  let total = 0;
  let coveredUntil = -Infinity;
  for (const interval of intervals) {
    total += Math.max(0, interval.end - Math.max(interval.start, coveredUntil));
    coveredUntil = Math.max(coveredUntil, interval.end);
  }
  return total;
}

export function formatReasoningDuration(
  durationMs: number | null,
  translator: InterfaceTranslator,
): string {
  if (durationMs === null) return translator.message("chat.timeline.thinkingDurationUnavailable");
  if (durationMs < 1_000) return "<1s";
  const totalSeconds = Math.round(durationMs / 1_000);
  const values = [
    [Math.floor(totalSeconds / 3_600), "h"],
    [Math.floor((totalSeconds % 3_600) / 60), "m"],
    [totalSeconds % 60, "s"],
  ] as const;
  return values.flatMap(([value, unit]) => (value > 0 ? [`${value}${unit}`] : [])).join(" ");
}
