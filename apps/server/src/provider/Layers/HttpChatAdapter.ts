import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderUserInputAnswers,
  RuntimeSessionId,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { bindProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";

export interface HttpChatTranscriptMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly attachments?: ProviderSendTurnInput["attachments"];
}

export interface HttpChatAdapterExecuteTurnInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly session: ProviderSession;
  readonly input: ProviderSendTurnInput;
  readonly messages: ReadonlyArray<HttpChatTranscriptMessage>;
  readonly signal: AbortSignal;
  readonly emitAssistantDelta: (delta: string) => Effect.Effect<void, ProviderAdapterError>;
  readonly emitReasoningDelta: (delta: string) => Effect.Effect<void, ProviderAdapterError>;
}

export interface HttpChatAdapterExecuteTurnResult {
  readonly assistantText?: string | undefined;
  readonly reasoningText?: string | undefined;
  readonly usage?: unknown;
  readonly modelUsage?: Record<string, unknown> | undefined;
  readonly totalCostUsd?: number | undefined;
  readonly stopReason?: string | null | undefined;
  readonly resumeCursor?: unknown;
}

export type HttpChatAdapterExecuteTurn = (
  input: HttpChatAdapterExecuteTurnInput,
) => Effect.Effect<HttpChatAdapterExecuteTurnResult, ProviderAdapterError>;

export interface HttpChatAdapterOptions {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly executeTurn: HttpChatAdapterExecuteTurn;
}

