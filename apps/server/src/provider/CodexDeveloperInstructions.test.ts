import { describe, expect, it } from "vite-plus/test";

import { buildCodexDeveloperInstructions } from "./CodexDeveloperInstructions.ts";

const preChangeDefaultFixture = {
  characters: 2_606,
  estimatedTokens: Math.ceil(2_606 / 4),
};
const estimatedTokens = (value: string) => Math.ceil(value.length / 4);

describe("buildCodexDeveloperInstructions delegation history policy", () => {
  for (const interactionMode of ["default", "plan"] as const) {
    it(`defaults automatic ${interactionMode} delegation to a self-contained brief without history`, () => {
      const instructions = buildCodexDeveloperInstructions(interactionMode, {
        model: "gpt-5.6",
        reasoningEffort: "high",
      });

      expect(instructions).toContain('fork_turns: "none"');
      expect(instructions).toContain("self-contained brief");
      expect(instructions).toContain("positive fork_turns count");
      expect(instructions).toContain("full history only when explicitly requested");
      expect(instructions).toContain("thread_context");
      expect(instructions).not.toMatch(/at most \d+ (?:direct )?(?:children|agents|subagents)/i);
    });
  }

  it("keeps character and token estimates thirty percent below the pre-change fixture", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.6",
      reasoningEffort: "high",
    });

    expect(instructions.length).toBeLessThanOrEqual(
      Math.floor(preChangeDefaultFixture.characters * 0.7),
    );
    expect(estimatedTokens(instructions)).toBeLessThanOrEqual(
      Math.floor(preChangeDefaultFixture.estimatedTokens * 0.7),
    );
  });

  it("keeps all eight self-contained briefs below half the legacy inherited input", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.6",
      reasoningEffort: "high",
    });
    const parentTranscript = `Goal and prior evidence\n${"historical tool output ".repeat(8_000)}`;
    const briefs = Array.from(
      { length: 8 },
      (_, index) =>
        `Workstream ${index + 1}: inspect its owned files, preserve behavior, and return focused acceptance evidence.`,
    );
    const legacyProcessedInput = briefs.reduce(
      (total, brief) => total + estimatedTokens(`${instructions}\n${parentTranscript}\n${brief}`),
      0,
    );
    const compactProcessedInput = briefs.reduce(
      (total, brief) => total + estimatedTokens(`${instructions}\n${brief}`),
      0,
    );

    expect(briefs).toHaveLength(8);
    expect(briefs.every((brief) => brief.includes("acceptance evidence"))).toBe(true);
    expect(compactProcessedInput).toBeLessThanOrEqual(legacyProcessedInput * 0.5);
  });

  it("adds only non-duplicated guidance for capabilities attached to this session", () => {
    const instructions = buildCodexDeveloperInstructions(
      "default",
      { model: "gpt-5.6", reasoningEffort: "high" },
      {
        preview: false,
        workspace: false,
        workspaceWrite: false,
        coordination: true,
        threadContext: true,
        projectMemory: false,
        knowledgeGraph: false,
      },
    );

    expect(instructions).not.toContain("preview_status");
    expect(instructions).not.toContain("workspace_context");
    expect(instructions).not.toContain("Project memory");
    expect(instructions).toContain("thread_context");
    expect(instructions).not.toMatch(/## (?:Coordination|Knowledge graph|Workspace context)/);
  });

  it("requires batched workspace discovery and recommends edits only for writable profiles", () => {
    const tools = {
      preview: false,
      workspace: true,
      workspaceWrite: true,
      coordination: true,
      threadContext: true,
      projectMemory: false,
      knowledgeGraph: true,
    };
    const instructions = buildCodexDeveloperInstructions(
      "default",
      { model: "gpt-5.6", reasoningEffort: "high" },
      tools,
    );

    expect(instructions).toContain("workspace_context");
    expect(instructions).toContain(
      "Searches or reads spanning multiple regular UTF-8 files MUST use batched `workspace_context` calls, using the fewest calls its limits allow; do not use shell text readers/searchers.",
    );
    expect(instructions).toContain("workspace_edit");
    expect(instructions).toMatch(/batch/i);
    expect(instructions).toMatch(/formatters.*generators.*binaries.*large files.*permission/i);

    const plan = buildCodexDeveloperInstructions(
      "plan",
      { model: "gpt-5.6", reasoningEffort: "high" },
      tools,
    );
    expect(plan).toContain("workspace_context");
    expect(plan).toContain(
      "Searches or reads spanning multiple regular UTF-8 files MUST use batched `workspace_context` calls, using the fewest calls its limits allow; do not use shell text readers/searchers.",
    );
    expect(plan).not.toContain("workspace_edit");
    expect(plan).not.toContain("formatters");
  });

  it("never recommends workspace edits for read-only workspace profiles", () => {
    const instructions = buildCodexDeveloperInstructions(
      "default",
      { model: "gpt-5.6", reasoningEffort: "high" },
      {
        preview: false,
        workspace: true,
        workspaceWrite: false,
        coordination: false,
        threadContext: true,
        projectMemory: false,
        knowledgeGraph: false,
      },
    );

    expect(instructions).toContain("workspace_context");
    expect(instructions).not.toContain("workspace_edit");
  });

  it("keeps unique preview and project-memory safety policy when those tools exist", () => {
    const instructions = buildCodexDeveloperInstructions("default", {
      model: "gpt-5.6",
      reasoningEffort: "high",
    });

    expect(instructions).toContain("preview_status");
    expect(instructions).toContain("project_memory");
    expect(instructions).toContain("verified durable facts");
    expect(instructions).toContain("Never store credentials");
    expect(instructions).not.toMatch(/## (?:Coordination|Knowledge graph|Workspace context)/);
    expect(instructions.indexOf("<collaboration_mode>")).toBeLessThan(
      instructions.indexOf("## Delegation history"),
    );
    expect(instructions.indexOf("## Delegation history")).toBeLessThan(
      instructions.indexOf("<runtime_info>"),
    );
  });
});
