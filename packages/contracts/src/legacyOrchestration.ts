import { OrchestrationHarnessSyncState } from "./harnessChatSync.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { OrchestrationMessageContext } from "./composerContext.ts";
import { MessageReplyReference } from "./messageReplies.ts";
import { DeepPlanRun, DeepPlanRunReference } from "./deepPlanning.ts";
import { ThreadEnvMode } from "./environment.ts";
import {
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import {
  RuntimeMode,
  DEFAULT_RUNTIME_MODE,
  ProviderInteractionMode,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "./providerPolicy.ts";
import { ThreadLinkedPullRequest, ThreadPullRequestLink } from "./threadPullRequest.ts";
export const OrchestrationMessageRole = Schema.Literals([
  "user",
  "assistant",
  "system",
  "reasoning",
]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

/** Identifies the source row represented by an immutable inherited history row. */
export const OrchestrationHistoryOrigin = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceId: TrimmedNonEmptyString,
  /** Stable global order across every inherited entity in the frozen prefix. */
  ordinal: NonNegativeInt,
});
export type OrchestrationHistoryOrigin = typeof OrchestrationHistoryOrigin.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  replyTo: Schema.optional(MessageReplyReference),
  replyTopicId: Schema.optional(SubagentId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  context: Schema.optional(OrchestrationMessageContext),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const ThreadForkBoundary = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("message"),
    messageId: MessageId,
  }),
  Schema.Struct({
    kind: Schema.Literal("proposed-plan"),
    planId: OrchestrationProposedPlanId,
  }),
]);
export type ThreadForkBoundary = typeof ThreadForkBoundary.Type;

export const ThreadForkWorkspace = Schema.Struct({
  mode: ThreadEnvMode,
  baseBranch: Schema.NullOr(TrimmedNonEmptyString),
  startFromOrigin: Schema.Boolean,
  runSetupScript: Schema.Boolean,
});
export type ThreadForkWorkspace = typeof ThreadForkWorkspace.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  deepPlan: Schema.optional(DeepPlanRunReference),
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
  deepPlan: Schema.optional(DeepPlanRunReference),
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationTurnAbortPhase = Schema.Literals(["interrupting", "force-stopping"]);
export type OrchestrationTurnAbortPhase = typeof OrchestrationTurnAbortPhase.Type;

export const OrchestrationTurnAbortState = Schema.Struct({
  runtimeSessionId: RuntimeSessionId,
  targetTurnId: Schema.NullOr(TurnId),
  phase: OrchestrationTurnAbortPhase,
  requestedAt: IsoDateTime,
  forceAt: IsoDateTime,
});
export type OrchestrationTurnAbortState = typeof OrchestrationTurnAbortState.Type;

