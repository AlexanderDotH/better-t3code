import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity, ThreadEnvMode } from "./environment.ts";
import {
  HarnessChatActivity,
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
} from "./harnessChatSync.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  ClientSurface,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  PROJECT_AGENT_MAX_CLAIMS,
  PROJECT_AGENT_MAX_PEERS,
  ProjectAgentClaim,
  ProjectAgentLease,
  ProjectAgentMessageBody,
  ProjectAgentMessageId,
  ProjectAgentMessageKind,
  ProjectAgentSummary,
} from "./projectAgentCoordination.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getWorkflowScript: "orchestration.getWorkflowScript",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  searchThreads: "orchestration.searchThreads",
  exportThreadTranscript: "orchestration.exportThreadTranscript",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  subscribeSubagent: "orchestration.subscribeSubagent",
} as const;

// Current clients opt into bounded pages. Omitting the field remains the
// mixed-version full-snapshot request used by pre-pagination clients.
export const ORCHESTRATION_MAX_THREAD_TURN_LIMIT = 150;
const OrchestrationThreadTurnLimit = PositiveInt.check(
  Schema.isLessThanOrEqualTo(ORCHESTRATION_MAX_THREAD_TURN_LIMIT),
);

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "acceptAlways",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderApprovalOption = Schema.Struct({
  decision: ProviderApprovalDecision,
  label: TrimmedNonEmptyString,
});
export type ProviderApprovalOption = typeof ProviderApprovalOption.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Persisted provider-history audio is display-only; composer uploads remain image-only. */
export const CHAT_ATTACHMENT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const PROVIDER_SEND_TURN_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPE_SET = new Set<string>(
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
);

/** Whether a pasted or picked image mime type can be sent on a provider turn. */
export function isProviderSendTurnSupportedImageMimeType(mimeType: string): boolean {
  return PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPE_SET.has(mimeType.toLowerCase());
}
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

export const ChatAudioAttachment = Schema.Struct({
  type: Schema.Literal("audio"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^audio\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(CHAT_ATTACHMENT_MAX_AUDIO_BYTES)),
});
export type ChatAudioAttachment = typeof ChatAudioAttachment.Type;

export const ChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sizeBytes: NonNegativeInt.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES),
  ),
});
export type ChatFileAttachment = typeof ChatFileAttachment.Type;

/**
 * Catch-all for attachment types this build does not know. Attachments ride on
 * persisted events and thread streams, so a newer server or client must be able
 * to introduce a type without making older readers fail to decode the whole
 * message. Decoders keep the shared base fields; consumers skip these or render
 * them as unsupported. Mirrors how `OrchestrationThreadActivity` keeps `kind`
 * open. The known discriminators are excluded so a malformed image or file
 * attachment fails its own schema instead of sliding through here with its
 * size and mime constraints unchecked.
 */
export const ChatUnknownAttachment = Schema.Struct({
  type: TrimmedNonEmptyString.check(
    Schema.isMaxLength(50),
    Schema.isPattern(/^(?!(?:image|file|audio)$)/),
  ),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sizeBytes: NonNegativeInt,
});
export type ChatUnknownAttachment = typeof ChatUnknownAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatAudioAttachment,
  ChatFileAttachment,
  ChatUnknownAttachment,
]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;
const ClientSendChatAttachment = Schema.Union([
  UploadChatImageAttachment,
  ChatImageAttachment,
  ChatFileAttachment,
]);

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
  /**
   * URL to open in the in-app browser preview when this script runs (or
   * when the user explicitly requests a preview). Optional; only honored on
   * the desktop build.
   */
  previewUrl: Schema.optional(TrimmedNonEmptyString),
  /**
   * When true, automatically open the preview panel pointed at `previewUrl`
   * the moment this script starts. Ignored without `previewUrl` or on web.
   */
  autoOpenPreview: Schema.optional(Schema.Boolean),
});
export type ProjectScript = typeof ProjectScript.Type;

export const ProjectFaviconPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(1024),
  Schema.isPattern(/\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i),
);
export type ProjectFaviconPath = typeof ProjectFaviconPath.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  // Per-project override for where new threads start. Null/absent means
  // "no override": clients fall back to t3.json, then the global setting.
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  checkpointsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  // Optional on the wire so cached snapshots from older servers still decode.
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.Array(ProjectScript),
  coordinationClaims: Schema.Array(ProjectAgentLease).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
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
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
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

