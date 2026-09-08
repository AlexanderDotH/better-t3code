import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyAgentEnhancementsToProviderInput,
  buildAccumulatedDeepThinkingData,
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildCavemanPromptAppendix,
  buildDecomposeSystemPrompt,
  buildEnabledSkillPromptAppendix,
  buildStepWorkUserPrompt,
  injectBundledSkillPrompts,
  injectCavemanPromptStyle,
  SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID,
} from "./index.ts";

describe("provider prompt enhancements", () => {
  it("applies bounded Deep Thinking and Caveman policy without changing the original request", () => {
    const original = "Implement the lifecycle fix and keep approvals intact.";
    const out = applyAgentEnhancementsToProviderInput({
      providerInput: original,
      cavemanMode: "full",
      deepThinking: {
        enabled: true,
        stepCount: 4,
        refinementPasses: 1,
        parallelEnabled: true,
        parallelBatchSize: 2,
        forceParallelForDurableProviders: false,
      },
    });

    expect(out.outcome).toBe("included");
    expect(out.providerInput).toContain("at most 4 distinct considerations");
    expect(out.providerInput).toContain("at most 1 bounded self-review pass");
    expect(out.providerInput).toContain("batches of at most 2");
    expect(out.providerInput).toContain("### Caveman mode");
    expect(out.providerInput).toContain("does not grant tools or relax approvals");
    expect(out.providerInput?.endsWith(original)).toBe(true);

    const forcedParallel = applyAgentEnhancementsToProviderInput({
      providerInput: original,
      cavemanMode: "off",
      deepThinking: {
        enabled: true,
        stepCount: 3,
        refinementPasses: 0,
        parallelEnabled: true,
        parallelBatchSize: 3,
        forceParallelForDurableProviders: true,
      },
    });
    expect(forcedParallel.providerInput).toContain(
      "Use that bounded organization when the already-selected runtime supports it durably.",
    );
  });

  it("returns byte-equivalent prompts when both agent enhancements are off", () => {
    const original = "  preserve these bytes\nincluding the final newline\n";
    const out = applyAgentEnhancementsToProviderInput({
      providerInput: original,
      cavemanMode: "off",
      deepThinking: {
        enabled: false,
        stepCount: 8,
        refinementPasses: 3,
        parallelEnabled: true,
        parallelBatchSize: 8,
        forceParallelForDurableProviders: true,
      },
    });

    expect(out).toEqual({ providerInput: original, outcome: "not-requested" });
    expect(out.providerInput).toBe(original);
  });

  it("omits optional enhancement policy instead of truncating a full provider request", () => {
    const original = "u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    expect(
      applyAgentEnhancementsToProviderInput({
        providerInput: original,
        cavemanMode: "ultra",
        deepThinking: {
          enabled: true,
          stepCount: 8,
          refinementPasses: 3,
          parallelEnabled: false,
          parallelBatchSize: 1,
          forceParallelForDurableProviders: false,
        },
      }),
    ).toEqual({ providerInput: original, outcome: "omitted" });
  });

  it("injects caveman prompt style only when enabled and never changes the user prompt", () => {
    const out = injectCavemanPromptStyle(
      { system: "base", user: "keep me" },
      { mode: "full", surface: "freeChatStream" },
    );

    expect(out.user).toBe("keep me");
    expect(out.system).toContain("base");
    expect(out.system).toContain("### Caveman mode");
    expect(out.system).toContain("Voice (full)");
  });

  it("skips caveman prompt style for off mode and strict guardrail surfaces", () => {
    const payload = { system: "judge", user: "u" };

    expect(injectCavemanPromptStyle(payload, { mode: "off" })).toEqual(payload);
    expect(
      injectCavemanPromptStyle(payload, { mode: "ultra", surface: "preflightGuardrail" }),
    ).toEqual(payload);
    expect(buildCavemanPromptAppendix("off")).toBe("");
  });

  it("builds deep-thinking prompts without provider side effects", () => {
    expect(buildDecomposeSystemPrompt(3)).toContain("exactly 3 non-empty strings");
    expect(
      buildStepWorkUserPrompt("Fix the bug", "Map the failure path", 1, 3, ["Read logs"]),
    ).toContain("Already covered:\n1. Read logs");

    const data = buildAccumulatedDeepThinkingData(
      ["Map the failure path"],
      [{ thinking: "The cache is stale." }],
      [],
    );
    expect(buildAnswerSystemPrompt("original system")).toContain("### Deep thinking");
    expect(buildAnswerUserPrompt("Fix the bug", data, "Original user text")).toContain(
      "Original user text",
    );
  });

  it("builds the section-entry skill appendix when explicitly enabled", () => {
    const appendix = buildEnabledSkillPromptAppendix(
      {
        phase: "implementation",
        surface: "workflowPhase",
        pageVerticalPadding: { topMm: 12, bottomMm: 12, source: "wizard" },
      },
      { enabledSkillIds: new Set([SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID]) },
    );

    expect(appendix).toContain("### Skill: Section Entry Print Layout");
    expect(appendix).toContain(".section-entries");
    expect(appendix).toContain('"topMm": 12');
    expect(appendix).toContain('"bottomMm": 12');
  });

  it("filters bundled skills by phase and parses customer-form page padding", () => {
    const disabledForChecking = buildEnabledSkillPromptAppendix(
      { phase: "checking", surface: "workflowPhase" },
      { enabledSkillIds: new Set([SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID]) },
    );
    expect(disabledForChecking).toBe("");

    const freeChatAppendix = buildEnabledSkillPromptAppendix(
      {
        surface: "freeChatTools",
        customerFormPromptMarkdown: "- **Page vertical padding:** 7mm",
      },
      { enabledSkillIds: new Set([SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID]) },
    );
    expect(freeChatAppendix).toContain("Configured page vertical padding: 7mm");
    expect(freeChatAppendix).toContain('"topMm": 7');
    expect(freeChatAppendix).toContain('"bottomMm": 7');
  });

  it("injects bundled skills into free-chat system prompts but leaves workflow prompts to callers", () => {
    const out = injectBundledSkillPrompts(
      { system: "base", user: "u" },
      { surface: "freeChatStream" },
      { enabledSkillIds: new Set([SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID]) },
    );
    expect(out.system).toContain("base");
    expect(out.system).toContain("### Skill: Section Entry Print Layout");
    expect(out.user).toBe("u");

    expect(
      injectBundledSkillPrompts(
        { system: "workflow", user: "u" },
        { phase: "implementation", surface: "workflowPhase" },
        { enabledSkillIds: new Set([SECTION_ENTRY_PRINT_LAYOUT_SKILL_ID]) },
      ),
    ).toEqual({ system: "workflow", user: "u" });
  });
});
