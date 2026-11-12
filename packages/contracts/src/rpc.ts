import {
  OrchestrationV2SearchThreadError,
  OrchestrationV2SearchThreadInput,
  OrchestrationV2SearchThreadResult,
  OrchestrationV2SearchThreadsInput,
  OrchestrationV2SearchThreadsResult,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationGetWorkflowScriptError,
  OrchestrationV2GetNativeChildWorkError,
  OrchestrationV2StopWorkflowError,
  OrchestrationV2ForceStopThreadError,
  OrchestrationV2DispatchCommandError,
  OrchestrationV2GetShellSnapshotError,
  OrchestrationV2CommandOutputError,
  OrchestrationV2GetThreadProjectionError,
  OrchestrationV2RpcSchemas,
  OrchestrationV2ThreadLaunchError,
} from "./orchestrationV2.ts";
import { OrchestrationDispatchCommandError } from "./orchestrationDispatch.ts";
import {
  McpAppCallToolInput,
  McpAppCallToolResult,
  McpAppReadResourceInput,
  McpAppReadResourceResult,
  McpAppRequestError,
  McpAppToolInfo,
  McpAppToolInfoInput,
  McpAppUpdateModelContextInput,
} from "./mcpApps.ts";
import {
  PeerLink,
  PeerLinkCreateInput,
  PeerLinkError,
  PeerLinkRemoveInput,
  PeerLinkRemoveResult,
  PeerLinkRequestAnswerInput,
  PeerLinkRequestError,
  PeerLinkSummary,
} from "./peerLink.ts";
import {
  ChatGptReconnectProfileInput,
  ChatGptReconnectProfile,
  ChatGptImportProfileInput,
  ChatGptHandoffInput,
  ChatGptHandoffState,
  ProviderAuthCancelInput,
  ProviderAuthCompleteInput,
  ProviderAuthState,
  ProviderAuthStartInput,
  ProviderAuthRespondInput,
  ProviderInstallCancelInput,
  ProviderInstallState,
  ProviderSetupError,
  ProviderSetupInput,
  CodexAuthCallbackInput,
  CodexAuthCallbackState,
} from "./providerSetup.ts";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  AcpRegistryAcceptUrlAuthInput,
  AcpRegistryAcceptUrlAuthResult,
  AcpRegistryDeleteSessionInput,
  AcpRegistryDeleteSessionResult,
  AcpRegistryDisableProviderInput,
  AcpRegistryDisableProviderResult,
  AcpRegistryImportSessionInput,
  AcpRegistryImportSessionResult,
  AcpRegistryListSessionsInput,
  AcpRegistryListSessionsResult,
  AcpRegistryListProvidersInput,
  AcpRegistryListProvidersResult,
  AcpRegistryLogoutInput,
  AcpRegistryLogoutResult,
  AcpRegistryManagedBinaryUninstallInput,
  AcpRegistryManagedBinaryUninstallResult,
  AcpRegistryOperationError,
  AcpRegistryPrepareInput,
  AcpRegistryPrepareResult,
  AcpRegistrySearchInput,
  AcpRegistrySearchResult,
  AcpRegistrySetProviderInput,
  AcpRegistrySetProviderResult,
} from "./acpRegistry.ts";
import { ExternalLauncherError, LaunchEditorInput } from "./editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  ClientActivityReportInput,
  BackgroundPolicySnapshot,
  HostPowerSnapshot,
} from "./background.ts";
import {
  FilesystemGetMetadataInput,
  FilesystemGetMetadataResult,
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
  PersistChatAttachmentsError,
  PersistChatAttachmentsInput,
  PersistChatAttachmentsResult,
} from "./chatAttachment.ts";
import {
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetTurnDiffError,
} from "./checkpointDiff.ts";
import {
  WorktreeSetupCancelInput,
  WorktreeSetupCancelResult,
  WorktreeSetupStreamEvent,
  WorktreeSetupSubscribeInput,
} from "./worktreeSetup.ts";
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
  VcsStatusSubscriptionInput,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "./git.ts";
import {
  ReviewBranchCommitsInput,
  ReviewBranchCommitsResult,
  ReviewDiffFileContentsInput,
  ReviewDiffFileContentsResult,
  ReviewDiffPreviewError,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
} from "./review.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import { OrchestrationSearchThreadsError } from "./threadSearch.ts";
import {
  ProviderUploadFeedbackError,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
  ProviderCompactThreadInput,
  ProviderCompactionError,
} from "./provider.ts";
import { ProviderInstanceId, ProviderInstanceMutation } from "./providerInstance.ts";
import {
  GuestShareCreateError,
  GuestShareCreateInput,
  GuestShareCreateResult,
} from "./guestShare.ts";
import { PullRequestReviewGuideResult } from "./pullRequestReviewGuide.ts";
import {
  PullRequestActionInput,
  PullRequestActivity,
  PullRequestChangeBreakdown,
  PullRequestCommentInput,
  PullRequestCommentUpdateInput,
  PullRequestDetail,
  PullRequestPreview,
  PullRequestChecks,
  PullRequestDiffFileContentsInput,
  PullRequestDiffFileContentsResult,
  PullRequestFilesViewedResult,
  PullRequestInvalidateInput,
  PullRequestReportStateInput,
  PullRequestListInput,
  PullRequestListResult,
  PullRequestListStatsInput,
  PullRequestListStatsResult,
  PullRequestFilterOptions,
  PullRequestFilterOptionsInput,
  PullRequestOperationError,
  PullRequestReactionInput,
  PullRequestRef,
  PullRequestRoutingResult,
  PullRequestRoutingIdentityInput,
  PullRequestRoutingIdentityResult,
  PullRequestStack,
  PullRequestLinkedThreadsResult,
  PullRequestSummary,
  PullRequestReviewerCandidateList,
  PullRequestReviewerRequestInput,
  PullRequestLabelCandidateList,
  PullRequestLabelChangeInput,
  PullRequestSetFilesViewedInput,
  PullRequestSubmitReviewInput,
  PullRequestThreadCommentsInput,
  PullRequestThreadCommentsResult,
  PullRequestThreadReplyInput,
  PullRequestThreadResolutionInput,
  PullRequestUnavailableError,
  PullRequestUpdateInput,
  PullRequestCheckLog,
  PullRequestCheckLogInput,
} from "./pullRequest.ts";
import {
  RelayClientInstallFailedError,
  RelayClientInstallProgressEventSchema,
  RelayClientStatusSchema,
} from "./relayClient.ts";
import {
  ProjectCreateNewInput,
  ProjectCreateNewResult,
  ProjectCreateFromThreadInput,
  ProjectCreateFromThreadResult,
  ProjectEnsureScratchResult,
  ProjectListEntriesError,
  ProjectListEntriesInput,
  ProjectListEntriesResult,
  ProjectListIgnoredFilesInput,
  ProjectListIgnoredFilesResult,
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
  Project,
  ProjectMutation,
  ProjectMutationError,
} from "./project.ts";
import {
  TerminalAttachInput,
  TerminalObserveInput,
  TerminalAttachStreamEvent,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalMetadataStreamEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
  TerminalEvent,
  TerminalRestartInput,
} from "./terminal.ts";
import {
  DiscoveredLocalServerList,
  ConfiguredLocalServerUrls,
  PreviewCloseInput,
  PreviewError,
  PreviewEvent,
  PreviewListInput,
  PreviewListResult,
  PreviewClearProfileError,
  PreviewClearProfileInput,
  PreviewReportProfilesInput,
  PreviewStopLocalServerError,
  PreviewStopLocalServerInput,
  PreviewOpenInput,
  PreviewReportStatusInput,
  PreviewResizeInput,
  PreviewAdjustInput,
  PreviewSessionSnapshot,
  PreviewNavigateInput,
  PreviewRefreshInput,
  PreviewPickElementInput,
  PreviewPickElementResult,
  PreviewPickElementError,
} from "./preview.ts";
import {
  DeviceActionInput,
  DeviceCloseInput,
  DeviceConfigureInput,
  DeviceDetail,
  DeviceDetailInput,
  DeviceError,
  DeviceListInput,
  SshDeviceHostConfig,
  DeviceEasAccount,
  DeviceEasAccountError,
  DeviceEasAccountInput,
  DeviceSimlockIdentity,
  DeviceSimlockIdentityError,
  DeviceSimlockIdentityInput,
  DeviceHostSummary,
  DeviceOpenInput,
  DeviceServiceState,
  DeviceSession,
  DeviceShutdownInput,
} from "./device.ts";
import {
  ServerConfigStreamEvent,
  DesktopUpdateCommitInput,
  OtlpEndpointCheckInput,
  ServerPrepareTriageError,
  ServerPrepareTriageInput,
  ServerPrepareTriageResult,
  OtlpEndpointCheckResult,
  ServerConfig,
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerLifecycleStreamEvent,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerNpmRelease,
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
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
import {
  StorageCleanupReport,
  DatabaseStorageStatus,
  ServerSettings,
  ServerSettingsError,
  ServerSettingsPatch,
} from "./settings.ts";
import {
  ScheduledTaskDeleteInput,
  ScheduledTaskDeleteResult,
  ScheduledTaskError,
  ScheduledTaskListInput,
  ScheduledTaskListResult,
  ScheduledTaskRunNowInput,
  ScheduledTaskRotateWebhookTokenInput,
  ScheduledTaskListWebhookDeliveriesInput,
  ScheduledTaskListWebhookDeliveriesResult,
  ScheduledTaskGetWebhookDeliveryInput,
  ScheduledTaskGetWebhookDeliveryResult,
  ScheduledTaskRunNowResult,
  ScheduledTaskSetEnabledInput,
  ScheduledTaskUpsertInput,
  ScheduledTaskMutationResult,
} from "./scheduledTask.ts";
import { SecretRequestAnswerInput, SecretRequestError } from "./secretRequest.ts";
import {
  ProjectCloneActionInput,
  ProjectCloneActionResult,
  ProjectCloneListEvent,
  ProjectCloneStartInput,
  ProjectCloneStartResult,
  ProjectCloneSubscribeInput,
} from "./projectClone.ts";
import {
  SourceControlCloneRepositoryInput,
  SourceControlCloneRepositoryResult,
  SourceControlDiscoveryResult,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryInfo,
  SourceControlRepositoryLookupInput,
  SourceControlAppAccess,
  SourceControlAppAccessInput,
  SourceControlStarredInput,
  SourceControlSignInError,
  SourceControlSignInInput,
  SourceControlSignInPrompt,
  SourceControlSignInResult,
} from "./sourceControl.ts";
import { VcsError } from "./vcs.ts";
import { DeepPlanError, DeepPlanGetRunInput, DeepPlanGetRunResult } from "./deepPlanning.ts";
import {
  DEEP_PLAN_WS_METHODS,
  DeepPlanCatalogSourcesInput,
  DeepPlanCatalogSourcesResult,
  DeepPlanExportSourcesInput,
  DeepPlanExportSourcesResult,
  DeepPlanReadExportChunkInput,
  DeepPlanReadExportChunkResult,
  DeepPlanInitializeSourcesInput,
  DeepPlanInitializeSourcesResult,
  DeepPlanImportSourceChunkInput,
  DeepPlanImportSourceChunkResult,
  DeepPlanListSourcesInput,
  DeepPlanListSourcesResult,
  DeepPlanReadSourceChunkInput,
  DeepPlanReadSourceChunkResult,
  DeepPlanSummarizeSourceInput,
  DeepPlanSummarizeSourceResult,
  DeepPlanSourceError,
} from "./deepPlanningSources.ts";
import {
  ProjectIndexGetSettingsInput,
  ProjectIndexSettings,
  ProjectIndexGetStatusInput,
  ProjectIndexStatusV1,
  ProjectIndexUpdateSettingsInput,
  ProjectIndexStartInput,
  ProjectIndexControlInput,
  ProjectIndexSubscribeInput,
  ProjectIndexStreamEvent,
  ProjectIndexActivityEvent,
  ProjectIndexQueryInput,
  ProjectIndexQueryResultV1,
  ProjectIndexModelCheckInput,
  ProjectIndexModelCheckResult,
  ProjectIndexReviewInput,
  ProjectIndexReviewResultV1,
  ProjectIndexOperationError,
} from "./projectIndexing.ts";
import {
  AiEndpointDiscoveryError,
  AiEndpointDiscoveryEvent,
  AiEndpointDiscoveryInput,
} from "./aiEndpoints.ts";
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
import {
  PlanParallelismReviewError,
  PlanParallelismReviewInput,
  PlanParallelismReviewResult,
} from "./planParallelismReview.ts";
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
  ExtensionCatalogSearchInput,
  ExtensionCatalogSearchResult,
  SkillRegistryPreviewInput,
  SkillRegistryPreviewResult,
  SkillRegistryInstallInput,
} from "./extensionCatalog.ts";
import {
  PreviewAutomationError,
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
} from "./previewAutomation.ts";
import {
  ImprovePromptInput,
  ProjectSpeechProfile,
  ProjectSpeechProfileError,
  ProjectSpeechProfileInput,
  SpeechStreamingStartInput,
  SpeechProcessDictationInput,
  SpeechProcessDictationResult,
  SpeechDictationError,
  AssemblyAiModelsResult,
  ProjectSpeechProfileListResult,
  ProjectTextTransformError,
  ProjectTextTransformResult,
  TranslateTranscriptInput,
} from "./speech.ts";
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
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

