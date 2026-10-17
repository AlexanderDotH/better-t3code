import {
  ResponseMetricsSnapshot,
  type OrchestrationThreadActivity,
  type TurnId,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { Option, Schema } from "effect";

const decodeSnapshot = Schema.decodeUnknownOption(ResponseMetricsSnapshot);

export function selectResponseMetrics(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyMap<TurnId, ResponseMetricsSnapshot> {
  const snapshots = new Map<TurnId, ResponseMetricsSnapshot>();
  for (const activity of activities) {
    if (
      activity.kind !== "response.metrics" ||
      activity.turnId === null ||
      activity.replyTopicId !== undefined ||
      activity.id.startsWith("subagent:")
    )
      continue;
    const snapshot = decodeSnapshot(activity.payload);
    if (Option.isSome(snapshot)) snapshots.set(activity.turnId, snapshot.value);
  }
  return snapshots;
}

export function formatResponseMetrics(
  snapshot: ResponseMetricsSnapshot | null,
  translator: InterfaceTranslator,
) {
  if (snapshot === null) return null;

  const { message, number } = translator;
  const unavailable = "–";
  const usage = snapshot.tokenUsage;
  const outputTokens = usage?.outputTokens;
  const complete = usage?.usageStatus === "complete";
  const duration = snapshot.responseDurationMs;
  const rate =
    complete && outputTokens !== undefined && duration !== undefined && duration > 0
      ? (outputTokens * 1000) / duration
      : null;
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
        speed: rate === null ? unavailable : number(rate, { maximumFractionDigits: 1 }),
      }),
      tooltip: message("chat.responseMetrics.speedTooltip"),
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
        tokens:
          outputTokens === undefined
            ? unavailable
            : `${complete ? "" : "≥ "}${number(outputTokens)}`,
      }),
      tooltip: message("chat.responseMetrics.outputTooltip"),
    },
    context: {
      text: message("chat.responseMetrics.contextInline", { context }),
      tooltip: message("chat.responseMetrics.contextTooltip"),
    },
  };
}
