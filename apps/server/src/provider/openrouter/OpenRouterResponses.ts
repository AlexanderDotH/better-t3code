import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import {
  buildOpenResponsesRequest,
  decodeOpenResponsesSse,
  isOpenResponsesProtocolError,
  type OpenResponsesEvent,
  type OpenResponsesHistoryItem,
} from "../openResponses/OpenResponses.ts";
import {
  type OpenRouterHistoryItem,
  type OpenRouterRoundEvent,
  type OpenRouterRoundRequest,
} from "./OpenRouterProtocol.ts";
import { buildOpenRouterRequestPolicy } from "./OpenRouterRouting.ts";
import { OpenRouterProtocolError } from "./OpenRouterSse.ts";

// Chat Completions reasoning details are not valid Responses input, so only replay
// output items that an earlier Responses round produced.
const responsesHistory = (
  history: ReadonlyArray<OpenRouterHistoryItem>,
): ReadonlyArray<OpenResponsesHistoryItem> =>
  history.map((item) =>
    item.type !== "assistant"
      ? item
      : {
          type: "assistant",
          content: item.content,
          ...(item.toolCalls === undefined ? {} : { toolCalls: item.toolCalls }),
          ...(item.opaque?.protocol === "responses"
            ? { outputItems: item.opaque.outputItems }
            : {}),
        },
  );

export const buildOpenRouterResponsesRequest = Effect.fn("buildOpenRouterResponsesRequest")((
  request: OpenRouterRoundRequest,
) => {
  const policy = buildOpenRouterRequestPolicy(request.settings);
  return Effect.succeed({
    ...buildOpenResponsesRequest({
      model: request.model,
      instructions: request.instructions,
      history: responsesHistory(request.history),
      tools: request.tools,
      ...(request.toolParameters === undefined
        ? {}
        : {
            toolChoice: request.toolParameters.toolChoice,
            parallelToolCalls: request.toolParameters.parallelToolCalls,
          }),
      ...(request.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: request.reasoningEffort }),
      ...(request.responseFormat === undefined ? {} : { responseFormat: request.responseFormat }),
    }),
    provider: policy.provider,
    plugins: policy.plugins,
  });
});

const toRoundEvent = (event: OpenResponsesEvent): OpenRouterRoundEvent => {
  if (event.type !== "completed") return event;
  const { assistantText, reasoningText, outputItems, usage } = event;
  const historyItem: OpenRouterHistoryItem = {
    type: "assistant",
    content: assistantText,
    ...(reasoningText ? { reasoning: reasoningText } : {}),
    ...(event.toolCalls.length === 0
      ? {}
      : {
          toolCalls: event.toolCalls.map((toolCall) => ({
            id: toolCall.callId,
            name: toolCall.name,
            arguments: toolCall.arguments,
          })),
        }),
    ...(outputItems.length === 0 ? {} : { opaque: { protocol: "responses", outputItems } }),
  };
  return {
    type: "completed",
    ...(assistantText ? { assistantText } : {}),
    ...(reasoningText ? { reasoningText } : {}),
    toolCalls: event.toolCalls.map((toolCall) => ({
      sourceId: toolCall.callId,
      name: toolCall.name,
      arguments: toolCall.arguments,
      ...(toolCall.itemId === undefined ? {} : { metadata: { itemId: toolCall.itemId } }),
    })),
    historyItems: [historyItem],
    model: event.model ?? "unknown",
    stopReason: event.status,
    ...(usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            ...(usage.cachedInputTokens === undefined
              ? {}
              : { cachedInputTokens: usage.cachedInputTokens }),
            ...(usage.reasoningTokens === undefined
              ? {}
              : { reasoningTokens: usage.reasoningTokens }),
          },
        }),
    ...(usage?.costUsd === undefined ? {} : { totalCostUsd: usage.costUsd }),
  };
};

export const decodeOpenRouterResponsesSse = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<OpenRouterRoundEvent, E | OpenRouterProtocolError, R> =>
  decodeOpenResponsesSse(bytes, { label: "OpenRouter Responses" }).pipe(
    Stream.map(toRoundEvent),
    Stream.mapError((error) =>
      isOpenResponsesProtocolError(error)
        ? new OpenRouterProtocolError({ protocol: "responses", message: error.message })
        : error,
    ),
  );
