import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ExecutionEnvironmentCapabilities,
  ExecutionEnvironmentDescriptor,
  ServerSelfUpdateCapability,
} from "./environment.ts";

const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const decodeServerSelfUpdateCapability = Schema.decodeUnknownSync(ServerSelfUpdateCapability);

describe("ExecutionEnvironmentCapabilities", () => {
  it("accepts container-managed server updates without treating them as self-update RPCs", () => {
    expect(decodeServerSelfUpdateCapability("container-managed")).toBe("container-managed");
  });
  it("defaults mid-chat provider switching to false for legacy descriptors", () => {
    expect(decodeCapabilities({ repositoryIdentity: true })).toEqual({
      repositoryIdentity: true,
      midChatProviderSwitching: false,
    });
  });

  it("accepts an advertised mid-chat provider switching capability", () => {
    expect(
      decodeCapabilities({
        repositoryIdentity: true,
        midChatProviderSwitching: true,
      }).midChatProviderSwitching,
    ).toBe(true);
  });

  it("treats an absent Git workbench capability as unsupported", () => {
    const legacy = decodeCapabilities({ repositoryIdentity: true });
    const current = decodeCapabilities({ repositoryIdentity: true, gitWorkbenchVersion: 1 });

    expect(legacy.gitWorkbenchVersion).toBeUndefined();
    expect(current.gitWorkbenchVersion).toBe(1);
  });

  it("keeps the MCP workspace capability optional for legacy servers", () => {
    const legacy = decodeCapabilities({ repositoryIdentity: true });
    const current = decodeCapabilities({ repositoryIdentity: true, mcpWorkspaceVersion: 1 });

    expect(legacy.mcpWorkspaceVersion).toBeUndefined();
    expect(current.mcpWorkspaceVersion).toBe(1);
    expect(() =>
      decodeCapabilities({ repositoryIdentity: true, mcpWorkspaceVersion: 0 }),
    ).toThrow();
  });

  it("keeps extended agent workflows optional for legacy servers", () => {
    const legacy = decodeCapabilities({ repositoryIdentity: true });
    const current = decodeCapabilities({ repositoryIdentity: true, agentWorkflowVersion: 1 });

    expect(legacy.agentWorkflowVersion).toBeUndefined();
    expect(current.agentWorkflowVersion).toBe(1);
    expect(() =>
      decodeCapabilities({ repositoryIdentity: true, agentWorkflowVersion: 0 }),
    ).toThrow();
  });

  it("keeps environment and project settings optional under version skew", () => {
    const legacy = decodeCapabilities({ repositoryIdentity: true });
    const previewSyncServer = decodeCapabilities({
      repositoryIdentity: true,
      environmentSettingsVersion: 2,
      projectSettingsVersion: 1,
    });
    const current = decodeCapabilities({
      repositoryIdentity: true,
      environmentSettingsVersion: 3,
      projectSettingsVersion: 1,
    });

    expect(legacy.environmentSettingsVersion).toBeUndefined();
    expect(legacy.projectSettingsVersion).toBeUndefined();
    expect(previewSyncServer.environmentSettingsVersion).toBe(2);
    expect(current.environmentSettingsVersion).toBe(3);
    expect(current.projectSettingsVersion).toBe(1);
  });
});

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("treats a missing pull-request capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.pullRequests).toBeUndefined();
  });

  it("preserves an advertised pull-request capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, pullRequests: true },
      }).capabilities.pullRequests,
    ).toBe(true);
  });
});
