import { IsoDateTime, MessageId, OrchestrationMessageRole, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";

const BoundedQuery = Schema.String.check(Schema.isMaxLength(1_000));
const BoundedCursor = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4_096));
const BoundedReference = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1_024));

export const ThreadContextInput = Schema.Struct({
  query: Schema.optionalKey(BoundedQuery),
  ref: Schema.optionalKey(BoundedReference),
  cursor: Schema.optionalKey(BoundedCursor),
});
export type ThreadContextInput = typeof ThreadContextInput.Type;

export const ThreadContextMessage = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type ThreadContextMessage = typeof ThreadContextMessage.Type;

export const ThreadContextResult = Schema.Struct({
  messages: Schema.Array(ThreadContextMessage),
  query: Schema.NullOr(Schema.String),
  reference: Schema.optionalKey(
    Schema.Struct({
      ref: BoundedReference,
      content: Schema.String,
      contentType: Schema.Literal("application/json"),
      totalBytes: Schema.Number,
      offset: Schema.Number,
    }),
  ),
  cursor: Schema.NullOr(BoundedCursor),
  hasMore: Schema.Boolean,
});
export type ThreadContextResult = typeof ThreadContextResult.Type;

export class ThreadContextError extends Schema.TaggedErrorClass<ThreadContextError>()(
  "ThreadContextError",
  {
    reason: Schema.Literals([
      "thread_not_found",
      "ancestry_unavailable",
      "cross_project_denied",
      "invalid_cursor",
      "reference_not_found",
      "projection_unavailable",
    ]),
    detail: Schema.String,
  },
) {}

export const ThreadContextTool = Tool.make("thread_context", {
  description:
    "Retrieve exact completed messages or a paginated tool-result/subagent reference from this authenticated thread. Message results include same-project frozen fork ancestry, are newest-first, and support a case-insensitive lexical query. References never carry caller-selected project or thread scope.",
  parameters: ThreadContextInput,
  success: ThreadContextResult,
  failure: ThreadContextError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ],
})
  .annotate(Tool.Title, "Retrieve exact thread context")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadContextToolkit = Toolkit.make(ThreadContextTool);
