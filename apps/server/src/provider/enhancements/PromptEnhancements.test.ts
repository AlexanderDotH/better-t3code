import { describe, expect, it } from "vite-plus/test";

import {
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
