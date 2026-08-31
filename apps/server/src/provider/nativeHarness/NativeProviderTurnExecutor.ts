import { TurnId, type EventId, type IsoDateTime, type ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ProviderAdapterRequestError,
  type ProviderAdapterError,
  type ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { nativeProviderErrorDetail } from "./NativeProviderError.ts";
import {
  type NativeProviderSessionContext,
  toNativeProviderSessionView,
} from "./NativeProviderSessionContext.ts";
import { makeNativeProviderRoundProjection } from "./NativeProviderRoundProjection.ts";
import type { NativeProviderSessionStore } from "./NativeProviderSessionStore.ts";
import { makeNativeProviderToolExecutor } from "./NativeProviderToolExecutor.ts";
import type {
  NativeProviderAdapterDefinition,
  NativeProviderAttachment,
  NativeProviderToolCall,
  NativeProviderTurnAdmission,
  NativeProviderUsage,
} from "./NativeProviderTypes.ts";

class NativeProviderTurnInterruptedError extends Schema.TaggedErrorClass<NativeProviderTurnInterruptedError>()(
  "NativeProviderTurnInterruptedError",
  {},
) {}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

export interface NativeProviderTurnExecutorDependencies<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
> {
  readonly definition: NativeProviderAdapterDefinition<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >;
  readonly environment: NodeJS.ProcessEnv;
  readonly admission: NativeProviderTurnAdmission;
  readonly sessionStore: NativeProviderSessionStore<HistoryItem, SessionState>;
  readonly requireSession: (
    threadId: ThreadId,
  ) => Effect.Effect<
    NativeProviderSessionContext<HistoryItem, SessionState>,
    ProviderAdapterSessionNotFoundError
  >;
  readonly readAttachment: (
    attachment: NativeProviderAttachment,
  ) => Effect.Effect<Uint8Array, ProviderAdapterRequestError>;
  readonly randomUuid: Effect.Effect<string, ProviderAdapterRequestError>;
  readonly nowIso: Effect.Effect<IsoDateTime>;
  readonly makeEventStamp: () => Effect.Effect<
    { readonly eventId: EventId; readonly createdAt: IsoDateTime },
    ProviderAdapterRequestError
  >;
}

export function makeNativeProviderTurnExecutor<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
>(
  dependencies: NativeProviderTurnExecutorDependencies<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >,
) {
  const { definition, sessionStore } = dependencies;
  const executeTool = makeNativeProviderToolExecutor<HistoryItem, SessionState, ToolCall>({
    provider: definition.provider,
    environment: dependencies.environment,
    toolHarness: definition.toolHarness,
    maxToolOutputBytes: definition.limits.maxToolOutputBytes,
    randomUuid: dependencies.randomUuid,
    makeEventStamp: dependencies.makeEventStamp,
  });
  const runModelRound = makeNativeProviderRoundProjection({
    provider: definition.provider,
    streamRound: definition.streamRound,
    randomUuid: dependencies.randomUuid,
    makeEventStamp: dependencies.makeEventStamp,
  });

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* dependencies.requireSession(input.threadId);
      return yield* context.turnSemaphore
        .withPermits(1)(
          Effect.gen(function* () {
            yield* sessionStore.touchWorkingSet(context);
            const plan = yield* definition.prepareTurn({
              input,
              session: toNativeProviderSessionView(context),
              readAttachment: dependencies.readAttachment,
            });
            if (plan.toolDeclarations.length > definition.limits.maxToolDefinitions) {
              return yield* new ProviderAdapterRequestError({
                provider: definition.provider,
                method: "session/prompt",
                detail: `T3 exposed ${plan.toolDeclarations.length} tools, exceeding ${definition.provider}'s ${definition.limits.maxToolDefinitions}-definition limit.`,
              });
            }
            const turnId = TurnId.make(yield* dependencies.randomUuid);
            const interrupt = yield* Deferred.make<void>();
            let historyStart = context.history.length;
            const preTurnHistory = [...context.history];
            const preTurnCount = context.turns.length;
            const turnItems: Array<unknown> = [];
            context.history.push(...plan.userHistoryItems);
            context.activeTurnId = turnId;
            context.activeInterrupt = interrupt;
            context.session = {
              ...context.session,
              status: "running",
              model: plan.model,
              activeTurnId: turnId,
              updatedAt: yield* dependencies.nowIso,
            };
            yield* context.emitRuntimeEvent({
              type: "turn.started",
              ...(yield* dependencies.makeEventStamp()),
              provider: definition.provider,
              threadId: input.threadId,
              turnId,
              payload: { model: plan.model },
            });
            yield* context.emitRuntimeEvent({
              type: "session.state.changed",
              ...(yield* dependencies.makeEventStamp()),
              provider: definition.provider,
              threadId: input.threadId,
              turnId,
              payload: { state: "running", reason: definition.messages.turnRunning },
            });

            let terminalEmitted = false;
            let lastUsage: NativeProviderUsage | undefined;
            let stopReason: string | null | undefined;
            const emitTerminal = (
              state: "completed" | "failed" | "interrupted",
              message?: string,
            ) =>
              Effect.gen(function* () {
                if (terminalEmitted) return;
                terminalEmitted = true;
                yield* context.emitRuntimeEvent({
                  type: "turn.completed",
                  ...(yield* dependencies.makeEventStamp()),
                  provider: definition.provider,
                  threadId: input.threadId,
                  turnId,
                  payload: {
                    state,
                    ...(stopReason !== undefined ? { stopReason } : {}),
                    ...(lastUsage?.raw !== undefined ? { usage: lastUsage.raw } : {}),
                    ...(lastUsage?.modelUsage ? { modelUsage: lastUsage.modelUsage } : {}),
                    ...(lastUsage?.totalCostUsd !== undefined
                      ? { totalCostUsd: lastUsage.totalCostUsd }
                      : {}),
                    ...(message ? { errorMessage: message } : {}),
                  },
                });
              });
            context.activeTerminal = emitTerminal;
            const settleActiveTurn = Effect.fn("NativeProviderTurnExecutor.settle")(function* () {
              context.activeAbortController?.abort();
              context.activeAbortController = undefined;
              context.activeInterrupt = undefined;
              context.activeTerminal = undefined;
              context.activeTurnId = undefined;
              const { activeTurnId: _activeTurnId, ...ready } = context.session;
              context.session = {
                ...ready,
                status: context.stopped ? "closed" : "ready",
                updatedAt: yield* dependencies.nowIso,
              };
            });
            const interruptActiveTurn = Effect.fn("NativeProviderTurnExecutor.interrupt")(
              function* () {
                context.history.splice(0, context.history.length, ...preTurnHistory);
                context.turns.splice(preTurnCount);
                yield* emitTerminal("interrupted");
                yield* settleActiveTurn();
              },
            );
            const failActiveTurn = Effect.fn("NativeProviderTurnExecutor.fail")(function* (
              cause: ProviderAdapterError,
            ) {
              context.history.splice(0, context.history.length, ...preTurnHistory);
              context.turns.splice(preTurnCount);
              const detail = nativeProviderErrorDetail(cause);
              yield* context.emitRuntimeEvent({
                type: "runtime.error",
                ...(yield* dependencies.makeEventStamp()),
                provider: definition.provider,
                threadId: input.threadId,
                turnId,
                payload: { message: detail, class: "provider_error" },
              });
              yield* emitTerminal("failed", detail);
              yield* settleActiveTurn();
              return yield* cause;
            });

            const runToolLoop = Effect.gen(function* () {
              for (let round = 0; round < definition.limits.maxToolRounds; round += 1) {
                const beforeRound = yield* (
                  definition.beforeRound?.({
                    session: toNativeProviderSessionView(context),
                    plan,
                  }) ?? Effect.void
                );
                if (beforeRound?.replacementHistory) {
                  context.history.splice(
                    0,
                    context.history.length,
                    ...beforeRound.replacementHistory,
                  );
                }
                if (beforeRound?.resetTurnHistoryStart) historyStart = 0;
                const response = yield* runModelRound(context, turnId, plan);
                context.history.push(...response.historyItems);
                lastUsage = response.usage;
                stopReason = response.stopReason;
                context.totalProcessedTokens += nonNegativeInteger(response.usage?.usedTokens);
                if (response.assistantText) {
                  turnItems.push({ type: "assistant_message", text: response.assistantText });
                }
                if (response.reasoningText) {
                  turnItems.push({ type: "reasoning", text: response.reasoningText });
                }
                if (response.toolCalls.length === 0) return;
                const results = yield* Effect.forEach(
                  response.toolCalls,
                  (call) =>
                    executeTool({
                      context,
                      turnId,
                      call,
                      interactionMode: input.interactionMode,
                      interrupt,
                    }),
                  { concurrency: definition.limits.maxParallelToolCalls },
                );
                context.history.push(
                  ...definition.toolResultsToHistoryItems({
                    session: toNativeProviderSessionView(context),
                    plan,
                    results,
                  }),
                );
                turnItems.push(
                  ...results.map(({ call, result }) => ({
                    type: result.itemType,
                    name: call.name,
                    title: result.title,
                    detail: result.detail,
                    output: result.output,
                  })),
                );
              }
              return yield* new ProviderAdapterRequestError({
                provider: definition.provider,
                method: "session/prompt",
                detail: `${definition.provider} exceeded T3's ${definition.limits.maxToolRounds}-round tool-call limit.`,
              });
            });
            const admittedToolLoop = dependencies.admission.withLease(
              {
                threadId: input.threadId,
                turnId,
                providerInstanceId: definition.instanceId,
                serializedHistoryBytes: sessionStore.historyBytes(context.history),
                attachmentBytes: plan.attachmentBytes,
                toolBufferBytes:
                  definition.limits.maxToolOutputBytes *
                  Math.min(
                    definition.limits.maxParallelToolCalls,
                    Math.max(1, plan.toolDeclarations.length),
                  ),
              },
              runToolLoop,
            );
            yield* Effect.raceFirst(
              admittedToolLoop,
              Deferred.await(interrupt).pipe(
                Effect.andThen(Effect.fail(new NativeProviderTurnInterruptedError())),
              ),
            ).pipe(
              Effect.catchTag("NativeProviderTurnInterruptedError", () =>
                Effect.gen(function* () {
                  yield* interruptActiveTurn();
                  return yield* Effect.interrupt;
                }),
              ),
              Effect.catch(failActiveTurn),
              Effect.onInterrupt(() => Effect.uninterruptible(interruptActiveTurn())),
            );
            const persistedItems = plan.persistedUserHistoryItems;
            if (persistedItems && persistedItems.length === plan.userHistoryItems.length) {
              for (let index = 0; index < plan.userHistoryItems.length; index += 1) {
                const liveIndex = context.history.indexOf(plan.userHistoryItems[index]!);
                if (liveIndex >= 0) context.history[liveIndex] = persistedItems[index]!;
              }
            }
            context.turns.push({
              id: turnId,
              historyStart,
              historyEnd: context.history.length,
              items: turnItems,
            });
            yield* sessionStore.persistSession(context).pipe(
              Effect.catch(failActiveTurn),
              Effect.onInterrupt(() => Effect.uninterruptible(interruptActiveTurn())),
            );
            yield* emitTerminal("completed");
            if (lastUsage) {
              yield* context.emitRuntimeEvent({
                type: "thread.token-usage.updated",
                ...(yield* dependencies.makeEventStamp()),
                provider: definition.provider,
                threadId: input.threadId,
                turnId,
                payload: {
                  usage: {
                    usedTokens: lastUsage.usedTokens,
                    totalProcessedTokens: context.totalProcessedTokens,
                    inputTokens: lastUsage.inputTokens,
                    cachedInputTokens: lastUsage.cachedInputTokens,
                    outputTokens: lastUsage.outputTokens,
                    reasoningOutputTokens: lastUsage.reasoningOutputTokens,
                    lastUsedTokens: lastUsage.usedTokens,
                    lastInputTokens: lastUsage.inputTokens,
                    lastCachedInputTokens: lastUsage.cachedInputTokens,
                    lastOutputTokens: lastUsage.outputTokens,
                    lastReasoningOutputTokens: lastUsage.reasoningOutputTokens,
                  },
                },
              });
            }
            yield* settleActiveTurn();
            context.lastWorkingSetUse = sessionStore.nextWorkingSetUse();
            yield* sessionStore.evictIdleWorkingSets(context.threadId);
            if (!context.stopped) {
              yield* context.emitRuntimeEvent({
                type: "session.state.changed",
                ...(yield* dependencies.makeEventStamp()),
                provider: definition.provider,
                threadId: input.threadId,
                payload: { state: "ready", reason: definition.messages.turnSettled },
              });
            }
            return {
              threadId: input.threadId,
              turnId,
              resumeCursor: context.session.resumeCursor,
            };
          }),
        )
        .pipe(
          Effect.ensuring(definition.toolHarness.releaseThread?.(input.threadId) ?? Effect.void),
        );
    });

  return { sendTurn };
}
