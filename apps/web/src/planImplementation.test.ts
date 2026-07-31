import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanImplementationPrompt,
  estimatePlanImplementationWorkUnits,
  getSupportedPlanSubagentCounts,
  resolvePlanImplementationSuggestion,
  type PlanImplementationStrategy,
} from "./planImplementation";

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
  const withNativeSubagents = input.withNativeSubagents ?? true;

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
    ...(withNativeSubagents
      ? {
          nativeSubagents: {
            toolName: input.toolName ?? "spawn_agent",
            maxRecommendedSubagents: input.maxRecommendedSubagents ?? 4,
          },
        }
      : {}),
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("estimatePlanImplementationWorkUnits", () => {
  it("uses the larger count between eligible headings and top-level list items", () => {
    const plan = [
      "# Ship parallel implementation",
      "",
      "## Summary",
      "- This summary item is not implementation work.",
      "",
      "## Contracts",
      "- Add the schema.",
      "  - Keep this nested detail out of the count.",
      "- Add compatibility decoding.",
      "",
      "## Web",
      "1. Add the settings control.",
      "   1. This nested item is not a work unit.",
      "2. Wire the action.",
    ].join("\n");

    expect(estimatePlanImplementationWorkUnits(plan)).toBe(4);
  });

  it("ignores excluded sections, their descendants, and fenced code", () => {
    const plan = [
      "# Ship it",
      "",
      "## Assumptions",
      "- Ignore this.",
      "### Nested assumption",
      "- Ignore this too.",
      "",
      "## Defaults",
      "- Ignore this.",
      "",
      "## Non-goals",
      "- Ignore this.",
      "",
      "## Out of scope",
      "- Ignore this.",
      "",
      "~~~md",
      "## Fake heading",
      "- Fake list item",
      "~~~",
      "",
      "## Implementation",
      "- Real work.",
    ].join("\n");

    expect(estimatePlanImplementationWorkUnits(plan)).toBe(1);
  });

  it("counts a root list indented consistently while excluding its nested items", () => {
    const plan = [
      "  - First root item",
      "    - Nested item",
      "  - Second root item",
      "    1. Nested ordered item",
    ].join("\n");

    expect(estimatePlanImplementationWorkUnits(plan)).toBe(2);
  });

  it("returns one for an empty or metadata-only plan", () => {
    expect(estimatePlanImplementationWorkUnits("")).toBe(1);
    expect(estimatePlanImplementationWorkUnits("## Summary\n\n- Nothing to implement yet.")).toBe(
      1,
    );
  });
});

describe("getSupportedPlanSubagentCounts", () => {
  it("returns every selectable count through the provider ceiling", () => {
    expect(getSupportedPlanSubagentCounts(provider())).toEqual([2, 3, 4]);
    expect(getSupportedPlanSubagentCounts(provider({ maxRecommendedSubagents: 3 }))).toEqual([
      2, 3,
    ]);
  });

  it("returns no counts for missing, disabled, unavailable, or unsupported providers", () => {
    expect(getSupportedPlanSubagentCounts(undefined)).toEqual([]);
    expect(getSupportedPlanSubagentCounts(provider({ enabled: false }))).toEqual([]);
    expect(getSupportedPlanSubagentCounts(provider({ installed: false }))).toEqual([]);
    expect(getSupportedPlanSubagentCounts(provider({ availability: "unavailable" }))).toEqual([]);
    expect(getSupportedPlanSubagentCounts(provider({ withNativeSubagents: false }))).toEqual([]);
    expect(getSupportedPlanSubagentCounts(provider({ maxRecommendedSubagents: 1 }))).toEqual([]);
  });
});

describe("resolvePlanImplementationSuggestion", () => {
  it("clamps the adaptive suggestion to two through the provider ceiling", () => {
    expect(
      resolvePlanImplementationSuggestion({
        featureEnabled: true,
        planMarkdown: "## Implementation\n\n- One task.",
        provider: provider(),
      }),
    ).toEqual({
      strategy: { kind: "subagents", count: 2 },
      supportedCounts: [2, 3, 4],
    });

    expect(
      resolvePlanImplementationSuggestion({
        featureEnabled: true,
        planMarkdown: "- one\n- two\n- three\n- four\n- five",
        provider: provider({ maxRecommendedSubagents: 3 }),
      }),
    ).toEqual({
      strategy: { kind: "subagents", count: 3 },
      supportedCounts: [2, 3],
    });
  });

  it("returns no suggestion when the experiment is off or the provider is ineligible", () => {
    expect(
      resolvePlanImplementationSuggestion({
        featureEnabled: false,
        planMarkdown: "- one\n- two",
        provider: provider(),
      }),
    ).toBeNull();

    expect(
      resolvePlanImplementationSuggestion({
        featureEnabled: true,
        planMarkdown: "- one\n- two",
        provider: provider({ withNativeSubagents: false }),
      }),
    ).toBeNull();
  });
});

describe("buildPlanImplementationPrompt", () => {
  it("preserves the existing standard implementation prompt byte-for-byte", () => {
    expect(buildPlanImplementationPrompt("## Ship it\n\n- step 1\n")).toBe(
      "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
    );
  });

  it("builds the exact fail-closed native-subagent execution contract", () => {
    const strategy: PlanImplementationStrategy = { kind: "subagents", count: 3 };

    expect(
      buildPlanImplementationPrompt("## Ship it\n\n- step 1\n", {
        strategy,
        provider: provider({ toolName: "spawn_agent" }),
      }),
    ).toBe(`PLEASE IMPLEMENT THIS COMPLETE PLAN USING EXACTLY 3 SUBAGENTS.

EXECUTION CONTRACT:
- Before modifying files, decompose the complete plan into exactly 3 concrete, non-overlapping workstreams.
- Use the provider's native \`spawn_agent\` tool to spawn exactly 3 direct child subagents in one parallel batch. Do not spawn fewer or more.
- Give every subagent meaningful implementation or verification work and explicit ownership. Do not create dummy or duplicate tasks.
- Subagents must not spawn additional agents.
- The parent agent owns shared-file integration, conflict resolution, unfinished work, and final verification.
- Wait for every subagent, use their results, integrate the complete plan, and run every specified acceptance check.
- Do not report completion while any plan item remains unfinished.
- If \`spawn_agent\` is unavailable or exactly 3 subagents cannot be started, STOP before modifying files and report the blocker. Do not silently fall back to serial implementation.

PLAN:
## Ship it

- step 1`);
  });

  it("rejects a subagent strategy when the exact provider snapshot cannot support it", () => {
    expect(() =>
      buildPlanImplementationPrompt("- step 1", {
        strategy: { kind: "subagents", count: 3 },
        provider: provider({ withNativeSubagents: false }),
      }),
    ).toThrow("Selected provider does not support native subagents");

    expect(() =>
      buildPlanImplementationPrompt("- step 1", {
        strategy: { kind: "subagents", count: 4 },
        provider: provider({ maxRecommendedSubagents: 3 }),
      }),
    ).toThrow("Selected provider supports at most 3 subagents");
  });
});
