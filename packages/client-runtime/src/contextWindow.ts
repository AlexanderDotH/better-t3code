import * as DateTime from "effect/DateTime";
import {
  type OrchestrationV2ContextTransfer,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2ProviderTurnTokenUsage,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import { Option, Schema } from "effect";
import { COMPACTION_SUGGESTION_MIN_TOKENS } from "@t3tools/shared/claudeCompaction";

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
const decodeCost = Schema.decodeUnknownOption(ThreadTokenUsageSnapshot.fields.cost);

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

type ContextWindowTurnItem =
  | Pick<
      Extract<OrchestrationV2TurnItem, { readonly type: "compaction" }>,
      "type" | "beforeTokenCount" | "afterTokenCount" | "startedAt" | "updatedAt"
    >
  | { readonly type: Exclude<OrchestrationV2TurnItem["type"], "compaction"> };

export interface ContextWindowProjection {
  readonly thread: Pick<
    OrchestrationV2ThreadProjection["thread"],
    "id" | "activeProviderThreadId" | "forkedFrom" | "modelSelection"
  >;
  readonly providerThreads: ReadonlyArray<
    Pick<OrchestrationV2ProviderThread, "id" | "contextUsage" | "updatedAt">
  >;
  readonly providerTurns: ReadonlyArray<Pick<OrchestrationV2ProviderTurn, "tokenUsage">>;
  readonly visibleTurnItems: ReadonlyArray<{ readonly item: ContextWindowTurnItem }>;
  readonly contextTransfers: ReadonlyArray<
    Pick<
      OrchestrationV2ContextTransfer,
      | "type"
      | "targetThreadId"
      | "sourceThreadId"
      | "sourcePoint"
      | "sourceProviderInstanceId"
      | "status"
      | "resolution"
      | "sourceTokenUsage"
    >
  >;
}

// A provider thread's snapshot is written when a turn starts; running turns report newer usage.
function latestProviderTurnTokenUsage(
  projection: ContextWindowProjection,
  hasProviderSnapshot: boolean,
): OrchestrationV2ProviderTurnTokenUsage | null {
  let latest: OrchestrationV2ProviderTurnTokenUsage | null = null;
  for (const { tokenUsage } of projection.providerTurns) {
    if (tokenUsage === undefined) continue;
    if (latest === null || Date.parse(tokenUsage.updatedAt) >= Date.parse(latest.updatedAt)) {
      latest = tokenUsage;
    }
  }
  if (latest !== null || hasProviderSnapshot) return latest;
  const { thread } = projection;
  const forkedFrom = thread.forkedFrom;
  if (forkedFrom?.type !== "run") return null;
  return (
    projection.contextTransfers.find(
      (transfer) =>
        transfer.type === "fork" &&
        transfer.targetThreadId === thread.id &&
        transfer.sourceThreadId === forkedFrom.threadId &&
        transfer.sourcePoint.runId === forkedFrom.runId &&
        transfer.sourceProviderInstanceId === thread.modelSelection.instanceId &&
        (transfer.status === "pending" || transfer.resolution?.strategy === "native_fork"),
    )?.sourceTokenUsage ?? null
  );
}

function projectionContextWindowSnapshot(
  projection: ContextWindowProjection,
): ContextWindowSnapshot | null {
  const providerThread =
    projection.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    ) ?? projection.providerThreads.findLast((thread) => thread.contextUsage != null);
  const providerUsage = providerThread?.contextUsage ?? null;
  const liveUsage = latestProviderTurnTokenUsage(projection, providerUsage !== null);
  if (liveUsage !== null) {
    return contextWindowSnapshot(
      {
        ...liveUsage,
        maxTokens: liveUsage.maxTokens ?? providerUsage?.maxTokens,
        cumulativeUsage: providerUsage?.cumulativeUsage,
        compactsAutomatically: providerUsage?.compactsAutomatically ?? true,
      },
      liveUsage.updatedAt,
    );
  }
  if (providerThread && providerUsage !== null) {
    return contextWindowSnapshot(providerUsage, DateTime.formatIso(providerThread.updatedAt));
  }
  for (let index = projection.visibleTurnItems.length - 1; index >= 0; index -= 1) {
    const item = projection.visibleTurnItems[index]?.item;
    if (item?.type !== "compaction") continue;
    const snapshot = contextWindowSnapshot(
      {
        usedTokens: item.afterTokenCount,
        totalProcessedTokens: item.beforeTokenCount,
        compactsAutomatically: true,
      },
      DateTime.formatIso(item.startedAt ?? item.updatedAt),
    );
    if (snapshot !== null) return snapshot;
  }
  return null;
}

export function deriveLatestContextWindowSnapshot(
  input: ReadonlyArray<UsageActivity> | ContextWindowProjection,
): ContextWindowSnapshot | null {
  if ("providerThreads" in input) return projectionContextWindowSnapshot(input);
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
    cost: Option.getOrNull(decodeCost(payload?.cost)) ?? null,
    updatedAt,
  };
}

const RESUME_COMPACTION_FALLBACK_TTL_MS = 70 * 60_000;

export function shouldOfferResumeCompaction(input: {
  readonly provider: string | null | undefined;
  readonly usedTokens: number | null | undefined;
  readonly updatedAt: string | null | undefined;
  readonly promptCacheTtlMs?: number | undefined;
  readonly now: string;
}): boolean {
  if (
    input.provider !== "claudeAgent" ||
    (input.usedTokens ?? 0) < COMPACTION_SUGGESTION_MIN_TOKENS
  )
    return false;
  const updatedAt = Date.parse(input.updatedAt ?? "");
  const now = Date.parse(input.now);
  return (
    Number.isFinite(updatedAt) &&
    Number.isFinite(now) &&
    now - updatedAt >= (input.promptCacheTtlMs ?? RESUME_COMPACTION_FALLBACK_TTL_MS)
  );
}

export function shouldCompactBeforeSend(input: {
  readonly offered: boolean;
  readonly keepFullHistory: boolean;
  readonly text: string;
}) {
  return input.offered && !input.keepFullHistory && !/^\s*\/compact(?:\s|$)/i.test(input.text);
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
