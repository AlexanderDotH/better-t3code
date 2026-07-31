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

  it("classifies local feature reads without granting mutation access", () => {
    const readMethods = [
      ORCHESTRATION_WS_METHODS.exportThreadTranscript,
      WS_METHODS.speechGetProjectProfile,
      WS_METHODS.speechListProjectProfiles,
      WS_METHODS.chatImportDiscover,
      WS_METHODS.skillsList,
      WS_METHODS.skillsDiscoverImportSources,
      WS_METHODS.mcpList,
      WS_METHODS.mcpDiscoverImportSources,
      WS_METHODS.mcpExportCursorJson,
      WS_METHODS.mcpProviderStatus,
    ];

    for (const method of readMethods) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    }
  });

  it("requires operate scope for local feature mutations", () => {
    const operateMethods = [
      WS_METHODS.serverCreateAssemblyAiStreamingToken,
      WS_METHODS.speechIndexProject,
      WS_METHODS.speechCreateBasicProjectProfile,
      WS_METHODS.speechTranslateTranscript,
      WS_METHODS.promptImprove,
      WS_METHODS.planReviewParallelism,
      WS_METHODS.chatImportRun,
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
      WS_METHODS.mcpImportCursorJson,
      WS_METHODS.mcpImportSources,
    ];

    for (const method of operateMethods) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    }
  });

  it("rejects unknown RPC method names", () => {
    for (const method of ["server.notRegistered", "toString", "constructor"]) {
      expect(() => requiredScopeForRpcMethod(method)).toThrow(
        `RPC method ${method} has no declared authorization scope.`,
      );
    }
  });
});
