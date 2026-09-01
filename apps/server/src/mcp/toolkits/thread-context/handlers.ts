import { MessageId, ProjectId, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ThreadContextError,
  ThreadContextToolkit,
  type ThreadContextInput,
  type ThreadContextMessage,
  type ThreadContextResult,
} from "./tools.ts";

const PAGE_SIZE = 20;
const REFERENCE_PAGE_CHARS = 32 * 1024;

const MessageCursorPayload = Schema.Struct({
  version: Schema.Literal(1),
  rootThreadId: ThreadId,
  projectId: ProjectId,
  query: Schema.NullOr(Schema.String),
  before: Schema.Struct({
    createdAt: Schema.String,
    threadId: ThreadId,
    messageId: MessageId,
  }),
});
const ReferenceCursorPayload = Schema.Struct({
  version: Schema.Literal(1),
  rootThreadId: ThreadId,
  projectId: ProjectId,
  ref: Schema.String,
  offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
const CursorPayload = Schema.Union([MessageCursorPayload, ReferenceCursorPayload]);
type CursorPayload = typeof CursorPayload.Type;
const decodeCursorPayload = Schema.decodeUnknownOption(CursorPayload);
const encodeUnknownJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function decodeCursor(cursor: string): CursorPayload | undefined {
  try {
    return Option.getOrUndefined(
      decodeCursorPayload(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))),
    );
  } catch {
    return undefined;
  }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

type MessageKey = Pick<ThreadContextMessage, "createdAt" | "messageId" | "threadId">;

function compareMessages(left: MessageKey, right: MessageKey): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    String(left.threadId).localeCompare(String(right.threadId)) ||
    String(left.messageId).localeCompare(String(right.messageId))
  );
}

const projectionError = () =>
  new ThreadContextError({
    reason: "projection_unavailable",
    detail: "Thread context could not read the orchestration projection.",
  });

