import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpClient from "effect-acp/client";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  makeSupportedProviderHistorySync,
  ProviderHistorySyncError,
  type ProviderHistoryAttachment,
  type ProviderHistoryListInput,
  type ProviderHistorySyncAdapter,
  type ProviderHistorySyncFacet,
  type ProviderHistorySyncSource,
  type ProviderHistoryThreadSummary,
  type ProviderHistoryTranscriptItem,
} from "../Services/ProviderHistorySync.ts";
import type { AcpSpawnInput } from "../acp/AcpSessionRuntime.ts";
import { type SessionLoadGate, waitForSessionLoadReplayIdle } from "../acp/AcpRuntimeModel.ts";
import {
  makeFallbackNativeItemId,
  normalizeVisibleProviderHistoryTranscript,
  type ProviderHistoryTranscriptCandidate,
} from "./visibleTranscript.ts";

const UNKNOWN_UPDATED_AT = "1970-01-01T00:00:00.000Z";
const DEFAULT_LOAD_TIMEOUT = Duration.seconds(90);
const DEFAULT_REPLAY_IDLE_GAP = Duration.millis(250);

class AcpHistoryGatewayError extends Data.TaggedError("AcpHistoryGatewayError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export interface AcpHistoryNativeListResult {
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
  readonly response: EffectAcpSchema.ListSessionsResponse;
}

export interface AcpHistoryNativeReadResult {
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
  readonly notifications: ReadonlyArray<EffectAcpSchema.SessionNotification>;
}

export interface AcpHistoryGateway {
  readonly list: (input: {
    readonly cursor?: string | undefined;
    readonly cwd?: string | undefined;
  }) => Effect.Effect<AcpHistoryNativeListResult, AcpHistoryGatewayError>;
  readonly read: (input: {
    readonly sessionId: string;
    readonly cwd: string;
  }) => Effect.Effect<AcpHistoryNativeReadResult, AcpHistoryGatewayError>;
}

export function acpHistoryCapabilityIssue(
  initializeResult: EffectAcpSchema.InitializeResponse,
): string | undefined {
  if (initializeResult.agentCapabilities?.sessionCapabilities?.list == null) {
    return "ACP agent does not advertise session/list capability.";
  }
  if (initializeResult.agentCapabilities?.loadSession !== true) {
    return "ACP agent does not advertise session/load capability.";
  }
  return undefined;
}

function issueAsError(
  initializeResult: EffectAcpSchema.InitializeResponse,
): AcpHistoryGatewayError | undefined {
  const issue = acpHistoryCapabilityIssue(initializeResult);
  return issue === undefined ? undefined : new AcpHistoryGatewayError({ detail: issue });
}

function detailFromCause(cause: unknown): string {
  if (cause instanceof AcpHistoryGatewayError) return cause.detail;
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  return String(cause);
}

function historyError(input: {
  readonly sourceId: string;
  readonly operation: string;
  readonly sessionId?: string | undefined;
  readonly cause: AcpHistoryGatewayError;
}): ProviderHistorySyncError {
  return new ProviderHistorySyncError({
    sourceId: input.sourceId,
    operation: input.operation,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    detail: detailFromCause(input.cause),
    cause: input.cause,
  });
}

function normalizedUpdatedAt(value: string | null | undefined): string {
  if (!value?.trim()) return UNKNOWN_UPDATED_AT;
  return DateTime.make(value).pipe(
    Option.match({ onNone: () => UNKNOWN_UPDATED_AT, onSome: DateTime.formatIso }),
  );
}

