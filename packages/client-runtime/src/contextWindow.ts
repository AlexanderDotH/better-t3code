import * as DateTime from "effect/DateTime";
import { type OrchestrationV2ThreadProjection, ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import { Option, Schema } from "effect";

export interface UsageActivity {
  readonly id: string;
  readonly kind: string;
  readonly tone?: string;
  readonly summary?: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly turnId?: import("@t3tools/contracts").TurnId | null;
  readonly replyTopicId?: import("@t3tools/contracts").SubagentId;
}

const decodeCumulativeUsage = Schema.decodeUnknownOption(
  ThreadTokenUsageSnapshot.fields.cumulativeUsage,
);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

export function deriveLatestContextWindowSnapshot(
  input:
    | ReadonlyArray<UsageActivity>
    | {
        readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "activeProviderThreadId">;
        readonly providerThreads: OrchestrationV2ThreadProjection["providerThreads"];
      },
): ContextWindowSnapshot | null {
  if ("providerThreads" in input) {
    const active = input.providerThreads.find(
      (thread) => thread.id === input.thread.activeProviderThreadId,
    );
    const providerThread =
      active ?? input.providerThreads.findLast((thread) => thread.contextUsage != null);
    if (providerThread?.contextUsage == null) return null;
    return contextWindowSnapshot(
      providerThread.contextUsage,
      DateTime.formatIso(providerThread.updatedAt),
    );
  }
  const activities = input;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (
      !activity ||
      activity.kind !== "context-window.updated" ||
      activity.replyTopicId !== undefined ||
      activity.id.startsWith("subagent:")
    ) {
      continue;
    }

    const snapshot = contextWindowSnapshot(activity.payload, activity.createdAt);
    if (snapshot !== null) return snapshot;
  }

  return null;
}

function contextWindowSnapshot(value: unknown, updatedAt: string): ContextWindowSnapshot | null {
  const payload = asRecord(value);
  const usedTokens = asFiniteNumber(payload?.usedTokens);
  if (usedTokens === null || usedTokens < 0) return null;

  const reportedMaxTokens = asFiniteNumber(payload?.maxTokens);
  const maxTokens = reportedMaxTokens !== null && reportedMaxTokens > 0 ? reportedMaxTokens : null;
  const usedPercentage = maxTokens !== null ? (usedTokens / maxTokens) * 100 : null;
  const remainingTokens =
    maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
  const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

  return {
    usedTokens,
    totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
    cumulativeUsage: Option.getOrNull(decodeCumulativeUsage(payload?.cumulativeUsage)) ?? null,
    maxTokens,
    remainingTokens,
    usedPercentage,
    remainingPercentage,
    inputTokens: asFiniteNumber(payload?.inputTokens),
    cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
    outputTokens: asFiniteNumber(payload?.outputTokens),
    reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
    lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
    lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
    lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
    lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
    lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
    toolUses: asFiniteNumber(payload?.toolUses),
    durationMs: asFiniteNumber(payload?.durationMs),
    compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
    autoCompactThreshold: asFiniteNumber(payload?.autoCompactThreshold),
    updatedAt,
  };
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
