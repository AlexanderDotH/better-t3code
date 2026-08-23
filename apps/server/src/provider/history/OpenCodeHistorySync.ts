import * as NodeURL from "node:url";

import {
  type Message,
  type OpencodeClient,
  type Part,
  type Session,
  type SessionStatus,
  type Todo,
} from "@opencode-ai/sdk/v2";
import type { OpenCodeSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  makeSupportedProviderHistorySync,
  ProviderHistorySyncError,
  type ProviderHistoryAttachment,
  type ProviderHistoryListInput,
  type ProviderHistorySyncAdapter,
  type ProviderHistorySyncFacet,
  type ProviderHistorySyncSource,
  type ProviderHistoryThreadSummary,
} from "../Services/ProviderHistorySync.ts";
import {
  type OpenCodeRuntime,
  OpenCodeRuntimeError,
  openCodeRuntimeErrorDetail,
  runOpenCodeSdk,
} from "../opencodeRuntime.ts";
import { normalizeVisibleProviderHistoryTranscript } from "./visibleTranscript.ts";

const UNKNOWN_UPDATED_AT = "1970-01-01T00:00:00.000Z";

export interface OpenCodeHistoryGateway {
  readonly list: (input: {
    readonly query?: string | undefined;
    readonly start: number;
    readonly limit: number;
  }) => Effect.Effect<
    {
      readonly sessions: ReadonlyArray<Session>;
      readonly statuses: Readonly<Record<string, SessionStatus>>;
    },
    OpenCodeRuntimeError
  >;
  readonly read: (input: {
    readonly sessionId: string;
    readonly cwd?: string | undefined;
  }) => Effect.Effect<
    {
      readonly session: Session;
      readonly messages: ReadonlyArray<{
        readonly info: Message;
        readonly parts: ReadonlyArray<Part>;
      }>;
      readonly todos: ReadonlyArray<Todo>;
    },
    OpenCodeRuntimeError
  >;
  readonly status: (input: {
    readonly sessionId: string;
    readonly cwd?: string | undefined;
  }) => Effect.Effect<SessionStatus | undefined, OpenCodeRuntimeError>;
}

function isoFromEpochMillis(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return DateTime.make(value).pipe(
    Option.match({ onNone: () => undefined, onSome: DateTime.formatIso }),
  );
}

function openCodeModel(session: Session): string | null {
  const providerId = session.model?.providerID?.trim();
  const modelId = session.model?.id?.trim();
  if (!providerId || !modelId) return null;
  return `${providerId}/${modelId}`;
}

function activityFromStatus(
  status: SessionStatus | undefined,
): ProviderHistoryThreadSummary["activity"] {
  if (status?.type === "idle") return "idle";
  if (status?.type === "busy" || status?.type === "retry") return "active";
  return "unknown";
}

