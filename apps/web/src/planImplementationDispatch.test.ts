import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolvePlanImplementationDispatch } from "./planImplementationDispatch";

function provider(input: {
  instanceId: string;
  toolName?: string;
  maxRecommendedSubagents?: number;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...(input.toolName
      ? {
          nativeSubagents: {
            toolName: input.toolName,
            maxRecommendedSubagents: input.maxRecommendedSubagents ?? 4,
          },
        }
      : {}),
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("resolvePlanImplementationDispatch", () => {
  it("preserves standard implementation without requiring a provider capability", () => {
    expect(
      resolvePlanImplementationDispatch({
        planMarkdown: "## Ship it\n\n- One task.",
        strategy: { kind: "standard" },
        selectedProviderInstanceId: ProviderInstanceId.make("unsupported"),
        providerStatuses: [],
      }),
    ).toEqual({
      _tag: "Ready",
      prompt: "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- One task.",
    });
  });

  it("uses only the exact selected provider-instance capability", () => {
    const result = resolvePlanImplementationDispatch({
      planMarkdown: "- One\n- Two",
      strategy: { kind: "subagents", count: 2 },
      selectedProviderInstanceId: ProviderInstanceId.make("codex-work"),
      providerStatuses: [
        provider({ instanceId: "codex", toolName: "wrong_tool" }),
        provider({ instanceId: "codex-work", toolName: "spawn_agent" }),
      ],
    });

    expect(result._tag).toBe("Ready");
    if (result._tag === "Ready") {
      expect(result.prompt).toContain("native `spawn_agent` tool");
      expect(result.prompt).not.toContain("wrong_tool");
    }
  });

  it("blocks before dispatch when the selected capability disappeared", () => {
    expect(
      resolvePlanImplementationDispatch({
        planMarkdown: "- One\n- Two",
        strategy: { kind: "subagents", count: 2 },
        selectedProviderInstanceId: ProviderInstanceId.make("codex-work"),
        providerStatuses: [provider({ instanceId: "codex-work" })],
      }),
    ).toEqual({
      _tag: "Blocked",
      error:
        "Parallel plan implementation is no longer available for the selected provider. " +
        "Selected provider does not support native subagents. " +
        "Choose Implement normally or select a provider with native subagent support.",
    });
  });

  it("blocks before dispatch when the selected count exceeds the current ceiling", () => {
    expect(
      resolvePlanImplementationDispatch({
        planMarkdown: "- One\n- Two\n- Three\n- Four",
        strategy: { kind: "subagents", count: 4 },
        selectedProviderInstanceId: ProviderInstanceId.make("codex-work"),
        providerStatuses: [
          provider({
            instanceId: "codex-work",
            toolName: "spawn_agent",
            maxRecommendedSubagents: 3,
          }),
        ],
      }),
    ).toEqual({
      _tag: "Blocked",
      error:
        "Parallel plan implementation is no longer available for the selected provider. " +
        "Selected provider supports at most 3 subagents. " +
        "Choose Implement normally or select a provider with native subagent support.",
    });
  });
});
