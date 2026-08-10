import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

export const PROJECT_AGENT_MAX_SUMMARY_CHARS = 300;
export const PROJECT_AGENT_MAX_PATH_CHARS = 512;
export const PROJECT_AGENT_MAX_TOPIC_CHARS = 160;
export const PROJECT_AGENT_MAX_CLAIMS = 16;
export const PROJECT_AGENT_MAX_MESSAGE_CHARS = 2_000;
export const PROJECT_AGENT_MAX_ACTIVITY_PREVIEW_CHARS = 240;
export const PROJECT_AGENT_MAX_PEERS = 32;
export const PROJECT_AGENT_MAX_INBOX_MESSAGES = 50;
export const PROJECT_AGENT_DEFAULT_INBOX_MESSAGES = 20;
export const PROJECT_AGENT_MESSAGE_HISTORY_LIMIT = 2_000;

export const ProjectAgentSummary = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_AGENT_MAX_SUMMARY_CHARS),
);
const ProjectAgentPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_AGENT_MAX_PATH_CHARS),
);
const ProjectAgentTopic = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_AGENT_MAX_TOPIC_CHARS),
);

export const ProjectAgentClaimInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("path"),
    path: ProjectAgentPath,
  }),
  Schema.Struct({
    kind: Schema.Literal("topic"),
    topic: ProjectAgentTopic,
  }),
]);
export type ProjectAgentClaimInput = typeof ProjectAgentClaimInput.Type;

// Claims are normalized before persistence. They intentionally share the
// transport shape so callers never need to translate between input and lease
// representations.
export const ProjectAgentClaim = ProjectAgentClaimInput;
export type ProjectAgentClaim = typeof ProjectAgentClaim.Type;

export const ProjectAgentLease = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  turnId: TurnId,
  summary: ProjectAgentSummary,
  claims: Schema.Array(ProjectAgentClaim).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PROJECT_AGENT_MAX_CLAIMS),
  ),
  updatedAt: IsoDateTime,
});
export type ProjectAgentLease = typeof ProjectAgentLease.Type;

export const ProjectAgentClaimSetInput = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("set"),
    summary: ProjectAgentSummary,
    claims: Schema.Array(ProjectAgentClaimInput).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(PROJECT_AGENT_MAX_CLAIMS),
    ),
  }),
  Schema.Struct({ action: Schema.Literal("release") }),
]);
export type ProjectAgentClaimSetInput = typeof ProjectAgentClaimSetInput.Type;

export const ProjectAgentClaimConflict = Schema.Struct({
  threadId: ThreadId,
  threadTitle: TrimmedNonEmptyString,
  requested: ProjectAgentClaim,
  existing: ProjectAgentClaim,
  summary: ProjectAgentSummary,
});
export type ProjectAgentClaimConflict = typeof ProjectAgentClaimConflict.Type;

export const ProjectAgentClaimSetResult = Schema.Union([
  Schema.Struct({ accepted: Schema.Literal(true), lease: Schema.NullOr(ProjectAgentLease) }),
  Schema.Struct({
    accepted: Schema.Literal(false),
    conflicts: Schema.Array(ProjectAgentClaimConflict).check(Schema.isMinLength(1)),
  }),
]);
export type ProjectAgentClaimSetResult = typeof ProjectAgentClaimSetResult.Type;

export const ProjectAgentPhase = Schema.Literals(["starting", "working", "waiting", "offline"]);
export type ProjectAgentPhase = typeof ProjectAgentPhase.Type;

export const ProjectAgentPeer = Schema.Struct({
  threadId: ThreadId,
  self: Schema.Boolean,
  phase: ProjectAgentPhase,
  title: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  summary: Schema.NullOr(ProjectAgentSummary),
  claims: Schema.Array(ProjectAgentClaim),
  unreadCount: NonNegativeInt,
});
export type ProjectAgentPeer = typeof ProjectAgentPeer.Type;

export const ProjectAgentListInput = Schema.Struct({});
export type ProjectAgentListInput = typeof ProjectAgentListInput.Type;

export const ProjectAgentListResult = Schema.Struct({
  peers: Schema.Array(ProjectAgentPeer).check(Schema.isMaxLength(PROJECT_AGENT_MAX_PEERS)),
  truncated: Schema.Boolean,
});
export type ProjectAgentListResult = typeof ProjectAgentListResult.Type;