function matchesSessionQuery(session: Session, query: string | undefined): boolean {
  const normalized = query?.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${session.title}\n${session.directory}`.toLocaleLowerCase().includes(normalized);
}

function summarizeSession(
  session: Session,
  statuses: Readonly<Record<string, SessionStatus>>,
): ProviderHistoryThreadSummary {
  return {
    sessionId: session.id,
    title: session.title.trim() || null,
    preview: null,
    cwd: session.directory.trim() || null,
    model: openCodeModel(session),
    ...(isoFromEpochMillis(session.time.created) === undefined
      ? {}
      : { createdAt: isoFromEpochMillis(session.time.created) }),
    updatedAt: isoFromEpochMillis(session.time.updated) ?? UNKNOWN_UPDATED_AT,
    archived: session.time.archived !== undefined,
    isChild: session.parentID !== undefined,
    activity: activityFromStatus(statuses[session.id]),
  };
}

function attachmentContent(url: string): ProviderHistoryAttachment["content"] {
  if (url.startsWith("data:")) return { type: "data-url", dataUrl: url };
  if (url.startsWith("file:")) {
    try {
      return { type: "file", path: NodeURL.fileURLToPath(url) };
    } catch {
      return { type: "url", url };
    }
  }
  return { type: "url", url };
}

function visibleAttachment(part: Part): ProviderHistoryAttachment | undefined {
  if (part.type !== "file") return undefined;
  const type = part.mime.startsWith("image/")
    ? "image"
    : part.mime.startsWith("audio/")
      ? "audio"
      : undefined;
  if (type === undefined) return undefined;
  return {
    type,
    nativeAttachmentId: part.id,
    name: part.filename?.trim() || `${type}-${part.id}`,
    mimeType: part.mime,
    content: attachmentContent(part.url),
  };
}

function messageCandidate(entry: { readonly info: Message; readonly parts: ReadonlyArray<Part> }) {
  const texts = entry.parts
    .filter(
      (part): part is Extract<Part, { readonly type: "text" }> =>
        part.type === "text" && part.synthetic !== true && part.ignored !== true,
    )
    .map((part) => part.text);
  const attachments = entry.parts.flatMap((part) => {
    const attachment = visibleAttachment(part);
    return attachment === undefined ? [] : [attachment];
  });
  const createdAt = isoFromEpochMillis(entry.info.time.created);
  const completedAt =
    entry.info.role === "assistant" ? isoFromEpochMillis(entry.info.time.completed) : undefined;
  return {
    kind: "message" as const,
    nativeMessageId: entry.info.id,
    role:
      entry.info.role === "assistant" && entry.info.summary === true ? "system" : entry.info.role,
    text: texts.join(""),
    attachments,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(completedAt === undefined ? {} : { updatedAt: completedAt }),
  };
}

function planMarkdown(todos: ReadonlyArray<Todo>): string {
  return todos
    .map((todo) => {
      const completed = todo.status === "completed";
      const suffix =
        todo.status === "in_progress"
          ? " _(in progress)_"
          : todo.status === "cancelled"
            ? " _(cancelled)_"
            : "";
      return `- [${completed ? "x" : " "}] ${todo.content.trim()}${suffix}`;
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

function historyError(input: {
  readonly sourceId: string;
  readonly operation: string;
  readonly sessionId?: string | undefined;
  readonly cause: OpenCodeRuntimeError;
}): ProviderHistorySyncError {
  return new ProviderHistorySyncError({
    sourceId: input.sourceId,
    operation: input.operation,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    detail: openCodeRuntimeErrorDetail(input.cause),
    cause: input.cause,
  });
}

function parseOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function makeOpenCodeHistorySyncAdapter(input: {
  readonly source: ProviderHistorySyncSource;
  readonly gateway: OpenCodeHistoryGateway;
}): ProviderHistorySyncAdapter {
  const knownSessions = new Map<string, Session>();
  const list: ProviderHistorySyncAdapter["list"] = Effect.fn("OpenCodeHistorySync.list")(function* (
    listInput: ProviderHistoryListInput,
  ) {
    const start = parseOffsetCursor(listInput.cursor);
    const native = yield* input.gateway
      .list({
        ...(listInput.query === undefined ? {} : { query: listInput.query }),
        start,
        limit: listInput.limit,
      })
      .pipe(
        Effect.mapError((cause) =>
          historyError({ sourceId: input.source.sourceId, operation: "list", cause }),
        ),
      );
    for (const session of native.sessions) knownSessions.set(session.id, session);
    const items = native.sessions
      .filter((session) => session.parentID === undefined)
      .filter((session) => listInput.includeArchived || session.time.archived === undefined)
      .filter((session) => matchesSessionQuery(session, listInput.query))
      .map((session) => summarizeSession(session, native.statuses));
    const latestUpdatedAt = items.reduce<string | undefined>(
      (latest, item) => (latest === undefined || item.updatedAt > latest ? item.updatedAt : latest),
      undefined,
    );
    return {
      items,
      ...(native.sessions.length < listInput.limit
        ? {}
        : { nextCursor: String(start + native.sessions.length) }),
      ...(latestUpdatedAt === undefined ? {} : { latestUpdatedAt }),
    };
  });

  const read: ProviderHistorySyncAdapter["read"] = Effect.fn("OpenCodeHistorySync.read")(
    function* ({ sessionId }) {
      const native = yield* input.gateway
        .read({ sessionId, cwd: knownSessions.get(sessionId)?.directory })
        .pipe(
          Effect.mapError((cause) =>
            historyError({
              sourceId: input.source.sourceId,
              operation: "read",
              sessionId,
              cause,
            }),
          ),
        );
      const session = native.session;
      knownSessions.set(sessionId, session);
      const messages = native.messages;
      const todos = native.todos;
      /* The OpenCode todo endpoint is optional across server versions. */
      const markdown = planMarkdown(todos);
      const updatedAt = isoFromEpochMillis(session.time.updated) ?? UNKNOWN_UPDATED_AT;
      const items = normalizeVisibleProviderHistoryTranscript([
        ...messages.map(messageCandidate),
        ...(markdown.length === 0
          ? []
          : [
              {
                kind: "plan" as const,
                nativePlanId: `${sessionId}:plan:${stableTextHash(markdown)}`,
                markdown,
                updatedAt,
              },
            ]),
      ]);
      const model = openCodeModel(session);
      return {
        sessionId,
        items,
        ...(session.directory.trim() ? { cwd: session.directory } : {}),
        ...(model === null ? {} : { model }),
        updatedAt,
      };
    },
  );

  return {
    list,
    read,
    resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { sessionId } }),
    checkActivity: Effect.fn("OpenCodeHistorySync.checkActivity")(function* ({ sessionId }) {
      const status = yield* input.gateway
        .status({ sessionId, cwd: knownSessions.get(sessionId)?.directory })
        .pipe(
          Effect.mapError((cause) =>
            historyError({
              sourceId: input.source.sourceId,
              operation: "status",
              sessionId,
              cause,
            }),
          ),
        );
      return activityFromStatus(status);
    }),
  };
}

/*
 * Runtime gateway methods deliberately keep one scoped OpenCode connection per
 * public history operation. A local provider therefore starts at most one
 * short-lived server for list, read, or status rather than one per endpoint.
 */
interface OpenCodeRuntimeHistoryGatewayInput {
  readonly runtime: OpenCodeRuntime["Service"];
  readonly settings: Pick<OpenCodeSettings, "binaryPath" | "serverPassword" | "serverUrl">;
  readonly environment: NodeJS.ProcessEnv;
  readonly defaultCwd: string;
}

function makeOpenCodeRuntimeHistoryGateway(
  input: OpenCodeRuntimeHistoryGatewayInput,
): OpenCodeHistoryGateway {
  const withClient = <A>(
    directory: string,
    use: (client: OpencodeClient) => Effect.Effect<A, OpenCodeRuntimeError>,
  ): Effect.Effect<A, OpenCodeRuntimeError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* input.runtime.connectToOpenCodeServer({
          binaryPath: input.settings.binaryPath,
          ...(input.settings.serverUrl ? { serverUrl: input.settings.serverUrl } : {}),
          environment: input.environment,
        });
        const client = input.runtime.createOpenCodeSdkClient({
          baseUrl: connection.url,
          directory,
          ...(input.settings.serverPassword
            ? { serverPassword: input.settings.serverPassword }
            : {}),
        });
        return yield* use(client);
      }),
    );

  return {
    list: ({ query, start, limit }) =>
      withClient(input.defaultCwd, (client) =>
        Effect.all(
          {
            sessions: runOpenCodeSdk("session.list", () =>
              client.session.list({
                roots: true,
                start,
                limit,
                ...(query?.trim() ? { search: query.trim() } : {}),
              }),
            ).pipe(Effect.map((result) => result.data ?? [])),
            statuses: runOpenCodeSdk("session.status", () => client.session.status({})).pipe(
              Effect.map((result) => result.data ?? {}),
              Effect.orElseSucceed((): Readonly<Record<string, SessionStatus>> => ({})),
            ),
          },
          { concurrency: "unbounded" },
        ),
      ),
    read: ({ sessionId, cwd }) =>
      withClient(cwd ?? input.defaultCwd, (client) =>
        Effect.gen(function* () {
          const session = yield* runOpenCodeSdk("session.get", () =>
            client.session.get({
              sessionID: sessionId,
              ...(cwd === undefined ? {} : { directory: cwd }),
            }),
          ).pipe(
            Effect.flatMap((result) =>
              result.data === undefined
                ? Effect.fail(
                    new OpenCodeRuntimeError({
                      operation: "session.get",
                      detail: `OpenCode session '${sessionId}' was not found.`,
                    }),
                  )
                : Effect.succeed(result.data),
            ),
          );
          const [messages, todos] = yield* Effect.all(
            [
              runOpenCodeSdk("session.messages", () =>
                client.session.messages({ sessionID: sessionId, directory: session.directory }),
              ).pipe(Effect.map((result) => result.data ?? [])),
              runOpenCodeSdk("session.todo", () =>
                client.session.todo({ sessionID: sessionId, directory: session.directory }),
              ).pipe(
                Effect.map((result) => result.data ?? []),
                Effect.orElseSucceed((): ReadonlyArray<Todo> => []),
              ),
            ],
            { concurrency: "unbounded" },
          );
          return { session, messages, todos };
        }),
      ),
    status: ({ sessionId, cwd }) =>
      withClient(cwd ?? input.defaultCwd, (client) =>
        runOpenCodeSdk("session.status", () =>
          client.session.status(cwd === undefined ? {} : { directory: cwd }),
        ).pipe(Effect.map((result) => result.data?.[sessionId])),
      ),
  };
}

export function makeOpenCodeHistorySync(input: {
  readonly source: ProviderHistorySyncSource;
  readonly runtime: OpenCodeRuntime["Service"];
  readonly settings: Pick<OpenCodeSettings, "binaryPath" | "serverPassword" | "serverUrl">;
  readonly environment: NodeJS.ProcessEnv;
  readonly defaultCwd: string;
}): ProviderHistorySyncFacet {
  const gateway = makeOpenCodeRuntimeHistoryGateway(input);
  return makeSupportedProviderHistorySync({
    source: input.source,
    adapter: makeOpenCodeHistorySyncAdapter({ source: input.source, gateway }),
  });
}
