import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ProviderAuthCancelInput,
  ProviderAuthCompleteInput,
  ProviderAuthState,
  ProviderInstallCancelInput,
  ProviderInstallState,
  ProviderSetupError,
  ProviderSetupInput,
} from "./providerSetup.ts";

import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  AuthEnvironmentScopes,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "./background.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  AgentSessionImportInput,
  AgentSessionImportProjectChangedError,
  AgentSessionImportProjectNotFoundError,
  AgentSessionImportResult,
  AgentSessionScanInput,
  AgentSessionScanResult,
  AgentSessionScanError,
} from "./agentSessions.ts";
import {
  AssetAccessError,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  AttachmentUploadSigningKeyError,
} from "./assets.ts";
import {
  GitActionProgressEvent,
  VcsSwitchRefInput,
  VcsSwitchRefResult,
  GitCommandError,
  VcsCreateRefInput,
  VcsCreateRefResult,
  VcsCreateWorktreeInput,
  VcsCreateWorktreeResult,
  VcsInitInput,
  VcsListRefsInput,
  VcsListRefsResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  VcsPullInput,
  GitPullRequestRefInput,
  VcsPullResult,
  VcsRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  VcsStatusInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  GitApplyChangeSelectionInput,
  GitApplyChangeSelectionResult,
  GitChangesDiffInput,
  GitChangesDiffResult,
  GitCommitDetailInput,
  GitCommitDetailResult,
  GitCommitFileDiffInput,
  GitCommitFileDiffResult,
  GitHistoryListInput,
  GitHistoryListResult,
  GitInteractiveRebasePlanInput,
  GitInteractiveRebasePlanResult,
  GitQueuedWorkflowCancelInput,
  GitQueuedWorkflowCancelResult,
  GitQueuedWorkflowUpsertInput,
  GitQueuedWorkflowUpsertResult,
  GitRepositoryInsightsInput,
  GitRepositoryInsightsResult,
  GitUndoSnapshotCreateInput,
  GitUndoSnapshotCreateResult,
  GitUndoSnapshotRestoreInput,
  GitUndoSnapshotRestoreResult,
  GitUndoSnapshotsListInput,
  GitUndoSnapshotsListResult,
  GitWorkbenchInput,
  GitWorkbenchOperationEvent,
  GitWorkbenchRunOperationInput,
  GitWorkbenchServiceError,
  GitWorkbenchSnapshot,
  GitWorkbenchStreamEvent,
} from "./gitWorkbench.ts";
import {
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  KnowledgeGraphCancelInput,
  KnowledgeGraphClearInput,
  KnowledgeGraphMutationResultV1,
  KnowledgeGraphNodeContentInput,
  KnowledgeGraphNodeContentResultV1,
  KnowledgeGraphOperationError,
  KnowledgeGraphPauseInput,
  KnowledgeGraphQueryInput,
  KnowledgeGraphQueryResultV1,
  KnowledgeGraphRebuildInput,
  KnowledgeGraphStreamEvent,
  KnowledgeGraphSubscribeInput,
} from "./knowledgeGraph.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationExportThreadTranscriptInput,
  OrchestrationThreadTranscriptExport,
  OrchestrationThreadTranscriptExportError,
  OrchestrationThreadTranscriptNotFoundError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  OrchestrationSearchThreadsInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationRpcSchemas,
  OrchestrationGetWorkflowScriptError,
} from "./orchestration.ts";
import {
  ProviderCompactThreadInput,
  ProviderCompactionError,
  ProviderUploadFeedbackError,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
} from "./provider.ts";
import {
  ProjectMemoryDocumentClearRequest,
  ProjectMemoryDocumentMutationResponse,
  ProjectMemoryDocumentReplaceRequest,
  ProjectMemoryDocumentViewRequest,
  ProjectMemoryDocumentViewResponse,
  ProjectMemoryError,
  ProjectMemoryImportRequest,
  ProjectMemoryImportResponse,
  ProjectMemorySettingsResponse,
  ProjectMemorySettingsUpdateRequest,
} from "./projectMemory.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  PlanParallelismReviewError,
  PlanParallelismReviewInput,
  PlanParallelismReviewResult,
} from "./planParallelismReview.ts";
import {
  PullRequestActionInput,
  PullRequestActivity,
  PullRequestCommentInput,
  PullRequestCommentUpdateInput,
  PullRequestDetail,
  PullRequestDiffFileContentsInput,
  PullRequestDiffFileContentsResult,
  PullRequestInvalidateInput,
  PullRequestListInput,
  PullRequestListResult,
  PullRequestListStatsInput,
  PullRequestListStatsResult,
  PullRequestOperationError,
  PullRequestReactionInput,
  PullRequestRef,
  PullRequestSummary,
  PullRequestReviewerCandidateList,
  PullRequestReviewerRequestInput,
  PullRequestLabelCandidateList,
  PullRequestLabelChangeInput,
  PullRequestSubmitReviewInput,
  PullRequestThreadCommentsInput,
  PullRequestThreadCommentsResult,
  PullRequestThreadReplyInput,
  PullRequestThreadResolutionInput,
  PullRequestUnavailableError,
  PullRequestUpdateInput,
} from "./pullRequest.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchContentsError,
  ProjectSearchContentsInput,
  ProjectSearchContentsResult,
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteConflictError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  McpConfigError,
  McpCreateInput,
  McpCursorJsonResult,
  McpDeleteInput,
  McpDiscoverImportSourcesInput,
  McpDiscoverImportSourcesResult,
  McpExportCursorJsonInput,
  McpImportCursorJsonInput,
  McpImportSourcesInput,
  McpListInput,
  McpListResult,
  McpMutationResult,
  McpProviderStatusInput,
  McpProviderStatusResult,
  McpRuntimeActionInput,
  McpRuntimeActionResult,
  McpRuntimeChange,
  McpRuntimeChangesInput,
  McpRuntimeContextChange,
  McpRuntimeContextChangesInput,
  McpRuntimeContextsInput,
  McpRuntimeContextsResult,
  McpRuntimeError,
  McpRuntimeServerDetailsInput,
  McpRuntimeServerDetailsResult,
  McpRuntimeSnapshot,
  McpRuntimeSnapshotInput,
  McpSetEnabledInput,
  McpSetProviderEnabledInput,
  McpSetProviderEnabledResult,
  McpUpdateInput,
} from "./mcp.ts";
import {
  SkillCreateInput,
  SkillDeleteInput,
  SkillDiscoverImportSourcesInput,
  SkillDiscoverImportSourcesResult,
  SkillEngineError,
  SkillImportSourcesInput,
  SkillImportSourcesResult,
  SkillListInput,
  SkillListResult,
  SkillMutationResult,
  SkillRenameInput,
  SkillSetEnabledInput,
  SkillUpdateInput,
} from "./skills.ts";
import {
  TerminalAttachInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  DiscoveredLocalServerList,
  ConfiguredLocalServerUrls,
  PreviewCloseInput,
  PreviewError,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewNavigateInput,
  PreviewOpenInput,
  PreviewRefreshInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewSessionSnapshot,
} from "./preview.ts";
import {
  PreviewAutomationError,
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
} from "./previewAutomation.ts";
import {
  ServerConfigStreamEvent,
  DesktopUpdateCommitInput,
  ServerConfig,
  AssemblyAiStreamingTokenError,
  AssemblyAiStreamingTokenResult,
  SpeechStreamingAudioInput,
  SpeechStreamingProxyError,
  SpeechStreamingSessionInput,
  SpeechStreamingSessionStartResult,
  SpeechStreamingTranscriptResult,
  ProviderAuthConnectEvent,
  ProviderAuthConnectInput,
  ProviderAuthDisconnectInput,
  ProviderAuthDisconnectResult,
  ProviderAuthOperationError,
  ProviderAuthSetCredentialInput,
  ProviderAuthSetCredentialResult,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerSelfUpdateInput,
  ServerSelfUpdateProgressEvent,
  ServerSelfUpdateResult,
  ServerTraceDiagnosticsResult,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerSignalProcessInput,
  ServerSignalProcessResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import {
  HostResourcesSnapshot,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryRetryResult,
  ResourceTelemetrySnapshot,
  ResourceProtectionSnapshot,
} from "./resourceTelemetry.ts";
import {
  UsageLimitSourceError,
  ProviderConsumeResetCreditInput,
  ProviderConsumeResetCreditResult,
} from "./providerUsageLimits.ts";
import { UsagePricing, UsageReadError, UsageSummary, UsageSummaryInput } from "./usage.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import {
  ImprovePromptInput,
  ProjectSpeechProfile,
  ProjectSpeechProfileError,
  ProjectSpeechProfileInput,
  ProjectSpeechProfileListResult,
  ProjectTextTransformError,
  ProjectTextTransformResult,
  TranslateTranscriptInput,
} from "./speech.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";
import {
  T3ChatImportDiscoverInput,
  T3ChatImportDiscoverResult,
  T3ChatImportError,
  T3ChatImportRunInput,
  T3ChatImportRunResult,
} from "./t3ChatImport.ts";
import {
  HarnessChatSyncError,
  HarnessChatSyncListInput,
  HarnessChatSyncListResult,
  HarnessChatSyncRunInput,
  HarnessChatSyncRunResult,
  HarnessChatSyncSourcesInput,
  HarnessChatSyncSourcesResult,
  HarnessChatSyncStatusInput,
  HarnessChatSyncStatusResult,
} from "./harnessChatSync.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsListEntries: "projects.listEntries",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",
  agentSessionsScan: "agentSessions.scan",
  agentSessionsImport: "agentSessions.import",
  assetsCreateUrl: "assets.createUrl",
  attachmentsCreateUploadUrl: "attachments.createUploadUrl",
  attachmentsDelete: "attachments.delete",

  // Provider methods
  providerUploadFeedback: "provider.uploadFeedback",
  providerAuthStart: "provider.auth.start",
  providerConsumeResetCredit: "provider.consumeResetCredit",
  providerAuthComplete: "provider.auth.complete",
  providerAuthCancel: "provider.auth.cancel",
  providerAuthLogout: "provider.auth.logout",
  providerAuthSubscribe: "provider.auth.subscribe",
  providerInstallStart: "provider.install.start",
  providerInstallCancel: "provider.install.cancel",
  providerInstallSubscribe: "provider.install.subscribe",
  providerInstallRemove: "provider.install.remove",

  // VCS methods
  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  // Git workflow methods
  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",
  gitRefreshWorkbench: "git.refreshWorkbench",
  gitGetRepositoryInsights: "git.getRepositoryInsights",
  gitListHistory: "git.listHistory",
  gitGetCommitDetail: "git.getCommitDetail",
  gitGetCommitFileDiff: "git.getCommitFileDiff",
  gitGetChangesDiff: "git.getChangesDiff",
  gitGetInteractiveRebasePlan: "git.getInteractiveRebasePlan",
  gitApplyChangeSelection: "git.applyChangeSelection",
  gitRunWorkbenchOperation: "git.runWorkbenchOperation",
  gitListUndoSnapshots: "git.listUndoSnapshots",
  gitCreateUndoSnapshot: "git.createUndoSnapshot",
  gitRestoreUndoSnapshot: "git.restoreUndoSnapshot",
  gitUpsertQueuedWorkflow: "git.upsertQueuedWorkflow",
  gitCancelQueuedWorkflow: "git.cancelQueuedWorkflow",

  // Review methods
  reviewGetDiffPreview: "review.getDiffPreview",
  reviewGetDiffFileContents: "review.getDiffFileContents",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Preview methods
  previewOpen: "preview.open",
  previewNavigate: "preview.navigate",
  previewResize: "preview.resize",
  previewRefresh: "preview.refresh",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewReportStatus: "preview.reportStatus",
  previewAutomationConnect: "previewAutomation.connect",
  previewAutomationRespond: "previewAutomation.respond",
  previewAutomationFocusHost: "previewAutomation.focusHost",

  // Server meta
  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverProviderAuthConnect: "server.providerAuthConnect",
  serverProviderAuthSetCredential: "server.providerAuthSetCredential",
  serverProviderAuthDisconnect: "server.providerAuthDisconnect",
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverCommitDesktopUpdate: "server.commitDesktopUpdate",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",
  providerCompactThread: "provider.compactThread",
  projectMemoryView: "projectMemory.view",
  projectMemoryUpdateSettings: "projectMemory.updateSettings",
  projectMemoryReplace: "projectMemory.replace",
  projectMemoryImport: "projectMemory.import",
  projectMemoryClear: "projectMemory.clear",
  serverCreateAssemblyAiStreamingToken: "server.createAssemblyAiStreamingToken",
  speechStartStreamingSession: "speech.startStreamingSession",
  speechPushStreamingAudio: "speech.pushStreamingAudio",
  speechFinishStreamingSession: "speech.finishStreamingSession",
  speechCancelStreamingSession: "speech.cancelStreamingSession",
  speechGetProjectProfile: "speech.getProjectProfile",
  speechListProjectProfiles: "speech.listProjectProfiles",
  speechIndexProject: "speech.indexProject",
  speechCreateBasicProjectProfile: "speech.createBasicProjectProfile",
  speechTranslateTranscript: "speech.translateTranscript",
  promptImprove: "prompt.improve",
  planReviewParallelism: "plan.reviewParallelism",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetHostResources: "server.getHostResources",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",
  serverGetUsageSummary: "server.getUsageSummary",
  serverRefreshUsageRates: "server.refreshUsageRates",

  // Cloud environment methods
  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  // Local T3 instance chat import
  chatImportDiscover: "chatImport.discover",
  chatImportRun: "chatImport.run",

  // Provider harness chat history sync
  harnessChatSyncSources: "harnessChatSync.sources",
  harnessChatSyncList: "harnessChatSync.list",
  harnessChatSyncRun: "harnessChatSync.run",
  harnessChatSyncStatus: "harnessChatSync.status",

  // Skills
  skillsList: "skills.list",
  skillsDiscoverImportSources: "skills.discoverImportSources",
  skillsImportSources: "skills.importSources",
  skillsCreate: "skills.create",
  skillsUpdate: "skills.update",
  skillsRename: "skills.rename",
  skillsDelete: "skills.delete",
  skillsSetEnabled: "skills.setEnabled",

  // MCP server settings
  mcpList: "mcp.list",
  mcpDiscoverImportSources: "mcp.discoverImportSources",
  mcpCreate: "mcp.create",
  mcpUpdate: "mcp.update",
  mcpDelete: "mcp.delete",
  mcpSetEnabled: "mcp.setEnabled",
  mcpSetProviderEnabled: "mcp.setProviderEnabled",
  mcpImportCursorJson: "mcp.importCursorJson",
  mcpImportSources: "mcp.importSources",
  mcpExportCursorJson: "mcp.exportCursorJson",
  mcpProviderStatus: "mcp.providerStatus",
  mcpRuntimeContexts: "mcp.runtimeContexts",
  mcpRuntimeContextChanges: "mcp.runtimeContextChanges",
  mcpRuntimeSnapshot: "mcp.runtimeSnapshot",
  mcpRuntimeChanges: "mcp.runtimeChanges",
  mcpRuntimeServerDetails: "mcp.runtimeServerDetails",
  mcpRuntimeAction: "mcp.runtimeAction",

  // Pull request methods
  pullRequestsList: "pullRequests.list",
  pullRequestsListStats: "pullRequests.listStats",
  pullRequestsSummary: "pullRequests.summary",
  pullRequestsDetail: "pullRequests.detail",
  pullRequestsActivity: "pullRequests.activity",
  pullRequestsThreadComments: "pullRequests.threadComments",
  pullRequestsDiffFileContents: "pullRequests.diffFileContents",
  pullRequestsRunAction: "pullRequests.runAction",
  pullRequestsUpdate: "pullRequests.update",
  pullRequestsComment: "pullRequests.comment",
  pullRequestsUpdateComment: "pullRequests.updateComment",
  pullRequestsSubmitReview: "pullRequests.submitReview",
  pullRequestsReplyToThread: "pullRequests.replyToThread",
  pullRequestsSetThreadResolution: "pullRequests.setThreadResolution",
  pullRequestsSetReaction: "pullRequests.setReaction",
  pullRequestsInvalidate: "pullRequests.invalidate",
  pullRequestsSubscribeRefreshes: "pullRequests.subscribeRefreshes",
  pullRequestsReviewerCandidates: "pullRequests.reviewerCandidates",
  pullRequestsRequestReviewers: "pullRequests.requestReviewers",
  pullRequestsLabelCandidates: "pullRequests.labelCandidates",
  pullRequestsSetLabels: "pullRequests.setLabels",

  // Source control methods
  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",

  // Continuous project Knowledge Graph
  knowledgeGraphSubscribe: "knowledgeGraph.subscribe",
  knowledgeGraphQuery: "knowledgeGraph.query",
  knowledgeGraphNodeContent: "knowledgeGraph.nodeContent",
  knowledgeGraphRebuild: "knowledgeGraph.rebuild",
  knowledgeGraphCancel: "knowledgeGraph.cancel",
  knowledgeGraphPause: "knowledgeGraph.pause",
  knowledgeGraphClear: "knowledgeGraph.clear",

  // Streaming subscriptions
  subscribeVcsStatus: "subscribeVcsStatus",
  gitSubscribeWorkbench: "git.subscribeWorkbench",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeBackgroundPolicy: "subscribeBackgroundPolicy",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
  subscribeResourceProtection: "subscribeResourceProtection",
} as const;

