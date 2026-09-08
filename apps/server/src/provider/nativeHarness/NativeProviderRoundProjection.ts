import {
  type EventId,
  type IsoDateTime,
  type ProviderDriverKind,
  RuntimeItemId,
  type TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError } from "../Errors.ts";
import {
  toNativeProviderSessionView,
  type NativeProviderSessionContext,
} from "./NativeProviderSessionContext.ts";
import type {
  NativeProviderAdapterDefinition,
  NativeProviderRoundEvent,
  NativeProviderToolCall,
  NativeProviderTurnPlan,
} from "./NativeProviderTypes.ts";

interface NativeProviderRoundProjectionDependencies<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
> {
  readonly provider: ProviderDriverKind;
  readonly streamRound: NativeProviderAdapterDefinition<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >["streamRound"];
  readonly randomUuid: Effect.Effect<string, ProviderAdapterRequestError>;
  readonly makeEventStamp: () => Effect.Effect<
    { readonly eventId: EventId; readonly createdAt: IsoDateTime },
    ProviderAdapterRequestError
  >;
}

export function makeNativeProviderRoundProjection<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
>(
  dependencies: NativeProviderRoundProjectionDependencies<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >,
) {
  return Effect.fn("NativeProviderRoundProjection.run")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
    turnId: TurnId,
    plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>,
  ) {
    const controller = new AbortController();
    context.activeAbortController = controller;
    let assistantText = "";
    let reasoningText = "";
    let assistantItemId: RuntimeItemId | undefined;
    let reasoningItemId: RuntimeItemId | undefined;
    let terminal:
      | Extract<NativeProviderRoundEvent<HistoryItem, ToolCall>, { readonly type: "completed" }>
      | undefined;

    const ensureItem = Effect.fn("NativeProviderRoundProjection.ensureItem")(function* (
      kind: "assistant" | "reasoning",
      sourceId: string | undefined,
    ) {
      const current = kind === "assistant" ? assistantItemId : reasoningItemId;
      if (current) return current;
      const itemId = RuntimeItemId.make(sourceId?.trim() || (yield* dependencies.randomUuid));
      if (kind === "assistant") assistantItemId = itemId;
      else reasoningItemId = itemId;
      yield* context.emitRuntimeEvent({
        type: "item.started",
        ...(yield* dependencies.makeEventStamp()),
        provider: dependencies.provider,
        threadId: context.threadId,
        turnId,
        itemId,
        payload: {
          itemType: kind === "assistant" ? "assistant_message" : "reasoning",
          status: "inProgress",
        },
      });
      return itemId;
    });

    yield* dependencies
      .streamRound({
        session: toNativeProviderSessionView(context),
        plan,
        turnId,
        signal: controller.signal,
      })
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "failed") {
              return yield* new ProviderAdapterRequestError({
                provider: dependencies.provider,
                method: "model/stream",
                detail: event.message,
              });
            }
            if (event.type === "completed") {
              if (terminal) {
                return yield* new ProviderAdapterRequestError({
                  provider: dependencies.provider,
                  method: "model/stream",
                  detail: `${dependencies.provider} emitted more than one terminal response event.`,
                });
              }
              terminal = event;
              return;
            }
            if (terminal) {
              return yield* new ProviderAdapterRequestError({
                provider: dependencies.provider,
                method: "model/stream",
                detail: `${dependencies.provider} emitted output after the terminal response event.`,
              });
            }
            const itemId = yield* ensureItem(event.kind, event.sourceId);
            if (event.kind === "assistant") assistantText += event.delta;
            else reasoningText += event.delta;
            yield* context.emitRuntimeEvent({
              type: "content.delta",
              ...(yield* dependencies.makeEventStamp()),
              provider: dependencies.provider,
              threadId: context.threadId,
              turnId,
              itemId,
              payload: {
                streamKind: event.kind === "assistant" ? "assistant_text" : "reasoning_text",
                delta: event.delta,
              },
            });
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            controller.abort();
            if (context.activeAbortController === controller) {
              context.activeAbortController = undefined;
            }
          }),
        ),
      );
    if (!terminal) {
      return yield* new ProviderAdapterRequestError({
        provider: dependencies.provider,
        method: "model/stream",
        detail: `${dependencies.provider} response stream ended without a terminal event.`,
      });
    }
    assistantText ||= terminal.assistantText ?? "";
    reasoningText ||= terminal.reasoningText ?? "";
    if (!assistantItemId && assistantText) {
      assistantItemId = yield* ensureItem("assistant", undefined);
      yield* context.emitRuntimeEvent({
        type: "content.delta",
        ...(yield* dependencies.makeEventStamp()),
        provider: dependencies.provider,
        threadId: context.threadId,
        turnId,
        itemId: assistantItemId,
        payload: { streamKind: "assistant_text", delta: assistantText },
      });
    }
    if (!reasoningItemId && reasoningText) {
      reasoningItemId = yield* ensureItem("reasoning", undefined);
      yield* context.emitRuntimeEvent({
        type: "content.delta",
        ...(yield* dependencies.makeEventStamp()),
        provider: dependencies.provider,
        threadId: context.threadId,
        turnId,
        itemId: reasoningItemId,
        payload: { streamKind: "reasoning_text", delta: reasoningText },
      });
    }
    if (assistantItemId) {
      yield* context.emitRuntimeEvent({
        type: "item.completed",
        ...(yield* dependencies.makeEventStamp()),
        provider: dependencies.provider,
        threadId: context.threadId,
        turnId,
        itemId: assistantItemId,
        payload: {
          itemType: "assistant_message",
          status: "completed",
          data: { text: assistantText },
        },
      });
    }
    if (reasoningItemId) {
      yield* context.emitRuntimeEvent({
        type: "item.completed",
        ...(yield* dependencies.makeEventStamp()),
        provider: dependencies.provider,
        threadId: context.threadId,
        turnId,
        itemId: reasoningItemId,
        payload: {
          itemType: "reasoning",
          status: "completed",
          data: { text: reasoningText },
        },
      });
    }
    return { ...terminal, assistantText, reasoningText };
  });
}
