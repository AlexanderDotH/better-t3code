import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  FETCH_MODE,
  FETCH_SUBAGENT_COUNT,
  buildFetchProviderInstructions,
  resolveFetchModeForProvider,
} from "./fetchMode.ts";

function provider(
  input: {
    enabled?: boolean;
    installed?: boolean;
    availability?: ServerProvider["availability"];
    maxRecommendedSubagents?: number;
    toolName?: string;
    withNativeSubagents?: boolean;
  } = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...(input.availability ? { availability: input.availability } : {}),
    ...((input.withNativeSubagents ?? true)
      ? {
          nativeSubagents: {
            toolName: input.toolName ?? "spawn_agent",
            maxRecommendedSubagents: input.maxRecommendedSubagents ?? 8,
          },
        }
      : {}),
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("Fetch repository exploration", () => {
  it("builds a bounded three-agent read-only exploration contract", () => {
    const instructions = buildFetchProviderInstructions(provider());

    expect(FETCH_MODE).toBe("repository-exploration");
    expect(FETCH_SUBAGENT_COUNT).toBe(3);
    expect(instructions).toContain("exactly 3 direct child subagents");
    expect(instructions).toContain("`spawn_agent`");
    expect(instructions).toContain("one parallel batch");
    expect(instructions).toContain("read-only");
    expect(instructions).toContain("must not modify files");
    expect(instructions).toContain("must not spawn additional agents");
    expect(instructions).toContain("Continue useful read-only exploration while they run");
    expect(instructions).toContain("wait for all three results before the first file modification");
    expect(instructions).toContain("If this is not a repository task");
  });

  it("does not arm Fetch when disabled or unsupported", () => {
    expect(
      resolveFetchModeForProvider({ featureEnabled: false, provider: provider() }),
    ).toBeUndefined();
    expect(
      resolveFetchModeForProvider({ featureEnabled: true, provider: undefined }),
    ).toBeUndefined();
    expect(
      resolveFetchModeForProvider({
        featureEnabled: true,
        provider: provider({ enabled: false }),
      }),
    ).toBeUndefined();
    expect(
      resolveFetchModeForProvider({
        featureEnabled: true,
        provider: provider({ installed: false }),
      }),
    ).toBeUndefined();
    expect(
      resolveFetchModeForProvider({
        featureEnabled: true,
        provider: provider({ availability: "unavailable" }),
      }),
    ).toBeUndefined();
    expect(
      resolveFetchModeForProvider({
        featureEnabled: true,
        provider: provider({ withNativeSubagents: false }),
      }),
    ).toBeUndefined();
    expect(
      resolveFetchModeForProvider({
        featureEnabled: true,
        provider: provider({ maxRecommendedSubagents: 2 }),
      }),
    ).toBeUndefined();
  });

  it("returns the narrow Fetch mode for a supported provider", () => {
    expect(resolveFetchModeForProvider({ featureEnabled: true, provider: provider() })).toBe(
      FETCH_MODE,
    );
  });
});
