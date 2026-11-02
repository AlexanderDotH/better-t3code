import type { ResponseMetricsSnapshot, TurnTokenUsage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function providerResponseMetrics(input: {
  readonly startedAt: DateTime.Utc;
  readonly completedAt: DateTime.Utc;
  readonly firstTokenAt: DateTime.Utc | undefined;
  readonly tokenUsage: TurnTokenUsage | undefined;
}): ResponseMetricsSnapshot {
  const startedAtMs = DateTime.toEpochMillis(input.startedAt);
  return {
    responseDurationMs: Math.max(0, DateTime.toEpochMillis(input.completedAt) - startedAtMs),
    ...(input.firstTokenAt === undefined
      ? {}
      : {
          timeToFirstTokenMs: Math.max(0, DateTime.toEpochMillis(input.firstTokenAt) - startedAtMs),
        }),
    ...(input.tokenUsage === undefined ? {} : { tokenUsage: input.tokenUsage }),
  };
}