export const invokeThreadContext = Effect.fn("ThreadContextToolkit.invoke")(function* (
  input: ThreadContextInput,
): Effect.fn.Return<
  ThreadContextResult,
  ThreadContextError,
  McpInvocationContext.McpInvocationContext | ProjectionSnapshotQuery.ProjectionSnapshotQuery
> {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const rootOption = yield* projections
    .getThreadDetailById(invocation.threadId)
    .pipe(Effect.mapError(projectionError));
  if (Option.isNone(rootOption)) {
    return yield* new ThreadContextError({
      reason: "thread_not_found",
      detail: "The authenticated thread is not available.",
    });
  }

  const root = rootOption.value;
  const ancestry = new Set<ThreadId>([root.id]);
  let fork = root.fork;
  while (fork !== undefined) {
    const sourceThreadId = fork.provenance.sourceThreadId;
    if (ancestry.has(sourceThreadId)) {
      return yield* new ThreadContextError({
        reason: "ancestry_unavailable",
        detail: "The authenticated thread has a cyclic fork ancestry.",
      });
    }
    const sourceOption = yield* projections
      .getThreadShellById(sourceThreadId)
      .pipe(Effect.mapError(projectionError));
    if (Option.isNone(sourceOption)) {
      return yield* new ThreadContextError({
        reason: "ancestry_unavailable",
        detail: "A fork ancestor is not available.",
      });
    }
    if (sourceOption.value.projectId !== root.projectId) {
      return yield* new ThreadContextError({
        reason: "cross_project_denied",
        detail: "Thread context cannot cross a project boundary.",
      });
    }
    ancestry.add(sourceThreadId);
    fork = sourceOption.value.fork;
  }

  for (const message of root.messages) {
    if (message.historyOrigin && !ancestry.has(message.historyOrigin.sourceThreadId)) {
      return yield* new ThreadContextError({
        reason: "cross_project_denied",
        detail: "Inherited message provenance falls outside the authenticated fork ancestry.",
      });
    }
  }

  const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === undefined) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "The thread context cursor is malformed.",
    });
  }
  if (cursor && cursor.projectId !== root.projectId) {
    return yield* new ThreadContextError({
      reason: "cross_project_denied",
      detail: "The thread context cursor belongs to another project.",
    });
  }
  if (cursor && cursor.rootThreadId !== root.id) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "The thread context cursor belongs to another thread.",
    });
  }
  const messageCursor = cursor && "before" in cursor ? cursor : undefined;
  const referenceCursor = cursor && "ref" in cursor ? cursor : undefined;
  const requestedQuery = input.query?.trim() || null;
  const requestedRef = input.ref?.trim();
  if (requestedRef && input.query !== undefined) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "A thread context request cannot combine a lexical query with a reference.",
    });
  }
  if (messageCursor && requestedRef) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "The thread context cursor is for message retrieval, not a reference.",
    });
  }
  if (referenceCursor && input.query !== undefined) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "The thread context cursor is for a reference, not a lexical query.",
    });
  }
  if (referenceCursor && requestedRef && referenceCursor.ref !== requestedRef) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "The thread context cursor does not match the requested reference.",
    });
  }

  const ref = referenceCursor?.ref ?? requestedRef;
  if (ref) {
    let content: string | undefined;
    if (ref.startsWith("tool-result:")) {
      const itemId = ref.slice("tool-result:".length);
      const activity = itemId
        ? root.activities.find((candidate) => {
            if (candidate.kind !== "tool.completed") return false;
            if (candidate.historyOrigin && !ancestry.has(candidate.historyOrigin.sourceThreadId)) {
              return false;
            }
            const payload = asRecord(candidate.payload);
            return payload.itemId === itemId && Object.hasOwn(payload, "canonicalPayload");
          })
        : undefined;
      const payload = activity ? asRecord(activity.payload) : undefined;
      if (payload) content = encodeUnknownJson(payload.canonicalPayload);
    } else if (ref.startsWith("subagent:")) {
      const agentId = ref.slice("subagent:".length);
      if (agentId) {
        const detail = yield* projections
          .getSubagentDetailById(root.id, SubagentId.make(agentId))
          .pipe(Effect.mapError(projectionError));
        if (
          Option.isSome(detail) &&
          detail.value.origin === "t3-managed" &&
          (detail.value.historyOrigin === undefined ||
            ancestry.has(detail.value.historyOrigin.sourceThreadId))
        ) {
          content = encodeUnknownJson(detail.value.messages);
        }
      }
    }
    if (content === undefined) {
      return yield* new ThreadContextError({
        reason: "reference_not_found",
        detail: "The reference is not available in the authenticated thread.",
      });
    }
    const offset = referenceCursor?.offset ?? 0;
    if (offset > content.length) {
      return yield* new ThreadContextError({
        reason: "invalid_cursor",
        detail: "The thread context reference cursor is outside the available content.",
      });
    }
    const end = Math.min(content.length, offset + REFERENCE_PAGE_CHARS);
    const hasMore = end < content.length;
    return {
      messages: [],
      query: null,
      reference: {
        ref,
        content: content.slice(offset, end),
        contentType: "application/json",
        totalBytes: Buffer.byteLength(content),
        offset,
      },
      cursor: hasMore
        ? encodeCursor({
            version: 1,
            rootThreadId: root.id,
            projectId: root.projectId,
            ref,
            offset: end,
          })
        : null,
      hasMore,
    };
  }

  if (
    messageCursor &&
    input.query !== undefined &&
    requestedQuery?.toLowerCase() !== messageCursor.query?.toLowerCase()
  ) {
    return yield* new ThreadContextError({
      reason: "invalid_cursor",
      detail: "The thread context cursor does not match the lexical query.",
    });
  }

  const query = messageCursor?.query ?? requestedQuery;
  const lexicalQuery = query?.toLowerCase();
  const messages = root.messages
    .filter(
      (message) =>
        !message.streaming &&
        message.role !== "system" &&
        (lexicalQuery === undefined || message.text.toLowerCase().includes(lexicalQuery)),
    )
    .map(
      (message): ThreadContextMessage => ({
        threadId: message.historyOrigin?.sourceThreadId ?? root.id,
        messageId: MessageId.make(message.historyOrigin?.sourceId ?? message.id),
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      }),
    )
    .filter(
      (message) =>
        messageCursor === undefined || compareMessages(message, messageCursor.before) < 0,
    )
    .toSorted((left, right) => compareMessages(right, left));
  const page = messages.slice(0, PAGE_SIZE);
  const hasMore = messages.length > PAGE_SIZE;
  const last = page.at(-1);

  return {
    messages: page,
    query,
    cursor:
      hasMore && last
        ? encodeCursor({
            version: 1,
            rootThreadId: root.id,
            projectId: root.projectId,
            query,
            before: {
              createdAt: last.createdAt,
              threadId: last.threadId,
              messageId: last.messageId,
            },
          })
        : null,
    hasMore,
  };
});

export const ThreadContextToolkitHandlersLive = ThreadContextToolkit.toLayer({
  thread_context: invokeThreadContext,
});