function matchesQuery(session: EffectAcpSchema.SessionInfo, query: string | undefined): boolean {
  const normalized = query?.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${session.title ?? ""}\n${session.cwd}`.toLocaleLowerCase().includes(normalized);
}

function acpSessionIsChild(session: EffectAcpSchema.SessionInfo): boolean {
  const meta = session._meta;
  if (!P.isObject(meta)) return false;
  if (meta.isChild === true) return true;
  return [meta.parentSessionId, meta.parentId, meta.parent_id].some(
    (parentId) => P.isString(parentId) && parentId.trim().length > 0,
  );
}

function summaryFromSession(session: EffectAcpSchema.SessionInfo): ProviderHistoryThreadSummary {
  return {
    sessionId: session.sessionId,
    title: session.title?.trim() || null,
    preview: null,
    cwd: session.cwd.trim() || null,
    model: null,
    updatedAt: normalizedUpdatedAt(session.updatedAt),
    archived: false,
    isChild: false,
    activity: "unknown",
  };
}

interface AcpPageCursor {
  readonly nativeCursor?: string;
  readonly offset: number;
}

const AcpPageCursorSchema = Schema.Struct({
  nativeCursor: Schema.optionalKey(Schema.String),
  offset: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
});
const decodeAcpPageCursor = Schema.decodeUnknownExit(Schema.fromJsonString(AcpPageCursorSchema));
const encodeAcpPageCursor = Schema.encodeSync(Schema.fromJsonString(AcpPageCursorSchema));

function decodePageCursor(cursor: string | undefined): AcpPageCursor {
  if (cursor === undefined) return { offset: 0 };
  const decoded = decodeAcpPageCursor(cursor);
  if (Exit.isFailure(decoded)) return { nativeCursor: cursor, offset: 0 };
  return {
    offset: decoded.value.offset,
    ...(decoded.value.nativeCursor === undefined
      ? {}
      : { nativeCursor: decoded.value.nativeCursor }),
  };
}

function encodePageCursor(cursor: AcpPageCursor): string {
  return encodeAcpPageCursor(cursor);
}

function nextPageCursor(input: {
  readonly cursor: AcpPageCursor;
  readonly filteredLength: number;
  readonly returnedLength: number;
  readonly nativeNextCursor: string | null | undefined;
}): string | undefined {
  const nextOffset = input.cursor.offset + input.returnedLength;
  if (nextOffset < input.filteredLength) {
    return encodePageCursor({
      ...(input.cursor.nativeCursor === undefined
        ? {}
        : { nativeCursor: input.cursor.nativeCursor }),
      offset: nextOffset,
    });
  }
  const nativeNextCursor = input.nativeNextCursor?.trim();
  return nativeNextCursor
    ? encodePageCursor({ nativeCursor: nativeNextCursor, offset: 0 })
    : undefined;
}

function markdownForPlan(entries: ReadonlyArray<EffectAcpSchema.PlanEntry>): string {
  return entries
    .map((entry) => {
      const completed = entry.status === "completed";
      const suffix = entry.status === "in_progress" ? " _(in progress)_" : "";
      return `- [${completed ? "x" : " "}] ${entry.content.trim()}${suffix}`;
    })
    .join("\n");
}

function stableTextHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

interface AcpMessageAccumulator {
  readonly nativeMessageId: string;
  readonly role: "user" | "assistant";
  readonly text: Array<string>;
  readonly attachments: Array<ProviderHistoryAttachment>;
}

function mediaAttachment(input: {
  readonly messageId: string;
  readonly content: Extract<EffectAcpSchema.ContentBlock, { readonly type: "image" | "audio" }>;
  readonly ordinal: number;
}): ProviderHistoryAttachment {
  return {
    type: input.content.type,
    nativeAttachmentId: `${input.messageId}:attachment:${input.ordinal}`,
    name: `${input.content.type}-${input.ordinal}`,
    mimeType: input.content.mimeType,
    content: {
      type: "data-url",
      dataUrl: `data:${input.content.mimeType};base64,${input.content.data}`,
    },
  };
}

export function collectAcpHistoryTranscriptItems(
  sessionId: string,
  notifications: ReadonlyArray<EffectAcpSchema.SessionNotification>,
): ReadonlyArray<ProviderHistoryTranscriptItem> {
  const messages: AcpMessageAccumulator[] = [];
  const messageIndexes = new Map<string, number>();
  let fallbackOrdinal = 0;
  let activeFallback:
    | { readonly role: "user" | "assistant"; readonly nativeMessageId: string }
    | undefined;
  let lastPlanMarkdown = "";

  for (const notification of notifications) {
    if (notification.sessionId !== sessionId) continue;
    const update = notification.update;
    if (update.sessionUpdate === "plan") {
      lastPlanMarkdown = markdownForPlan(update.entries);
      activeFallback = undefined;
      continue;
    }
    if (
      update.sessionUpdate !== "user_message_chunk" &&
      update.sessionUpdate !== "agent_message_chunk"
    ) {
      continue;
    }
    const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
    const explicitMessageId = update.messageId?.trim();
    const nativeMessageId =
      explicitMessageId ||
      (activeFallback?.role === role
        ? activeFallback.nativeMessageId
        : makeFallbackNativeItemId(sessionId, "message", fallbackOrdinal++));
    if (!explicitMessageId) activeFallback = { role, nativeMessageId };
    if (explicitMessageId) activeFallback = undefined;
    const identity = `${role}:${nativeMessageId}`;
    let messageIndex = messageIndexes.get(identity);
    if (messageIndex === undefined) {
      messageIndex = messages.length;
      messageIndexes.set(identity, messageIndex);
      messages.push({ nativeMessageId, role, text: [], attachments: [] });
    }
    const message = messages[messageIndex];
    if (message === undefined) continue;
    if (update.content.type === "text") {
      message.text.push(update.content.text);
      continue;
    }
    if (update.content.type === "image" || update.content.type === "audio") {
      message.attachments.push(
        mediaAttachment({
          messageId: nativeMessageId,
          content: update.content,
          ordinal: message.attachments.length,
        }),
      );
    }
  }

  const candidates: ProviderHistoryTranscriptCandidate[] = messages.map((message) => ({
    kind: "message" as const,
    nativeMessageId: message.nativeMessageId,
    role: message.role,
    text: message.text.join(""),
    attachments: message.attachments,
  }));
  if (lastPlanMarkdown.trim()) {
    candidates.push({
      kind: "plan",
      nativePlanId: `${sessionId}:plan:${stableTextHash(lastPlanMarkdown)}`,
      markdown: lastPlanMarkdown,
    });
  }
  return normalizeVisibleProviderHistoryTranscript(candidates);
}

export function makeAcpHistorySyncAdapter(input: {
  readonly source: ProviderHistorySyncSource;
  readonly gateway: AcpHistoryGateway;
  readonly defaultCwd: string;
}): ProviderHistorySyncAdapter {
  const knownSessions = new Map<string, { readonly cwd: string; readonly updatedAt: string }>();

  return {
    list: Effect.fn("AcpHistorySync.list")(function* (listInput: ProviderHistoryListInput) {
      const cursor = decodePageCursor(listInput.cursor);
      const native = yield* input.gateway
        .list({
          ...(cursor.nativeCursor === undefined ? {} : { cursor: cursor.nativeCursor }),
          ...(listInput.cwd === undefined ? {} : { cwd: listInput.cwd }),
        })
        .pipe(
          Effect.mapError((cause) =>
            historyError({ sourceId: input.source.sourceId, operation: "list", cause }),
          ),
        );
      const capabilityIssue = issueAsError(native.initializeResult);
      if (capabilityIssue !== undefined) {
        return yield* historyError({
          sourceId: input.source.sourceId,
          operation: "list",
          cause: capabilityIssue,
        });
      }
      const filtered = native.response.sessions
        .filter((session) => !acpSessionIsChild(session))
        .filter((session) => matchesQuery(session, listInput.query));
      const selected = filtered.slice(cursor.offset, cursor.offset + listInput.limit);
      for (const session of selected) {
        knownSessions.set(session.sessionId, {
          cwd: session.cwd,
          updatedAt: normalizedUpdatedAt(session.updatedAt),
        });
      }
      const items = selected.map(summaryFromSession);
      const latestUpdatedAt = items.reduce<string | undefined>(
        (latest, item) =>
          latest === undefined || item.updatedAt > latest ? item.updatedAt : latest,
        undefined,
      );
      const nextCursor = nextPageCursor({
        cursor,
        filteredLength: filtered.length,
        returnedLength: selected.length,
        nativeNextCursor: native.response.nextCursor,
      });
      return {
        items,
        ...(nextCursor === undefined ? {} : { nextCursor }),
        ...(latestUpdatedAt === undefined ? {} : { latestUpdatedAt }),
      };
    }),
    read: Effect.fn("AcpHistorySync.read")(function* ({ sessionId }) {
      const knownSession = knownSessions.get(sessionId);
      const cwd = knownSession?.cwd ?? input.defaultCwd;
      const native = yield* input.gateway.read({ sessionId, cwd }).pipe(
        Effect.mapError((cause) =>
          historyError({
            sourceId: input.source.sourceId,
            operation: "read",
            sessionId,
            cause,
          }),
        ),
      );
      const capabilityIssue = issueAsError(native.initializeResult);
      if (capabilityIssue !== undefined) {
        return yield* historyError({
          sourceId: input.source.sourceId,
          operation: "read",
          sessionId,
          cause: capabilityIssue,
        });
      }
      return {
        sessionId,
        items: collectAcpHistoryTranscriptItems(sessionId, native.notifications),
        cwd,
        updatedAt: knownSession?.updatedAt ?? UNKNOWN_UPDATED_AT,
      };
    }),
    resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { sessionId } }),
  };
}

interface AcpHistoryConnectionOptions {
  readonly spawn: AcpSpawnInput;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly authMethodId: string;
  readonly clientCapabilities?: EffectAcpSchema.InitializeRequest["clientCapabilities"];
  readonly clientInfo?: EffectAcpSchema.InitializeRequest["clientInfo"];
  readonly loadTimeout?: Duration.Input;
  readonly replayIdleGap?: Duration.Input;
}

interface AcpHistoryConnection {
  readonly acp: EffectAcpClient.AcpClient["Service"];
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
  readonly notificationsRef: Ref.Ref<ReadonlyArray<EffectAcpSchema.SessionNotification>>;
  readonly activeSessionRef: Ref.Ref<string | undefined>;
  readonly loadGateRef: Ref.Ref<Option.Option<SessionLoadGate>>;
}

const withAcpHistoryConnection = <A>(
  options: AcpHistoryConnectionOptions,
  use: (
    connection: AcpHistoryConnection,
  ) => Effect.Effect<A, AcpHistoryGatewayError | EffectAcpErrors.AcpError, Scope.Scope>,
): Effect.Effect<A, AcpHistoryGatewayError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const resolved = yield* resolveSpawnCommand(
        options.spawn.command,
        options.spawn.args,
        options.spawn.env ? { env: options.spawn.env, extendEnv: true } : {},
      );
      const child = yield* options.childProcessSpawner.spawn(
        ChildProcess.make(resolved.command, resolved.args, {
          ...(options.spawn.cwd ? { cwd: options.spawn.cwd } : {}),
          ...(options.spawn.env ? { env: options.spawn.env, extendEnv: true } : {}),
          shell: resolved.shell,
        }),
      );
      const context = yield* Layer.build(EffectAcpClient.layerChildProcess(child));
      const acp = yield* Effect.service(EffectAcpClient.AcpClient).pipe(Effect.provide(context));
      const notificationsRef = yield* Ref.make<ReadonlyArray<EffectAcpSchema.SessionNotification>>(
        [],
      );
      const activeSessionRef = yield* Ref.make<string | undefined>(undefined);
      const loadGateRef = yield* Ref.make<Option.Option<SessionLoadGate>>(Option.none());
      yield* acp.handleSessionUpdate((notification) =>
        Effect.gen(function* () {
          const activeSession = yield* Ref.get(activeSessionRef);
          if (activeSession === undefined || notification.sessionId !== activeSession) return;
          yield* Ref.update(notificationsRef, (notifications) => [...notifications, notification]);
          const gate = yield* Ref.get(loadGateRef);
          if (Option.isNone(gate) || !gate.value.active) return;
          yield* Ref.set(
            loadGateRef,
            Option.some({
              ...gate.value,
              lastActivityAtMillis: yield* Clock.currentTimeMillis,
            }),
          );
        }),
      );
      const initializeResult = yield* acp.agent.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
            ...options.clientCapabilities?.fs,
          },
          terminal: options.clientCapabilities?.terminal ?? false,
          ...(options.clientCapabilities?.auth ? { auth: options.clientCapabilities.auth } : {}),
          ...(options.clientCapabilities?.elicitation
            ? { elicitation: options.clientCapabilities.elicitation }
            : {}),
          ...(options.clientCapabilities?._meta ? { _meta: options.clientCapabilities._meta } : {}),
        },
        clientInfo: options.clientInfo ?? { name: "t3-code", version: "0.0.0" },
      });
      yield* acp.agent.authenticate({ methodId: options.authMethodId });
      return yield* use({
        acp,
        initializeResult,
        notificationsRef,
        activeSessionRef,
        loadGateRef,
      });
    }),
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof AcpHistoryGatewayError
        ? cause
        : new AcpHistoryGatewayError({ detail: detailFromCause(cause), cause }),
    ),
  );

function makeAcpRuntimeHistoryGateway(options: AcpHistoryConnectionOptions): AcpHistoryGateway {
  return {
    list: ({ cursor, cwd }) =>
      withAcpHistoryConnection(options, ({ acp, initializeResult }) => {
        const capabilityIssue = issueAsError(initializeResult);
        if (capabilityIssue !== undefined) return Effect.fail(capabilityIssue);
        return acp.agent
          .listSessions({
            ...(cursor === undefined ? {} : { cursor }),
            ...(cwd === undefined ? {} : { cwd }),
          })
          .pipe(Effect.map((response) => ({ initializeResult, response })));
      }),
    read: ({ sessionId, cwd }) =>
      withAcpHistoryConnection(
        options,
        Effect.fn("AcpHistorySync.nativeRead")(function* ({
          acp,
          initializeResult,
          notificationsRef,
          activeSessionRef,
          loadGateRef,
        }) {
          const capabilityIssue = issueAsError(initializeResult);
          if (capabilityIssue !== undefined) return yield* capabilityIssue;
          yield* Ref.set(activeSessionRef, sessionId);
          yield* Ref.set(
            loadGateRef,
            Option.some({
              active: true,
              lastActivityAtMillis: undefined,
              idleGap: Duration.fromInputUnsafe(options.replayIdleGap ?? DEFAULT_REPLAY_IDLE_GAP),
              initializeResult,
            }),
          );
          const idleFiber = yield* waitForSessionLoadReplayIdle({ gateRef: loadGateRef }).pipe(
            Effect.forkScoped,
          );
          yield* Effect.raceFirst(
            acp.agent.loadSession({ sessionId, cwd, mcpServers: [] }),
            Fiber.join(idleFiber),
          ).pipe(
            Effect.ensuring(Fiber.interrupt(idleFiber).pipe(Effect.ignore)),
            Effect.timeoutOption(options.loadTimeout ?? DEFAULT_LOAD_TIMEOUT),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(
                    new AcpHistoryGatewayError({ detail: "ACP session/load timed out." }),
                  ),
                onSome: Effect.succeed,
              }),
            ),
          );
          yield* Ref.set(loadGateRef, Option.none());
          return {
            initializeResult,
            notifications: yield* Ref.get(notificationsRef),
          };
        }),
      ),
  };
}

export function makeAcpHistorySync(input: {
  readonly source: ProviderHistorySyncSource;
  readonly defaultCwd: string;
  readonly spawn: AcpSpawnInput;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly authMethodId: string;
  readonly clientCapabilities?: EffectAcpSchema.InitializeRequest["clientCapabilities"];
}): ProviderHistorySyncFacet {
  const gateway = makeAcpRuntimeHistoryGateway(input);
  return makeSupportedProviderHistorySync({
    source: input.source,
    adapter: makeAcpHistorySyncAdapter({
      source: input.source,
      gateway,
      defaultCwd: input.defaultCwd,
    }),
  });
}
