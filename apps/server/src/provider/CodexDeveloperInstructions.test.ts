import { WORKSPACE_CONTEXT_MAX_QUERIES, WORKSPACE_CONTEXT_MAX_READS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  buildCodexDeveloperInstructions as buildModeInstructions,
} from "./CodexDeveloperInstructions.ts";

const buildCodexDeveloperInstructions = (
  mode: Parameters<typeof buildModeInstructions>[0],
  runtime: Parameters<typeof buildCodexAdditionalContext>[0],
  tools?: Parameters<typeof buildCodexAdditionalContext>[1],
) =>
  [
    buildModeInstructions(mode),
    ...Object.values(buildCodexAdditionalContext(runtime, tools, mode)).map((entry) => entry.value),
  ].join("\n\n");

const preChangeDefaultFixture = {
  characters: 2_606,
  estimatedTokens: Math.ceil(2_606 / 4),
};
const estimatedTokens = (value: string) => Math.ceil(value.length / 4);
const workspaceBatchGuidance = `Batch at most ${WORKSPACE_CONTEXT_MAX_QUERIES} queries or ${WORKSPACE_CONTEXT_MAX_READS} reads per call; split larger sets and use \`workspace_context\` only for mixed batches.`;

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

    const forkPolicy = instructions.replace(
      /<pull_request_linking>[\s\S]*?<\/pull_request_linking>/u,
      "",
    );
    expect(forkPolicy.length).toBeLessThanOrEqual(
      Math.floor(preChangeDefaultFixture.characters * 0.7),
    );
    expect(estimatedTokens(forkPolicy)).toBeLessThanOrEqual(
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
    expect(instructions).not.toContain("workspace_find");
    expect(instructions).not.toContain("workspace_read");
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

    expect(instructions).toContain("workspace_find");
    expect(instructions).toContain("workspace_read");
    expect(instructions).toContain("workspace_context");
    expect(instructions).toContain(workspaceBatchGuidance);
    expect(instructions).toContain("workspace_edit");
    expect(instructions).toMatch(/new files.*write mode.*create.*exact replacements/i);
    expect(instructions).toMatch(/large edits.*formatters.*generators.*binaries/i);

    const plan = buildCodexDeveloperInstructions(
      "plan",
      { model: "gpt-5.6", reasoningEffort: "high" },
      tools,
    );
    expect(plan).toContain("workspace_find");
    expect(plan).toContain("workspace_read");
    expect(plan).toContain("workspace_context");
    expect(plan).toContain(workspaceBatchGuidance);
    expect(plan).not.toContain("workspace_edit");
    expect(plan).not.toContain("Prefer `workspace_edit`");
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

    expect(instructions).toContain("workspace_find");
    expect(instructions).toContain("workspace_read");
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
    const context = buildCodexAdditionalContext({ model: "gpt-5.6", reasoningEffort: "high" });
    expect(context.t3_code_delegation?.value).toContain("## Delegation history");
    expect(context.t3_code_runtime?.value).toContain("<runtime_info>");
    expect(buildModeInstructions("default")).not.toContain("## Delegation history");
  });
});

describe("Codex application context", () => {
  it("preserves device guidance separately from collaboration-mode text", () => {
    const context = buildCodexAdditionalContext(
      { model: "gpt-5.6", reasoningEffort: "high" },
      { browser: false, device: true },
    );
    expect(context.t3_code_tools?.value).toContain("device_open");
    expect(context.t3_code_tools?.value).not.toContain("preview_status");
    expect(buildModeInstructions("default")).not.toMatch(
      /device_open|workspace_find|fork_turns|runtime_info/,
    );
  });
});
