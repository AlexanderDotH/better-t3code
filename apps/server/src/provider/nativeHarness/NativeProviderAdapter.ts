import {
  ApprovalRequestId,
  type CanonicalItemType,
  type CanonicalRequestType,
  EventId,
  type McpServerDefinition,
  McpRuntimeServerKey,
  McpServerName,
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSandboxMode,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeSessionId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import {
  makeBoundedProviderEventBroadcast,
  providerEventEncodedBytes,
  PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
  PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
} from "../boundedEventQueue.ts";
import { bindProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";
import type {
  ProviderAdapterCapabilities,
  ProviderAdapterShape,
} from "../Services/ProviderAdapter.ts";
import { makeNativeHarnessHistoryFiles } from "./NativeHarnessHistory.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class NativeProviderTurnInterruptedError extends Schema.TaggedErrorClass<NativeProviderTurnInterruptedError>()(
  "NativeProviderTurnInterruptedError",
  {},
) {}

export interface NativeProviderTurnRecord {
  readonly id: TurnId;
  readonly historyStart: number;
  readonly historyEnd: number;
  readonly items: Array<unknown>;
}

export interface NativeProviderPersistedHistory<HistoryItem> {
  readonly history: Array<HistoryItem>;
  readonly turns: Array<NativeProviderTurnRecord>;
  readonly totalProcessedTokens: number;
}

export interface NativeProviderHistoryStrategy<HistoryItem> {
  readonly directoryName: string;
  readonly resumeVersion: number;
  readonly encode: (
    input: NativeProviderPersistedHistory<HistoryItem> & { readonly sessionId: string },
  ) => string;
  readonly decode: (
    encoded: string,
    sessionId: string,
  ) => Effect.Effect<NativeProviderPersistedHistory<HistoryItem>, ProviderAdapterRequestError>;
  readonly isSessionId?: ((sessionId: string) => boolean) | undefined;
  readonly estimateBytes?: ((history: ReadonlyArray<HistoryItem>) => number) | undefined;
}

export interface NativeProviderUsage {
  readonly usedTokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly raw?: unknown;
  readonly modelUsage?: Readonly<Record<string, unknown>>;
  readonly totalCostUsd?: number;
}

export interface NativeProviderToolCall<Metadata = unknown> {
  readonly sourceId?: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly metadata: Metadata;
}

export interface NativeProviderToolResult {
  readonly ok: boolean;
  readonly itemType: CanonicalItemType;
  readonly title: string;
  readonly detail: string;
  readonly output: Readonly<Record<string, unknown>>;
}

export interface NativeProviderExecutedToolCall<ToolCall extends NativeProviderToolCall> {
  readonly call: ToolCall;
  readonly result: NativeProviderToolResult;
}

export interface NativeProviderToolHarness<ToolCall extends NativeProviderToolCall> {
  readonly isAvailable: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly toolName: string;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly sandboxMode: ProviderSandboxMode | undefined;
  }) => Effect.Effect<boolean, ProviderAdapterRequestError>;
  readonly requiresApproval: (
    toolName: string,
    runtimeMode: ProviderSession["runtimeMode"],
  ) => boolean;
  readonly requestType: (toolName: string) => CanonicalRequestType;
  readonly approvalDetail: (toolName: string, args: Readonly<Record<string, unknown>>) => string;
  readonly execute: (input: {
    readonly threadId: ThreadId;
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
  }) => Effect.Effect<NativeProviderToolResult, ProviderAdapterRequestError>;
  readonly eventData?: ((call: ToolCall) => Readonly<Record<string, unknown>>) | undefined;
  readonly releaseThread?: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
}

export type NativeProviderRoundEvent<HistoryItem, ToolCall extends NativeProviderToolCall> =
  | {
      readonly type: "contentDelta";
      readonly kind: "assistant" | "reasoning";
      readonly sourceId?: string;
      readonly delta: string;
    }
  | {
      readonly type: "completed";
      readonly historyItems: ReadonlyArray<HistoryItem>;
      readonly toolCalls: ReadonlyArray<ToolCall>;
      readonly assistantText?: string;
      readonly reasoningText?: string;
      readonly usage?: NativeProviderUsage;
      readonly stopReason?: string | null;
    }
  | { readonly type: "failed"; readonly message: string };