export const OrchestrationSubagentSummary = Schema.Struct({
  id: SubagentId,
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
export const OrchestrationHarnessSyncState = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  providerLabel: TrimmedNonEmptyString,
  activity: HarnessChatActivity,
  sourceUpdatedAt: Schema.NullOr(IsoDateTime),
  lastSyncedAt: IsoDateTime,
});
export type OrchestrationHarnessSyncState = typeof OrchestrationHarnessSyncState.Type;

export const ThreadLinkedPullRequest = Schema.Struct({
  projectId: ProjectId,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
});
export type ThreadLinkedPullRequest = typeof ThreadLinkedPullRequest.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
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
  // Pending-only state. Optional so older servers remain compatible.
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
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

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  checkpointsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  // Optional on the wire so cached snapshots from older servers still decode.
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // See OrchestrationThread.unsettledAt: last re-entry into the active list.
  unsettledAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedUntil: Schema.optional(Schema.NullOr(IsoDateTime)),
  snoozedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  pinnedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  pinOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
  /**
   * Native background work alive after the turn settles: "working" while
   * subagents/workflows run, "monitoring" when watch loops are the only
   * live work. Optional so old servers/clients interop; absent = none.
   */
  backgroundLiveness: Schema.optional(Schema.NullOr(Schema.Literals(["working", "monitoring"]))),
  /**
   * Current plan step while a turn runs, for the Working indicators
   * (sidebar row, in-chat working line). Cleared when the turn settles —
   * never persists as stale UI. Optional so old servers/clients interop.
   */
  planProgress: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        step: TrimmedNonEmptyString,
        completedSteps: NonNegativeInt,
        totalSteps: NonNegativeInt,
      }),
    ),
  ),
  harnessSync: Schema.optional(Schema.NullOr(OrchestrationHarnessSyncState)),
  fork: Schema.optional(ThreadForkState),
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("synchronized"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeShellInput = Schema.Struct({
  /**
   * When provided, the server skips the initial full shell snapshot and instead
   * replays shell events after this sequence before streaming live events.
   * Clients that already hold a cached (or HTTP-loaded) shell snapshot pass its
   * sequence here so the subscription resumes without re-sending the entire
   * projects/threads list (overlapping events are deduped by sequence on the
   * client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Requests an explicit marker after the subscription has emitted its initial
   * snapshot or catch-up replay and before it begins emitting live events.
   */
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationSubscribeShellInput = typeof OrchestrationSubscribeShellInput.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
  /**
   * When provided, the server skips the initial snapshot frame and instead
   * replays events after this sequence before streaming live events. Clients
   * that load the snapshot over HTTP pass the snapshot's sequence here so the
   * live subscription resumes without a gap (overlapping events are deduped by
   * sequence on the client).
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Requests an explicit marker after the subscription has emitted its initial
   * snapshot or catch-up replay and before it begins emitting live events.
   */
  requestCompletionMarker: Schema.optionalKey(Schema.Boolean),
  /**
   * When provided, the fallback snapshot frame (sent when `afterSequence` is
   * missing or the catch-up gap is too large) is windowed to the last
   * `turnLimit` user-anchored turns and carries `page` metadata. Absent means
   * the fallback snapshot is the full thread, preserving pre-pagination client
   * behavior. Live events are unaffected either way.
   */
  turnLimit: Schema.optionalKey(OrchestrationThreadTurnLimit),
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationSubscribeSubagentInput = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  /**
   * Resumes the filtered subagent stream after the last sequence already held
   * by the client. Cursor frames advance this value across unrelated thread
   * events without sending their payloads.
   */
  afterSequence: Schema.optionalKey(NonNegativeInt),
  /**
   * Windows fallback snapshots to the newest activities. Absent preserves the
   * full-snapshot behavior used by clients predating subagent pagination.
   */
  activityLimit: Schema.optionalKey(PositiveInt),
});
export type OrchestrationSubscribeSubagentInput = typeof OrchestrationSubscribeSubagentInput.Type;

export const OrchestrationExportThreadTranscriptInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationExportThreadTranscriptInput =
  typeof OrchestrationExportThreadTranscriptInput.Type;

export const OrchestrationThreadTranscriptExport = Schema.Struct({
  formatVersion: Schema.Literal(1),
  fileName: TrimmedNonEmptyString,
  mediaType: Schema.Literal("text/markdown"),
  generatedAt: IsoDateTime,
  content: Schema.String,
});
export type OrchestrationThreadTranscriptExport = typeof OrchestrationThreadTranscriptExport.Type;

/**
 * Bounds a thread detail read to a window of recent turns. `turnLimit` counts
 * turns with a user pending message (subagent/fan-out turns between them ride
 * along), so the window always contains the last N user prompts. `beforeCursor`
 * requests the disjoint page of older turns strictly before a previously
 * returned cursor. Requests without a window get the full thread; pagination is
 * strictly opt-in so older clients keep today's behavior on both HTTP and the
 * WebSocket fallback snapshot.
 */
export const OrchestrationThreadDetailWindow = Schema.Struct({
  turnLimit: Schema.optionalKey(OrchestrationThreadTurnLimit),
  beforeCursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export type OrchestrationThreadDetailWindow = typeof OrchestrationThreadDetailWindow.Type;

/**
 * Page metadata for a windowed thread detail read. `beforeCursor` is opaque and
 * exclusive: passing it back returns the adjacent disjoint slice of older
 * turns. `null` means the thread is fully loaded below this page. The
 * `snapshotSequence` mirrors the top-level snapshot sequence so history pages
 * can be sequence-checked against live state before merging.
 */
export const OrchestrationThreadDetailPage = Schema.Struct({
  beforeCursor: Schema.NullOr(TrimmedNonEmptyString),
  hasMore: Schema.Boolean,
  snapshotSequence: NonNegativeInt,
  /**
   * Highest event sequence applied to THIS thread at page read time. The
   * global `snapshotSequence` advances with every thread's events, so a
   * client cannot wait for it via its per-thread subscription; this
   * thread-scoped watermark is reachable. A client merging an older page
   * must first have applied live events up to it — otherwise a streaming
   * turn outside the loaded window could have deltas replayed on top of
   * page content that already includes them, duplicating text.
   */
  threadSequence: Schema.optionalKey(NonNegativeInt),
});
export type OrchestrationThreadDetailPage = typeof OrchestrationThreadDetailPage.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
  // Present only on windowed responses. Absent on full snapshots (and from
  // pre-pagination servers), which clients treat as fully loaded.
  page: Schema.optional(OrchestrationThreadDetailPage),
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

/**
 * Bounds a subagent detail read to a recent activity window. Messages and
 * proposed plans remain complete because activity payloads dominate retained
 * transcript memory on long-running, highly parallel threads.
 */
export const OrchestrationSubagentDetailWindow = Schema.Struct({
  activityLimit: Schema.optionalKey(PositiveInt),
  beforeCursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export type OrchestrationSubagentDetailWindow = typeof OrchestrationSubagentDetailWindow.Type;

export const OrchestrationSubagentDetailPage = Schema.Struct({
  beforeCursor: Schema.NullOr(TrimmedNonEmptyString),
  hasMore: Schema.Boolean,
  snapshotSequence: NonNegativeInt,
  /** Thread-scoped watermark reachable through subagent cursor frames. */
  threadSequence: Schema.optionalKey(NonNegativeInt),
});
export type OrchestrationSubagentDetailPage = typeof OrchestrationSubagentDetailPage.Type;

export const OrchestrationSubagentDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  threadId: ThreadId,
  subagent: OrchestrationSubagentDetail,
  // Present only for opt-in windowed responses. Absent means fully loaded.
  page: Schema.optional(OrchestrationSubagentDetailPage),
});
export type OrchestrationSubagentDetailSnapshot = typeof OrchestrationSubagentDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  // Absent = leave unchanged; null = clear the override.
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  checkpointsEnabled: Schema.optional(Schema.Boolean),
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

export const ThreadForkCommand = Schema.Struct({
  type: Schema.Literal("thread.fork"),
  commandId: CommandId,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  boundary: ThreadForkBoundary,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspace: ThreadForkWorkspace,
  createdAt: IsoDateTime,
});
export type ThreadForkCommand = typeof ThreadForkCommand.Type;

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadSettleCommand = Schema.Struct({
  type: Schema.Literal("thread.settle"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnsettleCommand = Schema.Struct({
  type: Schema.Literal("thread.unsettle"),
  commandId: CommandId,
  threadId: ThreadId,
  // Commands only carry "user": activity un-settles are decided server-side
  // (the decider emits thread.unsettled(reason: "activity") events directly,
  // never through this command), so a client cannot forge the neutral reset.
  reason: Schema.Literal("user"),
});

const ThreadSnoozeCommand = Schema.Struct({
  type: Schema.Literal("thread.snooze"),
  commandId: CommandId,
  threadId: ThreadId,
  // The wake time. Event-based wake conditions (PR merged, review posted)
  // will arrive as an optional condition field alongside this; time-based
  // snooze is just the first kind of condition.
  snoozedUntil: IsoDateTime,
});

const ThreadUnsnoozeCommand = Schema.Struct({
  type: Schema.Literal("thread.unsnooze"),
  commandId: CommandId,
  threadId: ThreadId,
  // Commands only carry "user": activity wakes are decided server-side (the
  // decider emits thread.unsnoozed(reason: "activity") directly), and timer
  // wakes need no event at all — clients derive visibility from snoozedUntil,
  // so a passed wake time simply stops classifying as snoozed.
  reason: Schema.Literal("user"),
});

const ThreadPinCommand = Schema.Struct({
  type: Schema.Literal("thread.pin"),
  commandId: CommandId,
  threadId: ThreadId,
  // Initial slot in the user-arranged pinned order (see ThreadPinReorderCommand).
  // Optional: clients on pre-reorder servers omit it, and the pinned block
  // falls back to creation order for keyless threads.
  orderKey: Schema.optional(TrimmedNonEmptyString),
});

const ThreadUnpinCommand = Schema.Struct({
  type: Schema.Literal("thread.unpin"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadPinReorderCommand = Schema.Struct({
  type: Schema.Literal("thread.pin.reorder"),
  commandId: CommandId,
  threadId: ThreadId,
  // Fractional index key: pinned threads sort by plain string comparison of
  // these keys, so a drag writes one key to one thread — neighbors (possibly
  // on other servers) are never touched. Clients compute a key that sorts
  // between the dropped position's neighbors.
  orderKey: TrimmedNonEmptyString,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  expectedBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
}).check(
  Schema.makeFilter(
    (input) =>
      !(input.title !== undefined && input.regenerateTitle === true) ||
      "title and regenerateTitle cannot be specified together",
  ),
);

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  fetchMode: Schema.optional(Schema.Literal("repository-exploration")),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnRetryCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.retry"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  messageId: MessageId,
  fetchMode: Schema.optional(Schema.Literal("repository-exploration")),
  modelSelection: Schema.optional(ModelSelection),
  createdAt: IsoDateTime,
});
export type ThreadTurnRetryCommand = typeof ThreadTurnRetryCommand.Type;

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ClientSendChatAttachment),
  }),
  fetchMode: Schema.optional(Schema.Literal("repository-exploration")),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
  // Settle-cleanup stops are conditional: the decider drops the stop if the
  // thread was re-engaged (unsettled, session starting/running, or a queued
  // turn start) between the settle and this command. Guarding in the decider
  // closes the race a post-settle snapshot read cannot: commands are decided
  // serially against the authoritative read model.
  onlyIfSettled: Schema.optional(Schema.Boolean),
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadForkCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSettleCommand,
  ThreadUnsettleCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadPinCommand,
  ThreadUnpinCommand,
  ThreadPinReorderCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnRetryCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadForkCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadSettleCommand,
  ThreadUnsettleCommand,
  ThreadSnoozeCommand,
  ThreadUnsnoozeCommand,
  ThreadPinCommand,
  ThreadUnpinCommand,
  ThreadPinReorderCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnRetryCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

export const ThreadForkWorkspaceUpdateStatus = Schema.Literals(["ready", "error"]);
export type ThreadForkWorkspaceUpdateStatus = typeof ThreadForkWorkspaceUpdateStatus.Type;

export const ThreadForkWorkspaceUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.fork.workspace.update"),
  commandId: CommandId,
  threadId: ThreadId,
  status: ThreadForkWorkspaceUpdateStatus,
  preparedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type ThreadForkWorkspaceUpdateCommand = typeof ThreadForkWorkspaceUpdateCommand.Type;

export const ThreadForkHandoffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.fork.handoff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  completedAt: IsoDateTime,
});
export type ThreadForkHandoffCompleteCommand = typeof ThreadForkHandoffCompleteCommand.Type;

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageImportCommand = Schema.Struct({
  type: Schema.Literal("thread.message.import"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  message: OrchestrationMessage,
});

export const ThreadHarnessSyncLinkCommand = Schema.Struct({
  type: Schema.Literal("thread.harness-sync.link"),
  commandId: CommandId,
  threadId: ThreadId,
  sourceId: HarnessChatSyncSourceId,
  continuationKey: HarnessChatContinuationKey,
  nativeSessionId: HarnessChatSessionId,
  providerInstanceId: ProviderInstanceId,
  providerLabel: TrimmedNonEmptyString,
  activity: HarnessChatActivity,
  sourceUpdatedAt: Schema.NullOr(IsoDateTime),
  lastSyncedAt: IsoDateTime,
});
export type ThreadHarnessSyncLinkCommand = typeof ThreadHarnessSyncLinkCommand.Type;

export const ThreadHarnessSyncMessageImportCommand = Schema.Struct({
  type: Schema.Literal("thread.harness-sync.message.import"),
  commandId: CommandId,
  threadId: ThreadId,
  nativeMessageId: TrimmedNonEmptyString,
  message: OrchestrationMessage,
  linkedAt: IsoDateTime,
});
export type ThreadHarnessSyncMessageImportCommand =
  typeof ThreadHarnessSyncMessageImportCommand.Type;

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadTurnAbortOutcome = Schema.Literals([
  "cooperative",
  "force-terminated",
  "force-detached",
  "force-failed",
]);
export type ThreadTurnAbortOutcome = typeof ThreadTurnAbortOutcome.Type;

export const ThreadTurnAbortSettleCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.abort.settle"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  turnId: Schema.NullOr(TurnId),
  outcome: ThreadTurnAbortOutcome,
  detail: Schema.optional(TrimmedNonEmptyString),
  settledAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type ThreadTurnAbortSettleCommand = typeof ThreadTurnAbortSettleCommand.Type;

const ThreadTitleRegenerationCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.title.regeneration.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: CommandId,
  title: Schema.optional(TrimmedNonEmptyString),
});

export const ThreadSubagentUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.subagent.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  subagent: OrchestrationSubagentSummary,
  createdAt: IsoDateTime,
});

