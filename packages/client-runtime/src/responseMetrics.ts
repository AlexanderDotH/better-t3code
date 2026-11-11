import * as DateTime from "effect/DateTime";
import {
  ResponseMetricsSnapshot,
  type MessageId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ProviderTurnId,
  type RunAttemptId,
  type RunId,
  type TurnId,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
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

const decodeSnapshot = Schema.decodeUnknownOption(ResponseMetricsSnapshot);

export interface ResponseMetrics extends ResponseMetricsSnapshot {
  readonly liveStartedAt?: number | undefined;
  readonly outputCharacters?: number;
  readonly outputCharactersByMessageId?: ReadonlyMap<MessageId, number>;
}

const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

// Quiet projections omit streamed bodies; the message row supplies its live text.
type ResponseMetricsTurnItem = Pick<OrchestrationV2TurnItem, "type" | "providerTurnId"> & {
  readonly text?: string;
  readonly messageId?: MessageId;
};

export function selectResponseMetrics(
  activities: ReadonlyArray<UsageActivity>,
): ReadonlyMap<TurnId, ResponseMetricsSnapshot> {
  const snapshots = new Map<TurnId, ResponseMetricsSnapshot>();
  for (const activity of activities) {
    if (
      activity.kind !== "response.metrics" ||
      activity.turnId == null ||
      activity.replyTopicId !== undefined ||
      activity.id.startsWith("subagent:")
    )
      continue;
    const snapshot = decodeSnapshot(activity.payload);
    if (Option.isSome(snapshot)) snapshots.set(activity.turnId, snapshot.value);
  }
  return snapshots;
}

export function selectV2ResponseMetrics<Item extends ResponseMetricsTurnItem>(
  projection: Pick<OrchestrationV2ThreadProjection, "runs" | "providerTurns"> & {
    readonly turnItems?: ReadonlyArray<Item>;
  },
): ReadonlyMap<RunId, ResponseMetrics> {
  const snapshots = new Map<RunId, ResponseMetrics>();
  const turnsByAttempt = new Map<
    RunAttemptId,
    OrchestrationV2ThreadProjection["providerTurns"][number]
  >();
  for (const turn of projection.providerTurns) {
    if (turn.runAttemptId === null) continue;
    const previous = turnsByAttempt.get(turn.runAttemptId);
    if (previous === undefined || turn.ordinal > previous.ordinal)
      turnsByAttempt.set(turn.runAttemptId, turn);
  }
  const outputByTurn = new Map<
    ProviderTurnId,
    { outputCharacters: number; outputCharactersByMessageId: Map<MessageId, number> }
  >();
  for (const item of projection.turnItems ?? []) {
    if (
      item.providerTurnId === null ||
      item.text === undefined ||
      (item.type !== "assistant_message" && item.type !== "reasoning")
    )
      continue;
    let output = outputByTurn.get(item.providerTurnId);
    if (output === undefined) {
      output = { outputCharacters: 0, outputCharactersByMessageId: new Map() };
      outputByTurn.set(item.providerTurnId, output);
    }
    const characters = item.text.length;
    output.outputCharacters += characters;
    if (item.type === "assistant_message" && item.messageId !== undefined)
      output.outputCharactersByMessageId.set(item.messageId, characters);
  }
  for (const run of projection.runs) {
    if (run.activeAttemptId === null) continue;
    const turn = turnsByAttempt.get(run.activeAttemptId);
    if (turn === undefined) continue;
    const contextUsage = turn.tokenUsage;
    const tokenUsage = turn.turnTokenUsage ?? turn.responseMetrics?.tokenUsage;
    const live = run.completedAt === null && turn.completedAt === null && turn.status === "running";
    const duration =
      turn.startedAt === null || turn.completedAt === null
        ? undefined
        : Math.max(
            0,
            DateTime.toEpochMillis(turn.completedAt) - DateTime.toEpochMillis(turn.startedAt),
          );
    snapshots.set(run.id, {
      ...outputByTurn.get(turn.id),
      ...(live && turn.startedAt !== null
        ? { liveStartedAt: DateTime.toEpochMillis(turn.startedAt) }
        : {}),
      ...(duration === undefined ? {} : { responseDurationMs: duration }),
      ...(tokenUsage === undefined && contextUsage?.outputTokens !== undefined
        ? {
            tokenUsage: {
              usageScope: "main_agent" as const,
              usageStatus: "partial" as const,
              hasSubagents: false,
              outputTokens: contextUsage.outputTokens,
            },
          }
        : tokenUsage === undefined
          ? {}
          : { tokenUsage }),
      ...(contextUsage === undefined ? {} : { contextUsedTokens: contextUsage.usedTokens }),
      ...(contextUsage?.maxTokens == null || contextUsage.maxTokens === 0
        ? {}
        : { contextLimitTokens: contextUsage.maxTokens }),
      ...turn.responseMetrics,
    });
  }
  return snapshots;
}

export function formatResponseMetrics(
  snapshot: ResponseMetrics | null,
  translator: InterfaceTranslator,
  options: {
    readonly nowMs?: number;
    readonly message?: { readonly id: MessageId; readonly text: string };
  } = {},
) {
  if (snapshot === null) return null;

  const { message, number } = translator;
  const unavailable = "–";
  const usage = snapshot.tokenUsage;
  const complete = usage?.usageStatus === "complete";
  const outputCharacters = Math.max(
    0,
    (snapshot.outputCharacters ?? 0) +
      (options.message === undefined
        ? 0
        : options.message.text.length -
          (snapshot.outputCharactersByMessageId?.get(options.message.id) ?? 0)),
  );
  const estimatedTokens =
    outputCharacters > 0 ? Math.ceil(outputCharacters / ESTIMATED_CHARACTERS_PER_TOKEN) : undefined;
  const live = snapshot.liveStartedAt !== undefined;
  const estimated =
    !complete &&
    estimatedTokens !== undefined &&
    (usage?.outputTokens === undefined || (live && estimatedTokens > usage.outputTokens));
  const outputTokens = estimated ? estimatedTokens : usage?.outputTokens;
  const prefix = estimated ? "≈ " : complete ? "" : "≥ ";
  const duration =
    snapshot.liveStartedAt !== undefined && options.nowMs !== undefined
      ? Math.max(0, options.nowMs - snapshot.liveStartedAt)
      : snapshot.responseDurationMs;
  const rate =
    (complete || estimated || live) &&
    outputTokens !== undefined &&
    duration !== undefined &&
    duration > 0
      ? (outputTokens * 1000) / duration
      : null;
  const estimateExplanation = estimated
    ? ` ${message("chat.responseMetrics.estimatedTooltip")}`
    : "";
  const timeToFirst = snapshot.timeToFirstTokenMs;
  const used = snapshot.contextUsedTokens;
  const limit = snapshot.contextLimitTokens;
  const context =
    used === undefined && limit === undefined
      ? unavailable
      : used === undefined || limit === undefined
        ? message("chat.responseMetrics.contextValueUnknown", {
            used: used === undefined ? unavailable : number(used),
            limit: limit === undefined ? unavailable : number(limit),
          })
        : message("chat.responseMetrics.contextValue", {
            used: number(used),
            limit: number(limit),
            percentage: number(used / limit, { style: "percent", maximumFractionDigits: 1 }),
          });

  return {
    speed: {
      text: message("chat.responseMetrics.speedInline", {
        speed:
          rate === null ? unavailable : `${prefix}${number(rate, { maximumFractionDigits: 1 })}`,
      }),
      tooltip: message("chat.responseMetrics.speedTooltip") + estimateExplanation,
    },
    firstToken: {
      text: message("chat.responseMetrics.firstTokenInline", {
        time:
          timeToFirst === undefined
            ? unavailable
            : message("chat.responseMetrics.seconds", {
                seconds: number(timeToFirst / 1000, { maximumFractionDigits: 2 }),
              }),
      }),
      tooltip: message("chat.responseMetrics.firstTokenTooltip"),
    },
    output: {
      text: message("chat.responseMetrics.outputInline", {
        tokens: outputTokens === undefined ? unavailable : `${prefix}${number(outputTokens)}`,
      }),
      tooltip: message("chat.responseMetrics.outputTooltip") + estimateExplanation,
    },
    context: {
      text: message("chat.responseMetrics.contextInline", { context }),
      tooltip: message("chat.responseMetrics.contextTooltip"),
    },
  };
}