export interface NativeProviderSessionView<HistoryItem, SessionState> {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
  readonly session: ProviderSession;
  readonly history: ReadonlyArray<HistoryItem>;
  readonly state: SessionState;
}

export interface NativeProviderStartResult<SessionState> {
  readonly model: string;
  readonly state: SessionState;
  readonly configured: Readonly<Record<string, unknown>>;
}

type NativeProviderAttachment = NonNullable<ProviderSendTurnInput["attachments"]>[number];

export interface NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState> {
  readonly model: string;
  readonly userHistoryItems: ReadonlyArray<HistoryItem>;
  readonly persistedUserHistoryItems?: ReadonlyArray<HistoryItem>;
  readonly attachmentBytes: number;
  readonly toolDeclarations: ReadonlyArray<ToolDefinition>;
  readonly protocol: ProtocolState;
}

export interface NativeProviderBeforeRoundResult<HistoryItem> {
  readonly replacementHistory?: ReadonlyArray<HistoryItem>;
  readonly resetTurnHistoryStart?: boolean;
}

export interface NativeProviderTurnAdmission {
  readonly withLease: <A, R>(
    input: {
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly providerInstanceId: ProviderInstanceId;
      readonly serializedHistoryBytes: number;
      readonly attachmentBytes: number;
      readonly toolBufferBytes: number;
    },
    effect: Effect.Effect<A, ProviderAdapterRequestError, R>,
  ) => Effect.Effect<A, ProviderAdapterRequestError, R>;
}

export interface NativeProviderMcpSessionConfig {
  readonly resolveServers?:
    | ((input: {
        readonly cwd: string;
      }) => Effect.Effect<ReadonlyArray<McpServerDefinition>, ProviderAdapterRequestError>)
    | undefined;
  readonly includeT3BuiltIn?: boolean | undefined;
}

export interface NativeProviderAdapterDefinition<
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
> {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly messages: {
    readonly sessionStarted: string;
    readonly sessionReady: string;
    readonly turnRunning: string;
    readonly turnSettled: string;
  };
  readonly limits: {
    readonly maxSessions?: number;
    readonly maxIdleWorkingSets?: number;
    readonly maxToolDefinitions: number;
    readonly maxToolOutputBytes: number;
    readonly maxToolRounds: number;
    readonly maxParallelToolCalls: number;
  };
  readonly history: NativeProviderHistoryStrategy<HistoryItem>;
  readonly start: (input: {
    readonly input: ProviderSessionStartInput;
    readonly fetchWorker: boolean;
  }) => Effect.Effect<NativeProviderStartResult<SessionState>, ProviderAdapterError>;
  readonly prepareTurn: (input: {
    readonly input: ProviderSendTurnInput;
    readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
    readonly readAttachment: (
      attachment: NativeProviderAttachment,
    ) => Effect.Effect<Uint8Array, ProviderAdapterRequestError>;
  }) => Effect.Effect<
    NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>,
    ProviderAdapterError
  >;
  readonly beforeRound?:
    | ((input: {
        readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
        readonly plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>;
      }) => Effect.Effect<
        NativeProviderBeforeRoundResult<HistoryItem> | void,
        ProviderAdapterRequestError
      >)
    | undefined;
  readonly streamRound: (input: {
    readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
    readonly plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>;
    readonly turnId: TurnId;
    readonly signal: AbortSignal;
  }) => Stream.Stream<NativeProviderRoundEvent<HistoryItem, ToolCall>, ProviderAdapterRequestError>;
  readonly toolHarness: NativeProviderToolHarness<ToolCall>;
  readonly toolResultsToHistoryItems: (input: {
    readonly session: NativeProviderSessionView<HistoryItem, SessionState>;
    readonly plan: NativeProviderTurnPlan<HistoryItem, ToolDefinition, ProtocolState>;
    readonly results: ReadonlyArray<NativeProviderExecutedToolCall<ToolCall>>;
  }) => ReadonlyArray<HistoryItem>;
  readonly admission?: NativeProviderTurnAdmission | undefined;
  readonly onWorkingSetEvicted?: ((threadId: ThreadId) => void) | undefined;
  readonly mcp?: NativeProviderMcpSessionConfig | undefined;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly toolName: string;
}

