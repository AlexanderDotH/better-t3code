import * as NodeURL from "node:url";

import {
  AbsolutePath,
  Session,
  type OpenCodeClient,
  type SessionMessage,
} from "@opencode/client/effect";
import { SessionsCursor } from "@opencode/protocol/groups/session";
import {
  ProviderHistorySyncError,
  type ProviderHistoryAttachment,
  type ProviderHistorySyncAdapter,
  type ProviderHistorySyncSource,
} from "@t3tools/provider-core/server/ProviderHistorySync";
import { normalizeVisibleProviderHistoryTranscript } from "@t3tools/provider-core/server/historyTranscript";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { OpenCode2Server } from "./OpenCode2Server.ts";

const HISTORY_REQUEST_TIMEOUT = "20 seconds";
const SESSION_PAGE_SIZE = 200;
const MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGES = 100;
const decodeSessionCursor = Schema.decodeEffect(SessionsCursor);
const decodeSessionId = Schema.decodeEffect(Session.ID);
const decodeDirectory = Schema.decodeEffect(AbsolutePath);

class OpenCode2HistoryProtocolError extends Schema.TaggedError<OpenCode2HistoryProtocolError>()(
  "OpenCode2HistoryProtocolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
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

function visibleAttachment(input: {
  readonly nativeAttachmentId: string;
  readonly mime: string;
  readonly name?: string | undefined;
  readonly url: string;
}): ReadonlyArray<ProviderHistoryAttachment> {
  const type = input.mime.startsWith("image/")
    ? "image"
    : input.mime.startsWith("audio/")
      ? "audio"
      : undefined;
  return type === undefined
    ? []
    : [
        {
          type,
          nativeAttachmentId: input.nativeAttachmentId,
          name: input.name?.trim() || `${type}-${input.nativeAttachmentId}`,
          mimeType: input.mime,
          content: attachmentContent(input.url),
        },
      ];
}

function visibleAttachments(message: SessionMessage.User | SessionMessage.Assistant) {
  if (message.type === "user") {
    return (message.files ?? []).flatMap((file, index) =>
      visibleAttachment({
        ...file,
        nativeAttachmentId: `${message.id}:file:${index}`,
        url:
          file.source.type === "uri"
            ? file.source.uri
            : file.data.startsWith("data:")
              ? file.data
              : `data:${file.mime};base64,${file.data}`,
      }),
    );
  }
  return message.content.flatMap((part) => {
    if (
      part.type !== "tool" ||
      (part.state.status !== "completed" && part.state.status !== "error")
    )
      return [];
    return (part.state.content ?? []).flatMap((file, index) =>
      file.type !== "file"
        ? []
        : visibleAttachment({
            ...file,
            nativeAttachmentId: `${message.id}:tool:${part.id}:file:${index}`,
            url: file.uri,
          }),
    );
  });
}

function visibleMessage(message: SessionMessage.Info) {
  if (message.type !== "user" && message.type !== "assistant") return [];
  return [
    {
      kind: "message" as const,
      nativeMessageId: message.id,
      role: message.type,
      text:
        message.type === "user"
          ? message.text
          : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
      attachments: visibleAttachments(message),
      createdAt: DateTime.formatIso(message.time.created),
      ...(message.type !== "assistant" || message.time.completed === undefined
        ? {}
        : { updatedAt: DateTime.formatIso(message.time.completed) }),
    },
  ];
}

function modelOf(session: Session.Info): string | null {
  return session.model === undefined ? null : `${session.model.providerID}/${session.model.id}`;
}

/** Read complete bounded pages; a broken cursor must never import a partial transcript as complete. */
const readMessages = Effect.fn("OpenCode2HistorySync.readMessages")(function* (
  client: OpenCodeClient,
  sessionID: Session.ID,
) {
  const messages: SessionMessage.Info[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const result = yield* client.message.list({
      sessionID,
      order: "asc",
      limit: MESSAGE_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (result.data.length > MESSAGE_PAGE_SIZE) {
      return yield* new OpenCode2HistoryProtocolError({
        detail: "OpenCode exceeded the requested history page size.",
      });
    }
    messages.push(...result.data);
    const next = result.cursor.next;
    if (next === undefined) return messages;
    if (result.data.length === 0 || seenCursors.has(next)) {
      return yield* new OpenCode2HistoryProtocolError({
        detail: "OpenCode returned a non-advancing history cursor.",
      });
    }
    seenCursors.add(next);
    cursor = next;
  }
  return yield* new OpenCode2HistoryProtocolError({
    detail: "OpenCode history exceeds the bounded import size.",
  });
});

export function makeOpenCode2HistorySyncAdapter(input: {
  readonly source: ProviderHistorySyncSource;
  readonly server: OpenCode2Server["Service"];
}): ProviderHistorySyncAdapter {
  const run = <A, E>(
    operation: string,
    sessionId: string | undefined,
    use: (client: OpenCodeClient) => Effect.Effect<A, E>,
  ) =>
    input.server
      .withConnection(({ client }) => use(client))
      .pipe(
        Effect.timeout(HISTORY_REQUEST_TIMEOUT),
        Effect.mapError(
          (cause) =>
            new ProviderHistorySyncError({
              sourceId: input.source.sourceId,
              operation,
              ...(sessionId === undefined ? {} : { sessionId }),
              detail:
                cause instanceof Error ? cause.message : `OpenCode 2 history ${operation} failed.`,
              cause,
            }),
        ),
      );

  return {
    list: (listInput) =>
      run("list", undefined, (client) =>
        Effect.gen(function* () {
          if (!Number.isSafeInteger(listInput.limit) || listInput.limit < 1) {
            return yield* new OpenCode2HistoryProtocolError({
              detail: "History page size must be a positive integer.",
            });
          }
          const limit = Math.min(SESSION_PAGE_SIZE, listInput.limit);
          const cursor =
            listInput.cursor === undefined
              ? undefined
              : yield* decodeSessionCursor(listInput.cursor);
          const directory =
            listInput.cwd === undefined ? undefined : yield* decodeDirectory(listInput.cwd);
          const native = yield* client.session.list({
            limit,
            order: "desc",
            parentID: null,
            ...(directory === undefined ? {} : { directory }),
            ...(listInput.query === undefined ? {} : { search: listInput.query }),
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (native.data.length > limit) {
            return yield* new OpenCode2HistoryProtocolError({
              detail: "OpenCode exceeded the requested session page size.",
            });
          }
          if (native.cursor.next !== undefined && native.cursor.next === cursor) {
            return yield* new OpenCode2HistoryProtocolError({
              detail: "OpenCode returned a non-advancing session cursor.",
            });
          }
          const active = yield* client.session.active();
          const items = native.data
            .filter((session) => session.parentID === undefined)
            .filter((session) => listInput.includeArchived || session.time.archived === undefined)
            .map((session) => ({
              sessionId: session.id,
              title: session.title?.trim() || null,
              preview: null,
              cwd: session.location.directory,
              model: modelOf(session),
              createdAt: DateTime.formatIso(session.time.created),
              updatedAt: DateTime.formatIso(session.time.updated),
              archived: session.time.archived !== undefined,
              isChild: false,
              activity: session.id in active ? ("active" as const) : ("idle" as const),
            }));
          const latestUpdatedAt = items.reduce<string | undefined>(
            (latest, item) =>
              latest === undefined || item.updatedAt > latest ? item.updatedAt : latest,
            undefined,
          );
          return {
            items,
            ...(native.cursor.next === undefined ? {} : { nextCursor: native.cursor.next }),
            ...(latestUpdatedAt === undefined ? {} : { latestUpdatedAt }),
          };
        }),
      ),
    read: ({ sessionId }) =>
      run("read", sessionId, (client) =>
        Effect.gen(function* () {
          const sessionID = yield* decodeSessionId(sessionId);
          const session = yield* client.session.get({ sessionID });
          if (session.id !== sessionId) {
            return yield* new OpenCode2HistoryProtocolError({
              detail: "OpenCode returned a different history session.",
            });
          }
          const messages = yield* readMessages(client, sessionID);
          const model = modelOf(session);
          return {
            sessionId: session.id,
            items: normalizeVisibleProviderHistoryTranscript(messages.flatMap(visibleMessage)),
            cwd: session.location.directory,
            ...(model === null ? {} : { model }),
            updatedAt: DateTime.formatIso(session.time.updated),
          };
        }),
      ),
    resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { sessionId } }),
    checkActivity: ({ sessionId }) =>
      run("status", sessionId, (client) =>
        client.session
          .active()
          .pipe(Effect.map((active) => (sessionId in active ? "active" : "idle"))),
      ),
  };
}