export const ThreadSubagentStateSetCommand = Schema.Struct({
  type: Schema.Literal("thread.subagent.state.set"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: SubagentId,
  status: OrchestrationSubagentStatus,
  statusMessage: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ThreadSubagentProgressSetCommand = Schema.Struct({
  type: Schema.Literal("thread.subagent.progress.set"),
  commandId: CommandId,
  threadId: ThreadId,
  subagentId: SubagentId,
  progress: Schema.NullOr(OrchestrationSubagentProgress),
  updatedAt: IsoDateTime,
});

export const ProjectAgentClaimSetCommand = Schema.Struct({
  type: Schema.Literal("project.agent.claim.set"),
  commandId: CommandId,
  projectId: ProjectId,
  threadId: ThreadId,
  turnId: TurnId,
  summary: ProjectAgentSummary,
  claims: Schema.Array(ProjectAgentClaim).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PROJECT_AGENT_MAX_CLAIMS),
  ),
  claimedAt: IsoDateTime,
});
export type ProjectAgentClaimSetCommand = typeof ProjectAgentClaimSetCommand.Type;

export const ProjectAgentClaimReleaseCommand = Schema.Struct({
  type: Schema.Literal("project.agent.claim.release"),
  commandId: CommandId,
  projectId: ProjectId,
  threadId: ThreadId,
  expectedTurnId: Schema.optional(TurnId),
  releasedAt: IsoDateTime,
});
export type ProjectAgentClaimReleaseCommand = typeof ProjectAgentClaimReleaseCommand.Type;

export const ProjectAgentMessageSendCommand = Schema.Struct({
  type: Schema.Literal("project.agent.message.send"),
  commandId: CommandId,
  projectId: ProjectId,
  messageId: ProjectAgentMessageId,
  senderThreadId: ThreadId,
  recipientThreadIds: Schema.Array(ThreadId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PROJECT_AGENT_MAX_PEERS),
  ),
  kind: ProjectAgentMessageKind,
  body: ProjectAgentMessageBody,
  sentAt: IsoDateTime,
});
export type ProjectAgentMessageSendCommand = typeof ProjectAgentMessageSendCommand.Type;