interface NativeProviderSessionContext<HistoryItem, SessionState> {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
  readonly emitRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly approvedForSession: Set<string>;
  readonly turnSemaphore: Semaphore.Semaphore;
  readonly history: Array<HistoryItem>;
  readonly turns: Array<NativeProviderTurnRecord>;
  readonly state: SessionState;
  session: ProviderSession;
  activeAbortController: AbortController | undefined;
  activeInterrupt: Deferred.Deferred<void> | undefined;
  activeTerminal:
    | ((
        state: "completed" | "failed" | "interrupted",
        message?: string,
      ) => Effect.Effect<void, ProviderAdapterRequestError>)
    | undefined;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
  workingSetLoaded: boolean;
  lastWorkingSetUse: number;
  totalProcessedTokens: number;
}

function errorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (Predicate.isObject(cause) && Predicate.isString(cause.message) && cause.message.trim()) {
    return cause.message.trim();
  }
  return String(cause).trim() || "Unknown native provider failure.";
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, "_");
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

function defaultToolItemType(name: string): CanonicalItemType {
  if (name === "exec_command") return "command_execution";
  if (name === "write_file" || name === "replace_text" || name === "apply_patch") {
    return "file_change";
  }
  return "mcp_tool_call";
}

function defaultToolEventData(call: NativeProviderToolCall): Readonly<Record<string, unknown>> {
  if (call.name === "write_file") {
    return {
      path: call.args.path,
      contentsBytes:
        typeof call.args.contents === "string" ? Buffer.byteLength(call.args.contents) : undefined,
    };
  }
  return call.args;
}

function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedToolResult(
  result: NativeProviderToolResult,
  maxBytes: number,
): NativeProviderToolResult {
  if (encodedBytes(result.output) <= maxBytes) return result;
  return {
    ok: false,
    itemType: result.itemType,
    title: result.title,
    detail: `Tool output exceeded T3's ${maxBytes}-byte limit.`,
    output: { error: `Tool output exceeded T3's ${maxBytes}-byte limit and was discarded.` },
  };
}

function sessionView<HistoryItem, SessionState>(
  context: NativeProviderSessionContext<HistoryItem, SessionState>,
): NativeProviderSessionView<HistoryItem, SessionState> {
  return {
    threadId: context.threadId,
    sessionId: context.sessionId,
    cwd: context.cwd,
    sandboxMode: context.sandboxMode,
    fetchWorker: context.fetchWorker,
    session: context.session,
    history: context.history,
    state: context.state,
  };
}

const noAdmission: NativeProviderTurnAdmission = {
  withLease: (_input, effect) => effect,
};

