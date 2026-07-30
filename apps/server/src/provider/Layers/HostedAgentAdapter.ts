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
  RuntimeRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderForceStopResult } from "../Services/ProviderAdapter.ts";
import { bindProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";

export type HostedAgentDelta =
  | { readonly kind: "text"; readonly text: string; readonly itemId?: string | undefined }
  | { readonly kind: "thinking"; readonly text: string; readonly itemId?: string | undefined }
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly status?: "running" | "done" | "error" | string | undefined;
      readonly callId?: string | undefined;
    }
  | { readonly kind: "status"; readonly text: string };

export interface HostedAgentTurnInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly cwd: string | undefined;
  readonly model: string | undefined;
  readonly input: ProviderSendTurnInput;
  readonly signal: AbortSignal;
  readonly emit: (delta: HostedAgentDelta) => void;
}

export interface HostedAgentTurnResult {
  readonly text: string;
  readonly thinking?: string | undefined;
  readonly usage?: unknown;
  readonly costUsd?: number | null | undefined;
  readonly resumeCursor?: unknown;
}

export interface HostedAgentRuntime {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly sessionModelSwitch?: "in-session" | "unsupported" | undefined;
  readonly startSession?: (
    input: ProviderSessionStartInput,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly runTurn: (
    input: HostedAgentTurnInput,
    providerState: unknown,
  ) => Promise<HostedAgentTurnResult>;
  readonly stopSession?: (threadId: ThreadId, providerState: unknown) => Promise<void>;
  readonly forceStopSession?: (
    threadId: ThreadId,
    providerState: unknown,
  ) => Promise<ProviderForceStopResult>;
}

interface HostedTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface HostedSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly emit: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly scope: Scope.Closeable;
  readonly turns: Array<HostedTurnSnapshot>;
  providerState: unknown;
  activeTurnId: TurnId | undefined;
  activeAbort: AbortController | undefined;
  stopped: boolean;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || error.name || "Unknown error";
  }
  const message = String(error).trim();
  return message || "Unknown error";
}

function ensureSessionContext(
  provider: ProviderDriverKind,
  sessions: ReadonlyMap<ThreadId, HostedSessionContext>,
  threadId: ThreadId,
): HostedSessionContext {
  const context = sessions.get(threadId);
  if (!context) {
    throw new ProviderAdapterSessionNotFoundError({ provider, threadId });
  }
  if (context.stopped) {
    throw new ProviderAdapterSessionClosedError({ provider, threadId });
  }
  return context;
}

function resolveTurnSnapshot(context: HostedSessionContext, turnId: TurnId): HostedTurnSnapshot {
  const existing = context.turns.find((turn) => turn.id === turnId);
  if (existing) return existing;
  const created: HostedTurnSnapshot = { id: turnId, items: [] };
  context.turns.push(created);
  return created;
}

function appendTurnItem(context: HostedSessionContext, turnId: TurnId, item: unknown): void {
  resolveTurnSnapshot(context, turnId).items.push(item);
}

function mapToolStatus(
  status: string | undefined,
): "inProgress" | "completed" | "failed" | "declined" {
  if (status === "done" || status === "completed" || status === "success") return "completed";
  if (status === "error" || status === "failed") return "failed";
  return "inProgress";
}

function adapterErrorDetail(error: ProviderAdapterError): string {
  return "detail" in error && typeof error.detail === "string" ? error.detail : error.message;
}

function updateProviderSession(
  context: HostedSessionContext,
  patch: Partial<ProviderSession>,
  options?: { readonly clearActiveTurnId?: boolean; readonly clearLastError?: boolean },
): Effect.Effect<ProviderSession> {
  return Effect.gen(function* () {
    const updatedAt = yield* nowIso;
    const next = {
      ...context.session,
      ...patch,
      updatedAt,
    } as ProviderSession & Record<string, unknown>;
    const mutable = next as Record<string, unknown>;
    if (options?.clearActiveTurnId) delete mutable.activeTurnId;
    if (options?.clearLastError) delete mutable.lastError;
    context.session = next;
    return next;
  });
}