export const ProjectAgentMessageKind = Schema.Literals(["info", "request", "blocker", "response"]);
export type ProjectAgentMessageKind = typeof ProjectAgentMessageKind.Type;

export const ProjectAgentMessageTarget = Schema.Union([
  Schema.Struct({ threadId: ThreadId }),
  Schema.Struct({ broadcast: Schema.Literal(true) }),
]);
export type ProjectAgentMessageTarget = typeof ProjectAgentMessageTarget.Type;

export const ProjectAgentMessageBody = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_AGENT_MAX_MESSAGE_CHARS),
);

export const ProjectAgentMessageSendInput = Schema.Struct({
  target: ProjectAgentMessageTarget,
  kind: ProjectAgentMessageKind,
  body: ProjectAgentMessageBody,
});
export type ProjectAgentMessageSendInput = typeof ProjectAgentMessageSendInput.Type;

export const ProjectAgentMessageId = TrimmedNonEmptyString.pipe(
  Schema.brand("ProjectAgentMessageId"),
);
export type ProjectAgentMessageId = typeof ProjectAgentMessageId.Type;

export const ProjectAgentMessage = Schema.Struct({
  sequence: NonNegativeInt,
  messageId: ProjectAgentMessageId,
  projectId: ProjectId,
  senderThreadId: ThreadId,
  recipientThreadId: ThreadId,
  kind: ProjectAgentMessageKind,
  body: ProjectAgentMessageBody,
  createdAt: IsoDateTime,
});
export type ProjectAgentMessage = typeof ProjectAgentMessage.Type;

export const ProjectAgentMessageSendResult = Schema.Struct({
  messageId: ProjectAgentMessageId,
  recipientThreadIds: Schema.Array(ThreadId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PROJECT_AGENT_MAX_PEERS),
  ),
  createdAt: IsoDateTime,
});
export type ProjectAgentMessageSendResult = typeof ProjectAgentMessageSendResult.Type;

export const ProjectAgentInboxInput = Schema.Struct({
  acknowledgeThrough: Schema.optional(NonNegativeInt),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_AGENT_MAX_INBOX_MESSAGES)).pipe(
    Schema.withDecodingDefault(Effect.succeed(PROJECT_AGENT_DEFAULT_INBOX_MESSAGES)),
  ),
});
export type ProjectAgentInboxInput = typeof ProjectAgentInboxInput.Type;

export const ProjectAgentInboxResult = Schema.Struct({
  messages: Schema.Array(ProjectAgentMessage),
  cursor: NonNegativeInt,
  nextAcknowledgeThrough: NonNegativeInt,
  hasMore: Schema.Boolean,
  historyTruncated: Schema.Boolean,
});
export type ProjectAgentInboxResult = typeof ProjectAgentInboxResult.Type;

export const ProjectAgentCoordinationUnavailableReason = Schema.Literals([
  "credential_not_authorized",
  "projection_unavailable",
  "thread_unavailable",
  "project_unavailable",
  "target_unavailable",
  "self_target",
  "no_active_recipients",
]);
export type ProjectAgentCoordinationUnavailableReason =
  typeof ProjectAgentCoordinationUnavailableReason.Type;

export class ProjectAgentCoordinationUnavailableError extends Schema.TaggedErrorClass<ProjectAgentCoordinationUnavailableError>()(
  "ProjectAgentCoordinationUnavailableError",
  {
    reason: ProjectAgentCoordinationUnavailableReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Project agent coordination is unavailable.";
  }
}

export class ProjectAgentCoordinationOperationError extends Schema.TaggedErrorClass<ProjectAgentCoordinationOperationError>()(
  "ProjectAgentCoordinationOperationError",
  {
    operation: Schema.Literals(["list", "claim", "send", "inbox"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Project agent coordination failed.";
  }
}

export const ProjectAgentCoordinationError = Schema.Union([
  ProjectAgentCoordinationUnavailableError,
  ProjectAgentCoordinationOperationError,
]);
export type ProjectAgentCoordinationError = typeof ProjectAgentCoordinationError.Type;
