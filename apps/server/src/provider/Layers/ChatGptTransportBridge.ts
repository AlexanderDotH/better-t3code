import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type {
  ChatGptResponseEvent,
  ChatGptResponseOutputItem,
} from "../chatgpt/ChatGptResponseSse.ts";
import type { ChatGptSubscriptionTransport } from "../chatgpt/ChatGptSubscriptionTransport.ts";
import {
  ChatGptAdapterBoundaryError,
  type ChatGptAdapterResponseItem,
  type ChatGptAdapterStreamEvent,
  type ChatGptAdapterTransport,
} from "./ChatGptAdapter.ts";

const isAdapterBoundaryError = Schema.is(ChatGptAdapterBoundaryError);

function detail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return "ChatGPT subscription transport failed.";
}

function bridgeError(operation: string) {
  return (cause: unknown) =>
    new ChatGptAdapterBoundaryError({ operation, detail: detail(cause), cause });
}

function outputItem(item: ChatGptResponseOutputItem): ChatGptAdapterResponseItem {
  if (item.type === "functionCall") {
    return {
      type: "function_call",
      ...(item.id === undefined ? {} : { id: item.id }),
      callId: item.callId,
      call_id: item.callId,
      name: item.name,
      arguments: item.arguments,
    };
  }
  if (item.type === "reasoning") {
    return {
      type: "reasoning",
      ...(item.id === undefined ? {} : { id: item.id }),
      ...(item.encryptedContent === undefined
        ? {}
        : { encryptedContent: item.encryptedContent, encrypted_content: item.encryptedContent }),
      summary: item.summary,
    };
  }
  return {
    type: "message",
    ...(item.id === undefined ? {} : { id: item.id }),
    ...(item.role === undefined ? {} : { role: item.role }),
    content: item.content,
  };
}

function event(input: ChatGptResponseEvent): ReadonlyArray<ChatGptAdapterStreamEvent> {
  switch (input.type) {
    case "outputTextDelta":
      return [{ type: "outputTextDelta", itemId: "assistant", delta: input.delta }];
    case "reasoningDelta":
      return [{ type: "reasoningDelta", itemId: "reasoning", delta: input.delta }];
    case "outputItemDone":
      return [{ type: "outputItemDone", item: outputItem(input.item) }];
    case "responseCompleted": {
      if (input.status !== "completed" && input.status !== "incomplete") {
        return [
          {
            type: "responseFailed",
            message: `ChatGPT response ended with status '${input.status}'.`,
          },
        ];
      }
      return [
        {
          type: "responseCompleted",
          responseId: input.responseId,
          status: input.status,
          outputItems: input.outputItems.map(outputItem),
          ...(input.usage === undefined
            ? {}
            : {
                usage: {
                  inputTokens: input.usage.inputTokens,
                  outputTokens: input.usage.outputTokens,
                  totalTokens: input.usage.totalTokens,
                  ...(input.usage.cachedInputTokens === undefined
                    ? {}
                    : { cachedInputTokens: input.usage.cachedInputTokens }),
                  ...(input.usage.reasoningTokens === undefined
                    ? {}
                    : { reasoningOutputTokens: input.usage.reasoningTokens }),
                },
              }),
        },
      ];
    }
    case "responseFailed":
      return [{ type: "responseFailed", message: input.message }];
    case "functionCallArgumentsDelta":
    case "refusalDelta":
    case "streamDone":
      return [];
  }
}

export function makeChatGptAdapterTransport(
  transport: ChatGptSubscriptionTransport,
): ChatGptAdapterTransport {
  return {
    rateLimit: transport.rateLimit,
    listModels: transport.listModels.pipe(
      Effect.map((models) =>
        models.map((model, index) => ({
          id: model.id,
          displayName: model.displayName,
          contextWindow: model.contextWindowTokens,
          default: index === 0,
          reasoningEfforts: model.reasoningEfforts,
        })),
      ),
      Effect.mapError(bridgeError("models/list")),
    ),
    streamResponse: ({ signal: _signal, tools, ...request }) =>
      transport
        .streamResponse({
          ...request,
          tools: tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
        })
        .pipe(
          Stream.flatMap((input) => Stream.fromIterable(event(input))),
          Stream.mapError(bridgeError("responses/stream")),
        ),
    compact: (request) =>
      transport.compact(request).pipe(
        Effect.map((result) => ({
          input: result.input.filter(
            (item): item is ChatGptAdapterResponseItem =>
              typeof item === "object" &&
              item !== null &&
              "type" in item &&
              typeof item.type === "string",
          ),
        })),
        Effect.flatMap((result) =>
          result.input.length > 0
            ? Effect.succeed(result)
            : Effect.fail(
                new ChatGptAdapterBoundaryError({
                  operation: "responses/compact",
                  detail: "ChatGPT compaction returned no valid replacement history.",
                }),
              ),
        ),
        Effect.mapError((cause) =>
          isAdapterBoundaryError(cause) ? cause : bridgeError("responses/compact")(cause),
        ),
      ),
  };
}