export const WS_METHODS = {
  deepPlanGetRun: DEEP_PLAN_WS_METHODS.getRun,
  deepPlanCatalogSources: DEEP_PLAN_WS_METHODS.catalogSources,
  deepPlanExportSources: DEEP_PLAN_WS_METHODS.exportSources,
  deepPlanReadExportChunk: DEEP_PLAN_WS_METHODS.readExportChunk,
  deepPlanInitializeSources: DEEP_PLAN_WS_METHODS.initializeSources,
  deepPlanImportSourceChunk: DEEP_PLAN_WS_METHODS.importSourceChunk,
  deepPlanListSources: DEEP_PLAN_WS_METHODS.listSources,
  deepPlanReadSourceChunk: DEEP_PLAN_WS_METHODS.readSourceChunk,
  deepPlanSummarizeSource: DEEP_PLAN_WS_METHODS.summarizeSource,
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  codexAuthCallbackSubscribe: "provider.codex.auth-callback.subscribe",
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
  terminalRestart: "terminal.restart",
  previewNavigate: "preview.navigate",
  previewRefresh: "preview.refresh",
  previewPickElementAt: "preview.pickElementAt",
  previewAutomationConnect: "previewAutomation.connect",
  previewAutomationRespond: "previewAutomation.respond",
  previewAutomationFocusHost: "previewAutomation.focusHost",
  serverProviderAuthConnect: "server.providerAuthConnect",
  serverProviderAuthSetCredential: "server.providerAuthSetCredential",
  serverProviderAuthDisconnect: "server.providerAuthDisconnect",
  serverGetSettings: "server.getSettings",
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
  speechProcessDictation: "speech.processDictation",
  speechListAssemblyAiModels: "speech.listAssemblyAiModels",
  promptImprove: "prompt.improve",
  planReviewParallelism: "plan.reviewParallelism",
  serverDiscoverAiEndpoints: "server.discoverAiEndpoints",
  serverReportHostPowerState: "server.reportHostPowerState",
  serverGetBackgroundPolicy: "server.getBackgroundPolicy",
  chatImportDiscover: "chatImport.discover",
  chatImportRun: "chatImport.run",
  harnessChatSyncSources: "harnessChatSync.sources",
  harnessChatSyncList: "harnessChatSync.list",
  harnessChatSyncRun: "harnessChatSync.run",
  harnessChatSyncStatus: "harnessChatSync.status",
  skillsList: "skills.list",
  skillsDiscoverImportSources: "skills.discoverImportSources",
  skillsImportSources: "skills.importSources",
  skillsCreate: "skills.create",
  skillsUpdate: "skills.update",
  skillsRename: "skills.rename",
  skillsDelete: "skills.delete",
  skillsSetEnabled: "skills.setEnabled",
  extensionCatalogSearch: "extensions.search",
  skillsPreviewRegistry: "skills.previewRegistry",
  skillsInstallRegistry: "skills.installRegistry",
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
  pullRequestsCheckLog: "pullRequests.checkLog",
  knowledgeGraphSubscribe: "knowledgeGraph.subscribe",
  knowledgeGraphQuery: "knowledgeGraph.query",
  knowledgeGraphNodeContent: "knowledgeGraph.nodeContent",
  knowledgeGraphRebuild: "knowledgeGraph.rebuild",
  knowledgeGraphCancel: "knowledgeGraph.cancel",
  knowledgeGraphPause: "knowledgeGraph.pause",
  knowledgeGraphClear: "knowledgeGraph.clear",
  projectIndexGetSettings: "projectIndex.getSettings",
  projectIndexGetStatus: "projectIndex.getStatus",
  projectIndexUpdateSettings: "projectIndex.updateSettings",
  projectIndexStart: "projectIndex.start",
  projectIndexControl: "projectIndex.control",
  projectIndexSubscribe: "projectIndex.subscribe",
  projectIndexSubscribeActivity: "projectIndex.subscribeActivity",
  projectIndexQuery: "projectIndex.query",
  projectIndexCheckModel: "projectIndex.checkModel",
  projectIndexReview: "projectIndex.review",
  gitSubscribeWorkbench: "git.subscribeWorkbench",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeBackgroundPolicy: "subscribeBackgroundPolicy",
  subscribeResourceProtection: "subscribeResourceProtection",
  projectsListEntries: "projects.listEntries",
  projectsListIgnoredFiles: "projects.listIgnoredFiles",
  projectsReadFile: "projects.readFile",
  projectsSearchContents: "projects.searchContents",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",
  projectsMutate: "projects.mutate",
  projectsEnsureScratch: "projects.ensureScratch",
  projectsCreateNew: "projects.createNew",
  projectsCreateFromThread: "projects.createFromThread",

  shellOpenInEditor: "shell.openInEditor",

  filesystemBrowse: "filesystem.browse",
  filesystemGetMetadata: "filesystem.getMetadata",
  agentSessionsScan: "agentSessions.scan",
  agentSessionsImport: "agentSessions.import",
  assetsCreateUrl: "assets.createUrl",
  assetsPersistChatAttachments: "assets.persistChatAttachments",
  attachmentsCreateUploadUrl: "attachments.createUploadUrl",
  attachmentsDelete: "attachments.delete",

  mcpAppsCallTool: "mcpApps.callTool",
  mcpAppsToolInfo: "mcpApps.toolInfo",
  mcpAppsReadResource: "mcpApps.readResource",
  mcpAppsUpdateModelContext: "mcpApps.updateModelContext",

  providerUploadFeedback: "provider.uploadFeedback",
  providerAuthStart: "provider.auth.start",
  providerConsumeResetCredit: "provider.consumeResetCredit",
  providerAuthComplete: "provider.auth.complete",
  chatGptReconnectProfile: "provider.chatgpt.reconnect-profile",
  chatGptImportProfile: "provider.chatgpt.import-profile",
  chatGptHandoffSubscribe: "provider.chatgpt.handoff.subscribe",
  providerAuthRespond: "provider.auth.respond",
  providerAuthCancel: "provider.auth.cancel",
  providerAuthLogout: "provider.auth.logout",
  providerAuthSubscribe: "provider.auth.subscribe",
  providerInstallStart: "provider.install.start",
  providerInstallCancel: "provider.install.cancel",
  providerInstallSubscribe: "provider.install.subscribe",
  providerInstallRemove: "provider.install.remove",

  vcsPull: "vcs.pull",
  vcsRefreshStatus: "vcs.refreshStatus",
  vcsListRefs: "vcs.listRefs",
  vcsCreateWorktree: "vcs.createWorktree",
  vcsRemoveWorktree: "vcs.removeWorktree",
  vcsCreateRef: "vcs.createRef",
  vcsSwitchRef: "vcs.switchRef",
  vcsInit: "vcs.init",

  gitRunStackedAction: "git.runStackedAction",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  reviewGetBranchCommits: "review.getBranchCommits",
  reviewGetDiffPreview: "review.getDiffPreview",
  reviewGetDiffFileContents: "review.getDiffFileContents",

  terminalOpen: "terminal.open",
  terminalAttach: "terminal.attach",
  terminalObserve: "terminal.observe",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalClose: "terminal.close",

  previewOpen: "preview.open",
  previewResize: "preview.resize",
  previewAdjust: "preview.adjust",
  previewClose: "preview.close",
  previewList: "preview.list",
  previewClearProfile: "preview.clearProfile",
  previewReportProfiles: "preview.reportProfiles",
  previewReportStatus: "preview.reportStatus",
  previewStopLocalServer: "preview.stopLocalServer",

  deviceConfigure: "device.configure",
  deviceList: "device.list",
  deviceTestHost: "device.testHost",
  deviceEasAccount: "device.easAccount",
  deviceSimlockIdentity: "device.simlockIdentity",
  deviceOpen: "device.open",
  deviceClose: "device.close",
  deviceShutdown: "device.shutdown",
  deviceDetail: "device.detail",
  deviceAction: "device.action",

  serverProbe: "server.probe",
  serverGetConfig: "server.getConfig",
  serverGetNpmRelease: "server.getNpmRelease",
  serverRefreshProviders: "server.refreshProviders",
  serverUpdateProvider: "server.updateProvider",
  serverUpdateServer: "server.updateServer",
  serverUpdateServerWithProgress: "server.updateServerWithProgress",
  serverCommitDesktopUpdate: "server.commitDesktopUpdate",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverRemoveKeybinding: "server.removeKeybinding",
  serverRunStorageCleanup: "server.runStorageCleanup",
  serverGetStorageCleanupReport: "server.getStorageCleanupReport",
  serverGetDatabaseStorage: "server.getDatabaseStorage",
  peerLinksList: "peerLinks.list",
  peerLinksLink: "peerLinks.link",
  peerLinksUnlink: "peerLinks.unlink",
  peerLinksAnswerRequest: "peerLinks.answerRequest",
  serverUpdateSettings: "server.updateSettings",
  serverDiscoverSourceControl: "server.discoverSourceControl",
  serverSearchAcpRegistry: "server.searchAcpRegistry",
  serverPrepareAcpRegistryAgent: "server.prepareAcpRegistryAgent",
  serverUninstallAcpRegistryManagedBinary: "server.uninstallAcpRegistryManagedBinary",
  serverAcceptAcpRegistryUrlAuth: "server.acceptAcpRegistryUrlAuth",
  serverListAcpRegistrySessions: "server.listAcpRegistrySessions",
  serverImportAcpRegistrySession: "server.importAcpRegistrySession",
  serverDeleteAcpRegistrySession: "server.deleteAcpRegistrySession",
  serverListAcpRegistryProviders: "server.listAcpRegistryProviders",
  serverSetAcpRegistryProvider: "server.setAcpRegistryProvider",
  serverDisableAcpRegistryProvider: "server.disableAcpRegistryProvider",
  serverLogoutAcpRegistry: "server.logoutAcpRegistry",
  serverGetTraceDiagnostics: "server.getTraceDiagnostics",
  serverGetProcessDiagnostics: "server.getProcessDiagnostics",
  serverGetHostResources: "server.getHostResources",
  serverGetProcessResourceHistory: "server.getProcessResourceHistory",
  serverGetResourceTelemetryHistory: "server.getResourceTelemetryHistory",
  serverRetryResourceTelemetry: "server.retryResourceTelemetry",
  serverCheckOtlpEndpoint: "server.checkOtlpEndpoint",
  serverPrepareTriage: "server.prepareTriage",
  serverSignalProcess: "server.signalProcess",
  serverReportClientActivity: "server.reportClientActivity",
  serverGetUsageSummary: "server.getUsageSummary",
  serverRefreshUsageRates: "server.refreshUsageRates",

  scheduledTasksSubscribe: "scheduledTasks.subscribe",
  scheduledTasksUpsert: "scheduledTasks.upsert",
  scheduledTasksSetEnabled: "scheduledTasks.setEnabled",
  scheduledTasksDelete: "scheduledTasks.delete",
  scheduledTasksRunNow: "scheduledTasks.runNow",
  scheduledTasksRotateWebhookToken: "scheduledTasks.rotateWebhookToken",
  secretsAnswerRequest: "secrets.answerRequest",
  guestShareCreate: "guestShare.create",
  scheduledTasksListWebhookDeliveries: "scheduledTasks.listWebhookDeliveries",
  scheduledTasksGetWebhookDelivery: "scheduledTasks.getWebhookDelivery",

  cloudGetRelayClientStatus: "cloud.getRelayClientStatus",
  cloudInstallRelayClient: "cloud.installRelayClient",

  pullRequestsList: "pullRequests.list",
  pullRequestsListStats: "pullRequests.listStats",
  pullRequestsFilterOptions: "pullRequests.filterOptions",
  pullRequestsSummary: "pullRequests.summary",
  pullRequestsRouting: "pullRequests.routing",
  pullRequestsRoutingIdentity: "pullRequests.routingIdentity",
  pullRequestsStack: "pullRequests.stack",
  pullRequestsLinkedThreads: "pullRequests.linkedThreads",
  pullRequestsDetail: "pullRequests.detail",
  pullRequestsPreview: "pullRequests.preview",
  pullRequestsChecks: "pullRequests.checks",
  pullRequestsActivity: "pullRequests.activity",
  pullRequestsReviewGuide: "pullRequests.reviewGuide",
  pullRequestsGenerateReviewGuide: "pullRequests.generateReviewGuide",
  pullRequestsThreadComments: "pullRequests.threadComments",
  pullRequestsDiffFileContents: "pullRequests.diffFileContents",
  pullRequestsFilesViewed: "pullRequests.filesViewed",
  pullRequestsChangeBreakdown: "pullRequests.changeBreakdown",
  pullRequestsSetFilesViewed: "pullRequests.setFilesViewed",
  pullRequestsRunAction: "pullRequests.runAction",
  pullRequestsUpdate: "pullRequests.update",
  pullRequestsComment: "pullRequests.comment",
  pullRequestsUpdateComment: "pullRequests.updateComment",
  pullRequestsSubmitReview: "pullRequests.submitReview",
  pullRequestsReplyToThread: "pullRequests.replyToThread",
  pullRequestsSetThreadResolution: "pullRequests.setThreadResolution",
  pullRequestsSetReaction: "pullRequests.setReaction",
  pullRequestsInvalidate: "pullRequests.invalidate",
  pullRequestsReportState: "pullRequests.reportState",
  pullRequestsSubscribeRefreshes: "pullRequests.subscribeRefreshes",
  pullRequestsReviewerCandidates: "pullRequests.reviewerCandidates",
  pullRequestsRequestReviewers: "pullRequests.requestReviewers",
  pullRequestsLabelCandidates: "pullRequests.labelCandidates",
  pullRequestsSetLabels: "pullRequests.setLabels",

  sourceControlLookupRepository: "sourceControl.lookupRepository",
  sourceControlCloneRepository: "sourceControl.cloneRepository",
  sourceControlPublishRepository: "sourceControl.publishRepository",
  sourceControlSignInStart: "sourceControl.signInStart",
  sourceControlSignInWait: "sourceControl.signInWait",
  sourceControlSignInCancel: "sourceControl.signInCancel",
  sourceControlAppAccess: "sourceControl.appAccess",
  sourceControlStarred: "sourceControl.starred",
  projectCloneStart: "projectClone.start",
  projectCloneCancel: "projectClone.cancel",
  projectCloneRetry: "projectClone.retry",
  subscribeProjectClones: "subscribeProjectClones",

  subscribeVcsStatus: "subscribeVcsStatus",
  subscribeWorktreeSetup: "subscribeWorktreeSetup",
  worktreeSetupCancel: "worktreeSetup.cancel",
  subscribeTerminalMetadata: "subscribeTerminalMetadata",
  subscribePreviewEvents: "subscribePreviewEvents",
  subscribeDiscoveredLocalServers: "subscribeDiscoveredLocalServers",
  subscribeDeviceState: "subscribeDeviceState",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeResourceTelemetry: "subscribeResourceTelemetry",
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
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    instanceId: Schema.optional(ProviderInstanceId),
    cwd: Schema.optional(TrimmedNonEmptyString),
    fresh: Schema.optional(Schema.Boolean),
    /** Bypass model caches; explicit rediscovery may open sessions, background refreshes must not. */
    refreshModels: Schema.optional(Schema.Boolean),
    /** Read secret references again; unlocking a vault can prompt on the host, so only explicit user refreshes ask. */
    reloadSecrets: Schema.optional(Schema.Boolean),
    /**
     * Reply without snapshots, or with only the requested instance's cwd snapshot. Snapshots then
     * reach the client only through these replies, so another client's scan shows on its next
     * refresh, at most one TTL later.
     */
    workspaceSnapshotsOnDemand: Schema.optional(Schema.Boolean),
    /** As on `subscribeServerConfig`: add /usage-limits to the replied snapshot. */
    usageLimitsCommand: Schema.optional(Schema.Boolean),
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
  payload: ProviderAuthStartInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthRespondRpc = Rpc.make(WS_METHODS.providerAuthRespond, {
  payload: ProviderAuthRespondInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsProviderAuthCompleteRpc = Rpc.make(WS_METHODS.providerAuthComplete, {
  payload: ProviderAuthCompleteInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});

const WsChatGptReconnectProfileRpc = Rpc.make(WS_METHODS.chatGptReconnectProfile, {
  payload: ChatGptReconnectProfileInput,
  success: Schema.NullOr(ChatGptReconnectProfile),
  error: ProviderSetupRpcError,
});
const WsChatGptImportProfileRpc = Rpc.make(WS_METHODS.chatGptImportProfile, {
  payload: ChatGptImportProfileInput,
  success: ProviderAuthState,
  error: ProviderSetupRpcError,
});
const WsChatGptHandoffSubscribeRpc = Rpc.make(WS_METHODS.chatGptHandoffSubscribe, {
  payload: ChatGptHandoffInput,
  success: ChatGptHandoffState,
  error: ProviderSetupRpcError,
  stream: true,
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

const WsServerGetNpmReleaseRpc = Rpc.make(WS_METHODS.serverGetNpmRelease, {
  payload: ServerNpmReleaseInput,
  success: Schema.NullOr(ServerNpmRelease),
  error: Schema.Union([ServerNpmReleaseError, EnvironmentAuthorizationError]),
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

const WsServerRunStorageCleanupRpc = Rpc.make(WS_METHODS.serverRunStorageCleanup, {
  payload: Schema.Struct({}),
  success: StorageCleanupReport,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});
const WsServerGetStorageCleanupReportRpc = Rpc.make(WS_METHODS.serverGetStorageCleanupReport, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(StorageCleanupReport),
  stream: true,
  error: EnvironmentAuthorizationError,
});

const WsServerGetDatabaseStorageRpc = Rpc.make(WS_METHODS.serverGetDatabaseStorage, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(DatabaseStorageStatus),
  stream: true,
  error: EnvironmentAuthorizationError,
});

const WsPeerLinksListRpc = Rpc.make(WS_METHODS.peerLinksList, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ links: Schema.Array(PeerLinkSummary) }),
  error: Schema.Union([PeerLinkError, EnvironmentAuthorizationError]),
});

const WsPeerLinksLinkRpc = Rpc.make(WS_METHODS.peerLinksLink, {
  payload: PeerLinkCreateInput,
  success: PeerLink,
  error: Schema.Union([PeerLinkError, EnvironmentAuthorizationError]),
});

const WsPeerLinksUnlinkRpc = Rpc.make(WS_METHODS.peerLinksUnlink, {
  payload: PeerLinkRemoveInput,
  success: PeerLinkRemoveResult,
  error: Schema.Union([PeerLinkError, EnvironmentAuthorizationError]),
});

const WsPeerLinksAnswerRequestRpc = Rpc.make(WS_METHODS.peerLinksAnswerRequest, {
  payload: PeerLinkRequestAnswerInput,
  error: Schema.Union([PeerLinkRequestError, EnvironmentAuthorizationError]),
});

const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({
    patch: ServerSettingsPatch,
    providerInstanceMutation: Schema.optionalKey(ProviderInstanceMutation),
  }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

const WsServerDiscoverSourceControlRpc = Rpc.make(WS_METHODS.serverDiscoverSourceControl, {
  payload: Schema.Struct({}),
  success: SourceControlDiscoveryResult,
  error: EnvironmentAuthorizationError,
});

const WsServerSearchAcpRegistryRpc = Rpc.make(WS_METHODS.serverSearchAcpRegistry, {
  payload: AcpRegistrySearchInput,
  success: AcpRegistrySearchResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerPrepareAcpRegistryAgentRpc = Rpc.make(WS_METHODS.serverPrepareAcpRegistryAgent, {
  payload: AcpRegistryPrepareInput,
  success: AcpRegistryPrepareResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerUninstallAcpRegistryManagedBinaryRpc = Rpc.make(
  WS_METHODS.serverUninstallAcpRegistryManagedBinary,
  {
    payload: AcpRegistryManagedBinaryUninstallInput,
    success: AcpRegistryManagedBinaryUninstallResult,
    error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
  },
);

const WsServerAcceptAcpRegistryUrlAuthRpc = Rpc.make(WS_METHODS.serverAcceptAcpRegistryUrlAuth, {
  payload: AcpRegistryAcceptUrlAuthInput,
  success: AcpRegistryAcceptUrlAuthResult,
  error: EnvironmentAuthorizationError,
});

const WsServerListAcpRegistrySessionsRpc = Rpc.make(WS_METHODS.serverListAcpRegistrySessions, {
  payload: AcpRegistryListSessionsInput,
  success: AcpRegistryListSessionsResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerImportAcpRegistrySessionRpc = Rpc.make(WS_METHODS.serverImportAcpRegistrySession, {
  payload: AcpRegistryImportSessionInput,
  success: AcpRegistryImportSessionResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerDeleteAcpRegistrySessionRpc = Rpc.make(WS_METHODS.serverDeleteAcpRegistrySession, {
  payload: AcpRegistryDeleteSessionInput,
  success: AcpRegistryDeleteSessionResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerListAcpRegistryProvidersRpc = Rpc.make(WS_METHODS.serverListAcpRegistryProviders, {
  payload: AcpRegistryListProvidersInput,
  success: AcpRegistryListProvidersResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerSetAcpRegistryProviderRpc = Rpc.make(WS_METHODS.serverSetAcpRegistryProvider, {
  payload: AcpRegistrySetProviderInput,
  success: AcpRegistrySetProviderResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
});

const WsServerDisableAcpRegistryProviderRpc = Rpc.make(
  WS_METHODS.serverDisableAcpRegistryProvider,
  {
    payload: AcpRegistryDisableProviderInput,
    success: AcpRegistryDisableProviderResult,
    error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
  },
);

const WsServerLogoutAcpRegistryRpc = Rpc.make(WS_METHODS.serverLogoutAcpRegistry, {
  payload: AcpRegistryLogoutInput,
  success: AcpRegistryLogoutResult,
  error: Schema.Union([AcpRegistryOperationError, EnvironmentAuthorizationError]),
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

const WsServerCheckOtlpEndpointRpc = Rpc.make(WS_METHODS.serverCheckOtlpEndpoint, {
  payload: OtlpEndpointCheckInput,
  success: OtlpEndpointCheckResult,
  error: EnvironmentAuthorizationError,
});

const WsServerPrepareTriageRpc = Rpc.make(WS_METHODS.serverPrepareTriage, {
  payload: ServerPrepareTriageInput,
  success: ServerPrepareTriageResult,
  error: Schema.Union([ServerPrepareTriageError, EnvironmentAuthorizationError]),
});

const WsServerGetUsageSummaryRpc = Rpc.make(WS_METHODS.serverGetUsageSummary, {
  payload: UsageSummaryInput,
  success: UsageSummary,
  error: Schema.Union([EnvironmentAuthorizationError, UsageReadError]),
});

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

// GitHub line counts cost 40-60% of the listing read; fetch separately so rows arrive first.
const WsPullRequestsListStatsRpc = Rpc.make(WS_METHODS.pullRequestsListStats, {
  payload: PullRequestListStatsInput,
  success: PullRequestListStatsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsFilterOptionsRpc = Rpc.make(WS_METHODS.pullRequestsFilterOptions, {
  payload: PullRequestFilterOptionsInput,
  success: PullRequestFilterOptions,
  error: PullRequestRpcError,
});

const WsPullRequestsRoutingRpc = Rpc.make(WS_METHODS.pullRequestsRouting, {
  payload: PullRequestRef,
  success: PullRequestRoutingResult,
  error: PullRequestRpcError,
});

const WsPullRequestsRoutingIdentityRpc = Rpc.make(WS_METHODS.pullRequestsRoutingIdentity, {
  payload: PullRequestRoutingIdentityInput,
  success: PullRequestRoutingIdentityResult,
  error: PullRequestRpcError,
});

const WsPullRequestsSummaryRpc = Rpc.make(WS_METHODS.pullRequestsSummary, {
  payload: PullRequestRef,
  success: PullRequestSummary,
  error: PullRequestRpcError,
});

const WsPullRequestsStackRpc = Rpc.make(WS_METHODS.pullRequestsStack, {
  payload: PullRequestRef,
  success: Schema.NullOr(PullRequestStack),
  error: PullRequestRpcError,
});

const WsPullRequestsLinkedThreadsRpc = Rpc.make(WS_METHODS.pullRequestsLinkedThreads, {
  payload: PullRequestRef,
  success: PullRequestLinkedThreadsResult,
  error: PullRequestRpcError,
});

const WsPullRequestsDetailRpc = Rpc.make(WS_METHODS.pullRequestsDetail, {
  payload: PullRequestRef,
  success: PullRequestDetail,
  error: PullRequestRpcError,
});

const WsPullRequestsPreviewRpc = Rpc.make(WS_METHODS.pullRequestsPreview, {
  payload: PullRequestRef,
  success: PullRequestPreview,
  error: PullRequestRpcError,
});

const WsPullRequestsChecksRpc = Rpc.make(WS_METHODS.pullRequestsChecks, {
  payload: PullRequestRef,
  success: Schema.NullOr(PullRequestChecks),
  error: PullRequestRpcError,
});

const WsPullRequestsActivityRpc = Rpc.make(WS_METHODS.pullRequestsActivity, {
  payload: PullRequestRef,
  success: PullRequestActivity,
  error: PullRequestRpcError,
});

const WsPullRequestsReviewGuideRpc = Rpc.make(WS_METHODS.pullRequestsReviewGuide, {
  payload: PullRequestRef,
  success: PullRequestReviewGuideResult,
  error: PullRequestRpcError,
});

const WsPullRequestsGenerateReviewGuideRpc = Rpc.make(WS_METHODS.pullRequestsGenerateReviewGuide, {
  payload: PullRequestRef,
  success: PullRequestReviewGuideResult,
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

const WsPullRequestsFilesViewedRpc = Rpc.make(WS_METHODS.pullRequestsFilesViewed, {
  payload: PullRequestRef,
  success: PullRequestFilesViewedResult,
  error: PullRequestRpcError,
});

const WsPullRequestsChangeBreakdownRpc = Rpc.make(WS_METHODS.pullRequestsChangeBreakdown, {
  payload: PullRequestRef,
  success: PullRequestChangeBreakdown,
  error: PullRequestRpcError,
});

const WsPullRequestsSetFilesViewedRpc = Rpc.make(WS_METHODS.pullRequestsSetFilesViewed, {
  payload: PullRequestSetFilesViewedInput,
  success: Schema.Void,
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

const WsPullRequestsReportStateRpc = Rpc.make(WS_METHODS.pullRequestsReportState, {
  payload: PullRequestReportStateInput,
  success: Schema.Void,
  error: PullRequestRpcError,
});

const WsPullRequestsSubscribeRefreshesRpc = Rpc.make(WS_METHODS.pullRequestsSubscribeRefreshes, {
  payload: Schema.Struct({}),
  success: NonNegativeInt,
  error: EnvironmentAuthorizationError,
  stream: true,
});

// Fetch reviewer candidates only when the menu opens to avoid unused host requests.
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

// Starts a device-flow sign-in the server finishes on its own, so a client can leave meanwhile.
const WsSourceControlSignInStartRpc = Rpc.make(WS_METHODS.sourceControlSignInStart, {
  payload: SourceControlSignInInput,
  success: SourceControlSignInPrompt,
  error: Schema.Union([SourceControlSignInError, EnvironmentAuthorizationError]),
});

// Resolves when the sign-in `signInStart` began ends, however long the user takes.
const WsSourceControlSignInWaitRpc = Rpc.make(WS_METHODS.sourceControlSignInWait, {
  payload: SourceControlSignInInput,
  success: SourceControlSignInResult,
  error: Schema.Union([SourceControlSignInError, EnvironmentAuthorizationError]),
});

// Ends the sign-in `signInStart` began, so approving the code afterwards signs nothing in.
const WsSourceControlSignInCancelRpc = Rpc.make(WS_METHODS.sourceControlSignInCancel, {
  payload: SourceControlSignInInput,
  success: Schema.Void,
  error: Schema.Union([SourceControlSignInError, EnvironmentAuthorizationError]),
});

const WsSourceControlAppAccessRpc = Rpc.make(WS_METHODS.sourceControlAppAccess, {
  payload: SourceControlAppAccessInput,
  success: SourceControlAppAccess,
  error: EnvironmentAuthorizationError,
});

// False when the server's forge account has not starred the repository or the forge cannot say.
const WsSourceControlStarredRpc = Rpc.make(WS_METHODS.sourceControlStarred, {
  payload: SourceControlStarredInput,
  success: Schema.Boolean,
  error: EnvironmentAuthorizationError,
});

// Returns when the project exists and cloning starts; progress uses the subscription.
const WsProjectCloneStartRpc = Rpc.make(WS_METHODS.projectCloneStart, {
  payload: ProjectCloneStartInput,
  success: ProjectCloneStartResult,
  error: Schema.Union([
    SourceControlRepositoryError,
    OrchestrationDispatchCommandError,
    EnvironmentAuthorizationError,
  ]),
});

const WsProjectCloneCancelRpc = Rpc.make(WS_METHODS.projectCloneCancel, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: EnvironmentAuthorizationError,
});

const WsProjectCloneRetryRpc = Rpc.make(WS_METHODS.projectCloneRetry, {
  payload: ProjectCloneActionInput,
  success: ProjectCloneActionResult,
  error: Schema.Union([SourceControlRepositoryError, EnvironmentAuthorizationError]),
});

const WsSubscribeProjectClonesRpc = Rpc.make(WS_METHODS.subscribeProjectClones, {
  payload: ProjectCloneSubscribeInput,
  success: ProjectCloneListEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
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

const WsProjectsListIgnoredFilesRpc = Rpc.make(WS_METHODS.projectsListIgnoredFiles, {
  payload: ProjectListIgnoredFilesInput,
  success: ProjectListIgnoredFilesResult,
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

const WsProjectsMutateRpc = Rpc.make(WS_METHODS.projectsMutate, {
  payload: ProjectMutation,
  success: Project,
  error: Schema.Union([ProjectMutationError, EnvironmentAuthorizationError]),
});

const WsProjectsEnsureScratchRpc = Rpc.make(WS_METHODS.projectsEnsureScratch, {
  payload: Schema.Struct({}),
  success: ProjectEnsureScratchResult,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsProjectsCreateNewRpc = Rpc.make(WS_METHODS.projectsCreateNew, {
  payload: ProjectCreateNewInput,
  success: ProjectCreateNewResult,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsProjectsCreateFromThreadRpc = Rpc.make(WS_METHODS.projectsCreateFromThread, {
  payload: ProjectCreateFromThreadInput,
  success: ProjectCreateFromThreadResult,
  error: Schema.Union([OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
});

const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

const WsFilesystemGetMetadataRpc = Rpc.make(WS_METHODS.filesystemGetMetadata, {
  payload: FilesystemGetMetadataInput,
  success: FilesystemGetMetadataResult,
  error: EnvironmentAuthorizationError,
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

const WsAssetsPersistChatAttachmentsRpc = Rpc.make(WS_METHODS.assetsPersistChatAttachments, {
  payload: PersistChatAttachmentsInput,
  success: PersistChatAttachmentsResult,
  error: Schema.Union([PersistChatAttachmentsError, EnvironmentAuthorizationError]),
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

const WsMcpAppsCallToolRpc = Rpc.make(WS_METHODS.mcpAppsCallTool, {
  payload: McpAppCallToolInput,
  success: McpAppCallToolResult,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsMcpAppsToolInfoRpc = Rpc.make(WS_METHODS.mcpAppsToolInfo, {
  payload: McpAppToolInfoInput,
  success: McpAppToolInfo,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsMcpAppsUpdateModelContextRpc = Rpc.make(WS_METHODS.mcpAppsUpdateModelContext, {
  payload: McpAppUpdateModelContextInput,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsMcpAppsReadResourceRpc = Rpc.make(WS_METHODS.mcpAppsReadResource, {
  payload: McpAppReadResourceInput,
  success: McpAppReadResourceResult,
  error: Schema.Union([McpAppRequestError, EnvironmentAuthorizationError]),
});

const WsProviderUploadFeedbackRpc = Rpc.make(WS_METHODS.providerUploadFeedback, {
  payload: ProviderUploadFeedbackInput,
  success: ProviderUploadFeedbackResult,
  error: Schema.Union([ProviderUploadFeedbackError, EnvironmentAuthorizationError]),
});

const WsSubscribeVcsStatusRpc = Rpc.make(WS_METHODS.subscribeVcsStatus, {
  payload: VcsStatusSubscriptionInput,
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
  payload: Schema.Struct({
    ...VcsStatusInput.fields,
    localOnly: Schema.optional(Schema.Boolean),
  }),
  success: VcsStatusResult,
  error: Schema.Union([GitManagerServiceError, EnvironmentAuthorizationError]),
});

const WsSubscribeWorktreeSetupRpc = Rpc.make(WS_METHODS.subscribeWorktreeSetup, {
  payload: WorktreeSetupSubscribeInput,
  success: WorktreeSetupStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsWorktreeSetupCancelRpc = Rpc.make(WS_METHODS.worktreeSetupCancel, {
  payload: WorktreeSetupCancelInput,
  success: WorktreeSetupCancelResult,
  error: EnvironmentAuthorizationError,
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

const WsVcsListRefsRpc = Rpc.make(WS_METHODS.vcsListRefs, {
  payload: VcsListRefsInput,
  success: VcsListRefsResult,
  error: Schema.Union([GitCommandError, EnvironmentAuthorizationError]),
});

const WsVcsCreateWorktreeRpc = Rpc.make(WS_METHODS.vcsCreateWorktree, {
  // Worktrees use the managed folder; required null path preserves compatibility with older servers.
  payload: Schema.Struct({ ...VcsCreateWorktreeInput.fields, path: Schema.Null }),
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

const WsReviewGetBranchCommitsRpc = Rpc.make(WS_METHODS.reviewGetBranchCommits, {
  payload: ReviewBranchCommitsInput,
  success: ReviewBranchCommitsResult,
  error: Schema.Union([ReviewDiffPreviewError, EnvironmentAuthorizationError]),
});

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

const WsTerminalObserveRpc = Rpc.make(WS_METHODS.terminalObserve, {
  payload: TerminalObserveInput,
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

const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});

const WsPreviewOpenRpc = Rpc.make(WS_METHODS.previewOpen, {
  payload: PreviewOpenInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewResizeRpc = Rpc.make(WS_METHODS.previewResize, {
  payload: PreviewResizeInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsPreviewAdjustRpc = Rpc.make(WS_METHODS.previewAdjust, {
  payload: PreviewAdjustInput,
  success: PreviewSessionSnapshot,
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

const WsPreviewClearProfileRpc = Rpc.make(WS_METHODS.previewClearProfile, {
  payload: PreviewClearProfileInput,
  error: Schema.Union([PreviewClearProfileError, EnvironmentAuthorizationError]),
});

const WsPreviewReportProfilesRpc = Rpc.make(WS_METHODS.previewReportProfiles, {
  payload: PreviewReportProfilesInput,
  error: EnvironmentAuthorizationError,
});

const WsPreviewReportStatusRpc = Rpc.make(WS_METHODS.previewReportStatus, {
  payload: PreviewReportStatusInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});

const WsSubscribePreviewEventsRpc = Rpc.make(WS_METHODS.subscribePreviewEvents, {
  payload: Schema.Struct({}),
  success: PreviewEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsPreviewStopLocalServerRpc = Rpc.make(WS_METHODS.previewStopLocalServer, {
  payload: PreviewStopLocalServerInput,
  error: Schema.Union([PreviewStopLocalServerError, EnvironmentAuthorizationError]),
});

const WsSubscribeDiscoveredLocalServersRpc = Rpc.make(WS_METHODS.subscribeDiscoveredLocalServers, {
  payload: Schema.Struct({
    configuredUrls: Schema.optional(ConfiguredLocalServerUrls),
  }),
  success: DiscoveredLocalServerList,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsDeviceTestHostRpc = Rpc.make(WS_METHODS.deviceTestHost, {
  payload: SshDeviceHostConfig,
  success: DeviceHostSummary,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceEasAccountRpc = Rpc.make(WS_METHODS.deviceEasAccount, {
  payload: DeviceEasAccountInput,
  success: DeviceEasAccount,
  error: Schema.Union([DeviceEasAccountError, EnvironmentAuthorizationError]),
});

const WsDeviceSimlockIdentityRpc = Rpc.make(WS_METHODS.deviceSimlockIdentity, {
  payload: DeviceSimlockIdentityInput,
  success: DeviceSimlockIdentity,
  error: Schema.Union([DeviceSimlockIdentityError, EnvironmentAuthorizationError]),
});

const WsDeviceListRpc = Rpc.make(WS_METHODS.deviceList, {
  payload: DeviceListInput,
  success: DeviceServiceState,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceConfigureRpc = Rpc.make(WS_METHODS.deviceConfigure, {
  payload: DeviceConfigureInput,
  success: DeviceServiceState,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceOpenRpc = Rpc.make(WS_METHODS.deviceOpen, {
  payload: DeviceOpenInput,
  success: DeviceSession,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceCloseRpc = Rpc.make(WS_METHODS.deviceClose, {
  payload: DeviceCloseInput,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceShutdownRpc = Rpc.make(WS_METHODS.deviceShutdown, {
  payload: DeviceShutdownInput,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceDetailRpc = Rpc.make(WS_METHODS.deviceDetail, {
  payload: DeviceDetailInput,
  success: DeviceDetail,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsDeviceActionRpc = Rpc.make(WS_METHODS.deviceAction, {
  payload: DeviceActionInput,
  success: DeviceDetail,
  error: Schema.Union([DeviceError, EnvironmentAuthorizationError]),
});

const WsSubscribeDeviceStateRpc = Rpc.make(WS_METHODS.subscribeDeviceState, {
  payload: Schema.Struct({}),
  success: DeviceServiceState,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsOrchestrationV2DispatchCommandRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.dispatchCommand, {
  payload: OrchestrationV2RpcSchemas.dispatchCommand.input,
  success: OrchestrationV2RpcSchemas.dispatchCommand.output,
  error: Schema.Union([OrchestrationV2DispatchCommandError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetTurnDiffRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getTurnDiff, {
  payload: OrchestrationV2RpcSchemas.getTurnDiff.input,
  success: OrchestrationV2RpcSchemas.getTurnDiff.output,
  error: Schema.Union([OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationV2RpcSchemas.getFullThreadDiff.input,
    success: OrchestrationV2RpcSchemas.getFullThreadDiff.output,
    error: Schema.Union([OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2SearchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThread, {
  payload: OrchestrationV2SearchThreadInput,
  success: OrchestrationV2SearchThreadResult,
  error: Schema.Union([OrchestrationV2SearchThreadError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SearchThreadStreamRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.searchThreadStream,
  {
    payload: OrchestrationV2SearchThreadInput,
    success: OrchestrationV2SearchThreadResult,
    error: Schema.Union([OrchestrationV2SearchThreadError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

const WsOrchestrationV2SearchThreadsRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.searchThreads, {
  payload: OrchestrationV2SearchThreadsInput,
  success: OrchestrationV2SearchThreadsResult,
  error: Schema.Union([OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetArchivedShellSnapshotRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot,
  {
    payload: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.input,
    success: OrchestrationV2RpcSchemas.getArchivedShellSnapshot.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetThreadFamilyRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getThreadFamily, {
  payload: OrchestrationV2RpcSchemas.getThreadFamily.input,
  success: OrchestrationV2RpcSchemas.getThreadFamily.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetWorktreeThreadIdsRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getWorktreeThreadIds,
  {
    payload: OrchestrationV2RpcSchemas.getWorktreeThreadIds.input,
    success: OrchestrationV2RpcSchemas.getWorktreeThreadIds.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetOlderSettledThreadsRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads,
  {
    payload: OrchestrationV2RpcSchemas.getOlderSettledThreads.input,
    success: OrchestrationV2RpcSchemas.getOlderSettledThreads.output,
    error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetThreadProjectionRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
  {
    payload: OrchestrationV2RpcSchemas.getThreadProjection.input,
    success: OrchestrationV2RpcSchemas.getThreadProjection.output,
    error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2StopWorkflowRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.stopWorkflow, {
  payload: OrchestrationV2RpcSchemas.stopWorkflow.input,
  success: OrchestrationV2RpcSchemas.stopWorkflow.output,
  error: Schema.Union([OrchestrationV2StopWorkflowError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2ForceStopThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.forceStopThread, {
  payload: OrchestrationV2RpcSchemas.forceStopThread.input,
  success: OrchestrationV2RpcSchemas.forceStopThread.output,
  error: Schema.Union([OrchestrationV2ForceStopThreadError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2GetWorkflowScriptRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getWorkflowScript,
  {
    payload: OrchestrationV2RpcSchemas.getWorkflowScript.input,
    success: OrchestrationV2RpcSchemas.getWorkflowScript.output,
    error: Schema.Union([OrchestrationGetWorkflowScriptError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetNativeChildWorkRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.getNativeChildWork,
  {
    payload: OrchestrationV2RpcSchemas.getNativeChildWork.input,
    success: OrchestrationV2RpcSchemas.getNativeChildWork.output,
    error: Schema.Union([OrchestrationV2GetNativeChildWorkError, EnvironmentAuthorizationError]),
  },
);

const WsOrchestrationV2GetTurnItemRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.getTurnItem, {
  payload: OrchestrationV2RpcSchemas.getTurnItem.input,
  success: OrchestrationV2RpcSchemas.getTurnItem.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2LaunchThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.launchThread, {
  payload: OrchestrationV2RpcSchemas.launchThread.input,
  success: OrchestrationV2RpcSchemas.launchThread.output,
  error: Schema.Union([OrchestrationV2ThreadLaunchError, EnvironmentAuthorizationError]),
});

const WsOrchestrationV2SubscribeShellRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {
  payload: OrchestrationV2RpcSchemas.subscribeShell.input,
  success: OrchestrationV2RpcSchemas.subscribeShell.output,
  error: Schema.Union([OrchestrationV2GetShellSnapshotError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeThreadRpc = Rpc.make(ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
  payload: OrchestrationV2RpcSchemas.subscribeThread.input,
  success: OrchestrationV2RpcSchemas.subscribeThread.output,
  error: Schema.Union([OrchestrationV2GetThreadProjectionError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsOrchestrationV2SubscribeCommandOutputRpc = Rpc.make(
  ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
  {
    payload: OrchestrationV2RpcSchemas.subscribeCommandOutput.input,
    success: OrchestrationV2RpcSchemas.subscribeCommandOutput.output,
    error: Schema.Union([OrchestrationV2CommandOutputError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

const WsSubscribeTerminalMetadataRpc = Rpc.make(WS_METHODS.subscribeTerminalMetadata, {
  payload: Schema.Struct({}),
  success: TerminalMetadataStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({
    /** Opt-in protects older clients that reject unknown theme event types. */
    environmentThemes: Schema.optional(Schema.Boolean),
    usageLimitSources: Schema.optional(Schema.Boolean),
    /** Advertise client handling before the server offers /usage-limits, or older clients send it as a prompt. */
    usageLimitsCommand: Schema.optional(Schema.Boolean),
    /** Omit per-cwd provider snapshots; the client fetches its cwd through `server.refreshProviders`. */
    workspaceSnapshotsOnDemand: Schema.optional(Schema.Boolean),
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

const WsScheduledTasksSubscribeRpc = Rpc.make(WS_METHODS.scheduledTasksSubscribe, {
  payload: ScheduledTaskListInput,
  success: ScheduledTaskListResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsScheduledTasksUpsertRpc = Rpc.make(WS_METHODS.scheduledTasksUpsert, {
  payload: ScheduledTaskUpsertInput,
  success: ScheduledTaskMutationResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksSetEnabledRpc = Rpc.make(WS_METHODS.scheduledTasksSetEnabled, {
  payload: ScheduledTaskSetEnabledInput,
  success: ScheduledTaskMutationResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksDeleteRpc = Rpc.make(WS_METHODS.scheduledTasksDelete, {
  payload: ScheduledTaskDeleteInput,
  success: ScheduledTaskDeleteResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksRunNowRpc = Rpc.make(WS_METHODS.scheduledTasksRunNow, {
  payload: ScheduledTaskRunNowInput,
  success: ScheduledTaskRunNowResult,
  error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksRotateWebhookTokenRpc = Rpc.make(
  WS_METHODS.scheduledTasksRotateWebhookToken,
  {
    payload: ScheduledTaskRotateWebhookTokenInput,
    success: ScheduledTaskMutationResult,
    error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  },
);

const WsGuestShareCreateRpc = Rpc.make(WS_METHODS.guestShareCreate, {
  payload: GuestShareCreateInput,
  success: GuestShareCreateResult,
  error: Schema.Union([GuestShareCreateError, EnvironmentAuthorizationError]),
});

const WsSecretsAnswerRequestRpc = Rpc.make(WS_METHODS.secretsAnswerRequest, {
  payload: SecretRequestAnswerInput,
  error: Schema.Union([SecretRequestError, EnvironmentAuthorizationError]),
});

const WsScheduledTasksListWebhookDeliveriesRpc = Rpc.make(
  WS_METHODS.scheduledTasksListWebhookDeliveries,
  {
    payload: ScheduledTaskListWebhookDeliveriesInput,
    success: ScheduledTaskListWebhookDeliveriesResult,
    error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  },
);

const WsScheduledTasksGetWebhookDeliveryRpc = Rpc.make(
  WS_METHODS.scheduledTasksGetWebhookDelivery,
  {
    payload: ScheduledTaskGetWebhookDeliveryInput,
    success: ScheduledTaskGetWebhookDeliveryResult,
    error: Schema.Union([ScheduledTaskError, EnvironmentAuthorizationError]),
  },
);

const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

const WsSubscribeResourceTelemetryRpc = Rpc.make(WS_METHODS.subscribeResourceTelemetry, {
  payload: Schema.Struct({}),
  success: ResourceTelemetrySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export class RpcScopeAuthorization extends RpcMiddleware.Service<RpcScopeAuthorization>()(
  "t3/contracts/RpcScopeAuthorization",
  { error: EnvironmentAuthorizationError },
) {}

const WsCodexAuthCallbackSubscribeRpc = Rpc.make(WS_METHODS.codexAuthCallbackSubscribe, {
  payload: CodexAuthCallbackInput,
  success: CodexAuthCallbackState,
  error: ProviderSetupRpcError,
  stream: true,
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
const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
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
    payload: SpeechStreamingStartInput,
    success: AssemblyAiStreamingTokenResult,
    error: Schema.Union([
      AssemblyAiStreamingTokenError,
      ProjectSpeechProfileError,
      SpeechDictationError,
      EnvironmentAuthorizationError,
    ]),
  },
);
const WsSpeechStartStreamingSessionRpc = Rpc.make(WS_METHODS.speechStartStreamingSession, {
  payload: SpeechStreamingStartInput,
  success: SpeechStreamingSessionStartResult,
  error: Schema.Union([
    SpeechStreamingProxyError,
    AssemblyAiStreamingTokenError,
    ProjectSpeechProfileError,
    SpeechDictationError,
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
const WsSpeechProcessDictationRpc = Rpc.make(WS_METHODS.speechProcessDictation, {
  payload: SpeechProcessDictationInput,
  success: SpeechProcessDictationResult,
  error: Schema.Union([SpeechDictationError, EnvironmentAuthorizationError]),
});
const WsSpeechListAssemblyAiModelsRpc = Rpc.make(WS_METHODS.speechListAssemblyAiModels, {
  payload: Schema.Struct({}),
  success: AssemblyAiModelsResult,
  error: Schema.Union([SpeechDictationError, EnvironmentAuthorizationError]),
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
const WsServerDiscoverAiEndpointsRpc = Rpc.make(WS_METHODS.serverDiscoverAiEndpoints, {
  payload: AiEndpointDiscoveryInput,
  success: AiEndpointDiscoveryEvent,
  error: Schema.Union([AiEndpointDiscoveryError, EnvironmentAuthorizationError]),
  stream: true,
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
const WsExtensionCatalogSearchRpc = Rpc.make(WS_METHODS.extensionCatalogSearch, {
  payload: ExtensionCatalogSearchInput,
  success: ExtensionCatalogSearchResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});
const WsSkillsPreviewRegistryRpc = Rpc.make(WS_METHODS.skillsPreviewRegistry, {
  payload: SkillRegistryPreviewInput,
  success: SkillRegistryPreviewResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
});
const WsSkillsInstallRegistryRpc = Rpc.make(WS_METHODS.skillsInstallRegistry, {
  payload: SkillRegistryInstallInput,
  success: SkillMutationResult,
  error: Schema.Union([SkillEngineError, EnvironmentAuthorizationError]),
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
const WsPullRequestsCheckLogRpc = Rpc.make(WS_METHODS.pullRequestsCheckLog, {
  payload: PullRequestCheckLogInput,
  success: PullRequestCheckLog,
  error: PullRequestRpcError,
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
const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: Schema.Union([TerminalError, EnvironmentAuthorizationError]),
});
const WsPreviewNavigateRpc = Rpc.make(WS_METHODS.previewNavigate, {
  payload: PreviewNavigateInput,
  success: PreviewSessionSnapshot,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});
const WsPreviewRefreshRpc = Rpc.make(WS_METHODS.previewRefresh, {
  payload: PreviewRefreshInput,
  error: Schema.Union([PreviewError, EnvironmentAuthorizationError]),
});
const WsPreviewPickElementAtRpc = Rpc.make(WS_METHODS.previewPickElementAt, {
  payload: PreviewPickElementInput,
  success: PreviewPickElementResult,
  error: Schema.Union([PreviewPickElementError, EnvironmentAuthorizationError]),
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
const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});
const ProjectIndexRpcError = Schema.Union([
  ProjectIndexOperationError,
  EnvironmentAuthorizationError,
]);
const WsProjectIndexGetSettingsRpc = Rpc.make(WS_METHODS.projectIndexGetSettings, {
  payload: ProjectIndexGetSettingsInput,
  success: ProjectIndexSettings,
  error: ProjectIndexRpcError,
});
const WsProjectIndexGetStatusRpc = Rpc.make(WS_METHODS.projectIndexGetStatus, {
  payload: ProjectIndexGetStatusInput,
  success: ProjectIndexStatusV1,
  error: ProjectIndexRpcError,
});
const WsProjectIndexUpdateSettingsRpc = Rpc.make(WS_METHODS.projectIndexUpdateSettings, {
  payload: ProjectIndexUpdateSettingsInput,
  success: ProjectIndexStatusV1,
  error: ProjectIndexRpcError,
});
const WsProjectIndexStartRpc = Rpc.make(WS_METHODS.projectIndexStart, {
  payload: ProjectIndexStartInput,
  success: ProjectIndexStatusV1,
  error: ProjectIndexRpcError,
});
const WsProjectIndexControlRpc = Rpc.make(WS_METHODS.projectIndexControl, {
  payload: ProjectIndexControlInput,
  success: ProjectIndexStatusV1,
  error: ProjectIndexRpcError,
});
const WsProjectIndexSubscribeRpc = Rpc.make(WS_METHODS.projectIndexSubscribe, {
  payload: ProjectIndexSubscribeInput,
  success: ProjectIndexStreamEvent,
  error: ProjectIndexRpcError,
  stream: true,
});
const WsProjectIndexSubscribeActivityRpc = Rpc.make(WS_METHODS.projectIndexSubscribeActivity, {
  payload: Schema.Struct({}),
  success: ProjectIndexActivityEvent,
  error: ProjectIndexRpcError,
  stream: true,
});
const WsProjectIndexQueryRpc = Rpc.make(WS_METHODS.projectIndexQuery, {
  payload: ProjectIndexQueryInput,
  success: ProjectIndexQueryResultV1,
  error: ProjectIndexRpcError,
});
const WsProjectIndexCheckModelRpc = Rpc.make(WS_METHODS.projectIndexCheckModel, {
  payload: ProjectIndexModelCheckInput,
  success: ProjectIndexModelCheckResult,
  error: ProjectIndexRpcError,
});
const WsProjectIndexReviewRpc = Rpc.make(WS_METHODS.projectIndexReview, {
  payload: ProjectIndexReviewInput,
  success: ProjectIndexReviewResultV1,
  error: ProjectIndexRpcError,
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
const WsSubscribeBackgroundPolicyRpc = Rpc.make(WS_METHODS.subscribeBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});
const WsSubscribeResourceProtectionRpc = Rpc.make(WS_METHODS.subscribeResourceProtection, {
  payload: Schema.Struct({}),
  success: ResourceProtectionSnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});
const DeepPlanRpcError = Schema.Union([DeepPlanError, EnvironmentAuthorizationError]);
const DeepPlanSourcesRpcError = Schema.Union([DeepPlanSourceError, EnvironmentAuthorizationError]);
const WsDeepPlanGetRunRpc = Rpc.make(DEEP_PLAN_WS_METHODS.getRun, {
  payload: DeepPlanGetRunInput,
  success: DeepPlanGetRunResult,
  error: DeepPlanRpcError,
});
const WsDeepPlanCatalogSourcesRpc = Rpc.make(DEEP_PLAN_WS_METHODS.catalogSources, {
  payload: DeepPlanCatalogSourcesInput,
  success: DeepPlanCatalogSourcesResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanExportSourcesRpc = Rpc.make(DEEP_PLAN_WS_METHODS.exportSources, {
  payload: DeepPlanExportSourcesInput,
  success: DeepPlanExportSourcesResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanReadExportChunkRpc = Rpc.make(DEEP_PLAN_WS_METHODS.readExportChunk, {
  payload: DeepPlanReadExportChunkInput,
  success: DeepPlanReadExportChunkResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanInitializeSourcesRpc = Rpc.make(DEEP_PLAN_WS_METHODS.initializeSources, {
  payload: DeepPlanInitializeSourcesInput,
  success: DeepPlanInitializeSourcesResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanImportSourceChunkRpc = Rpc.make(DEEP_PLAN_WS_METHODS.importSourceChunk, {
  payload: DeepPlanImportSourceChunkInput,
  success: DeepPlanImportSourceChunkResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanListSourcesRpc = Rpc.make(DEEP_PLAN_WS_METHODS.listSources, {
  payload: DeepPlanListSourcesInput,
  success: DeepPlanListSourcesResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanReadSourceChunkRpc = Rpc.make(DEEP_PLAN_WS_METHODS.readSourceChunk, {
  payload: DeepPlanReadSourceChunkInput,
  success: DeepPlanReadSourceChunkResult,
  error: DeepPlanSourcesRpcError,
});
const WsDeepPlanSummarizeSourceRpc = Rpc.make(DEEP_PLAN_WS_METHODS.summarizeSource, {
  payload: DeepPlanSummarizeSourceInput,
  success: DeepPlanSummarizeSourceResult,
  error: DeepPlanSourcesRpcError,
});

export const WsRpcGroup = RpcGroup.make(
  WsCodexAuthCallbackSubscribeRpc,
  WsServerProviderAuthConnectRpc,
  WsServerProviderAuthSetCredentialRpc,
  WsServerProviderAuthDisconnectRpc,
  WsServerGetSettingsRpc,
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
  WsSpeechProcessDictationRpc,
  WsSpeechListAssemblyAiModelsRpc,
  WsPromptImproveRpc,
  WsPlanReviewParallelismRpc,
  WsServerDiscoverAiEndpointsRpc,
  WsServerReportHostPowerStateRpc,
  WsServerGetBackgroundPolicyRpc,
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
  WsExtensionCatalogSearchRpc,
  WsSkillsPreviewRegistryRpc,
  WsSkillsInstallRegistryRpc,
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
  WsPullRequestsCheckLogRpc,
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
  WsTerminalRestartRpc,
  WsPreviewNavigateRpc,
  WsPreviewRefreshRpc,
  WsPreviewPickElementAtRpc,
  WsPreviewAutomationConnectRpc,
  WsPreviewAutomationRespondRpc,
  WsPreviewAutomationFocusHostRpc,
  WsSubscribeTerminalEventsRpc,
  WsProjectIndexGetSettingsRpc,
  WsProjectIndexGetStatusRpc,
  WsProjectIndexUpdateSettingsRpc,
  WsProjectIndexStartRpc,
  WsProjectIndexControlRpc,
  WsProjectIndexSubscribeRpc,
  WsProjectIndexSubscribeActivityRpc,
  WsProjectIndexQueryRpc,
  WsProjectIndexCheckModelRpc,
  WsProjectIndexReviewRpc,
  WsKnowledgeGraphSubscribeRpc,
  WsKnowledgeGraphQueryRpc,
  WsKnowledgeGraphNodeContentRpc,
  WsKnowledgeGraphRebuildRpc,
  WsKnowledgeGraphCancelRpc,
  WsKnowledgeGraphPauseRpc,
  WsKnowledgeGraphClearRpc,
  WsSubscribeBackgroundPolicyRpc,
  WsSubscribeResourceProtectionRpc,
  WsDeepPlanGetRunRpc,
  WsDeepPlanCatalogSourcesRpc,
  WsDeepPlanExportSourcesRpc,
  WsDeepPlanReadExportChunkRpc,
  WsDeepPlanInitializeSourcesRpc,
  WsDeepPlanImportSourceChunkRpc,
  WsDeepPlanListSourcesRpc,
  WsDeepPlanReadSourceChunkRpc,
  WsDeepPlanSummarizeSourceRpc,

  WsGuestShareCreateRpc,
  WsServerProbeRpc,
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpdateProviderRpc,
  WsProviderConsumeResetCreditRpc,
  WsProviderAuthStartRpc,
  WsProviderAuthCompleteRpc,
  WsChatGptReconnectProfileRpc,
  WsChatGptImportProfileRpc,
  WsChatGptHandoffSubscribeRpc,
  WsProviderAuthRespondRpc,
  WsProviderAuthCancelRpc,
  WsProviderAuthLogoutRpc,
  WsProviderAuthSubscribeRpc,
  WsProviderInstallStartRpc,
  WsProviderInstallCancelRpc,
  WsProviderInstallSubscribeRpc,
  WsProviderInstallRemoveRpc,
  WsServerUpdateServerRpc,
  WsServerGetNpmReleaseRpc,
  WsServerUpdateServerWithProgressRpc,
  WsServerCommitDesktopUpdateRpc,
  WsServerUpsertKeybindingRpc,
  WsServerRemoveKeybindingRpc,
  WsServerRunStorageCleanupRpc,
  WsServerGetStorageCleanupReportRpc,
  WsServerGetDatabaseStorageRpc,
  WsServerUpdateSettingsRpc,
  WsPeerLinksListRpc,
  WsPeerLinksLinkRpc,
  WsPeerLinksUnlinkRpc,
  WsPeerLinksAnswerRequestRpc,
  WsServerDiscoverSourceControlRpc,
  WsServerSearchAcpRegistryRpc,
  WsServerPrepareAcpRegistryAgentRpc,
  WsServerUninstallAcpRegistryManagedBinaryRpc,
  WsServerAcceptAcpRegistryUrlAuthRpc,
  WsServerListAcpRegistrySessionsRpc,
  WsServerImportAcpRegistrySessionRpc,
  WsServerDeleteAcpRegistrySessionRpc,
  WsServerListAcpRegistryProvidersRpc,
  WsServerSetAcpRegistryProviderRpc,
  WsServerDisableAcpRegistryProviderRpc,
  WsServerLogoutAcpRegistryRpc,
  WsServerGetTraceDiagnosticsRpc,
  WsServerGetProcessDiagnosticsRpc,
  WsServerGetHostResourcesRpc,
  WsServerGetProcessResourceHistoryRpc,
  WsServerGetResourceTelemetryHistoryRpc,
  WsServerRetryResourceTelemetryRpc,
  WsServerCheckOtlpEndpointRpc,
  WsServerPrepareTriageRpc,
  WsServerGetUsageSummaryRpc,
  WsServerRefreshUsageRatesRpc,
  WsServerSignalProcessRpc,
  WsScheduledTasksSubscribeRpc,
  WsScheduledTasksUpsertRpc,
  WsScheduledTasksSetEnabledRpc,
  WsScheduledTasksDeleteRpc,
  WsScheduledTasksRunNowRpc,
  WsScheduledTasksRotateWebhookTokenRpc,
  WsSecretsAnswerRequestRpc,
  WsScheduledTasksListWebhookDeliveriesRpc,
  WsScheduledTasksGetWebhookDeliveryRpc,
  WsServerReportClientActivityRpc,
  WsCloudGetRelayClientStatusRpc,
  WsCloudInstallRelayClientRpc,
  WsPullRequestsListRpc,
  WsPullRequestsListStatsRpc,
  WsPullRequestsFilterOptionsRpc,
  WsPullRequestsSummaryRpc,
  WsPullRequestsRoutingRpc,
  WsPullRequestsRoutingIdentityRpc,
  WsPullRequestsStackRpc,
  WsPullRequestsLinkedThreadsRpc,
  WsPullRequestsDetailRpc,
  WsPullRequestsPreviewRpc,
  WsPullRequestsChecksRpc,
  WsPullRequestsActivityRpc,
  WsPullRequestsReviewGuideRpc,
  WsPullRequestsGenerateReviewGuideRpc,
  WsPullRequestsThreadCommentsRpc,
  WsPullRequestsDiffFileContentsRpc,
  WsPullRequestsFilesViewedRpc,
  WsPullRequestsChangeBreakdownRpc,
  WsPullRequestsSetFilesViewedRpc,
  WsPullRequestsRunActionRpc,
  WsPullRequestsUpdateRpc,
  WsPullRequestsCommentRpc,
  WsPullRequestsUpdateCommentRpc,
  WsPullRequestsSubmitReviewRpc,
  WsPullRequestsReplyToThreadRpc,
  WsPullRequestsSetThreadResolutionRpc,
  WsPullRequestsSetReactionRpc,
  WsPullRequestsInvalidateRpc,
  WsPullRequestsReportStateRpc,
  WsPullRequestsSubscribeRefreshesRpc,
  WsPullRequestsReviewerCandidatesRpc,
  WsPullRequestsRequestReviewersRpc,
  WsPullRequestsLabelCandidatesRpc,
  WsPullRequestsSetLabelsRpc,
  WsSourceControlLookupRepositoryRpc,
  WsSourceControlCloneRepositoryRpc,
  WsSourceControlPublishRepositoryRpc,
  WsSourceControlSignInStartRpc,
  WsSourceControlSignInWaitRpc,
  WsSourceControlSignInCancelRpc,
  WsSourceControlAppAccessRpc,
  WsSourceControlStarredRpc,
  WsProjectCloneStartRpc,
  WsProjectCloneCancelRpc,
  WsProjectCloneRetryRpc,
  WsSubscribeProjectClonesRpc,
  WsProjectsListEntriesRpc,
  WsProjectsListIgnoredFilesRpc,
  WsProjectsReadFileRpc,
  WsProjectsSearchContentsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsEnsureScratchRpc,
  WsProjectsCreateNewRpc,
  WsProjectsCreateFromThreadRpc,
  WsProjectsWriteFileRpc,
  WsProjectsMutateRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsFilesystemGetMetadataRpc,
  WsAgentSessionsScanRpc,
  WsAgentSessionsImportRpc,
  WsAssetsCreateUrlRpc,
  WsAssetsPersistChatAttachmentsRpc,
  WsAttachmentsCreateUploadUrlRpc,
  WsAttachmentsDeleteRpc,
  WsMcpAppsCallToolRpc,
  WsMcpAppsToolInfoRpc,
  WsMcpAppsReadResourceRpc,
  WsMcpAppsUpdateModelContextRpc,
  WsProviderUploadFeedbackRpc,
  WsSubscribeVcsStatusRpc,
  WsSubscribeWorktreeSetupRpc,
  WsWorktreeSetupCancelRpc,
  WsVcsPullRpc,
  WsVcsRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsVcsListRefsRpc,
  WsVcsCreateWorktreeRpc,
  WsVcsRemoveWorktreeRpc,
  WsVcsCreateRefRpc,
  WsVcsSwitchRefRpc,
  WsVcsInitRpc,
  WsReviewGetBranchCommitsRpc,
  WsReviewGetDiffPreviewRpc,
  WsReviewGetDiffFileContentsRpc,
  WsTerminalOpenRpc,
  WsTerminalAttachRpc,
  WsTerminalObserveRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalMetadataRpc,
  WsPreviewOpenRpc,
  WsPreviewResizeRpc,
  WsPreviewAdjustRpc,
  WsPreviewCloseRpc,
  WsPreviewListRpc,
  WsPreviewClearProfileRpc,
  WsPreviewReportProfilesRpc,
  WsPreviewReportStatusRpc,
  WsSubscribePreviewEventsRpc,
  WsPreviewStopLocalServerRpc,
  WsSubscribeDiscoveredLocalServersRpc,
  WsDeviceConfigureRpc,
  WsDeviceListRpc,
  WsDeviceTestHostRpc,
  WsDeviceEasAccountRpc,
  WsDeviceSimlockIdentityRpc,
  WsDeviceOpenRpc,
  WsDeviceCloseRpc,
  WsDeviceShutdownRpc,
  WsDeviceDetailRpc,
  WsDeviceActionRpc,
  WsSubscribeDeviceStateRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsSubscribeResourceTelemetryRpc,
  WsOrchestrationV2DispatchCommandRpc,
  WsOrchestrationV2GetWorkflowScriptRpc,
  WsOrchestrationV2GetNativeChildWorkRpc,
  WsOrchestrationV2StopWorkflowRpc,
  WsOrchestrationV2ForceStopThreadRpc,
  WsOrchestrationV2GetTurnItemRpc,
  WsOrchestrationV2GetTurnDiffRpc,
  WsOrchestrationV2GetFullThreadDiffRpc,
  WsOrchestrationV2SearchThreadsRpc,
  WsOrchestrationV2SearchThreadRpc,
  WsOrchestrationV2SearchThreadStreamRpc,
  WsOrchestrationV2GetArchivedShellSnapshotRpc,
  WsOrchestrationV2GetThreadFamilyRpc,
  WsOrchestrationV2GetWorktreeThreadIdsRpc,
  WsOrchestrationV2GetOlderSettledThreadsRpc,
  WsOrchestrationV2GetThreadProjectionRpc,
  WsOrchestrationV2LaunchThreadRpc,
  WsOrchestrationV2SubscribeShellRpc,
  WsOrchestrationV2SubscribeThreadRpc,
  WsOrchestrationV2SubscribeCommandOutputRpc,
).middleware(RpcScopeAuthorization);
