import { ProjectId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import {
  ThreadContextError,
  ThreadContextToolkit,
  type ThreadContextInput,
  type ThreadContextMessage,
} from "./tools.ts";

const PAGE_SIZE = 20;
const SCAN_PAGE_SIZE = 100;
const REFERENCE_PAGE_CHARS = 32 * 1024;
const CursorPayload = Schema.Struct({
  version: Schema.Literal(2),
  rootThreadId: ThreadId,
  projectId: ProjectId,
  query: Schema.NullOr(Schema.String),
  beforePosition: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  ref: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
});
type CursorPayload = typeof CursorPayload.Type;
const decodeCursorPayload = Schema.decodeUnknownOption(Schema.fromJsonString(CursorPayload));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeCursor = (payload: CursorPayload) =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");
const decodeCursor = (cursor: string) =>
  Option.getOrUndefined(decodeCursorPayload(Buffer.from(cursor, "base64url").toString("utf8")));
const unavailable = () =>
  new ThreadContextError({
    reason: "projection_unavailable",
    detail: "Thread context could not read the orchestration projection.",
  });
const invalidCursor = (detail: string) =>
  new ThreadContextError({ reason: "invalid_cursor", detail });

export const invokeThreadContext = Effect.fn("ThreadContextToolkit.invoke")(function* (
  input: ThreadContextInput,
) {
  const invocation = yield* McpInvocationContext.requireWorkspaceMcpCapability().pipe(
    Effect.mapError(
      () =>
        new ThreadContextError({
          reason: "thread_not_found",
          detail: "An authenticated workspace thread is required.",
        }),
    ),
  );
  const threads = yield* OrchestratorV2;
  const root = yield* threads
    .getThreadShell(invocation.threadId)
    .pipe(Effect.mapError(unavailable));
  if (root === null)
    return yield* new ThreadContextError({
      reason: "thread_not_found",
      detail: "The authenticated thread is not available.",
    });

  const ancestry = new Set<ThreadId>([root.id]);
  let ancestor = root;
  while (ancestor.forkedFrom?.type === "run" && ancestor.lineage.sideChat !== true) {
    const sourceThreadId = ancestor.forkedFrom.threadId;
    if (ancestry.has(sourceThreadId))
      return yield* new ThreadContextError({
        reason: "ancestry_unavailable",
        detail: "The authenticated thread has cyclic fork ancestry.",
      });
    const source = yield* threads.getThreadShell(sourceThreadId).pipe(Effect.mapError(unavailable));
    if (source === null)
      return yield* new ThreadContextError({
        reason: "ancestry_unavailable",
        detail: "A fork ancestor is not available.",
      });
    if (source.projectId !== root.projectId)
      return yield* new ThreadContextError({
        reason: "cross_project_denied",
        detail: "Thread context cannot cross a project boundary.",
      });
    ancestry.add(sourceThreadId);
    ancestor = source;
  }

  const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === undefined)
    return yield* invalidCursor("The thread context cursor is malformed.");
  if (cursor?.projectId !== undefined && cursor.projectId !== root.projectId)
    return yield* new ThreadContextError({
      reason: "cross_project_denied",
      detail: "The cursor belongs to another project.",
    });
  if (cursor !== undefined && cursor.rootThreadId !== root.id)
    return yield* invalidCursor("The cursor belongs to another thread.");
  const requestedRef = input.ref?.trim();
  const requestedQuery = input.query?.trim() || null;
  if ((requestedRef || cursor?.ref) && input.query !== undefined)
    return yield* invalidCursor("A reference cannot be combined with a lexical query.");
  if (
    cursor !== undefined &&
    ((cursor.ref === undefined && requestedRef !== undefined) ||
      (requestedRef !== undefined && cursor.ref !== requestedRef))
  )
    return yield* invalidCursor("The cursor does not match the requested reference.");
  if (
    cursor !== undefined &&
    input.query !== undefined &&
    cursor.query?.toLowerCase() !== requestedQuery?.toLowerCase()
  )
    return yield* invalidCursor("The cursor does not match the lexical query.");
  const ref = cursor?.ref ?? requestedRef;
  if (ref !== undefined) {
    let content: string | undefined;
    if (ref.startsWith("tool-result:")) {
      const itemId = ref.slice("tool-result:".length);
      if (itemId.length > 0) {
        const page = yield* threads
          .getTimelinePage(root.id, { itemId: TurnItemId.make(itemId), limit: 1, view: "activity" })
          .pipe(Effect.mapError(unavailable));
        const row = page.items[0];
        if (row !== undefined && ancestry.has(row.sourceThreadId)) {
          const item = yield* threads
            .getTurnItem({ threadId: row.sourceThreadId, itemId: row.sourceItemId })
            .pipe(Effect.mapError(unavailable));
          if (item?.type === "dynamic_tool" && item.output !== undefined)
            content = encodeJson(item.output);
        }
      }
    } else if (ref.startsWith("subagent:")) {
      const agentId = ref.slice("subagent:".length);
      let afterPosition = -1;
      let hasMore = true;
      while (hasMore && content === undefined) {
        const page = yield* threads
          .getTimelinePage(root.id, { afterPosition, limit: SCAN_PAGE_SIZE, view: "activity" })
          .pipe(Effect.mapError(unavailable));
        for (const row of page.items) {
          const item = row.item;
          if (
            ancestry.has(row.sourceThreadId) &&
            item.type === "subagent" &&
            item.origin === "app_owned" &&
            item.subagentId === agentId &&
            item.childThreadId !== null
          ) {
            const child = yield* threads
              .getThreadShell(item.childThreadId)
              .pipe(Effect.mapError(unavailable));
            if (
              child?.projectId !== root.projectId ||
              child.lineage.parentThreadId !== row.sourceThreadId
            )
              continue;
            const transcript = yield* threads
              .getThreadRecords(child.id, ["messages"])
              .pipe(Effect.mapError(unavailable));
            content = encodeJson(transcript.messages);
            break;
          }
        }
        afterPosition = page.items.at(-1)?.position ?? afterPosition;
        hasMore = page.hasMore && page.items.length > 0;
      }
    }
    if (content === undefined)
      return yield* new ThreadContextError({
        reason: "reference_not_found",
        detail: "The reference is not available in the authenticated thread.",
      });
    const offset = cursor?.offset ?? 0;
    if (offset > content.length)
      return yield* invalidCursor("The reference cursor is outside the available content.");
    const end = Math.min(content.length, offset + REFERENCE_PAGE_CHARS);
    const hasMore = end < content.length;
    return {
      messages: [],
      query: null,
      reference: {
        ref,
        content: content.slice(offset, end),
        contentType: "application/json" as const,
        totalBytes: Buffer.byteLength(content),
        offset,
      },
      cursor: hasMore
        ? encodeCursor({
            version: 2,
            rootThreadId: root.id,
            projectId: root.projectId,
            query: null,
            ref,
            offset: end,
          })
        : null,
      hasMore,
    };
  }

  const query = cursor?.query ?? requestedQuery;
  const first = yield* threads
    .getTimelinePage(root.id, { limit: 1, view: "activity" })
    .pipe(Effect.mapError(unavailable));
  let beforePosition = Math.min(cursor?.beforePosition ?? first.totalItems, first.totalItems);
  const matches: Array<{ position: number; message: ThreadContextMessage }> = [];
  while (beforePosition > 0 && matches.length <= PAGE_SIZE) {
    const start = Math.max(0, beforePosition - SCAN_PAGE_SIZE);
    const page = yield* threads
      .getTimelinePage(root.id, {
        afterPosition: start - 1,
        limit: beforePosition - start,
        view: "activity",
      })
      .pipe(Effect.mapError(unavailable));
    for (const row of page.items.toReversed()) {
      if (!ancestry.has(row.sourceThreadId))
        return yield* new ThreadContextError({
          reason: "cross_project_denied",
          detail: "Message provenance falls outside the authenticated fork ancestry.",
        });
      const item = row.item;
      if (
        (item.type !== "user_message" && item.type !== "assistant_message") ||
        (item.type === "assistant_message" && item.streaming) ||
        (query !== null && !item.text.toLowerCase().includes(query.toLowerCase()))
      )
        continue;
      matches.push({
        position: row.position,
        message: {
          threadId: row.sourceThreadId,
          messageId: item.messageId,
          role: item.type === "user_message" ? "user" : "assistant",
          text: item.text,
          createdAt: DateTime.formatIso(item.startedAt ?? item.updatedAt),
        },
      });
      if (matches.length > PAGE_SIZE) break;
    }
    beforePosition = start;
  }
  const page = matches.slice(0, PAGE_SIZE);
  const hasMore = matches.length > PAGE_SIZE;
  return {
    messages: page.map((match) => match.message),
    query,
    cursor: hasMore
      ? encodeCursor({
          version: 2,
          rootThreadId: root.id,
          projectId: root.projectId,
          query,
          beforePosition: page.at(-1)!.position,
        })
      : null,
    hasMore,
  };
});

export const ThreadContextToolkitHandlersLive = McpToolAccess.toLayer(ThreadContextToolkit, {
  thread_context: McpToolAccess.readsAsCaller(invokeThreadContext),
});
