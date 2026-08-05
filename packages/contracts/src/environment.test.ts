import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ExecutionEnvironmentCapabilities } from "./environment.ts";

const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);

describe("ExecutionEnvironmentCapabilities", () => {
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
});
