import {
  RuntimeSessionId,
  type EventId,
  type IsoDateTime,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Semaphore from "effect/Semaphore";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { bindProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makeNativeHarnessHistoryFiles } from "./NativeHarnessHistory.ts";
import {
  type NativeProviderSessionContext,
  settleNativeProviderApprovalsAsCancelled,
} from "./NativeProviderSessionContext.ts";
import {
  makeNativeProviderSessionStore,
  safeNativeProviderPathSegment,
} from "./NativeProviderSessionStore.ts";
import type {
  NativeProviderAdapterDefinition,
  NativeProviderAttachment,
  NativeProviderToolCall,
} from "./NativeProviderTypes.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface NativeProviderSessionLifecycleDependencies<
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
  readonly nowIso: Effect.Effect<IsoDateTime>;
  readonly randomUuid: Effect.Effect<string, ProviderAdapterRequestError>;
  readonly makeEventStamp: () => Effect.Effect<
    { readonly eventId: EventId; readonly createdAt: IsoDateTime },
    ProviderAdapterRequestError
  >;
  readonly publishRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
}

export function makeNativeProviderSessionLifecycle<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
>(
  dependencies: NativeProviderSessionLifecycleDependencies<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >,
) {
  return Effect.gen(function* () {
    const { definition, nowIso, randomUuid, makeEventStamp } = dependencies;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const sessions = new Map<ThreadId, NativeProviderSessionContext<HistoryItem, SessionState>>();
    const historyDirectory = path.join(
      serverConfig.stateDir,
      "provider-sessions",
      safeNativeProviderPathSegment(definition.history.directoryName),
      safeNativeProviderPathSegment(definition.instanceId),
    );
    const historyFiles = yield* makeNativeHarnessHistoryFiles(historyDirectory);
    const sessionStore = makeNativeProviderSessionStore({
      provider: definition.provider,
      history: definition.history,
      historyFiles,
      sessions,
      maxIdleWorkingSets: definition.limits.maxIdleWorkingSets,
      onWorkingSetEvicted: definition.onWorkingSetEvicted,
    });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<
      NativeProviderSessionContext<HistoryItem, SessionState>,
      ProviderAdapterSessionNotFoundError
    > => {
      const context = sessions.get(threadId);
      return context && !context.stopped
        ? Effect.succeed(context)
        : Effect.fail(
            new ProviderAdapterSessionNotFoundError({
              provider: definition.provider,
              threadId,
            }),
          );
    };

    const stopSessionInternal = Effect.fn("NativeProviderSessionLifecycle.stopInternal")(function* (
      context: NativeProviderSessionContext<HistoryItem, SessionState>,
    ) {
      if (context.stopped) return;
      context.stopped = true;
      if (context.activeTerminal) yield* context.activeTerminal("interrupted");
      context.activeAbortController?.abort();
      if (context.activeInterrupt) {
        yield* Deferred.succeed(context.activeInterrupt, undefined).pipe(Effect.ignore);
      }
      yield* settleNativeProviderApprovalsAsCancelled(context);
      sessions.delete(context.threadId);
      yield* definition.toolHarness.releaseThread?.(context.threadId) ?? Effect.void;
      context.session = { ...context.session, status: "closed", updatedAt: yield* nowIso };
      yield* context.emitRuntimeEvent({
        type: "session.exited",
        ...(yield* makeEventStamp()),
        provider: definition.provider,
        threadId: context.threadId,
        payload: { exitKind: "graceful" },
      });
    });

    const parseResumeCursor = (raw: unknown): { readonly sessionId: string } | undefined => {
      if (!Predicate.isObject(raw)) return undefined;
      if (raw.schemaVersion !== definition.history.resumeVersion) return undefined;
      if (!Predicate.isString(raw.sessionId)) return undefined;
      const isSessionId =
        definition.history.isSessionId ?? ((value: string) => UUID_PATTERN.test(value));
      return isSessionId(raw.sessionId) ? { sessionId: raw.sessionId } : undefined;
    };

    const readAttachment = Effect.fn("NativeProviderSessionLifecycle.readAttachment")(function* (
      attachment: NativeProviderAttachment,
    ) {
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return yield* new ProviderAdapterRequestError({
          provider: definition.provider,
          method: "session/prompt",
          detail: `Invalid attachment id '${attachment.id}'.`,
        });
      }
      return yield* fileSystem.readFile(attachmentPath).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: definition.provider,
              method: "session/prompt",
              detail: `Failed to read attachment '${attachment.name}'.`,
              cause,
            }),
        ),
      );
    });

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== definition.provider) {
          return yield* new ProviderAdapterValidationError({
            provider: definition.provider,
            operation: "startSession",
            issue: `Expected provider '${definition.provider}' but received '${input.provider}'.`,
          });
        }
        if (
          input.providerInstanceId !== undefined &&
          input.providerInstanceId !== definition.instanceId
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: definition.provider,
            operation: "startSession",
            issue: `Expected provider instance '${definition.instanceId}' but received '${input.providerInstanceId}'.`,
          });
        }
        if (!input.cwd?.trim()) {
          return yield* new ProviderAdapterValidationError({
            provider: definition.provider,
            operation: "startSession",
            issue: "cwd is required and must be non-empty.",
          });
        }
        const existing = sessions.get(input.threadId);
        const maxSessions = definition.limits.maxSessions;
        if (!existing && maxSessions !== undefined && sessions.size >= maxSessions) {
          return yield* new ProviderAdapterRequestError({
            provider: definition.provider,
            method: "session/start",
            detail: `${definition.provider} supports at most ${maxSessions} managed sessions per provider instance.`,
          });
        }
        if (existing && !existing.stopped) yield* stopSessionInternal(existing);

        const fetchWorker = input.purpose === "fetch-worker";
        const resume =
          !fetchWorker && !input.freshSession ? parseResumeCursor(input.resumeCursor) : undefined;
        const sessionId = resume?.sessionId ?? (yield* randomUuid);
        const persisted = resume ? yield* sessionStore.loadPersistedSession(sessionId) : undefined;
        if (resume && !persisted) {
          return yield* new ProviderAdapterRequestError({
            provider: definition.provider,
            method: "session/resume",
            detail: `${definition.provider} session '${sessionId}' is no longer available in T3-owned history.`,
          });
        }
        const prepared = yield* definition.start({ input, fetchWorker });
        const runtimeSessionId = input.runtimeSessionId ?? RuntimeSessionId.make(yield* randomUuid);
        const createdAt = yield* nowIso;
        const cwd = path.resolve(input.cwd.trim());
        const resumeCursor = {
          schemaVersion: definition.history.resumeVersion,
          sessionId,
        } as const;
        const session: ProviderSession = {
          provider: definition.provider,
          providerInstanceId: definition.instanceId,
          status: "ready",
          runtimeMode: fetchWorker ? "approval-required" : input.runtimeMode,
          cwd,
          model: prepared.model,
          threadId: input.threadId,
          runtimeSessionId,
          resumeCursor,
          createdAt,
          updatedAt: createdAt,
        };
        const context: NativeProviderSessionContext<HistoryItem, SessionState> = {
          threadId: input.threadId,
          sessionId,
          cwd,
          sandboxMode: fetchWorker ? "read-only" : input.sandboxMode,
          fetchWorker,
          emitRuntimeEvent: bindProviderRuntimeEventOrigin(
            runtimeSessionId,
            dependencies.publishRuntimeEvent,
          ),
          pendingApprovals: new Map(),
          approvedForSession: new Set(),
          turnSemaphore: yield* Semaphore.make(1),
          history: persisted ? [...persisted.history] : [],
          turns: persisted ? [...persisted.turns] : [],
          state: prepared.state,
          session,
          activeAbortController: undefined,
          activeInterrupt: undefined,
          activeTerminal: undefined,
          activeTurnId: undefined,
          stopped: false,
          workingSetLoaded: true,
          lastWorkingSetUse: sessionStore.nextWorkingSetUse(),
          totalProcessedTokens: persisted?.totalProcessedTokens ?? 0,
        };
        sessions.set(input.threadId, context);
        if (!persisted) yield* sessionStore.persistSession(context);
        yield* sessionStore.evictIdleWorkingSets(input.threadId);
        yield* context.emitRuntimeEvent({
          type: "session.started",
          ...(yield* makeEventStamp()),
          provider: definition.provider,
          threadId: input.threadId,
          payload: { resume: resumeCursor, message: definition.messages.sessionStarted },
        });
        yield* context.emitRuntimeEvent({
          type: "session.configured",
          ...(yield* makeEventStamp()),
          provider: definition.provider,
          threadId: input.threadId,
          payload: { config: { ...prepared.configured, resumed: persisted !== undefined } },
        });
        yield* context.emitRuntimeEvent({
          type: "session.state.changed",
          ...(yield* makeEventStamp()),
          provider: definition.provider,
          threadId: input.threadId,
          payload: { state: "ready", reason: definition.messages.sessionReady },
        });
        yield* context.emitRuntimeEvent({
          type: "thread.started",
          ...(yield* makeEventStamp()),
          provider: definition.provider,
          threadId: input.threadId,
          payload: { providerThreadId: sessionId },
        });
        return session;
      });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
      threadId,
      turnId,
      expectedRuntimeSessionId,
    ) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (
          expectedRuntimeSessionId !== undefined &&
          (!context || context.session.runtimeSessionId !== expectedRuntimeSessionId)
        ) {
          return;
        }
        const live = yield* requireSession(threadId);
        if (turnId !== undefined && live.activeTurnId !== turnId) return;
        live.activeAbortController?.abort();
        if (live.activeInterrupt) {
          yield* Deferred.succeed(live.activeInterrupt, undefined).pipe(Effect.ignore);
        }
        yield* settleNativeProviderApprovalsAsCancelled(live);
      });

    const forceStopSession: ProviderAdapterShape<ProviderAdapterError>["forceStopSession"] = (
      threadId,
      expectedRuntimeSessionId,
    ) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context || context.session.runtimeSessionId !== expectedRuntimeSessionId) {
          return { outcome: "terminated", mechanism: "already-stopped" } as const;
        }
        yield* stopSessionInternal(context);
        return { outcome: "terminated", mechanism: "runtime-close" } as const;
      });

    const unsupportedResponse = (threadId: ThreadId, method: string, requestId: string) =>
      requireSession(threadId).pipe(
        Effect.andThen(
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: definition.provider,
              method,
              detail: `${definition.provider} has no pending request '${requestId}'.`,
            }),
          ),
        ),
      );

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const pending = context.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: definition.provider,
            method: "tool/approval",
            detail: `Unknown pending ${definition.provider} approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
      threadId,
      requestId,
    ) => unsupportedResponse(threadId, "user-input/respond", requestId);

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        yield* sessionStore.touchWorkingSet(context);
        return {
          threadId,
          turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
        };
      });

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
      threadId,
      numTurns,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        yield* sessionStore.touchWorkingSet(context);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: definition.provider,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        const nextLength = Math.max(0, context.turns.length - numTurns);
        const removed = context.turns.slice(nextLength);
        context.history.splice(removed[0]?.historyStart ?? context.history.length);
        context.turns.splice(nextLength);
        yield* sessionStore.persistSession(context);
        return {
          threadId,
          turns: context.turns.map((turn) => ({ id: turn.id, items: [...turn.items] })),
        };
      });

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.flatMap(requireSession(threadId), stopSessionInternal);
    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));
    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });
    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

    return {
      forceStopSession,
      hasSession,
      interruptTurn,
      listSessions,
      readAttachment,
      readThread,
      requireSession,
      respondToRequest,
      respondToUserInput,
      rollbackThread,
      sessionStore,
      startSession,
      stopAll,
      stopSession,
    };
  });
}