const ProviderForkCursorSchema = Schema.Struct({
  providerThreadId: TrimmedNonEmptyString,
  providerTurnId: TrimmedNonEmptyString,
});

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  runtimeSessionId: Schema.NullOr(RuntimeSessionId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  abortState: Schema.NullOr(OrchestrationTurnAbortState).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  providerForkCursor: Schema.optional(ProviderForkCursorSchema),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  replyTopicId: Schema.optional(SubagentId),
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

// Version changes even when a manual rename keeps the same text.
export const ThreadTitleState = Schema.Struct({
  source: Schema.Literals(["manual", "generated"]),
  version: CommandId,
  needsRefinement: Schema.Boolean,
});
export type ThreadTitleState = typeof ThreadTitleState.Type;

export const ThreadTitleRegeneration = Schema.Struct({
  requestId: CommandId,
  startedAt: IsoDateTime,
});
export type ThreadTitleRegeneration = typeof ThreadTitleRegeneration.Type;

export const OrchestrationSubagentStatus = Schema.Literals([
  "starting",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "error",
  "unavailable",
]);
export type OrchestrationSubagentStatus = typeof OrchestrationSubagentStatus.Type;

export const OrchestrationSubagentProgress = Schema.Struct({
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  detail: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type OrchestrationSubagentProgress = typeof OrchestrationSubagentProgress.Type;

export const OrchestrationSubagentOrigin = Schema.Literals([
  "provider-native",
  "t3-fetch",
  "t3-managed",
]);
export type OrchestrationSubagentOrigin = typeof OrchestrationSubagentOrigin.Type;

export const MessageReplyTopic = Schema.Struct({
  rootMessageId: MessageId,
  replyTo: MessageReplyReference,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspacePath: TrimmedNonEmptyString,
  lastCommandId: Schema.optional(CommandId),
  lastUserMessageId: Schema.optional(MessageId),
});
export type MessageReplyTopic = typeof MessageReplyTopic.Type;

export const OrchestrationSubagentSummary = Schema.Struct({
  id: SubagentId,
  messageReply: Schema.optional(MessageReplyTopic),
  origin: OrchestrationSubagentOrigin.pipe(
    Schema.withDecodingDefault(Effect.succeed("provider-native" as const)),
  ),
  providerInstanceId: Schema.NullOr(ProviderInstanceId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  providerDriver: Schema.NullOr(ProviderDriverKind).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  providerThreadId: TrimmedNonEmptyString,
  parentId: Schema.NullOr(SubagentId),
  path: Schema.NullOr(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString,
  nickname: Schema.NullOr(TrimmedNonEmptyString),
  role: Schema.NullOr(TrimmedNonEmptyString),
  task: Schema.NullOr(TrimmedNonEmptyString),
  model: Schema.NullOr(TrimmedNonEmptyString),
  reasoningEffort: Schema.NullOr(TrimmedNonEmptyString),
  serviceTier: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  depth: NonNegativeInt,
  status: OrchestrationSubagentStatus,
  statusMessage: Schema.NullOr(TrimmedNonEmptyString),
  latestProgress: Schema.NullOr(OrchestrationSubagentProgress),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type OrchestrationSubagentSummary = typeof OrchestrationSubagentSummary.Type;

export const OrchestrationSubagentDetail = Schema.Struct({
  ...OrchestrationSubagentSummary.fields,
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan),
  activities: Schema.Array(OrchestrationThreadActivity),
});
export type OrchestrationSubagentDetail = typeof OrchestrationSubagentDetail.Type;

export const ThreadForkWorkspaceStatus = Schema.Literals(["pending", "ready", "error"]);
export type ThreadForkWorkspaceStatus = typeof ThreadForkWorkspaceStatus.Type;

export const ThreadForkWorkspaceState = Schema.Struct({
  spec: ThreadForkWorkspace,
  status: ThreadForkWorkspaceStatus,
  preparedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
});
export type ThreadForkWorkspaceState = typeof ThreadForkWorkspaceState.Type;

export const ThreadForkHandoffStatus = Schema.Literals(["pending", "completed"]);
export type ThreadForkHandoffStatus = typeof ThreadForkHandoffStatus.Type;

export const ThreadForkHandoffState = Schema.Struct({
  status: ThreadForkHandoffStatus,
  historyInputChars: NonNegativeInt,
  historyAttachmentCount: NonNegativeInt,
  remainingInputChars: NonNegativeInt,
  remainingAttachmentCount: NonNegativeInt,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadForkHandoffState = typeof ThreadForkHandoffState.Type;

export const ThreadForkProvenance = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceTitle: TrimmedNonEmptyString,
  boundary: ThreadForkBoundary,
  forkedAt: IsoDateTime,
});
export type ThreadForkProvenance = typeof ThreadForkProvenance.Type;

export const ThreadForkState = Schema.Struct({
  provenance: ThreadForkProvenance,
  workspace: ThreadForkWorkspaceState,
  handoff: ThreadForkHandoffState,
  providerForkCursor: Schema.optional(ProviderForkCursorSchema),
});
export type ThreadForkState = typeof ThreadForkState.Type;

export const ThreadForkHistoryTurnState = Schema.Literals([
  "pending",
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type ThreadForkHistoryTurnState = typeof ThreadForkHistoryTurnState.Type;

export const ThreadForkHistoryTurn = Schema.Struct({
  turnId: Schema.NullOr(TurnId),
  pendingMessageId: Schema.NullOr(MessageId),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  state: ThreadForkHistoryTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  checkpointTurnCount: Schema.NullOr(NonNegativeInt),
  checkpointRef: Schema.NullOr(CheckpointRef),
  checkpointStatus: Schema.NullOr(OrchestrationCheckpointStatus),
  checkpointFiles: Schema.Array(OrchestrationCheckpointFile),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  providerForkCursor: Schema.optional(ProviderForkCursorSchema),
  historyOrigin: OrchestrationHistoryOrigin,
});
export type ThreadForkHistoryTurn = typeof ThreadForkHistoryTurn.Type;

export const ThreadForkHistoryMessage = Schema.Struct({
  ...OrchestrationMessage.fields,
  historyOrigin: OrchestrationHistoryOrigin,
});
export type ThreadForkHistoryMessage = typeof ThreadForkHistoryMessage.Type;

export const ThreadForkHistoryProposedPlan = Schema.Struct({
  ...OrchestrationProposedPlan.fields,
  historyOrigin: OrchestrationHistoryOrigin,
});
export type ThreadForkHistoryProposedPlan = typeof ThreadForkHistoryProposedPlan.Type;

export const ThreadForkHistoryActivity = Schema.Struct({
  ...OrchestrationThreadActivity.fields,
  historyOrigin: OrchestrationHistoryOrigin,
});
export type ThreadForkHistoryActivity = typeof ThreadForkHistoryActivity.Type;

export const ThreadForkHistorySubagent = Schema.Struct({
  ...OrchestrationSubagentSummary.fields,
  historyOrigin: OrchestrationHistoryOrigin,
});
export type ThreadForkHistorySubagent = typeof ThreadForkHistorySubagent.Type;

export const ThreadForkHistoryCheckpoint = Schema.Struct({
  ...OrchestrationCheckpointSummary.fields,
  historyOrigin: OrchestrationHistoryOrigin,
});
export type ThreadForkHistoryCheckpoint = typeof ThreadForkHistoryCheckpoint.Type;

/** Arrays retain canonical source ordering within each projected entity kind. */
export const ThreadForkHistory = Schema.Struct({
  messages: Schema.Array(ThreadForkHistoryMessage),
  proposedPlans: Schema.Array(ThreadForkHistoryProposedPlan),
  activities: Schema.Array(ThreadForkHistoryActivity),
  subagents: Schema.Array(ThreadForkHistorySubagent),
  turns: Schema.Array(ThreadForkHistoryTurn),
  checkpoints: Schema.Array(ThreadForkHistoryCheckpoint),
});
export type ThreadForkHistory = typeof ThreadForkHistory.Type;

/**
 * Compact public state for a thread linked to provider-native harness history.
 * Stable source/session identifiers stay in the server projection; clients only
 * need enough state to explain sync freshness and guard concurrent continuation.
 */

/**
 * Legacy single-PR link. Still emitted as the thread's derived current pull
 * request (see `@t3tools/shared/threadPullRequests`) so clients from before
 * `pullRequests` keep working independently of their release schedule.
 */
export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  deepPlan: Schema.optional(Schema.NullOr(DeepPlanRun)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  // Optional so payloads from pre-link servers still decode.
  pullRequests: Schema.Array(ThreadPullRequestLink).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  branchPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // When the thread last re-entered the active list (any thread.unsettled).
  // Anchors the active-list sort so an unsettled thread surfaces at the top
  // instead of sinking back to its creation-order slot. Cleared on settle.
  // Optional so payloads from pre-stamp servers still decode.
  unsettledAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Snooze is an overlay on the active lifecycle, not a fourth destination:
  // a snoozed thread stays "active" in the model and is only suppressed from
  // the inbox until snoozedUntil passes (or the thread raises its hand).
  // Optional so payloads from pre-snooze servers still decode.
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Active pinned threads render in the pinned block. Settled and snoozed
  // threads remain in their respective shelves even when pinned.
  // Optional so payloads from pre-pinning servers still decode.
  pinnedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Fractional index for user-arranged pinned order. Keyed threads sort by
  // string comparison ahead of keyless ones (which keep creation order), so
  // servers never need each other's threads to agree on the merged list.
  // Optional so payloads from pre-reorder servers still decode.
  pinOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  // Manual Active placement. Keyless threads retain their creation/re-entry
  // order above the arranged run. Settling clears this slot.
  activeOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  // Set while the user has turned automatic settlement off for this thread.
  // Survives manual settle, un-settle, and activity: only the user clears it.
  // Optional so payloads from older servers still decode.
  autoSettleDisabledAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  // Pending-only state. Optional so older servers remain compatible.
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  titleState: Schema.optional(Schema.NullOr(ThreadTitleState)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  replyMessages: Schema.optional(Schema.Array(OrchestrationMessage)),
  replyActivities: Schema.optional(Schema.Array(OrchestrationThreadActivity)),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  subagents: Schema.Array(OrchestrationSubagentSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
  harnessSync: Schema.optional(Schema.NullOr(OrchestrationHarnessSyncState)),
  fork: Schema.optional(ThreadForkState),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;