function stopHostedContext(
  runtime: HostedAgentRuntime,
  context: HostedSessionContext,
): Effect.Effect<void> {
  if (context.stopped) return Effect.void;
  context.stopped = true;
  context.activeAbort?.abort();
  return Effect.tryPromise({
    try: () => runtime.stopSession?.(context.threadId, context.providerState) ?? Promise.resolve(),
    catch: (cause) =>
      new ProviderAdapterProcessError({
        provider: runtime.provider,
        threadId: context.threadId,
        detail: safeErrorMessage(cause),
        cause,
      }),
  }).pipe(Effect.ignore, Effect.andThen(Scope.close(context.scope, Exit.void)), Effect.asVoid);
}

export function makeHostedAgentAdapter(
  runtime: HostedAgentRuntime,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, never, Crypto.Crypto | Scope.Scope> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, HostedSessionContext>();

    const randomUuid = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: runtime.provider,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate hosted-agent runtime identifier.",
            cause,
          }),
      ),
    );

    const buildEventBase = (input: {
      readonly threadId: ThreadId;
      readonly turnId?: TurnId | undefined;
      readonly itemId?: string | undefined;
      readonly requestId?: string | undefined;
    }) =>
      Effect.all({
        eventId: randomUuid.pipe(Effect.map(EventId.make)),
        createdAt: nowIso,
      }).pipe(
        Effect.map(({ eventId, createdAt }) => ({
          eventId,
          provider: runtime.provider,
          providerInstanceId: runtime.instanceId,
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
          ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
        })),
      );

    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);

    const emitDelta = (
      context: HostedSessionContext,
      turnId: TurnId,
      delta: HostedAgentDelta,
    ): void => {
      if (context.stopped || context.activeTurnId !== turnId) return;
      const effect = Effect.gen(function* () {
        if (delta.kind === "text" || delta.kind === "thinking") {
          if (!delta.text) return;
          yield* context.emit({
            ...(yield* buildEventBase({
              threadId: context.threadId,
              turnId,
              itemId: delta.itemId,
            })),
            type: "content.delta",
            payload: {
              streamKind: delta.kind === "text" ? "assistant_text" : "reasoning_text",
              delta: delta.text,
            },
          });
          return;
        }

        if (delta.kind === "tool") {
          const itemId = delta.callId ?? delta.name;
          yield* context.emit({
            ...(yield* buildEventBase({ threadId: context.threadId, turnId, itemId })),
            type:
              delta.status === "done" || delta.status === "error"
                ? "item.completed"
                : "item.updated",
            payload: {
              itemType: "dynamic_tool_call",
              title: delta.name,
              status: mapToolStatus(delta.status),
              data: {
                name: delta.name,
                ...(delta.status ? { status: delta.status } : {}),
              },
            },
          });
          return;
        }

        if (delta.text.trim()) {
          yield* context.emit({
            ...(yield* buildEventBase({ threadId: context.threadId, turnId })),
            type: "runtime.warning",
            payload: {
              message: delta.text.trim(),
            },
          });
        }
      });
      void Effect.runPromise(effect.pipe(Effect.ignore));
    };

    const stopAllContexts = Effect.fn("HostedAgentAdapter.stopAllContexts")(function* () {
      const contexts = [...sessions.values()];
      sessions.clear();
      yield* Effect.forEach(
        contexts,
        (context) => stopHostedContext(runtime, context).pipe(Effect.ignoreCause),
        { concurrency: "unbounded", discard: true },
      );
    });

    yield* Effect.addFinalizer(() =>
      stopAllContexts().pipe(Effect.ensuring(Queue.shutdown(runtimeEvents))),
    );

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = Effect.fn(
      "HostedAgentAdapter.startSession",
    )(function* (input) {
      if (
        input.providerInstanceId !== undefined &&
        input.providerInstanceId !== runtime.instanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: runtime.provider,
          operation: "startSession",
          issue: `Provider instance '${input.providerInstanceId}' is not bound to '${runtime.instanceId}'.`,
        });
      }

      const existing = sessions.get(input.threadId);
      if (existing && !existing.stopped) {
        return existing.session;
      }

      const sessionScope = yield* Scope.make();
      const controller = new AbortController();
      const providerState = yield* Effect.tryPromise({
        try: () => runtime.startSession?.(input, controller.signal) ?? Promise.resolve(undefined),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: runtime.provider,
            threadId: input.threadId,
            detail: safeErrorMessage(cause),
            cause,
          }),
      });

      const createdAt = yield* nowIso;
      const runtimeSessionId = input.runtimeSessionId ?? RuntimeSessionId.make(yield* randomUuid);
      const session: ProviderSession = {
        provider: runtime.provider,
        providerInstanceId: runtime.instanceId,
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

      const context: HostedSessionContext = {
        threadId: input.threadId,
        session,
        emit: bindProviderRuntimeEventOrigin(runtimeSessionId, emit),
        scope: sessionScope,
        turns: [],
        providerState,
        activeTurnId: undefined,
        activeAbort: undefined,
        stopped: false,
      };
      sessions.set(input.threadId, context);

      yield* context.emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "session.started",
        payload: {
          message: input.cwd ? `Workspace: ${input.cwd}` : "Hosted agent session started.",
        },
      });

      return session;
    });

    const runTurnInBackground = (
      context: HostedSessionContext,
      input: ProviderSendTurnInput,
      turnId: TurnId,
      controller: AbortController,
    ) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            runtime.runTurn(
              {
                threadId: input.threadId,
                turnId,
                cwd: context.session.cwd,
                model: input.modelSelection?.model ?? context.session.model,
                input,
                signal: controller.signal,
                emit: (delta) => emitDelta(context, turnId, delta),
              },
              context.providerState,
            ),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: runtime.provider,
              threadId: input.threadId,
              detail: safeErrorMessage(cause),
              cause,
            }),
        });

        if (result.text.trim()) {
          appendTurnItem(context, turnId, {
            role: "assistant",
            content: result.text,
            ...(result.thinking ? { thinking: result.thinking } : {}),
          });
          yield* context.emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
              detail: result.text,
            },
          });
        }

        context.activeTurnId = undefined;
        context.activeAbort = undefined;
        yield* updateProviderSession(
          context,
          {
            status: "ready",
            ...(result.resumeCursor !== undefined ? { resumeCursor: result.resumeCursor } : {}),
          },
          { clearActiveTurnId: true, clearLastError: true },
        );
        yield* context.emit({
          ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
          type: "turn.completed",
          payload: {
            state: "completed",
            ...(result.usage !== undefined ? { usage: result.usage } : {}),
            ...(typeof result.costUsd === "number" ? { totalCostUsd: result.costUsd } : {}),
          },
        });
      }).pipe(
        Effect.catch((error: ProviderAdapterError) =>
          Effect.gen(function* () {
            const detail = adapterErrorDetail(error);
            context.activeTurnId = undefined;
            context.activeAbort = undefined;
            yield* updateProviderSession(
              context,
              {
                status: "ready",
                lastError: detail,
              },
              { clearActiveTurnId: true },
            );
            yield* context.emit({
              ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
              type: "runtime.error",
              payload: {
                message: detail,
                class: controller.signal.aborted ? "provider_error" : "transport_error",
              },
            });
            yield* context.emit({
              ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
              type: "turn.completed",
              payload: {
                state: controller.signal.aborted ? "cancelled" : "failed",
              },
            });
          }),
        ),
        Effect.ignoreCause({ log: true }),
      );

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = Effect.fn(
      "HostedAgentAdapter.sendTurn",
    )(function* (input) {
      const context = ensureSessionContext(runtime.provider, sessions, input.threadId);
      if (context.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: runtime.provider,
          operation: "sendTurn",
          issue: "A turn is already running for this provider session.",
        });
      }

      const hasText = Boolean(input.input?.trim());
      const hasAttachments = (input.attachments?.length ?? 0) > 0;
      if (!hasText && !hasAttachments) {
        return yield* new ProviderAdapterValidationError({
          provider: runtime.provider,
          operation: "sendTurn",
          issue: "Hosted-agent turns require text input or at least one attachment.",
        });
      }

      if (
        input.modelSelection?.instanceId !== undefined &&
        input.modelSelection.instanceId !== runtime.instanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: runtime.provider,
          operation: "sendTurn",
          issue: `Model selection targets '${input.modelSelection.instanceId}', expected '${runtime.instanceId}'.`,
        });
      }

      const turnId = TurnId.make(`${runtime.provider}-turn-${yield* randomUuid}`);
      const controller = new AbortController();
      context.activeTurnId = turnId;
      context.activeAbort = controller;
      appendTurnItem(context, turnId, {
        role: "user",
        content: input.input ?? "",
        attachments: input.attachments ?? [],
      });
      yield* updateProviderSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        },
        { clearLastError: true },
      );
      yield* context.emit({
        ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
        type: "turn.started",
        payload: {
          model: input.modelSelection?.model ?? context.session.model,
        },
      });

      yield* runTurnInBackground(context, input, turnId, controller).pipe(
        Effect.forkIn(context.scope),
        Effect.asVoid,
      );

      return { threadId: input.threadId, turnId };
    });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = Effect.fn(
      "HostedAgentAdapter.interruptTurn",
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
      const context = ensureSessionContext(runtime.provider, sessions, threadId);
      const activeTurnId = context.activeTurnId;
      if (!activeTurnId) return;
      if (turnId !== undefined && turnId !== activeTurnId) return;
      context.activeAbort?.abort();
      yield* context.emit({
        ...(yield* buildEventBase({ threadId, turnId: activeTurnId })),
        type: "turn.aborted",
        payload: {
          reason: "Interrupted by user.",
        },
      });
    });

    const forceStopSession: ProviderAdapterShape<ProviderAdapterError>["forceStopSession"] =
      Effect.fn("HostedAgentAdapter.forceStopSession")(
        function* (threadId, expectedRuntimeSessionId) {
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
          context.stopped = true;
          context.activeAbort?.abort();
          yield* Scope.close(context.scope, Exit.void);
          yield* context.emit({
            ...(yield* buildEventBase({ threadId })),
            type: "session.exited",
            payload: {
              reason: "Force-stopped after the provider did not finish interrupting.",
              exitKind: "error",
              recoverable: true,
            },
          });

          if (runtime.forceStopSession) {
            const remoteResult = yield* Effect.tryPromise({
              try: () => runtime.forceStopSession!(threadId, context.providerState),
              catch: (cause) =>
                new ProviderAdapterProcessError({
                  provider: runtime.provider,
                  threadId,
                  detail: safeErrorMessage(cause),
                  cause,
                }),
            }).pipe(
              Effect.timeoutOption("1 second"),
              Effect.orElseSucceed(() => Option.none()),
            );
            if (Option.isSome(remoteResult)) return remoteResult.value;
            return {
              outcome: "detached",
              mechanism: "local-detach",
              detail:
                "The local hosted-agent request was aborted and detached. The provider's remote hard-stop request failed or was not confirmed within 1 second, so remote execution may continue.",
            } as const;
          }

          return {
            outcome: "detached",
            mechanism: "local-detach",
            detail:
              "The local hosted-agent request was aborted and detached, but this provider does not expose a verifiable remote hard-stop API.",
          } as const;
        },
      );

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = Effect.fn(
      "HostedAgentAdapter.stopSession",
    )(function* (threadId) {
      const context = ensureSessionContext(runtime.provider, sessions, threadId);
      sessions.delete(threadId);
      yield* stopHostedContext(runtime, context);
      yield* context.emit({
        ...(yield* buildEventBase({ threadId })),
        type: "session.exited",
        payload: {
          exitKind: "graceful",
          recoverable: false,
        },
      });
    });

    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.succeed(
        [...sessions.values()]
          .filter((context) => !context.stopped)
          .map((context) => context.session),
      );

    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped));

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = Effect.fn(
      "HostedAgentAdapter.readThread",
    )(function* (threadId) {
      yield* Effect.void;
      const context = ensureSessionContext(runtime.provider, sessions, threadId);
      return {
        threadId,
        turns: context.turns.map((turn) => ({
          id: turn.id,
          items: [...turn.items],
        })),
      };
    });

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = Effect.fn(
      "HostedAgentAdapter.rollbackThread",
    )(function* (threadId, numTurns) {
      const context = ensureSessionContext(runtime.provider, sessions, threadId);
      const keepCount = Math.max(0, context.turns.length - Math.max(0, numTurns));
      context.turns.splice(keepCount);
      return yield* readThread(threadId);
    });

    const unsupportedRequest = (operation: string) =>
      new ProviderAdapterRequestError({
        provider: runtime.provider,
        method: operation,
        detail: `${runtime.provider} does not expose interactive request responses through this adapter yet.`,
      });

    return {
      provider: runtime.provider,
      capabilities: {
        sessionModelSwitch: runtime.sessionModelSwitch ?? "unsupported",
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
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll: stopAllContexts,
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
}