export const ProjectAgentInboxAcknowledgeCommand = Schema.Struct({
  type: Schema.Literal("project.agent.inbox.acknowledge"),
  commandId: CommandId,
  projectId: ProjectId,
  threadId: ThreadId,
  acknowledgeThrough: NonNegativeInt,
  acknowledgedAt: IsoDateTime,
});
export type ProjectAgentInboxAcknowledgeCommand = typeof ProjectAgentInboxAcknowledgeCommand.Type;

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadForkWorkspaceUpdateCommand,
  ThreadForkHandoffCompleteCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadMessageImportCommand,
  ThreadHarnessSyncLinkCommand,
  ThreadHarnessSyncMessageImportCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  ThreadTurnAbortSettleCommand,
  ThreadTitleRegenerationCompleteCommand,
  ThreadSubagentUpsertCommand,
  ThreadSubagentStateSetCommand,
  ThreadSubagentProgressSetCommand,
  ProjectAgentClaimSetCommand,
  ProjectAgentClaimReleaseCommand,
  ProjectAgentMessageSendCommand,
  ProjectAgentInboxAcknowledgeCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.forked",
  "thread.fork-workspace-updated",
  "thread.fork-handoff-completed",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.settled",
  "thread.unsettled",
  "thread.snoozed",
  "thread.unsnoozed",
  "thread.pinned",
  "thread.unpinned",
  "thread.pin-reordered",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.harness-sync-linked",
  "thread.harness-sync-message-imported",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.turn-abort-settled",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "thread.subagent-upserted",
  "thread.subagent-state-set",
  "thread.subagent-progress-set",
  "project.agent-claim-set",
  "project.agent-claim-released",
  "project.agent-message-sent",
  "project.agent-inbox-acknowledged",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  // Defaults on decode so persisted events from older servers remain valid.
  checkpointsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  // Optional so persisted events from older servers still decode.
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  defaultThreadEnvMode: Schema.optional(Schema.NullOr(ThreadEnvMode)),
  checkpointsEnabled: Schema.optional(Schema.Boolean),
  faviconPath: Schema.optional(Schema.NullOr(ProjectFaviconPath)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ProjectAgentClaimSetPayload = ProjectAgentLease;
export type ProjectAgentClaimSetPayload = typeof ProjectAgentClaimSetPayload.Type;

export const ProjectAgentClaimReleasedPayload = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  expectedTurnId: Schema.NullOr(TurnId),
  releasedAt: IsoDateTime,
});
export type ProjectAgentClaimReleasedPayload = typeof ProjectAgentClaimReleasedPayload.Type;

