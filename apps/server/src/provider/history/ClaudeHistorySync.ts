import {
  foldSessionSummary,
  getSessionMessages as sdkGetSessionMessages,
  listSessions as sdkListSessions,
  type GetSessionMessagesOptions,
  type ListSessionsOptions,
  type SDKSessionInfo,
  type SessionKey,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";

import {
  ProviderHistorySyncError,
  type ProviderHistoryAttachment,
  type ProviderHistorySyncAdapter,
  type ProviderHistoryTranscript,
} from "../Services/ProviderHistorySync.ts";
import {
  normalizeVisibleProviderHistoryTranscript,
  type ProviderHistoryTranscriptCandidate,
} from "./visibleTranscript.ts";

const CLAUDE_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface ClaudeHistorySdk {
  readonly listSessions: (options?: ListSessionsOptions) => Promise<SDKSessionInfo[]>;
  readonly getSessionMessages: (
    sessionId: string,
    options?: GetSessionMessagesOptions,
  ) => Promise<SessionMessage[]>;
}

const defaultSdk: ClaudeHistorySdk = {
  listSessions: sdkListSessions,
  getSessionMessages: sdkGetSessionMessages,
};

interface ClaudeSessionFile {
  readonly projectKey: string;
  readonly sessionId: string;
  readonly path: string;
  readonly mtime: number;
}

function parseSessionEntries(contents: string): ReadonlyArray<SessionStoreEntry> {
  const entries: SessionStoreEntry[] = [];
  for (const line of contents.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!Predicate.isObject(parsed) || !Predicate.isString(parsed.type)) continue;
      entries.push(parsed as SessionStoreEntry);
    } catch {
      continue;
    }
  }
  return entries;
}

const scanClaudeSessionFiles = Effect.fn("scanClaudeSessionFiles")(function* (input: {
  readonly configDir: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  const projectsDir = input.path.join(input.configDir, "projects");
  if (!(yield* input.fileSystem.exists(projectsDir))) return [];
  const projectNames = yield* input.fileSystem.readDirectory(projectsDir);
  const files = yield* Effect.forEach(
    projectNames,
    (projectKey) =>
      Effect.gen(function* () {
        const projectPath = input.path.join(projectsDir, projectKey);
        const projectStat = yield* input.fileSystem.stat(projectPath);
        if (projectStat.type !== "Directory") return [];
        const entryNames = yield* input.fileSystem.readDirectory(projectPath);
        return yield* Effect.forEach(
          entryNames,
          (entryName) =>
            Effect.gen(function* () {
              if (!entryName.endsWith(".jsonl")) return undefined;
              const sessionId = entryName.slice(0, -".jsonl".length);
              if (!CLAUDE_SESSION_ID.test(sessionId)) return undefined;
              const sessionPath = input.path.join(projectPath, entryName);
              const stat = yield* input.fileSystem.stat(sessionPath);
              if (stat.type !== "File") return undefined;
              return {
                projectKey,
                sessionId,
                path: sessionPath,
                mtime: Option.match(stat.mtime, {
                  onNone: () => 0,
                  onSome: (mtime) => mtime.getTime(),
                }),
              };
            }),
          { concurrency: "unbounded" },
        );
      }),
    { concurrency: "unbounded" },
  );
  const sessions: ClaudeSessionFile[] = files.flat().flatMap((file) => (file ? [file] : []));
  return sessions.sort((left, right) => right.mtime - left.mtime);
});

/**
 * Read-only SDK store rooted at one configured Claude config directory.
 * SDK history helpers receive this store explicitly, so concurrent instances
 * never swap the process-wide `CLAUDE_CONFIG_DIR` variable.
 */
export const makeClaudeHomeSessionStore = Effect.fn("makeClaudeHomeSessionStore")(function* (
  configDir: string,
): Effect.fn.Return<SessionStore, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scanFiles = () => scanClaudeSessionFiles({ configDir, fileSystem, path });
  const readEntries = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(Effect.map(parseSessionEntries));
  const runPromise = Effect.runPromise;

  return {
    append: () => Promise.reject(new Error("Claude history store is read-only.")),
    load: (key: SessionKey) =>
      runPromise(
        Effect.gen(function* () {
          const files = yield* scanFiles();
          const file = files.find((candidate) => candidate.sessionId === key.sessionId);
          return file ? [...(yield* readEntries(file.path))] : null;
        }),
      ),
    listSessions: () =>
      runPromise(
        scanFiles().pipe(
          Effect.map((files) => files.map(({ sessionId, mtime }) => ({ sessionId, mtime }))),
        ),
      ),
    listSessionSummaries: () =>
      runPromise(
        Effect.gen(function* () {
          const files = yield* scanFiles();
          return yield* Effect.forEach(
            files,
            (file) =>
              readEntries(file.path).pipe(
                Effect.map((entries) =>
                  foldSessionSummary(
                    undefined,
                    { projectKey: file.projectKey, sessionId: file.sessionId },
                    [...entries],
                    { mtime: file.mtime },
                  ),
                ),
              ),
            { concurrency: "unbounded" },
          );
        }),
      ),
  };
});