interface HttpChatTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface HttpChatSessionContext {
  session: ProviderSession;
  readonly emit: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly scope: Scope.Closeable;
  readonly turns: Array<HttpChatTurnSnapshot>;
  readonly transcript: Array<HttpChatTranscriptMessage>;
  readonly activeAbort: Ref.Ref<AbortController | undefined>;
  readonly runningFiber: Ref.Ref<Fiber.Fiber<void, ProviderAdapterError> | undefined>;
  stopped: boolean;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function ensureSessionContext(
  provider: ProviderDriverKind,
  sessions: ReadonlyMap<ThreadId, HttpChatSessionContext>,
  threadId: ThreadId,
): HttpChatSessionContext {
  const context = sessions.get(threadId);
  if (!context) {
    throw new ProviderAdapterSessionNotFoundError({ provider, threadId });
  }
  if (context.stopped) {
    throw new ProviderAdapterSessionClosedError({ provider, threadId });
  }
  return context;
}

function resolveTurnSnapshot(
  context: HttpChatSessionContext,
  turnId: TurnId,
): HttpChatTurnSnapshot {
  const existing = context.turns.find((turn) => turn.id === turnId);
  if (existing) return existing;
  const created: HttpChatTurnSnapshot = { id: turnId, items: [] };
  context.turns.push(created);
  return created;
}

function appendTurnItem(context: HttpChatSessionContext, turnId: TurnId, item: unknown): void {
  resolveTurnSnapshot(context, turnId).items.push(item);
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export function makeHttpChatAdapter(
  options: HttpChatAdapterOptions,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, never, Crypto.Crypto | Scope.Scope> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, HttpChatSessionContext>();

    const randomUuid = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: options.provider,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate HTTP-chat runtime identifier.",
            cause,
          }),
      ),
    );

    const makeEventBase = (input: {
      readonly threadId: ThreadId;
      readonly turnId?: TurnId | undefined;
      readonly itemId?: string | undefined;
    }) =>
      Effect.all({
        eventId: randomUuid.pipe(Effect.map(EventId.make)),
        createdAt: nowIso,
      }).pipe(
        Effect.map(({ eventId, createdAt }) => ({
          eventId,
          provider: options.provider,
          providerInstanceId: options.providerInstanceId,
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
        })),
      );

    const emit = (event: ProviderRuntimeEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

    const updateSession = (
      context: HttpChatSessionContext,
      patch: Partial<ProviderSession>,
      opts?: { readonly clearActiveTurnId?: boolean; readonly clearLastError?: boolean },
    ) =>
      Effect.gen(function* () {
        const updatedAt = yield* nowIso;
        const patched = { ...context.session, ...patch, updatedAt };
        const { activeTurnId: _activeTurnId, lastError: _lastError, ...withoutCleared } = patched;
        const next: ProviderSession =
          opts?.clearActiveTurnId && opts?.clearLastError
            ? withoutCleared
            : opts?.clearActiveTurnId
              ? (() => {
                  const { activeTurnId: _removed, ...rest } = patched;
                  return rest;
                })()
              : opts?.clearLastError
                ? (() => {
                    const { lastError: _removed, ...rest } = patched;
                    return rest;
                  })()
                : patched;
        context.session = next;
        return next;
      });

    const stopContext = (context: HttpChatSessionContext) =>
      Effect.gen(function* () {
        if (context.stopped) return;
        context.stopped = true;
        const abort = yield* Ref.get(context.activeAbort);
        abort?.abort();
        const running = yield* Ref.get(context.runningFiber);
        if (running) {
          yield* Fiber.interrupt(running).pipe(Effect.ignore);
        }
        yield* Scope.close(context.scope, Exit.void);
      });

    const stopAllContexts = Effect.fn("HttpChatAdapter.stopAllContexts")(function* () {
      const contexts = [...sessions.values()];
      sessions.clear();
      yield* Effect.forEach(contexts, stopContext, { concurrency: "unbounded", discard: true });
    });

    yield* Effect.addFinalizer(() =>
      stopAllContexts().pipe(
        Effect.ignore,
        Effect.tap(() => PubSub.shutdown(events)),
      ),
    );

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
      "HttpChatAdapter.startSession",
    )(function* (input: ProviderSessionStartInput) {
      if (
        input.providerInstanceId !== undefined &&
        input.providerInstanceId !== options.providerInstanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: options.provider,
          operation: "startSession",
          issue: `Provider instance '${input.providerInstanceId}' is not bound to '${options.providerInstanceId}'.`,
        });
      }

      const existing = sessions.get(input.threadId);
      if (existing && !existing.stopped) {
        return existing.session;
      }

      const createdAt = yield* nowIso;
      const runtimeSessionId = input.runtimeSessionId ?? RuntimeSessionId.make(yield* randomUuid);
      const session: ProviderSession = {
        provider: options.provider,
        providerInstanceId: options.providerInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        runtimeSessionId,
        createdAt,
        updatedAt: createdAt,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
      };

      const context: HttpChatSessionContext = {
        session,
        emit: bindProviderRuntimeEventOrigin(runtimeSessionId, emit),
        scope: yield* Scope.make(),
        turns: [],
        transcript: [],
        activeAbort: yield* Ref.make<AbortController | undefined>(undefined),
        runningFiber: yield* Ref.make<Fiber.Fiber<void, ProviderAdapterError> | undefined>(
          undefined,
        ),
        stopped: false,
      };
      sessions.set(input.threadId, context);

      yield* context.emit({
        ...(yield* makeEventBase({ threadId: input.threadId })),
        type: "session.started",
        payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
      });
      yield* context.emit({
        ...(yield* makeEventBase({ threadId: input.threadId })),
        type: "thread.started",
        payload: {},
      });

      return session;
    });

    const completeTurn = (
      context: HttpChatSessionContext,
      input: ProviderSendTurnInput,
      turnId: TurnId,
      controller: AbortController,
      result: HttpChatAdapterExecuteTurnResult,
      streamedAssistantText: string,
    ) =>
      Effect.gen(function* () {
        const assistantText = result.assistantText ?? streamedAssistantText;
        if (assistantText.trim()) {
          context.transcript.push({ role: "assistant", content: assistantText });
          appendTurnItem(context, turnId, {
            type: "assistant_message",
            role: "assistant",
            content: assistantText,
            ...(result.reasoningText ? { reasoning: result.reasoningText } : {}),
          });
          if (!controller.signal.aborted) {
            yield* context.emit({
              ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
              type: "item.completed",
              payload: {
                itemType: "assistant_message",
                status: "completed",
                title: "Assistant message",
                detail: assistantText,
              },
            });
          }
        }

        yield* Ref.set(context.activeAbort, undefined);
        yield* Ref.set(context.runningFiber, undefined);
        yield* updateSession(
          context,
          {
            status: "ready",
            ...(result.resumeCursor !== undefined ? { resumeCursor: result.resumeCursor } : {}),
          },
          { clearActiveTurnId: true, clearLastError: true },
        );
        yield* context.emit({
          ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
          type: "turn.completed",
          payload: {
            state: controller.signal.aborted ? "interrupted" : "completed",
            ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
            ...(result.usage !== undefined ? { usage: result.usage } : {}),
            ...(result.modelUsage !== undefined ? { modelUsage: result.modelUsage } : {}),
            ...(typeof result.totalCostUsd === "number"
              ? { totalCostUsd: result.totalCostUsd }
              : {}),
          },
        });
      });

    const runTurnInBackground = (
      context: HttpChatSessionContext,
      input: ProviderSendTurnInput,
      turnId: TurnId,
      controller: AbortController,
    ) =>
      Effect.gen(function* () {
        let streamedAssistantText = "";
        const emitAssistantDelta = (delta: string) =>
          Effect.gen(function* () {
            if (context.stopped || controller.signal.aborted) return;
            streamedAssistantText += delta;
            yield* context.emit({
              ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
              type: "content.delta",
              payload: {
                streamKind: "assistant_text",
                delta,
              },
            });
          });
        const emitReasoningDelta = (delta: string) =>
          Effect.gen(function* () {
            if (context.stopped || controller.signal.aborted) return;
            const eventBase = yield* makeEventBase({ threadId: input.threadId, turnId });
            yield* context.emit({
              ...eventBase,
              type: "content.delta",
              payload: {
                streamKind: "reasoning_text",
                delta,
              },
            });
          });

        const result = yield* options.executeTurn({
          threadId: input.threadId,
          turnId,
          session: context.session,
          input,
          messages: [...context.transcript],
          signal: controller.signal,
          emitAssistantDelta,
          emitReasoningDelta,
        });
        yield* completeTurn(context, input, turnId, controller, result, streamedAssistantText);
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* Ref.set(context.activeAbort, undefined);
            yield* Ref.set(context.runningFiber, undefined);
            const detail = errorDetail(error);
            yield* updateSession(
              context,
              {
                status: "ready",
                lastError: detail,
              },
              { clearActiveTurnId: true },
            );
            yield* context.emit({
              ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
              type: "runtime.error",
              payload: {
                message: detail,
                class: controller.signal.aborted ? "provider_error" : "transport_error",
              },
            });
            yield* context.emit({
              ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
              type: "turn.completed",
              payload: {
                state: controller.signal.aborted ? "interrupted" : "failed",
                errorMessage: detail,
              },
            });
          }),
        ),
      );

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn(
      "HttpChatAdapter.sendTurn",
    )(function* (input) {
      const context = ensureSessionContext(options.provider, sessions, input.threadId);
      if (context.session.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: options.provider,
          operation: "sendTurn",
          issue: "A turn is already running for this provider session.",
        });
      }

      const hasText = Boolean(input.input?.trim());
      const hasAttachments = (input.attachments?.length ?? 0) > 0;
      if (!hasText && !hasAttachments) {
        return yield* new ProviderAdapterValidationError({
          provider: options.provider,
          operation: "sendTurn",
          issue: "HTTP-chat turns require text input or at least one attachment.",
        });
      }

      if (
        input.modelSelection?.instanceId !== undefined &&
        input.modelSelection.instanceId !== options.providerInstanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: options.provider,
          operation: "sendTurn",
          issue: `Model selection targets '${input.modelSelection.instanceId}', expected '${options.providerInstanceId}'.`,
        });
      }

      const turnId = TurnId.make(`${options.provider}-turn-${yield* randomUuid}`);
      const controller = new AbortController();
      const userMessage: HttpChatTranscriptMessage = {
        role: "user",
        content: input.input ?? "",
        attachments: input.attachments ?? [],
      };
      context.transcript.push(userMessage);
      appendTurnItem(context, turnId, {
        type: "user_message",
        role: "user",
        content: input.input ?? "",
        attachments: input.attachments ?? [],
      });
      yield* Ref.set(context.activeAbort, controller);
      yield* updateSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        },
        { clearLastError: true },
      );
      yield* context.emit({
        ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
        type: "turn.started",
        payload: {
          model: input.modelSelection?.model ?? context.session.model,
        },
      });

      const fiber = yield* runTurnInBackground(context, input, turnId, controller).pipe(
        Effect.forkIn(context.scope),
      );
      yield* Ref.set(context.runningFiber, fiber);
      return { threadId: input.threadId, turnId };
    });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = Effect.fn(
      "HttpChatAdapter.interruptTurn",
    )(function* (threadId, turnId, expectedRuntimeSessionId) {
      const current = sessions.get(threadId);
      if (
        expectedRuntimeSessionId !== undefined &&
        (!current ||
          current.stopped ||
          current.session.runtimeSessionId !== expectedRuntimeSessionId)
      ) {
        return;
      }
      const context = ensureSessionContext(options.provider, sessions, threadId);
      const activeTurnId = context.session.activeTurnId;
      if (!activeTurnId || (turnId !== undefined && turnId !== activeTurnId)) return;
      const controller = yield* Ref.get(context.activeAbort);
      controller?.abort();
      yield* context.emit({
        ...(yield* makeEventBase({ threadId, turnId: activeTurnId })),
        type: "turn.aborted",
        payload: {
          reason: "Interrupted by user.",
        },
      });
    });

    const forceStopSession: ProviderAdapterShape<ProviderAdapterError>["forceStopSession"] =
      Effect.fn("HttpChatAdapter.forceStopSession")(function* (threadId, expectedRuntimeSessionId) {
        const context = sessions.get(threadId);
        if (
          !context ||
          context.stopped ||
          context.session.runtimeSessionId !== expectedRuntimeSessionId
        ) {
          return {
            outcome: "terminated",
            mechanism: "already-stopped",
          } as const;
        }

        sessions.delete(threadId);
        yield* stopContext(context);
        yield* context.emit({
          ...(yield* makeEventBase({ threadId })),
          type: "session.exited",
          payload: {
            reason: "Force-stopped locally after the provider did not finish interrupting.",
            exitKind: "error",
            recoverable: true,
          },
        });
        return {
          outcome: "detached",
          mechanism: "local-detach",
          detail:
            "The local HTTP request was aborted and detached, but this provider does not expose a verifiable remote hard-stop API.",
        } as const;
      });

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = Effect.fn(
      "HttpChatAdapter.stopSession",
    )(function* (threadId) {
      const context = ensureSessionContext(options.provider, sessions, threadId);
      sessions.delete(threadId);
      yield* stopContext(context);
      yield* context.emit({
        ...(yield* makeEventBase({ threadId })),
        type: "session.exited",
        payload: {
          exitKind: "graceful",
          recoverable: false,
        },
      });
    });

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = Effect.fn(
      "HttpChatAdapter.readThread",
    )(function* (threadId) {
      yield* Effect.void;
      const context = ensureSessionContext(options.provider, sessions, threadId);
      return {
        threadId,
        turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
      };
    });

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = Effect.fn(
      "HttpChatAdapter.rollbackThread",
    )(function* (threadId, numTurns) {
      const context = ensureSessionContext(options.provider, sessions, threadId);
      const count = Math.max(0, context.turns.length - Math.max(0, numTurns));
      context.turns.splice(count);

      const rebuilt: Array<HttpChatTranscriptMessage> = [];
      for (const turn of context.turns) {
        for (const item of turn.items) {
          if (!item || typeof item !== "object") continue;
          const record = item as { readonly role?: unknown; readonly content?: unknown };
          if (
            (record.role === "user" || record.role === "assistant") &&
            typeof record.content === "string"
          ) {
            rebuilt.push({ role: record.role, content: record.content });
          }
        }
      }
      context.transcript.splice(0, context.transcript.length, ...rebuilt);
      return yield* readThread(threadId);
    });

    const unsupportedRequest = (operation: string) =>
      new ProviderAdapterRequestError({
        provider: options.provider,
        method: operation,
        detail: `${options.provider} does not expose interactive request responses through this adapter yet.`,
      });

    return {
      provider: options.provider,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      forceStopSession,
      respondToRequest: (
        _threadId: ThreadId,
        _requestId: ApprovalRequestId,
        _decision: ProviderApprovalDecision,
      ) => Effect.fail(unsupportedRequest("respondToRequest")),
      respondToUserInput: (
        _threadId: ThreadId,
        _requestId: ApprovalRequestId,
        _answers: ProviderUserInputAnswers,
      ) => Effect.fail(unsupportedRequest("respondToUserInput")),
      stopSession,
      listSessions: () =>
        Effect.succeed(
          [...sessions.values()]
            .filter((context) => !context.stopped)
            .map((context) => context.session),
        ),
      hasSession: (threadId) =>
        Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped)),
      readThread,
      rollbackThread,
      stopAll: stopAllContexts,
      streamEvents: Stream.fromPubSub(events),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
}