export const makeNativeProviderAdapter = Effect.fn("makeNativeProviderAdapter")(function* <
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
>(
  definition: NativeProviderAdapterDefinition<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >,
) {
  const environment = definition.environment ?? process.env;
  const admission = definition.admission ?? noAdmission;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const serverConfig = yield* ServerConfig;
  const sessions = new Map<ThreadId, NativeProviderSessionContext<HistoryItem, SessionState>>();
  const runtimeEventBroadcast = yield* makeBoundedProviderEventBroadcast<ProviderRuntimeEvent>({
    capacity: PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
    byteCapacity: PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
    sizeOf: providerEventEncodedBytes,
  });
  const historyDirectory = path.join(
    serverConfig.stateDir,
    "provider-sessions",
    safePathSegment(definition.history.directoryName),
    safePathSegment(definition.instanceId),
  );
  const historyFiles = yield* makeNativeHarnessHistoryFiles(historyDirectory);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: definition.provider,
          method: "crypto/randomUUIDv4",
          detail: `Failed to generate a ${definition.provider} runtime identifier.`,
          cause,
        }),
    ),
  );
  const makeEventStamp = () =>
    Effect.all({ eventId: Effect.map(randomUuid, EventId.make), createdAt: nowIso });
  const publishRuntimeEvent = (event: ProviderRuntimeEvent) =>
    runtimeEventBroadcast.publish(event).pipe(Effect.asVoid);
  let workingSetSequence = 0;

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

  const persistSession = Effect.fn("NativeProviderAdapter.persistSession")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
  ) {
    const contents = yield* Effect.try({
      try: () =>
        definition.history.encode({
          sessionId: context.sessionId,
          history: context.history,
          turns: context.turns,
          totalProcessedTokens: context.totalProcessedTokens,
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: definition.provider,
          method: "session/persist",
          detail: `Failed to encode ${definition.provider} session '${context.sessionId}'.`,
          cause,
        }),
    });
    yield* historyFiles.write(context.sessionId, contents).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: definition.provider,
            method: "session/persist",
            detail: `Failed to persist ${definition.provider} session '${context.sessionId}'.`,
            cause,
          }),
      ),
    );
  });

  const loadPersistedSession = Effect.fn("NativeProviderAdapter.loadPersistedSession")(function* (
    sessionId: string,
  ) {
    const encoded = yield* historyFiles.read(sessionId).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: definition.provider,
            method: "session/resume",
            detail: `Failed to read ${definition.provider} session '${sessionId}'.`,
            cause,
          }),
      ),
    );
    if (encoded === undefined) return undefined;
    return yield* definition.history.decode(encoded, sessionId);
  });

  const evictIdleWorkingSets = (protectedThreadId: ThreadId) =>
    Effect.sync(() => {
      const maxIdleWorkingSets = definition.limits.maxIdleWorkingSets;
      if (maxIdleWorkingSets === undefined) return;
      const loaded = Array.from(sessions.values()).filter(
        (context) =>
          context.workingSetLoaded && (context.history.length > 0 || context.turns.length > 0),
      );
      let excess = loaded.length - maxIdleWorkingSets;
      if (excess <= 0) return;
      const candidates = loaded
        .filter(
          (context) => context.threadId !== protectedThreadId && context.activeTurnId === undefined,
        )
        .toSorted((left, right) => left.lastWorkingSetUse - right.lastWorkingSetUse);
      for (const context of candidates) {
        if (excess <= 0) break;
        context.history.splice(0);
        context.turns.splice(0);
        context.workingSetLoaded = false;
        definition.onWorkingSetEvicted?.(context.threadId);
        excess -= 1;
      }
    });

  const touchWorkingSet = Effect.fn("NativeProviderAdapter.touchWorkingSet")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
  ) {
    if (!context.workingSetLoaded) {
      const persisted = yield* loadPersistedSession(context.sessionId);
      if (!persisted) {
        return yield* new ProviderAdapterRequestError({
          provider: definition.provider,
          method: "session/load-working-set",
          detail: `${definition.provider} session '${context.sessionId}' no longer has persisted history.`,
        });
      }
      context.history.push(...persisted.history);
      context.turns.push(...persisted.turns);
      context.totalProcessedTokens = persisted.totalProcessedTokens;
      context.workingSetLoaded = true;
    }
    context.lastWorkingSetUse = ++workingSetSequence;
    yield* evictIdleWorkingSets(context.threadId);
  });

  const settleApprovalsAsCancelled = (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
  ) =>
    Effect.forEach(
      context.pendingApprovals.values(),
      (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
      { discard: true },
    );

  const stopSessionInternal = Effect.fn("NativeProviderAdapter.stopSessionInternal")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
  ) {
    if (context.stopped) return;
    context.stopped = true;
    if (context.activeTerminal) yield* context.activeTerminal("interrupted");
    context.activeAbortController?.abort();
    if (context.activeInterrupt) {
      yield* Deferred.succeed(context.activeInterrupt, undefined).pipe(Effect.ignore);
    }
    yield* settleApprovalsAsCancelled(context);
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

  const readAttachment = Effect.fn("NativeProviderAdapter.readAttachment")(function* (
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
      const persisted = resume ? yield* loadPersistedSession(sessionId) : undefined;
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
        emitRuntimeEvent: bindProviderRuntimeEventOrigin(runtimeSessionId, publishRuntimeEvent),
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
        lastWorkingSetUse: ++workingSetSequence,
        totalProcessedTokens: persisted?.totalProcessedTokens ?? 0,
      };
      sessions.set(input.threadId, context);
      if (!persisted) yield* persistSession(context);
      yield* evictIdleWorkingSets(input.threadId);
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

  const executeTool = Effect.fn("NativeProviderAdapter.executeTool")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
    turnId: TurnId,
    call: ToolCall,
    interactionMode: ProviderInteractionMode | undefined,
    interrupt: Deferred.Deferred<void>,
  ) {
    const itemId = RuntimeItemId.make(call.sourceId?.trim() || (yield* randomUuid));
    const detail = definition.toolHarness.approvalDetail(call.name, call.args);
    yield* context.emitRuntimeEvent({
      type: "item.started",
      ...(yield* makeEventStamp()),
      provider: definition.provider,
      threadId: context.threadId,
      turnId,
      itemId,
      payload: {
        itemType: defaultToolItemType(call.name),
        status: "inProgress",
        title: call.name,
        detail,
        data: definition.toolHarness.eventData?.(call) ?? defaultToolEventData(call),
      },
    });
    const available = yield* definition.toolHarness.isAvailable({
      threadId: context.threadId,
      cwd: context.cwd,
      toolName: call.name,
      interactionMode,
      sandboxMode: context.fetchWorker ? "read-only" : context.sandboxMode,
    });
    let decision: ProviderApprovalDecision = "accept";
    const requiresApproval =
      available &&
      !context.approvedForSession.has(call.name) &&
      definition.toolHarness.requiresApproval(call.name, context.session.runtimeMode);
    if (requiresApproval) {
      const rawRequestId = yield* randomUuid;
      const requestId = ApprovalRequestId.make(rawRequestId);
      const runtimeRequestId = RuntimeRequestId.make(rawRequestId);
      const pending = {
        decision: yield* Deferred.make<ProviderApprovalDecision>(),
        toolName: call.name,
      };
      context.pendingApprovals.set(requestId, pending);
      const requestType = definition.toolHarness.requestType(call.name);
      yield* context.emitRuntimeEvent({
        type: "request.opened",
        ...(yield* makeEventStamp()),
        provider: definition.provider,
        threadId: context.threadId,
        turnId,
        itemId,
        requestId: runtimeRequestId,
        payload: { requestType, detail, args: call.args },
      });
      decision = yield* Effect.raceFirst(
        Deferred.await(pending.decision),
        Deferred.await(interrupt).pipe(Effect.andThen(Effect.interrupt)),
      ).pipe(Effect.ensuring(Effect.sync(() => context.pendingApprovals.delete(requestId))));
      yield* context.emitRuntimeEvent({
        type: "request.resolved",
        ...(yield* makeEventStamp()),
        provider: definition.provider,
        threadId: context.threadId,
        turnId,
        itemId,
        requestId: runtimeRequestId,
        payload: { requestType, decision },
      });
      if (decision === "acceptForSession") context.approvedForSession.add(call.name);
    }
    const declined = decision === "decline" || decision === "cancel";
    const result = boundedToolResult(
      !available
        ? {
            ok: false,
            itemType: defaultToolItemType(call.name),
            title: call.name,
            detail: `T3 did not expose '${call.name}' for this session mode.`,
            output: { error: `Tool '${call.name}' is not available in this session mode.` },
          }
        : declined
          ? {
              ok: false,
              itemType: "dynamic_tool_call",
              title: call.name,
              detail: decision === "cancel" ? "Tool call cancelled." : "Tool call declined.",
              output: { error: `Tool call ${decision}.` },
            }
          : yield* definition.toolHarness
              .execute({
                threadId: context.threadId,
                name: call.name,
                args: call.args,
                cwd: context.cwd,
                environment,
              })
              .pipe(
                Effect.catch((cause) =>
                  Effect.succeed({
                    ok: false,
                    itemType: defaultToolItemType(call.name),
                    title: call.name,
                    detail: errorDetail(cause),
                    output: { error: errorDetail(cause) },
                  }),
                ),
              ),
      definition.limits.maxToolOutputBytes,
    );
    yield* context.emitRuntimeEvent({
      type: "item.completed",
      ...(yield* makeEventStamp()),
      provider: definition.provider,
      threadId: context.threadId,
      turnId,
      itemId,
      payload: {
        itemType: result.itemType,
        status: declined ? "declined" : result.ok ? "completed" : "failed",
        title: result.title,
        detail: result.detail,
        data: result.output,
      },
    });
    if (result.itemType === "command_execution") {
      const output =
        typeof result.output.output === "string"
          ? result.output.output
          : typeof result.output.stdout === "string"
            ? result.output.stdout
            : "";
      if (output) {
        yield* context.emitRuntimeEvent({
          type: "content.delta",
          ...(yield* makeEventStamp()),
          provider: definition.provider,
          threadId: context.threadId,
          turnId,
          itemId,
          payload: { streamKind: "command_output", delta: output },
        });
      }
    }
    return { call, result } satisfies NativeProviderExecutedToolCall<ToolCall>;
  });

  const runModelRound = Effect.fn("NativeProviderAdapter.runModelRound")(function* (
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

    const ensureItem = Effect.fn("NativeProviderAdapter.ensureContentItem")(function* (
      kind: "assistant" | "reasoning",
      sourceId: string | undefined,
    ) {
      const current = kind === "assistant" ? assistantItemId : reasoningItemId;
      if (current) return current;
      const itemId = RuntimeItemId.make(sourceId?.trim() || (yield* randomUuid));
      if (kind === "assistant") assistantItemId = itemId;
      else reasoningItemId = itemId;
      yield* context.emitRuntimeEvent({
        type: "item.started",
        ...(yield* makeEventStamp()),
        provider: definition.provider,
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

    yield* definition
      .streamRound({
        session: sessionView(context),
        plan,
        turnId,
        signal: controller.signal,
      })
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "failed") {
              return yield* new ProviderAdapterRequestError({
                provider: definition.provider,
                method: "model/stream",
                detail: event.message,
              });
            }
            if (event.type === "completed") {
              if (terminal) {
                return yield* new ProviderAdapterRequestError({
                  provider: definition.provider,
                  method: "model/stream",
                  detail: `${definition.provider} emitted more than one terminal response event.`,
                });
              }
              terminal = event;
              return;
            }
            if (terminal) {
              return yield* new ProviderAdapterRequestError({
                provider: definition.provider,
                method: "model/stream",
                detail: `${definition.provider} emitted output after the terminal response event.`,
              });
            }
            const itemId = yield* ensureItem(event.kind, event.sourceId);
            if (event.kind === "assistant") assistantText += event.delta;
            else reasoningText += event.delta;
            yield* context.emitRuntimeEvent({
              type: "content.delta",
              ...(yield* makeEventStamp()),
              provider: definition.provider,
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
        provider: definition.provider,
        method: "model/stream",
        detail: `${definition.provider} response stream ended without a terminal event.`,
      });
    }
    assistantText ||= terminal.assistantText ?? "";
    reasoningText ||= terminal.reasoningText ?? "";
    if (!assistantItemId && assistantText) {
      assistantItemId = yield* ensureItem("assistant", undefined);
      yield* context.emitRuntimeEvent({
        type: "content.delta",
        ...(yield* makeEventStamp()),
        provider: definition.provider,
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
        ...(yield* makeEventStamp()),
        provider: definition.provider,
        threadId: context.threadId,
        turnId,
        itemId: reasoningItemId,
        payload: { streamKind: "reasoning_text", delta: reasoningText },
      });
    }
    if (assistantItemId) {
      yield* context.emitRuntimeEvent({
        type: "item.completed",
        ...(yield* makeEventStamp()),
        provider: definition.provider,
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
        ...(yield* makeEventStamp()),
        provider: definition.provider,
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

  const historyBytes = (history: ReadonlyArray<HistoryItem>): number =>
    definition.history.estimateBytes?.(history) ?? encodedBytes(history);

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      return yield* context.turnSemaphore
        .withPermits(1)(
          Effect.gen(function* () {
            yield* touchWorkingSet(context);
            const plan = yield* definition.prepareTurn({
              input,
              session: sessionView(context),
              readAttachment,
            });
            if (plan.toolDeclarations.length > definition.limits.maxToolDefinitions) {
              return yield* new ProviderAdapterRequestError({
                provider: definition.provider,
                method: "session/prompt",
                detail: `T3 exposed ${plan.toolDeclarations.length} tools, exceeding ${definition.provider}'s ${definition.limits.maxToolDefinitions}-definition limit.`,
              });
            }
            const turnId = TurnId.make(yield* randomUuid);
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
              updatedAt: yield* nowIso,
            };
            yield* context.emitRuntimeEvent({
              type: "turn.started",
              ...(yield* makeEventStamp()),
              provider: definition.provider,
              threadId: input.threadId,
              turnId,
              payload: { model: plan.model },
            });
            yield* context.emitRuntimeEvent({
              type: "session.state.changed",
              ...(yield* makeEventStamp()),
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
                  ...(yield* makeEventStamp()),
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
            const settleActiveTurn = Effect.fn("NativeProviderAdapter.settleActiveTurn")(
              function* () {
                context.activeAbortController?.abort();
                context.activeAbortController = undefined;
                context.activeInterrupt = undefined;
                context.activeTerminal = undefined;
                context.activeTurnId = undefined;
                const { activeTurnId: _activeTurnId, ...ready } = context.session;
                context.session = {
                  ...ready,
                  status: context.stopped ? "closed" : "ready",
                  updatedAt: yield* nowIso,
                };
              },
            );
            const interruptActiveTurn = Effect.fn("NativeProviderAdapter.interruptActiveTurn")(
              function* () {
                context.history.splice(0, context.history.length, ...preTurnHistory);
                context.turns.splice(preTurnCount);
                yield* emitTerminal("interrupted");
                yield* settleActiveTurn();
              },
            );
            const failActiveTurn = Effect.fn("NativeProviderAdapter.failActiveTurn")(function* (
              cause: ProviderAdapterError,
            ) {
              context.history.splice(0, context.history.length, ...preTurnHistory);
              context.turns.splice(preTurnCount);
              const detail = errorDetail(cause);
              yield* context.emitRuntimeEvent({
                type: "runtime.error",
                ...(yield* makeEventStamp()),
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
                    session: sessionView(context),
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
                  (call) => executeTool(context, turnId, call, input.interactionMode, interrupt),
                  { concurrency: definition.limits.maxParallelToolCalls },
                );
                context.history.push(
                  ...definition.toolResultsToHistoryItems({
                    session: sessionView(context),
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
            const admittedToolLoop = admission.withLease(
              {
                threadId: input.threadId,
                turnId,
                providerInstanceId: definition.instanceId,
                serializedHistoryBytes: historyBytes(context.history),
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
            yield* persistSession(context).pipe(
              Effect.catch(failActiveTurn),
              Effect.onInterrupt(() => Effect.uninterruptible(interruptActiveTurn())),
            );
            yield* emitTerminal("completed");
            if (lastUsage) {
              yield* context.emitRuntimeEvent({
                type: "thread.token-usage.updated",
                ...(yield* makeEventStamp()),
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
            context.lastWorkingSetUse = ++workingSetSequence;
            yield* evictIdleWorkingSets(context.threadId);
            if (!context.stopped) {
              yield* context.emitRuntimeEvent({
                type: "session.state.changed",
                ...(yield* makeEventStamp()),
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
      yield* settleApprovalsAsCancelled(live);
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

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      yield* touchWorkingSet(context);
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
      yield* touchWorkingSet(context);
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
      yield* persistSession(context);
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

  const getMcpSnapshot: NonNullable<
    ProviderAdapterShape<ProviderAdapterError>["mcpRuntime"]
  >["getSnapshot"] = Effect.fn("NativeProviderAdapter.getMcpSnapshot")(function* (input) {
    if (input.providerInstanceId !== definition.instanceId) {
      return yield* new ProviderAdapterValidationError({
        provider: definition.provider,
        operation: "mcpRuntime",
        issue: `MCP runtime target belongs to provider instance '${input.providerInstanceId}', not '${definition.instanceId}'.`,
      });
    }
    const context = yield* requireSession(input.threadId);
    if (context.session.runtimeSessionId !== input.runtimeSessionId) {
      return yield* new ProviderAdapterValidationError({
        provider: definition.provider,
        operation: "mcpRuntime",
        issue: `MCP runtime session '${input.runtimeSessionId}' has been replaced.`,
      });
    }
    const observedAt = yield* nowIso;
    const configured = definition.mcp?.resolveServers
      ? yield* definition.mcp.resolveServers({ cwd: context.cwd })
      : [];
    const internal =
      definition.mcp?.includeT3BuiltIn === false
        ? undefined
        : McpProviderSession.readMcpProviderSession(input.threadId);
    return [
      ...(internal
        ? [
            {
              providerKey: McpRuntimeServerKey.make("t3-code"),
              source: "t3-built-in" as const,
              providerInstanceId: definition.instanceId,
              threadId: context.threadId,
              runtimeSessionId: input.runtimeSessionId,
              name: McpServerName.make("T3 Code"),
              transport: "http" as const,
              state: "unknown" as const,
              statusSource: "configuration" as const,
              observedAt,
              authState: "authenticated" as const,
              availableActions: [] as const,
              reportsTools: false,
              configDrift: "none" as const,
            },
          ]
        : []),
      ...configured.map((server) => ({
        serverId: server.id,
        providerKey: McpRuntimeServerKey.make(server.id),
        source: "t3-managed" as const,
        providerInstanceId: definition.instanceId,
        threadId: context.threadId,
        runtimeSessionId: input.runtimeSessionId,
        name: McpServerName.make(server.name),
        transport: server.transport,
        state: "unknown" as const,
        statusSource: "configuration" as const,
        observedAt,
        authState: "unknown" as const,
        availableActions: ["refresh"] as const,
        reportsTools: false,
        configDrift: "none" as const,
      })),
    ];
  });

  const mcpRuntime = definition.mcp
    ? {
        getSnapshot: getMcpSnapshot,
        applyConfiguration: (input: Parameters<typeof getMcpSnapshot>[0]) =>
          getMcpSnapshot(input).pipe(
            Effect.andThen(definition.toolHarness.releaseThread?.(input.threadId) ?? Effect.void),
            Effect.as("applied" as const),
          ),
      }
    : undefined;

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(Effect.ignore, Effect.andThen(runtimeEventBroadcast.shutdown)),
  );

  return {
    provider: definition.provider,
    capabilities: definition.capabilities,
    ...(mcpRuntime ? { mcpRuntime } : {}),
    startSession,
    sendTurn,
    interruptTurn,
    forceStopSession,
    respondToRequest,
    respondToUserInput: (threadId, requestId) =>
      unsupportedResponse(threadId, "user-input/respond", requestId),
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: runtimeEventBroadcast.stream,
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
