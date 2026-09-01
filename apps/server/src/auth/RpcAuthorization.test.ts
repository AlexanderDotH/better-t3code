import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "./RpcAuthorization.ts";

describe("RPC authorization scopes", () => {
  it("declares exactly one scope for every RPC in the server group", () => {
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it("authorizes background policy reporting and observation deliberately", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportClientActivity)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportHostPowerState)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverGetBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.subscribeBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
  });

  it("allows relay status reads without granting relay installation access", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudGetRelayClientStatus)).toBe(
      AuthRelayReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudInstallRelayClient)).toBe(AuthRelayWriteScope);
  });

  it("separates Knowledge Graph observation from lifecycle mutations", () => {
    for (const method of [
      WS_METHODS.knowledgeGraphSubscribe,
      WS_METHODS.knowledgeGraphQuery,
      WS_METHODS.knowledgeGraphNodeContent,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    }

    for (const method of [
      WS_METHODS.knowledgeGraphRebuild,
      WS_METHODS.knowledgeGraphCancel,
      WS_METHODS.knowledgeGraphPause,
      WS_METHODS.knowledgeGraphClear,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    }
  });

  it("classifies local feature reads without granting mutation access", () => {
    const readMethods = [
      ORCHESTRATION_WS_METHODS.exportThreadTranscript,
      WS_METHODS.speechGetProjectProfile,
      WS_METHODS.speechListProjectProfiles,
      WS_METHODS.chatImportDiscover,
      WS_METHODS.harnessChatSyncSources,
      WS_METHODS.harnessChatSyncList,
      WS_METHODS.harnessChatSyncStatus,
      WS_METHODS.skillsList,
      WS_METHODS.skillsDiscoverImportSources,
      WS_METHODS.mcpList,
      WS_METHODS.mcpDiscoverImportSources,
      WS_METHODS.mcpExportCursorJson,
      WS_METHODS.mcpProviderStatus,
      WS_METHODS.mcpRuntimeContexts,
      WS_METHODS.mcpRuntimeContextChanges,
      WS_METHODS.mcpRuntimeSnapshot,
      WS_METHODS.mcpRuntimeChanges,
      WS_METHODS.mcpRuntimeServerDetails,
      WS_METHODS.gitSubscribeWorkbench,
      WS_METHODS.gitGetRepositoryInsights,
      WS_METHODS.gitListHistory,
      WS_METHODS.gitGetCommitDetail,
      WS_METHODS.gitGetCommitFileDiff,
      WS_METHODS.gitGetChangesDiff,
      WS_METHODS.gitGetInteractiveRebasePlan,
      WS_METHODS.gitListUndoSnapshots,
    ];

    for (const method of readMethods) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    }
  });

  it("requires operate scope for local feature mutations", () => {
    const operateMethods = [
      WS_METHODS.serverCreateAssemblyAiStreamingToken,
      WS_METHODS.serverProviderAuthConnect,
      WS_METHODS.serverProviderAuthSetCredential,
      WS_METHODS.serverProviderAuthDisconnect,
      WS_METHODS.speechIndexProject,
      WS_METHODS.speechCreateBasicProjectProfile,
      WS_METHODS.speechTranslateTranscript,
      WS_METHODS.promptImprove,
      WS_METHODS.planReviewParallelism,
      WS_METHODS.chatImportRun,
      WS_METHODS.harnessChatSyncRun,
      WS_METHODS.skillsImportSources,
      WS_METHODS.skillsCreate,
      WS_METHODS.skillsUpdate,
      WS_METHODS.skillsRename,
      WS_METHODS.skillsDelete,
      WS_METHODS.skillsSetEnabled,
      WS_METHODS.mcpCreate,
      WS_METHODS.mcpUpdate,
      WS_METHODS.mcpDelete,
      WS_METHODS.mcpSetEnabled,
      WS_METHODS.mcpSetProviderEnabled,
      WS_METHODS.mcpRuntimeAction,
      WS_METHODS.mcpImportCursorJson,
      WS_METHODS.mcpImportSources,
      WS_METHODS.gitApplyChangeSelection,
      WS_METHODS.gitRunWorkbenchOperation,
      WS_METHODS.gitCreateUndoSnapshot,
      WS_METHODS.gitRestoreUndoSnapshot,
      WS_METHODS.gitUpsertQueuedWorkflow,
      WS_METHODS.gitCancelQueuedWorkflow,
    ];

    for (const method of operateMethods) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    }
  });

  it("requires permission to operate on a thread before uploading feedback", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.providerUploadFeedback)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("reads the reviewer menu under the same scope as the pull request it belongs to", () => {
    // The candidate list is a read like the detail beside it, and asking somebody for a review is
    // a write like every other pull request operation.
    expect(requiredScopeForRpcMethod(WS_METHODS.pullRequestsReviewerCandidates)).toBe(
      requiredScopeForRpcMethod(WS_METHODS.pullRequestsDetail),
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.pullRequestsRequestReviewers)).toBe(
      requiredScopeForRpcMethod(WS_METHODS.pullRequestsComment),
    );
  });

  it("rejects unknown RPC method names", () => {
    for (const method of ["server.notRegistered", "toString", "constructor"]) {
      expect(() => requiredScopeForRpcMethod(method)).toThrow(
        `RPC method ${method} has no declared authorization scope.`,
      );
    }
  });
});