export const ProjectAgentMessageSentPayload = Schema.Struct({
  projectId: ProjectId,
  messageId: ProjectAgentMessageId,
  senderThreadId: ThreadId,
  recipientThreadIds: Schema.Array(ThreadId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(PROJECT_AGENT_MAX_PEERS),
  ),
  kind: ProjectAgentMessageKind,
  body: ProjectAgentMessageBody,
  sentAt: IsoDateTime,
});
export type ProjectAgentMessageSentPayload = typeof ProjectAgentMessageSentPayload.Type;

export const ProjectAgentInboxAcknowledgedPayload = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  acknowledgeThrough: NonNegativeInt,
  acknowledgedAt: IsoDateTime,
});
export type ProjectAgentInboxAcknowledgedPayload = typeof ProjectAgentInboxAcknowledgedPayload.Type;

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadForkedPayload = Schema.Struct({
  threadId: ThreadId,
  fork: ThreadForkState,
  history: ThreadForkHistory,
});
export type ThreadForkedPayload = typeof ThreadForkedPayload.Type;

export const ThreadForkWorkspaceUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  status: ThreadForkWorkspaceUpdateStatus,
  preparedAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type ThreadForkWorkspaceUpdatedPayload = typeof ThreadForkWorkspaceUpdatedPayload.Type;

