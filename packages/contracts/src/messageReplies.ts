import * as Schema from "effect/Schema";

import { MessageId, SubagentId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Captured when replying so later edits cannot change the quoted context. */
export const MessageReplyReference = Schema.Struct({
  messageId: MessageId,
  replyTopicId: Schema.optional(SubagentId),
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  authorLabel: Schema.optional(TrimmedNonEmptyString),
});
export type MessageReplyReference = typeof MessageReplyReference.Type;
