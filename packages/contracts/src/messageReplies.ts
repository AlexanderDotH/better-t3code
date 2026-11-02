import { ThreadEnvMode } from "./environment.ts";
import * as Schema from "effect/Schema";

import { MessageId, PlanId, SubagentId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Captured when replying so later edits cannot change the quoted context. */
export const MessageReplyReference = Schema.Struct({
  messageId: MessageId,
  replyTopicId: Schema.optional(SubagentId),
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  authorLabel: Schema.optional(TrimmedNonEmptyString),
});
export type MessageReplyReference = typeof MessageReplyReference.Type;

export const ThreadForkBoundary = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("message"), messageId: MessageId }),
  Schema.Struct({ kind: Schema.Literal("proposed-plan"), planId: PlanId }),
]);
export type ThreadForkBoundary = typeof ThreadForkBoundary.Type;

export const ThreadForkWorkspace = Schema.Struct({
  mode: ThreadEnvMode,
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  startFromOrigin: Schema.Boolean,
  runSetupScript: Schema.Boolean,
});
export type ThreadForkWorkspace = typeof ThreadForkWorkspace.Type;