export const ThreadForkHandoffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  completedAt: IsoDateTime,
});
export type ThreadForkHandoffCompletedPayload = typeof ThreadForkHandoffCompletedPayload.Type;

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadSettledPayload = Schema.Struct({
  threadId: ThreadId,
  settledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsettledPayload = Schema.Struct({
  threadId: ThreadId,
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadSnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  snoozedUntil: IsoDateTime,
  snoozedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnsnoozedPayload = Schema.Struct({
  threadId: ThreadId,
  // user: explicit "wake now". activity: real work arrived (user message /
  // session coming alive) and the decider cleared the snooze — mirrors
  // thread.unsettled's activity resets. Timer wakes emit no event: clients
  // derive them from snoozedUntil passing.
  reason: Schema.Literals(["user", "activity"]),
  updatedAt: IsoDateTime,
});

export const ThreadPinnedPayload = Schema.Struct({
  threadId: ThreadId,
  pinnedAt: IsoDateTime,
  // Absent on re-pins of an already-pinned thread (the existing key wins)
  // and on pins from clients that predate reordering.
  pinOrderKey: Schema.optional(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ThreadUnpinnedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadPinReorderedPayload = Schema.Struct({
  threadId: ThreadId,
  orderKey: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  /** Intent marker consumed by the title-generation reactor. Keeping this on
      the existing event lets older clients safely ignore the new field. */
  regenerateTitle: Schema.optional(Schema.Literal(true)),
  /** Title at request time, used to avoid overwriting a later manual rename. */
  previousTitle: Schema.optional(TrimmedNonEmptyString),
  /** Pending state shared with clients. Null clears a matching request. */
  titleRegeneration: Schema.optional(Schema.NullOr(ThreadTitleRegeneration)),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});

export const ThreadHarnessSyncLinkedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  sourceId: HarnessChatSyncSourceId,
  continuationKey: HarnessChatContinuationKey,
  nativeSessionId: HarnessChatSessionId,
  providerInstanceId: ProviderInstanceId,
  providerLabel: TrimmedNonEmptyString,
  activity: HarnessChatActivity,
  sourceUpdatedAt: Schema.NullOr(IsoDateTime),
  lastSyncedAt: IsoDateTime,
});
export type ThreadHarnessSyncLinkedPayload = typeof ThreadHarnessSyncLinkedPayload.Type;

export const ThreadHarnessSyncMessageImportedPayload = Schema.Struct({
  ...ThreadMessageSentPayload.fields,
  nativeMessageId: TrimmedNonEmptyString,
  linkedAt: IsoDateTime,
});
export type ThreadHarnessSyncMessageImportedPayload =
  typeof ThreadHarnessSyncMessageImportedPayload.Type;

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  resultOnly: Schema.optional(Schema.Boolean),
  retryOfTurnId: Schema.optional(TurnId),
  fetchMode: Schema.optional(Schema.Literal("repository-exploration")),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadTurnAbortSettledPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeSessionId: RuntimeSessionId,
  turnId: Schema.NullOr(TurnId),
  outcome: ThreadTurnAbortOutcome,
  detail: Schema.optional(TrimmedNonEmptyString),
  settledAt: IsoDateTime,
});
export type ThreadTurnAbortSettledPayload = typeof ThreadTurnAbortSettledPayload.Type;

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  subagentId: Schema.optional(SubagentId),
  activity: OrchestrationThreadActivity,
});

export const ThreadSubagentUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  subagent: OrchestrationSubagentSummary,
});