function historyError(input: {
  readonly sourceId: string;
  readonly operation: string;
  readonly sessionId?: string;
  readonly detail?: string;
  readonly cause?: unknown;
}): ProviderHistorySyncError {
  const causeDetail =
    input.cause instanceof Error && input.cause.message.trim().length > 0
      ? input.cause.message
      : input.cause === undefined
        ? undefined
        : String(input.cause);
  return new ProviderHistorySyncError({
    sourceId: input.sourceId,
    operation: input.operation,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    detail: input.detail ?? causeDetail ?? "Claude history operation failed.",
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function millisecondsToIso(value: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(value));
}

function parseOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
}

function matchesSession(
  session: SDKSessionInfo,
  input: {
    readonly query?: string | undefined;
    readonly cwd?: string | undefined;
  },
): boolean {
  if (input.cwd?.trim() && session.cwd !== input.cwd.trim()) return false;
  const query = input.query?.trim().toLocaleLowerCase();
  if (!query) return true;
  return [session.summary, session.customTitle, session.firstPrompt, session.cwd, session.gitBranch]
    .filter(Predicate.isString)
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function sessionSummary(session: SDKSessionInfo) {
  const title = session.summary.trim() || session.customTitle?.trim() || null;
  const preview = session.firstPrompt?.trim() || null;
  return {
    sessionId: session.sessionId,
    title,
    preview,
    cwd: session.cwd?.trim() || null,
    model: null,
    ...(session.createdAt === undefined ? {} : { createdAt: millisecondsToIso(session.createdAt) }),
    updatedAt: millisecondsToIso(session.lastModified),
    archived: false,
    isChild: false,
    activity: "unknown" as const,
  };
}

function messageContent(message: SessionMessage): unknown {
  return Predicate.isObject(message.message) ? message.message.content : undefined;
}

function blockText(block: unknown): string | undefined {
  if (!Predicate.isObject(block) || block.type !== "text" || !Predicate.isString(block.text)) {
    return undefined;
  }
  return block.text;
}

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function sourceMimeType(source: Record<string, unknown>, type: "image" | "audio"): string {
  const candidate = Predicate.isString(source.media_type)
    ? source.media_type
    : Predicate.isString(source.mime_type)
      ? source.mime_type
      : undefined;
  return candidate ?? `${type}/*`;
}

function pathBasename(value: string): string {
  return value.split(/[\\/]/u).at(-1) ?? "";
}

function claudeAttachment(
  messageId: string,
  block: unknown,
  index: number,
): ProviderHistoryAttachment | undefined {
  if (!Predicate.isObject(block) || (block.type !== "image" && block.type !== "audio")) {
    return undefined;
  }
  if (!Predicate.isObject(block.source)) return undefined;
  const type = block.type;
  const source = block.source;
  const mimeType = sourceMimeType(source, type);
  const fallback = `${type}-${index + 1}${EXTENSION_BY_MIME[mimeType] ?? ""}`;
  const nativeAttachmentId = `${messageId}:attachment:${index}`;

  if (source.type === "base64" && Predicate.isString(source.data)) {
    return {
      type,
      nativeAttachmentId,
      name: fallback,
      mimeType,
      content: { type: "data-url", dataUrl: `data:${mimeType};base64,${source.data}` },
    };
  }
  if (source.type === "url" && Predicate.isString(source.url)) {
    return {
      type,
      nativeAttachmentId,
      name: pathBasename(new URL(source.url).pathname) || fallback,
      mimeType,
      content: { type: "url", url: source.url },
    };
  }
  if (source.type === "file" && Predicate.isString(source.path)) {
    return {
      type,
      nativeAttachmentId,
      name: pathBasename(source.path) || fallback,
      mimeType,
      content: { type: "file", path: source.path },
    };
  }
  return undefined;
}

function assistantPlan(
  messageId: string,
  block: unknown,
  index: number,
): ProviderHistoryTranscriptCandidate | undefined {
  if (
    !Predicate.isObject(block) ||
    block.type !== "tool_use" ||
    block.name !== "ExitPlanMode" ||
    !Predicate.isObject(block.input) ||
    !Predicate.isString(block.input.plan)
  ) {
    return undefined;
  }
  return {
    kind: "plan",
    nativePlanId: `${messageId}:plan:${index}`,
    markdown: block.input.plan,
  };
}

function transcriptCandidates(
  messages: ReadonlyArray<SessionMessage>,
): ReadonlyArray<ProviderHistoryTranscriptCandidate> {
  return messages.flatMap((message) => {
    if (message.type === "system" || message.parent_tool_use_id !== null) return [];
    const content = messageContent(message);
    const blocks = Array.isArray(content) ? content : [];
    const text = Predicate.isString(content)
      ? content
      : blocks
          .flatMap((block) => {
            const value = blockText(block);
            return value ? [value] : [];
          })
          .join("\n");
    const attachments = blocks.flatMap((block, index) => {
      const attachment = claudeAttachment(message.uuid, block, index);
      return attachment ? [attachment] : [];
    });
    const visibleMessage: ProviderHistoryTranscriptCandidate = {
      kind: "message",
      nativeMessageId: message.uuid,
      role: message.type,
      text,
      attachments,
    };
    if (message.type !== "assistant") return [visibleMessage];
    const plans = blocks.flatMap((block, index) => {
      const plan = assistantPlan(message.uuid, block, index);
      return plan ? [plan] : [];
    });
    return [visibleMessage, ...plans];
  });
}

function transcriptFromMessages(input: {
  readonly session: SDKSessionInfo;
  readonly messages: ReadonlyArray<SessionMessage>;
}): ProviderHistoryTranscript {
  return {
    sessionId: input.session.sessionId,
    items: normalizeVisibleProviderHistoryTranscript(transcriptCandidates(input.messages)),
    ...(input.session.cwd?.trim() ? { cwd: input.session.cwd.trim() } : {}),
    updatedAt: millisecondsToIso(input.session.lastModified),
  };
}

export function makeClaudeHistorySyncAdapter(input: {
  readonly sourceId: string;
  readonly sessionStore: SessionStore;
  readonly sdk?: ClaudeHistorySdk;
}): ProviderHistorySyncAdapter {
  const sdk = input.sdk ?? defaultSdk;

  const loadSessions = (operation: string, sessionId?: string) =>
    Effect.tryPromise({
      try: () => sdk.listSessions({ sessionStore: input.sessionStore }),
      catch: (cause) =>
        historyError({
          sourceId: input.sourceId,
          operation,
          ...(sessionId ? { sessionId } : {}),
          cause,
        }),
    });
  const loadMessages = (sessionId: string, operation: string) =>
    Effect.tryPromise({
      try: () => sdk.getSessionMessages(sessionId, { sessionStore: input.sessionStore }),
      catch: (cause) => historyError({ sourceId: input.sourceId, operation, sessionId, cause }),
    });

  return {
    list: (request) =>
      Effect.gen(function* () {
        const sessions = (yield* loadSessions("list"))
          .filter((session) => matchesSession(session, request))
          .sort((left, right) => right.lastModified - left.lastModified);
        const offset = parseOffset(request.cursor);
        const page = sessions.slice(offset, offset + request.limit);
        const nextOffset = offset + page.length;
        const latestUpdatedAt = sessions[0]
          ? millisecondsToIso(sessions[0].lastModified)
          : undefined;
        return {
          items: page.map(sessionSummary),
          ...(nextOffset < sessions.length ? { nextCursor: String(nextOffset) } : {}),
          totalMatching: sessions.length,
          ...(latestUpdatedAt ? { latestUpdatedAt } : {}),
        };
      }),
    read: ({ sessionId }) =>
      Effect.gen(function* () {
        const [sessions, messages] = yield* Effect.all(
          [loadSessions("read", sessionId), loadMessages(sessionId, "read")],
          { concurrency: "unbounded" },
        );
        const session = sessions.find((candidate) => candidate.sessionId === sessionId);
        if (!session) {
          return yield* historyError({
            sourceId: input.sourceId,
            operation: "read",
            sessionId,
            detail: "Claude session was not found in the configured home.",
          });
        }
        return transcriptFromMessages({ session, messages });
      }),
    resumeCursor: ({ sessionId }) =>
      Effect.gen(function* () {
        const messages = yield* loadMessages(sessionId, "resume");
        const lastAssistantUuid = messages.findLast(
          (message) => message.type === "assistant",
        )?.uuid;
        const turnCount = messages.filter(
          (message) => message.type === "user" && message.parent_tool_use_id === null,
        ).length;
        return {
          resumeCursor: {
            resume: sessionId,
            ...(lastAssistantUuid ? { resumeSessionAt: lastAssistantUuid } : {}),
            turnCount,
          },
        };
      }),
  };
}