const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({
    // Optional so new clients can still probe older servers.
    scopes: Schema.optionalKey(AuthEnvironmentScopes),
  }),
  error: EnvironmentAuthorizationError,
});

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
    cwd: Schema.optional(TrimmedNonEmptyString),
    /** Explicit user request. Background status refreshes must not open agent sessions. */
    refreshModels: Schema.optional(Schema.Boolean),
  }),
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([EnvironmentAuthorizationError, ProviderSetupError]),
});

const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

const ProviderSetupRpcError = Schema.Union([ProviderSetupError, EnvironmentAuthorizationError]);

const WsProviderConsumeResetCreditRpc = Rpc.make(WS_METHODS.providerConsumeResetCredit, {
  payload: ProviderConsumeResetCreditInput,
  success: ProviderConsumeResetCreditResult,
  error: Schema.Union([ProviderSetupError, UsageLimitSourceError, EnvironmentAuthorizationError]),
});

const WsProviderAuthStartRpc = Rpc.make(WS_METHODS.providerAuthStart, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthCompleteRpc = Rpc.make(WS_METHODS.providerAuthComplete, {
  payload: ProviderAuthCompleteInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthCancelRpc = Rpc.make(WS_METHODS.providerAuthCancel, {
  payload: ProviderAuthCancelInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthLogoutRpc = Rpc.make(WS_METHODS.providerAuthLogout, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthSubscribeRpc = Rpc.make(WS_METHODS.providerAuthSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
  stream: true,
});

const WsProviderInstallStartRpc = Rpc.make(WS_METHODS.providerInstallStart, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsProviderInstallCancelRpc = Rpc.make(WS_METHODS.providerInstallCancel, {
  payload: ProviderInstallCancelInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsProviderInstallSubscribeRpc = Rpc.make(WS_METHODS.providerInstallSubscribe, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
  stream: true,
});

const WsProviderInstallRemoveRpc = Rpc.make(WS_METHODS.providerInstallRemove, {
  payload: ProviderSetupInput,
  success: ProviderInstallState,
  error: ProviderSetupRpcError,
});

const WsServerProviderAuthConnectRpc = Rpc.make(WS_METHODS.serverProviderAuthConnect, {
  payload: ProviderAuthConnectInput,
  success: ProviderAuthConnectEvent,
  error: Schema.Union([ProviderAuthOperationError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerProviderAuthSetCredentialRpc = Rpc.make(WS_METHODS.serverProviderAuthSetCredential, {
  payload: ProviderAuthSetCredentialInput,
  success: ProviderAuthSetCredentialResult,
  error: Schema.Union([ProviderAuthOperationError, EnvironmentAuthorizationError]),
});

const WsServerProviderAuthDisconnectRpc = Rpc.make(WS_METHODS.serverProviderAuthDisconnect, {
  payload: ProviderAuthDisconnectInput,
  success: ProviderAuthDisconnectResult,
  error: Schema.Union([ProviderAuthOperationError, EnvironmentAuthorizationError]),
});

const WsServerUpdateServerRpc = Rpc.make(WS_METHODS.serverUpdateServer, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

const WsServerUpdateServerWithProgressRpc = Rpc.make(WS_METHODS.serverUpdateServerWithProgress, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateProgressEvent,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerCommitDesktopUpdateRpc = Rpc.make(WS_METHODS.serverCommitDesktopUpdate, {
  payload: DesktopUpdateCommitInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsProviderCompactThreadRpc = Rpc.make(WS_METHODS.providerCompactThread, {
  payload: ProviderCompactThreadInput,
  success: Schema.Void,
  error: Schema.Union([ProviderCompactionError, EnvironmentAuthorizationError]),
});

const WsProjectMemoryViewRpc = Rpc.make(WS_METHODS.projectMemoryView, {
  payload: ProjectMemoryDocumentViewRequest,
  success: ProjectMemoryDocumentViewResponse,
  error: Schema.Union([ProjectMemoryError, EnvironmentAuthorizationError]),
});

const WsProjectMemoryUpdateSettingsRpc = Rpc.make(WS_METHODS.projectMemoryUpdateSettings, {
  payload: ProjectMemorySettingsUpdateRequest,
  success: ProjectMemorySettingsResponse,
  error: Schema.Union([ProjectMemoryError, EnvironmentAuthorizationError]),
});

const WsProjectMemoryReplaceRpc = Rpc.make(WS_METHODS.projectMemoryReplace, {
  payload: ProjectMemoryDocumentReplaceRequest,
  success: ProjectMemoryDocumentMutationResponse,
  error: Schema.Union([ProjectMemoryError, EnvironmentAuthorizationError]),
});

const WsProjectMemoryImportRpc = Rpc.make(WS_METHODS.projectMemoryImport, {
  payload: ProjectMemoryImportRequest,
  success: ProjectMemoryImportResponse,
  error: Schema.Union([ProjectMemoryError, EnvironmentAuthorizationError]),
});

const WsProjectMemoryClearRpc = Rpc.make(WS_METHODS.projectMemoryClear, {
  payload: ProjectMemoryDocumentClearRequest,
  success: ProjectMemoryDocumentMutationResponse,
  error: Schema.Union([ProjectMemoryError, EnvironmentAuthorizationError]),
});

const WsServerCreateAssemblyAiStreamingTokenRpc = Rpc.make(
  WS_METHODS.serverCreateAssemblyAiStreamingToken,
  {
    payload: ProjectSpeechProfileInput,
    success: AssemblyAiStreamingTokenResult,
    error: Schema.Union([
      AssemblyAiStreamingTokenError,
      ProjectSpeechProfileError,
      EnvironmentAuthorizationError,
    ]),
  },
);

const WsSpeechStartStreamingSessionRpc = Rpc.make(WS_METHODS.speechStartStreamingSession, {
  payload: ProjectSpeechProfileInput,
  success: SpeechStreamingSessionStartResult,
  error: Schema.Union([
    SpeechStreamingProxyError,
    AssemblyAiStreamingTokenError,
    ProjectSpeechProfileError,
    EnvironmentAuthorizationError,
  ]),
});

const WsSpeechPushStreamingAudioRpc = Rpc.make(WS_METHODS.speechPushStreamingAudio, {
  payload: SpeechStreamingAudioInput,
  success: SpeechStreamingTranscriptResult,
  error: Schema.Union([SpeechStreamingProxyError, EnvironmentAuthorizationError]),
});

const WsSpeechFinishStreamingSessionRpc = Rpc.make(WS_METHODS.speechFinishStreamingSession, {
  payload: SpeechStreamingSessionInput,
  success: SpeechStreamingTranscriptResult,
  error: Schema.Union([SpeechStreamingProxyError, EnvironmentAuthorizationError]),
});

const WsSpeechCancelStreamingSessionRpc = Rpc.make(WS_METHODS.speechCancelStreamingSession, {
  payload: SpeechStreamingSessionInput,
  success: Schema.Void,
  error: Schema.Union([SpeechStreamingProxyError, EnvironmentAuthorizationError]),
});

const WsSpeechGetProjectProfileRpc = Rpc.make(WS_METHODS.speechGetProjectProfile, {
  payload: ProjectSpeechProfileInput,
  success: Schema.NullOr(ProjectSpeechProfile),
  error: Schema.Union([ProjectSpeechProfileError, EnvironmentAuthorizationError]),
});

const WsSpeechListProjectProfilesRpc = Rpc.make(WS_METHODS.speechListProjectProfiles, {
  payload: Schema.Struct({}),
  success: ProjectSpeechProfileListResult,
  error: Schema.Union([ProjectSpeechProfileError, EnvironmentAuthorizationError]),
});

const WsSpeechIndexProjectRpc = Rpc.make(WS_METHODS.speechIndexProject, {
  payload: ProjectSpeechProfileInput,
  success: ProjectSpeechProfile,
  error: Schema.Union([ProjectSpeechProfileError, EnvironmentAuthorizationError]),
});

const WsSpeechCreateBasicProjectProfileRpc = Rpc.make(WS_METHODS.speechCreateBasicProjectProfile, {
  payload: ProjectSpeechProfileInput,
  success: ProjectSpeechProfile,
  error: Schema.Union([ProjectSpeechProfileError, EnvironmentAuthorizationError]),
});

const WsSpeechTranslateTranscriptRpc = Rpc.make(WS_METHODS.speechTranslateTranscript, {
  payload: TranslateTranscriptInput,
  success: ProjectTextTransformResult,
  error: Schema.Union([ProjectTextTransformError, EnvironmentAuthorizationError]),
});

const WsPromptImproveRpc = Rpc.make(WS_METHODS.promptImprove, {
  payload: ImprovePromptInput,
  success: ProjectTextTransformResult,
  error: Schema.Union([ProjectTextTransformError, EnvironmentAuthorizationError]),
});

const WsPlanReviewParallelismRpc = Rpc.make(WS_METHODS.planReviewParallelism, {
  payload: PlanParallelismReviewInput,
  success: PlanParallelismReviewResult,
  error: Schema.Union([PlanParallelismReviewError, EnvironmentAuthorizationError]),
});

const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetTraceDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetTraceDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerTraceDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetProcessDiagnosticsRpc = Rpc.make(WS_METHODS.serverGetProcessDiagnostics, {
  payload: Schema.Struct({}),
  success: ServerProcessDiagnosticsResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetHostResourcesRpc = Rpc.make(WS_METHODS.serverGetHostResources, {
  payload: Schema.Struct({}),
  success: HostResourcesSnapshot,
  error: EnvironmentAuthorizationError,
});

const WsServerGetProcessResourceHistoryRpc = Rpc.make(WS_METHODS.serverGetProcessResourceHistory, {
  payload: ServerProcessResourceHistoryInput,
  success: ServerProcessResourceHistoryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetResourceTelemetryHistoryRpc = Rpc.make(
  WS_METHODS.serverGetResourceTelemetryHistory,
  {
    payload: ResourceTelemetryHistoryInput,
    success: ResourceTelemetryHistory,
    error: EnvironmentAuthorizationError,
  },
);

const WsServerRetryResourceTelemetryRpc = Rpc.make(WS_METHODS.serverRetryResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetryRetryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerGetUsageSummaryRpc = Rpc.make(WS_METHODS.serverGetUsageSummary, {
  payload: UsageSummaryInput,
  success: UsageSummary,
  error: Schema.Union([EnvironmentAuthorizationError, UsageReadError]),
});

/**
 * Refetches the model rate table ahead of its daily TTL, so a model released
 * since the last fetch gets priced. The next usage summary uses the new table.
 */
const WsServerRefreshUsageRatesRpc = Rpc.make(WS_METHODS.serverRefreshUsageRates, {
  payload: Schema.Struct({}),
  success: UsagePricing,
  error: EnvironmentAuthorizationError,
});

const WsServerSignalProcessRpc = Rpc.make(WS_METHODS.serverSignalProcess, {
  payload: ServerSignalProcessInput,
  success: ServerSignalProcessResult,
  error: EnvironmentAuthorizationError,
});

const WsCloudGetRelayClientStatusRpc = Rpc.make(WS_METHODS.cloudGetRelayClientStatus, {
  payload: Schema.Struct({}),
  success: RelayClientStatusSchema,
  error: EnvironmentAuthorizationError,
});

const WsCloudInstallRelayClientRpc = Rpc.make(WS_METHODS.cloudInstallRelayClient, {
  payload: Schema.Struct({}),
  success: RelayClientInstallProgressEventSchema,
  error: Schema.Union([RelayClientInstallFailedError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsServerReportClientActivityRpc = Rpc.make(WS_METHODS.serverReportClientActivity, {
  payload: ClientActivityReportInput,
  error: EnvironmentAuthorizationError,
});

const WsServerReportHostPowerStateRpc = Rpc.make(WS_METHODS.serverReportHostPowerState, {
  payload: HostPowerSnapshot,
  error: EnvironmentAuthorizationError,
});

const WsServerGetBackgroundPolicyRpc = Rpc.make(WS_METHODS.serverGetBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
});

const WsChatImportDiscoverRpc = Rpc.make(WS_METHODS.chatImportDiscover, {
  payload: T3ChatImportDiscoverInput,
  success: T3ChatImportDiscoverResult,
  error: Schema.Union([T3ChatImportError, EnvironmentAuthorizationError]),
});

const WsChatImportRunRpc = Rpc.make(WS_METHODS.chatImportRun, {
  payload: T3ChatImportRunInput,
  success: T3ChatImportRunResult,
  error: Schema.Union([T3ChatImportError, EnvironmentAuthorizationError]),
});

const WsHarnessChatSyncSourcesRpc = Rpc.make(WS_METHODS.harnessChatSyncSources, {
  payload: HarnessChatSyncSourcesInput,
  success: HarnessChatSyncSourcesResult,
  error: Schema.Union([HarnessChatSyncError, EnvironmentAuthorizationError]),
});

const WsHarnessChatSyncListRpc = Rpc.make(WS_METHODS.harnessChatSyncList, {
  payload: HarnessChatSyncListInput,
  success: HarnessChatSyncListResult,
  error: Schema.Union([HarnessChatSyncError, EnvironmentAuthorizationError]),
});

const WsHarnessChatSyncRunRpc = Rpc.make(WS_METHODS.harnessChatSyncRun, {
  payload: HarnessChatSyncRunInput,
  success: HarnessChatSyncRunResult,
  error: Schema.Union([HarnessChatSyncError, EnvironmentAuthorizationError]),
});

const WsHarnessChatSyncStatusRpc = Rpc.make(WS_METHODS.harnessChatSyncStatus, {
  payload: HarnessChatSyncStatusInput,
  success: HarnessChatSyncStatusResult,
  error: Schema.Union([HarnessChatSyncError, EnvironmentAuthorizationError]),
});

const WsSkillsListRpc = Rpc.make(WS_METHODS.skillsList, {
  payload: SkillListInput,
  success: SkillListResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsDiscoverImportSourcesRpc = Rpc.make(WS_METHODS.skillsDiscoverImportSources, {
  payload: SkillDiscoverImportSourcesInput,
  success: SkillDiscoverImportSourcesResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsImportSourcesRpc = Rpc.make(WS_METHODS.skillsImportSources, {
  payload: SkillImportSourcesInput,
  success: SkillImportSourcesResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsCreateRpc = Rpc.make(WS_METHODS.skillsCreate, {
  payload: SkillCreateInput,
  success: SkillMutationResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsUpdateRpc = Rpc.make(WS_METHODS.skillsUpdate, {
  payload: SkillUpdateInput,
  success: SkillMutationResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsRenameRpc = Rpc.make(WS_METHODS.skillsRename, {
  payload: SkillRenameInput,
  success: SkillMutationResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsDeleteRpc = Rpc.make(WS_METHODS.skillsDelete, {
  payload: SkillDeleteInput,
  success: SkillListResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsSkillsSetEnabledRpc = Rpc.make(WS_METHODS.skillsSetEnabled, {
  payload: SkillSetEnabledInput,
  success: SkillMutationResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});

const WsMcpListRpc = Rpc.make(WS_METHODS.mcpList, {
  payload: McpListInput,
  success: McpListResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpDiscoverImportSourcesRpc = Rpc.make(WS_METHODS.mcpDiscoverImportSources, {
  payload: McpDiscoverImportSourcesInput,
  success: McpDiscoverImportSourcesResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpCreateRpc = Rpc.make(WS_METHODS.mcpCreate, {
  payload: McpCreateInput,
  success: McpMutationResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpUpdateRpc = Rpc.make(WS_METHODS.mcpUpdate, {
  payload: McpUpdateInput,
  success: McpMutationResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpDeleteRpc = Rpc.make(WS_METHODS.mcpDelete, {
  payload: McpDeleteInput,
  success: McpMutationResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpSetEnabledRpc = Rpc.make(WS_METHODS.mcpSetEnabled, {
  payload: McpSetEnabledInput,
  success: McpMutationResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpSetProviderEnabledRpc = Rpc.make(WS_METHODS.mcpSetProviderEnabled, {
  payload: McpSetProviderEnabledInput,
  success: McpSetProviderEnabledResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpImportCursorJsonRpc = Rpc.make(WS_METHODS.mcpImportCursorJson, {
  payload: McpImportCursorJsonInput,
  success: McpMutationResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpImportSourcesRpc = Rpc.make(WS_METHODS.mcpImportSources, {
  payload: McpImportSourcesInput,
  success: McpMutationResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpExportCursorJsonRpc = Rpc.make(WS_METHODS.mcpExportCursorJson, {
  payload: McpExportCursorJsonInput,
  success: McpCursorJsonResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpProviderStatusRpc = Rpc.make(WS_METHODS.mcpProviderStatus, {
  payload: McpProviderStatusInput,
  success: McpProviderStatusResult,
  error: Schema.Union([McpConfigError, EnvironmentAuthorizationError]),
});

const WsMcpRuntimeContextsRpc = Rpc.make(WS_METHODS.mcpRuntimeContexts, {
  payload: McpRuntimeContextsInput,
  success: McpRuntimeContextsResult,
  error: Schema.Union([McpRuntimeError, EnvironmentAuthorizationError]),
});

const WsMcpRuntimeContextChangesRpc = Rpc.make(WS_METHODS.mcpRuntimeContextChanges, {
  payload: McpRuntimeContextChangesInput,
  success: McpRuntimeContextChange,
  error: Schema.Union([McpRuntimeError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsMcpRuntimeSnapshotRpc = Rpc.make(WS_METHODS.mcpRuntimeSnapshot, {
  payload: McpRuntimeSnapshotInput,
  success: McpRuntimeSnapshot,
  error: Schema.Union([McpRuntimeError, EnvironmentAuthorizationError]),
});

const WsMcpRuntimeChangesRpc = Rpc.make(WS_METHODS.mcpRuntimeChanges, {
  payload: McpRuntimeChangesInput,
  success: McpRuntimeChange,
  error: Schema.Union([McpRuntimeError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsMcpRuntimeServerDetailsRpc = Rpc.make(WS_METHODS.mcpRuntimeServerDetails, {
  payload: McpRuntimeServerDetailsInput,
  success: McpRuntimeServerDetailsResult,
  error: Schema.Union([McpRuntimeError, EnvironmentAuthorizationError]),
});

const WsMcpRuntimeActionRpc = Rpc.make(WS_METHODS.mcpRuntimeAction, {
  payload: McpRuntimeActionInput,
  success: McpRuntimeActionResult,
  error: Schema.Union([McpRuntimeError, EnvironmentAuthorizationError]),
});

const PullRequestRpcError = Schema.Union([
  PullRequestUnavailableError,
  PullRequestOperationError,
  EnvironmentAuthorizationError,
]);

const WsPullRequestsListRpc = Rpc.make(WS_METHODS.pullRequestsList, {
  payload: PullRequestListInput,
  success: PullRequestListResult,
  error: PullRequestRpcError,
});

/**
 * The line counts for rows already on the page. Its own call because on GitHub the pair costs
 * 40-60% of the listing read that answers everything else on the row, so the rows arrive first
 * and their stats a moment later.
 */
const WsPullRequestsListStatsRpc = Rpc.make(WS_METHODS.pullRequestsListStats, {
  payload: PullRequestListStatsInput,
  success: PullRequestListStatsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsSummaryRpc = Rpc.make(WS_METHODS.pullRequestsSummary, {
  payload: PullRequestRef,
  success: PullRequestSummary,
  error: PullRequestRpcError,
});

const WsPullRequestsDetailRpc = Rpc.make(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestRef,
  success: PullRequestDetail,
  error: PullRequestRpcError,
});

const WsPullRequestsActivityRpc = Rpc.make(WS_METHODS.pullRequestsActivity, {
  payload: PullRequestRef,
  success: PullRequestActivity,
  error: PullRequestRpcError,
});

const WsPullRequestsThreadCommentsRpc = Rpc.make(WS_METHODS.pullRequestsThreadComments, {
  payload: PullRequestThreadCommentsInput,
  success: PullRequestThreadCommentsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsDiffFileContentsRpc = Rpc.make(WS_METHODS.pullRequestsDiffFileContents, {
  payload: PullRequestDiffFileContentsInput,
  success: PullRequestDiffFileContentsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsRunActionRpc = Rpc.make(WS_METHODS.pullRequestsRunAction, {
  payload: PullRequestActionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsUpdateRpc = Rpc.make(WS_METHODS.pullRequestsUpdate, {
  payload: PullRequestUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsCommentRpc = Rpc.make(WS_METHODS.pullRequestsComment, {
  payload: PullRequestCommentInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsUpdateCommentRpc = Rpc.make(WS_METHODS.pullRequestsUpdateComment, {
  payload: PullRequestCommentUpdateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubmitReviewRpc = Rpc.make(WS_METHODS.pullRequestsSubmitReview, {
  payload: PullRequestSubmitReviewInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsReplyToThreadRpc = Rpc.make(WS_METHODS.pullRequestsReplyToThread, {
  payload: PullRequestThreadReplyInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSetThreadResolutionRpc = Rpc.make(WS_METHODS.pullRequestsSetThreadResolution, {
  payload: PullRequestThreadResolutionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSetReactionRpc = Rpc.make(WS_METHODS.pullRequestsSetReaction, {
  payload: PullRequestReactionInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsInvalidateRpc = Rpc.make(WS_METHODS.pullRequestsInvalidate, {
  payload: PullRequestInvalidateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubscribeRefreshesRpc = Rpc.make(WS_METHODS.pullRequestsSubscribeRefreshes, {
  payload: Schema.Struct({}),
  success: NonNegativeInt,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/**
 * Read on its own rather than as part of the detail: the people who may be asked are only wanted
 * once somebody opens the menu, and reading them with every change request would spend a request
 * per host on a list nobody looked at.
 */
const WsPullRequestsReviewerCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsReviewerCandidates, {
  payload: PullRequestRef,
  success: PullRequestReviewerCandidateList,
  error: PullRequestRpcError,
});

const WsPullRequestsRequestReviewersRpc = Rpc.make(WS_METHODS.pullRequestsRequestReviewers, {
  payload: PullRequestReviewerRequestInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

/** Read when the label menu opens, for the same reason the reviewer candidates are. */
const WsPullRequestsLabelCandidatesRpc = Rpc.make(WS_METHODS.pullRequestsLabelCandidates, {
  payload: PullRequestRef,
  success: PullRequestLabelCandidateList,
  error: PullRequestRpcError,
});

const WsPullRequestsSetLabelsRpc = Rpc.make(WS_METHODS.pullRequestsSetLabels, {
  payload: PullRequestLabelChangeInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsSourceControlLookupRepositoryRpc = Rpc.make(WS_METHODS.sourceControlLookupRepository, {
  payload: SourceControlRepositoryLookupInput,
  success: SourceControlRepositoryInfo,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSourceControlCloneRepositoryRpc = Rpc.make(WS_METHODS.sourceControlCloneRepository, {
  payload: SourceControlCloneRepositoryInput,
  success: SourceControlCloneRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSourceControlPublishRepositoryRpc = Rpc.make(WS_METHODS.sourceControlPublishRepository, {
  payload: SourceControlPublishRepositoryInput,
  success: SourceControlPublishRepositoryResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: Schema.Union([ProjectSearchEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsSearchContentsRpc = Rpc.make(WS_METHODS.projectsSearchContents, {
  payload: ProjectSearchContentsInput,
  success: ProjectSearchContentsResult,
  error: Schema.Union([ProjectSearchContentsError, EnvironmentAuthorizationError]),
});

const WsProjectsListEntriesRpc = Rpc.make(WS_METHODS.projectsListEntries, {
  payload: ProjectListEntriesInput,
  success: ProjectListEntriesResult,
  error: Schema.Union([ProjectListEntriesError, EnvironmentAuthorizationError]),
});

const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: Schema.Union([ProjectReadFileError, EnvironmentAuthorizationError]),
});

const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: Schema.Union([
    ProjectWriteFileError,
    ProjectWriteConflictError,
    EnvironmentAuthorizationError,
  ]),
});

const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: Schema.Union([FilesystemBrowseError, EnvironmentAuthorizationError]),
});

const WsAgentSessionsScanRpc = Rpc.make(WS_METHODS.agentSessionsScan, {
  payload: AgentSessionScanInput,
  success: AgentSessionScanResult,
  error: Schema.Union([AgentSessionScanError, EnvironmentAuthorizationError]),
});

const WsAgentSessionsImportRpc = Rpc.make(WS_METHODS.agentSessionsImport, {
  payload: AgentSessionImportInput,
  success: AgentSessionImportResult,
  error: Schema.Union([
    AgentSessionImportProjectChangedError,
    AgentSessionImportProjectNotFoundError,
    AgentSessionScanError,
    EnvironmentAuthorizationError,
  ]),
});

const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

const WsAttachmentsCreateUploadUrlRpc = Rpc.make(WS_METHODS.attachmentsCreateUploadUrl, {
  payload: AttachmentCreateUploadUrlInput,
  success: AttachmentCreateUploadUrlResult,
  error: Schema.Union([AttachmentUploadSigningKeyError, EnvironmentAuthorizationError]),
});

const WsAttachmentsDeleteRpc = Rpc.make(WS_METHODS.attachmentsDelete, {
  payload: AttachmentDeleteInput,
  error: EnvironmentAuthorizationError,
});

const WsProviderUploadFeedbackRpc = Rpc.make(WS_METHODS.providerUploadFeedback, {
  payload: ProviderUploadFeedbackInput,
  success: ProviderUploadFeedbackResult,
  error: Schema.Union([ProviderUploadFeedbackError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusInput,
  success: VcsStatusStreamEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsVcsPullRpc = Rpc.make(WS_METHODS.vcsPull, {
  payload: VcsPullInput,
  success: VcsPullResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRefreshStatusRpc = Rpc.make(WS_METHODS.vcsRefreshStatus, {
  payload: VcsStatusInput,
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsGitSubscribeWorkbenchRpc = Rpc.make(WS_METHODS.gitSubscribeWorkbench, {
  payload: GitWorkbenchInput,
  success: GitWorkbenchStreamEvent,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsGitRefreshWorkbenchRpc = Rpc.make(WS_METHODS.gitRefreshWorkbench, {
  payload: GitWorkbenchInput,
  success: GitWorkbenchSnapshot,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitGetRepositoryInsightsRpc = Rpc.make(WS_METHODS.gitGetRepositoryInsights, {
  payload: GitRepositoryInsightsInput,
  success: GitRepositoryInsightsResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitListHistoryRpc = Rpc.make(WS_METHODS.gitListHistory, {
  payload: GitHistoryListInput,
  success: GitHistoryListResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitGetCommitDetailRpc = Rpc.make(WS_METHODS.gitGetCommitDetail, {
  payload: GitCommitDetailInput,
  success: GitCommitDetailResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitGetCommitFileDiffRpc = Rpc.make(WS_METHODS.gitGetCommitFileDiff, {
  payload: GitCommitFileDiffInput,
  success: GitCommitFileDiffResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitGetChangesDiffRpc = Rpc.make(WS_METHODS.gitGetChangesDiff, {
  payload: GitChangesDiffInput,
  success: GitChangesDiffResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitGetInteractiveRebasePlanRpc = Rpc.make(WS_METHODS.gitGetInteractiveRebasePlan, {
  payload: GitInteractiveRebasePlanInput,
  success: GitInteractiveRebasePlanResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitApplyChangeSelectionRpc = Rpc.make(WS_METHODS.gitApplyChangeSelection, {
  payload: GitApplyChangeSelectionInput,
  success: GitApplyChangeSelectionResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitRunWorkbenchOperationRpc = Rpc.make(WS_METHODS.gitRunWorkbenchOperation, {
  payload: GitWorkbenchRunOperationInput,
  success: GitWorkbenchOperationEvent,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsGitListUndoSnapshotsRpc = Rpc.make(WS_METHODS.gitListUndoSnapshots, {
  payload: GitUndoSnapshotsListInput,
  success: GitUndoSnapshotsListResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitCreateUndoSnapshotRpc = Rpc.make(WS_METHODS.gitCreateUndoSnapshot, {
  payload: GitUndoSnapshotCreateInput,
  success: GitUndoSnapshotCreateResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitRestoreUndoSnapshotRpc = Rpc.make(WS_METHODS.gitRestoreUndoSnapshot, {
  payload: GitUndoSnapshotRestoreInput,
  success: GitUndoSnapshotRestoreResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitUpsertQueuedWorkflowRpc = Rpc.make(WS_METHODS.gitUpsertQueuedWorkflow, {
  payload: GitQueuedWorkflowUpsertInput,
  success: GitQueuedWorkflowUpsertResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsGitCancelQueuedWorkflowRpc = Rpc.make(WS_METHODS.gitCancelQueuedWorkflow, {
  payload: GitQueuedWorkflowCancelInput,
  success: GitQueuedWorkflowCancelResult,
  error: Schema.Union([GitWorkbenchServiceError, EnvironmentAuthorizationError]),
});

const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  payload: VcsCreateWorktreeInput,
  success: VcsCreateWorktreeResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsRemoveWorktreeRpc = Rpc.make(WS_METHODS.vcsRemoveWorktree, {
  payload: VcsRemoveWorktreeInput,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateRefRpc = Rpc.make(WS_METHODS.vcsCreateRef, {
  payload: VcsCreateRefInput,
  success: VcsCreateRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsSwitchRefRpc = Rpc.make(WS_METHODS.vcsSwitchRef, {
  payload: VcsSwitchRefInput,
  success: VcsSwitchRefResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsInitRpc = Rpc.make(WS_METHODS.vcsInit, {
  payload: VcsInitInput,
  error: Schema.Union([VcsError, EnvironmentAuthorizationError]),
});

/**
 * Ephemeral live diff preview for compact/mobile surfaces.
 * Not the persisted T3 Review model. Future review sessions should use
 * review.open* + review.getSnapshot.
 */
const WsReviewGetDiffPreviewRpc = Rpc.make(WS_METHODS.reviewGetDiffPreview, {
  payload: ReviewDiffPreviewInput,
  success: ReviewDiffPreviewResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsReviewGetDiffFileContentsRpc = Rpc.make(WS_METHODS.reviewGetDiffFileContents, {
  payload: ReviewDiffFileContentsInput,
  success: ReviewDiffFileContentsResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalAttachRpc = Rpc.make(WS_METHODS.terminalAttach, {
  payload: TerminalAttachInput,
  success: TerminalAttachStreamEvent,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsPreviewOpenRpc = Rpc.make(WS_METHODS.previewOpen, {
  payload: PreviewOpenInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewNavigateRpc = Rpc.make(WS_METHODS.previewNavigate, {
  payload: PreviewNavigateInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewResizeRpc = Rpc.make(WS_METHODS.previewResize, {
  payload: PreviewResizeInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewRefreshRpc = Rpc.make(WS_METHODS.previewRefresh, {
  payload: PreviewRefreshInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewCloseRpc = Rpc.make(WS_METHODS.previewClose, {
  payload: PreviewCloseInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewListRpc = Rpc.make(WS_METHODS.previewList, {
  payload: PreviewListInput,
  success: PreviewListResult,
  error: EnvironmentAuthorizationError,
});

const WsPreviewReportStatusRpc = Rpc.make(WS_METHODS.previewReportStatus, {
  payload: PreviewReportStatusInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewAutomationConnectRpc = Rpc.make(WS_METHODS.previewAutomationConnect, {
  payload: PreviewAutomationHost,
  success: PreviewAutomationStreamEvent,
  error: Schema.Union([PreviewAutomationError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsPreviewAutomationRespondRpc = Rpc.make(WS_METHODS.previewAutomationRespond, {
  payload: PreviewAutomationResponse,
  error: Schema.Union([PreviewAutomationError, EnvironmentAuthorizationError]),
});

const WsPreviewAutomationFocusHostRpc = Rpc.make(WS_METHODS.previewAutomationFocusHost, {
  payload: PreviewAutomationHostFocus,
  error: EnvironmentAuthorizationError,
});

const WsSubscribePreviewEventsRpc = Rpc.make(WS_METHODS.subscribePreviewEvents, {
  payload: Schema.Struct({}),
  success: PreviewEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeDiscoveredLocalServersRpc = Rpc.make(WS_METHODS.subscribeDiscoveredLocalServers, {
  payload: Schema.Struct({
    configuredUrls: Schema.optional(ConfiguredLocalServerUrls),
  }),
  success: DiscoveredLocalServerList,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsOrchestrationDispatchCommandRpc = Rpc.make(ORCHESTRATION_WS_METHODS.dispatchCommand, {
  payload: ClientOrchestrationCommand,
  success: OrchestrationRpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetWorkflowScriptRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getWorkflowScript, {
  payload: OrchestrationRpcSchemas.getWorkflowScript.input,
  success: OrchestrationRpcSchemas.getWorkflowScript.output,
  error: Schema.Union([OrchestrationGetWorkflowScriptError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
  payload: OrchestrationGetFullThreadDiffInput,
  success: OrchestrationRpcSchemas.getFullThreadDiff.output,
  error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationSearchThreadsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.searchThreads, {
  payload: OrchestrationSearchThreadsInput,
  success: OrchestrationRpcSchemas.searchThreads.output,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

const WsOrchestrationExportThreadTranscriptRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.exportThreadTranscript,
  {
    payload: OrchestrationExportThreadTranscriptInput,
    success: OrchestrationThreadTranscriptExport,
    error: Schema.Union([
      OrchestrationThreadTranscriptNotFoundError,
      OrchestrationThreadTranscriptExportError,
      EnvironmentAuthorizationError,
    ]),
  },
);
const WsOrchestrationGetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationRpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationRpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationSubscribeThreadRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeThread, {
  payload: OrchestrationRpcSchemas.subscribeThread.input,
  success: OrchestrationRpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationSubscribeSubagentRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeSubagent, {
  payload: OrchestrationRpcSchemas.subscribeSubagent.input,
  success: OrchestrationRpcSchemas.subscribeSubagent.output,
  error: Schema.Union([OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const KnowledgeGraphRpcError = Schema.Union([
  KnowledgeGraphOperationError,
  EnvironmentAuthorizationError,
]);

export const WsKnowledgeGraphSubscribeRpc = Rpc.make(WS_METHODS.knowledgeGraphSubscribe, {
  payload: KnowledgeGraphSubscribeInput,
  success: KnowledgeGraphStreamEvent,
  error: KnowledgeGraphRpcError,
  stream: true,
});

export const WsKnowledgeGraphQueryRpc = Rpc.make(WS_METHODS.knowledgeGraphQuery, {
  payload: KnowledgeGraphQueryInput,
  success: KnowledgeGraphQueryResultV1,
  error: KnowledgeGraphRpcError,
});

export const WsKnowledgeGraphNodeContentRpc = Rpc.make(WS_METHODS.knowledgeGraphNodeContent, {
  payload: KnowledgeGraphNodeContentInput,
  success: KnowledgeGraphNodeContentResultV1,
  error: KnowledgeGraphRpcError,
});

export const WsKnowledgeGraphRebuildRpc = Rpc.make(WS_METHODS.knowledgeGraphRebuild, {
  payload: KnowledgeGraphRebuildInput,
  success: KnowledgeGraphMutationResultV1,
  error: KnowledgeGraphRpcError,
});

export const WsKnowledgeGraphCancelRpc = Rpc.make(WS_METHODS.knowledgeGraphCancel, {
  payload: KnowledgeGraphCancelInput,
  success: KnowledgeGraphMutationResultV1,
  error: KnowledgeGraphRpcError,
});

export const WsKnowledgeGraphPauseRpc = Rpc.make(WS_METHODS.knowledgeGraphPause, {
  payload: KnowledgeGraphPauseInput,
  success: KnowledgeGraphMutationResultV1,
  error: KnowledgeGraphRpcError,
});

export const WsKnowledgeGraphClearRpc = Rpc.make(WS_METHODS.knowledgeGraphClear, {
  payload: KnowledgeGraphClearInput,
  success: KnowledgeGraphMutationResultV1,
  error: KnowledgeGraphRpcError,
});

const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({
    /**
     * Whether this client understands `environmentThemesUpdated` events.
     * Already-shipped clients decode the stream against the old event union
     * and would die on an unknown member, so the server emits the theme
     * stream only to subscribers that ask for it. Absent on old clients;
     * dropped by old servers.
     */
    environmentThemes: Schema.optional(Schema.Boolean),
    /** Whether this client understands `usageLimitSourcesUpdated` events. */
    usageLimitSources: Schema.optional(Schema.Boolean),
    /**
     * Whether this client answers `/usage-limits` itself. The server injects
     * that command into provider catalogs only for such clients; an older
     * client would send it to the provider as an ordinary prompt.
     */
    usageLimitsCommand: Schema.optional(Schema.Boolean),
  }),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeBackgroundPolicyRpc = Rpc.make(WS_METHODS.subscribeBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeResourceTelemetryRpc = Rpc.make(WS_METHODS.subscribeResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetrySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsSubscribeResourceProtectionRpc = Rpc.make(WS_METHODS.subscribeResourceProtection, {
  payload: Schema.Struct({}),
  success: ResourceProtectionSnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsProviderConsumeResetCreditRpc,
  WsProviderAuthStartRpc,
  WsProviderAuthCompleteRpc,
  WsProviderAuthCancelRpc,
  WsProviderAuthLogoutRpc,
  WsProviderAuthSubscribeRpc,
  WsProviderInstallStartRpc,
  WsProviderInstallCancelRpc,
  WsProviderInstallSubscribeRpc,
  WsProviderInstallRemoveRpc,
  WsServerProviderAuthConnectRpc,
  WsServerProviderAuthSetCredentialRpc,
  WsServerProviderAuthDisconnectRpc,
  WsServerUpdateServerRpc,
  WsServerUpdateServerWithProgressRpc,
  WsServerCommitDesktopUpdateRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsProviderCompactThreadRpc,
  WsProjectMemoryViewRpc,
  WsProjectMemoryUpdateSettingsRpc,
  WsProjectMemoryReplaceRpc,
  WsProjectMemoryImportRpc,
  WsProjectMemoryClearRpc,
  WsServerCreateAssemblyAiStreamingTokenRpc,
  WsSpeechStartStreamingSessionRpc,
  WsSpeechPushStreamingAudioRpc,
  WsSpeechFinishStreamingSessionRpc,
  WsSpeechCancelStreamingSessionRpc,
  WsSpeechGetProjectProfileRpc,
  WsSpeechListProjectProfilesRpc,
  WsSpeechIndexProjectRpc,
  WsSpeechCreateBasicProjectProfileRpc,
  WsSpeechTranslateTranscriptRpc,
  WsPromptImproveRpc,
  WsPlanReviewParallelismRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetHostResourcesRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetResourceTelemetryHistoryRpc,
  WsServerRetryResourceTelemetryRpc,
  WsServerGetUsageSummaryRpc,
  WsServerRefreshUsageRatesRpc,
  WsServerSignalProcessRpc,
  WsServerReportClientActivityRpc,
  WsServerReportHostPowerStateRpc,
  WsServerGetBackgroundPolicyRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsChatImportDiscoverRpc,
  WsChatImportRunRpc,
  WsHarnessChatSyncSourcesRpc,
  WsHarnessChatSyncListRpc,
  WsHarnessChatSyncRunRpc,
  WsHarnessChatSyncStatusRpc,
  WsSkillsListRpc,
  WsSkillsDiscoverImportSourcesRpc,
  WsSkillsImportSourcesRpc,
  WsSkillsCreateRpc,
  WsSkillsUpdateRpc,
  WsSkillsRenameRpc,
  WsSkillsDeleteRpc,
  WsSkillsSetEnabledRpc,
  WsMcpListRpc,
  WsMcpDiscoverImportSourcesRpc,
  WsMcpCreateRpc,
  WsMcpUpdateRpc,
  WsMcpDeleteRpc,
  WsMcpSetEnabledRpc,
  WsMcpSetProviderEnabledRpc,
  WsMcpImportCursorJsonRpc,
  WsMcpImportSourcesRpc,
  WsMcpExportCursorJsonRpc,
  WsMcpProviderStatusRpc,
  WsMcpRuntimeContextsRpc,
  WsMcpRuntimeContextChangesRpc,
  WsMcpRuntimeSnapshotRpc,
  WsMcpRuntimeChangesRpc,
  WsMcpRuntimeServerDetailsRpc,
  WsMcpRuntimeActionRpc,
  WsPullRequestsListRpc,
  WsPullRequestsListStatsRpc,
  WsPullRequestsSummaryRpc,
  WsPullRequestsDetailRpc,
  WsPullRequestsActivityRpc,
  WsPullRequestsThreadCommentsRpc,
  WsPullRequestsDiffFileContentsRpc,
  WsPullRequestsRunActionRpc,
  WsPullRequestsUpdateRpc,
  WsPullRequestsCommentRpc,
  WsPullRequestsUpdateCommentRpc,
  WsPullRequestsSubmitReviewRpc,
  WsPullRequestsReplyToThreadRpc,
  WsPullRequestsSetThreadResolutionRpc,
  WsPullRequestsSetReactionRpc,
  WsPullRequestsInvalidateRpc,
  WsPullRequestsSubscribeRefreshesRpc,
  WsPullRequestsReviewerCandidatesRpc,
  WsPullRequestsRequestReviewersRpc,
  WsPullRequestsLabelCandidatesRpc,
  WsPullRequestsSetLabelsRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsProjectsListEntriesRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchContentsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsAgentSessionsScanRpc,
  WsAgentSessionsImportRpc,
  WsAssetsCreateUrlRpc,
  WsAttachmentsCreateUploadUrlRpc,
  WsAttachmentsDeleteRpc,
  WsProviderUploadFeedbackRpc,
  WsKnowledgeGraphSubscribeRpc,
  WsKnowledgeGraphQueryRpc,
  WsKnowledgeGraphNodeContentRpc,
  WsKnowledgeGraphRebuildRpc,
  WsKnowledgeGraphCancelRpc,
  WsKnowledgeGraphPauseRpc,
  WsKnowledgeGraphClearRpc,
  WsSubscribeVcsStatusRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitSubscribeWorkbenchRpc,
  WsGitRefreshWorkbenchRpc,
  WsGitGetRepositoryInsightsRpc,
  WsGitListHistoryRpc,
  WsGitGetCommitDetailRpc,
  WsGitGetCommitFileDiffRpc,
  WsGitGetChangesDiffRpc,
  WsGitGetInteractiveRebasePlanRpc,
  WsGitApplyChangeSelectionRpc,
  WsGitRunWorkbenchOperationRpc,
  WsGitListUndoSnapshotsRpc,
  WsGitCreateUndoSnapshotRpc,
  WsGitRestoreUndoSnapshotRpc,
  WsGitUpsertQueuedWorkflowRpc,
  WsGitCancelQueuedWorkflowRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsReviewGetDiffPreviewRpc,
  WsReviewGetDiffFileContentsRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeTerminalMetadataRpc,
  WsPreviewOpenRpc,
  WsPreviewNavigateRpc,
  WsPreviewResizeRpc,
  WsPreviewRefreshRpc,
  WsPreviewCloseRpc,
  WsPreviewListRpc,
  WsPreviewReportStatusRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsSubscribePreviewEventsRpc,
  WsSubscribeDiscoveredLocalServersRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeBackgroundPolicyRpc,
  WsSubscribeResourceTelemetryRpc,
  WsSubscribeResourceProtectionRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetWorkflowScriptRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationSearchThreadsRpc,
  WsOrchestrationExportThreadTranscriptRpc,
  WsOrchestrationGetArchivedShellSnapshotRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestrationSubscribeSubagentRpc,
);