export const ThreadSubagentStateSetPayload = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  status: OrchestrationSubagentStatus,
  statusMessage: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ThreadSubagentProgressSetPayload = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  progress: Schema.NullOr(OrchestrationSubagentProgress),
  updatedAt: IsoDateTime,
});

/**
 * Which client connection dispatched the command that produced an event.
 * Stamped by the orchestration engine on client-dispatched commands; absent on
 * provider/server-originated events and on commands from clients too old to
 * report it.
 */
export const OrchestrationClientOrigin = Schema.Struct({
  surface: Schema.optional(ClientSurface),
  appVersion: Schema.optional(TrimmedNonEmptyString),
});
export type OrchestrationClientOrigin = typeof OrchestrationClientOrigin.Type;

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
  origin: Schema.optional(OrchestrationClientOrigin),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.agent-claim-set"),
    payload: ProjectAgentClaimSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.agent-claim-released"),
    payload: ProjectAgentClaimReleasedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.agent-message-sent"),
    payload: ProjectAgentMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.agent-inbox-acknowledged"),
    payload: ProjectAgentInboxAcknowledgedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.forked"),
    payload: ThreadForkedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.fork-workspace-updated"),
    payload: ThreadForkWorkspaceUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.fork-handoff-completed"),
    payload: ThreadForkHandoffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.settled"),
    payload: ThreadSettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unsettled"),
    payload: ThreadUnsettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.snoozed"),
    payload: ThreadSnoozedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unsnoozed"),
    payload: ThreadUnsnoozedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned"),
    payload: ThreadPinnedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unpinned"),
    payload: ThreadUnpinnedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pin-reordered"),
    payload: ThreadPinReorderedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.harness-sync-linked"),
    payload: ThreadHarnessSyncLinkedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.harness-sync-message-imported"),
    payload: ThreadHarnessSyncMessageImportedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-abort-settled"),
    payload: ThreadTurnAbortSettledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.subagent-upserted"),
    payload: ThreadSubagentUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.subagent-state-set"),
    payload: ThreadSubagentStateSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.subagent-progress-set"),
    payload: ThreadSubagentProgressSetPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationStreamCursor = Schema.Struct({
  kind: Schema.Literal("cursor"),
  sequence: NonNegativeInt,
});
export type OrchestrationStreamCursor = typeof OrchestrationStreamCursor.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("synchronized"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
  OrchestrationStreamCursor,
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationSubagentStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationSubagentDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
  OrchestrationStreamCursor,
]);
export type OrchestrationSubagentStreamItem = typeof OrchestrationSubagentStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue({
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  historyOrigin: Schema.optional(OrchestrationHistoryOrigin),
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationThreadSearchSource = Schema.Literals(["user", "assistant"]);
export type OrchestrationThreadSearchSource = typeof OrchestrationThreadSearchSource.Type;

// The server's SQLite client is synchronous and single-connection. Bound both
// scan input and response size so a search cannot monopolize that connection.
export const OrchestrationSearchThreadsInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type OrchestrationSearchThreadsInput = typeof OrchestrationSearchThreadsInput.Type;

export const OrchestrationThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String.check(Schema.isMaxLength(240)),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadSearchMatch = typeof OrchestrationThreadSearchMatch.Type;

export const OrchestrationSearchThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
});
export type OrchestrationSearchThreadsResult = typeof OrchestrationSearchThreadsResult.Type;

export const OrchestrationGetWorkflowScriptInput = Schema.Struct({
  threadId: ThreadId,
  /** Absolute path from the workflow's runHandles.scriptPath. The server
   * re-derives containment; the client value is a hint, never trusted. */
  scriptPath: TrimmedNonEmptyString,
});
export type OrchestrationGetWorkflowScriptInput = typeof OrchestrationGetWorkflowScriptInput.Type;

export const OrchestrationGetWorkflowScriptResult = Schema.Struct({
  scriptPath: TrimmedNonEmptyString,
  contents: Schema.String,
  truncated: Schema.Boolean,
});
export type OrchestrationGetWorkflowScriptResult = typeof OrchestrationGetWorkflowScriptResult.Type;

const WORKFLOW_SCRIPT_ERROR_MESSAGES = {
  "invalid-path": "Workflow scripts must be absolute .js paths.",
  "root-unavailable": "Script root unavailable.",
  "not-found": "Script not found.",
  "outside-root": "Script path is outside the workflow scripts root.",
  "not-js": "Resolved script is not a .js file.",
  "not-regular-file": "Script is not a regular file.",
  "changed-during-read": "Script changed between resolution and open.",
  "read-failed": "Script read failed.",
} as const;

export class OrchestrationGetWorkflowScriptError extends Schema.TaggedErrorClass<OrchestrationGetWorkflowScriptError>()(
  "OrchestrationGetWorkflowScriptError",
  {
    reason: Schema.Literals([
      "invalid-path",
      "root-unavailable",
      "not-found",
      "outside-root",
      "not-js",
      "not-regular-file",
      "changed-during-read",
      "read-failed",
    ]),
    scriptPath: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return WORKFLOW_SCRIPT_ERROR_MESSAGES[this.reason];
  }
}

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getWorkflowScript: {
    input: OrchestrationGetWorkflowScriptInput,
    output: OrchestrationGetWorkflowScriptResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  searchThreads: {
    input: OrchestrationSearchThreadsInput,
    output: OrchestrationSearchThreadsResult,
  },
  exportThreadTranscript: {
    input: OrchestrationExportThreadTranscriptInput,
    output: OrchestrationThreadTranscriptExport,
  },
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeSubagent: {
    input: OrchestrationSubscribeSubagentInput,
    output: OrchestrationSubagentStreamItem,
  },
  subscribeShell: {
    input: OrchestrationSubscribeShellInput,
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
    bootstrapThreadDisposition: Schema.optional(Schema.Literal("deleted")),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationSearchThreadsError extends Schema.TaggedErrorClass<OrchestrationSearchThreadsError>()(
  "OrchestrationSearchThreadsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class OrchestrationThreadTranscriptNotFoundError extends Schema.TaggedErrorClass<OrchestrationThreadTranscriptNotFoundError>()(
  "OrchestrationThreadTranscriptNotFoundError",
  {
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return `Thread transcript not found: ${this.threadId}`;
  }
}

export class OrchestrationThreadTranscriptExportError extends Schema.TaggedErrorClass<OrchestrationThreadTranscriptExportError>()(
  "OrchestrationThreadTranscriptExportError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
