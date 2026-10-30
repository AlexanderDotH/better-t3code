import { describe, expect, it } from "vite-plus/test";

import { buildCodexAdditionalContext } from "./CodexDeveloperInstructions.ts";
import { buildDeepPlanInstructions } from "./DeepPlanInstructions.ts";
import { DEEP_PLAN_PROVIDER_SUPPORT, providerDeepPlanSupport } from "./DeepPlanSupport.ts";
import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";
import { buildOpenAiSystemInstructions } from "./openai/OpenAiAdapterSystemPrompt.ts";
import { buildOpenRouterSystemInstructions } from "./openrouter/OpenRouterAdapter.ts";

describe("Deep Plan provider instructions", () => {
  it("explicitly ends obsolete Deep Plan requirements for an unbound turn", () => {
    const text = buildDeepPlanInstructions(undefined);
    expect(text).toContain("Deep Plan is inactive for this turn");
    expect(text).toContain("source-collection errors");
    expect(text).toContain("do not require Deep Plan tools or registration");
    expect(text).not.toContain("Start with deep_plan_state");
    for (const mode of ["default", "plan"] as const) {
      const context = buildCodexAdditionalContext(
        { model: "gpt-6.1-sol", reasoningEffort: "high" },
        false,
        mode,
      );
      expect(context.t3_code_deep_plan?.value).toBe(text);
    }
    expect(buildRuntimeInstructions({ harness: "Cursor", deepPlan: null })).toContain(text);
    for (const build of [buildOpenAiSystemInstructions, buildOpenRouterSystemInstructions]) {
      expect(
        build({
          cwd: "/workspace",
          sandboxMode: "read-only",
          interactionMode: "plan",
          fetchWorker: false,
        }),
      ).toContain(text);
    }
  });

  it("requires bounded parallel analysis and inherits composer permissions", () => {
    const text = buildDeepPlanInstructions({ phase: "planning" });
    expect(text).toContain("deep_plan_analyze_sources");
    expect(text).toContain("Keep calling it until complete");
    expect(text).toContain("Never silently fall back to sequential analysis");
    expect(text).toContain("composer's permission mode governs other tools");
  });

  it("gives source workers a narrow analysis contract instead of plan publication", () => {
    const text = buildDeepPlanInstructions({
      phase: "planning",
      sourceAnalysis: { sourceIds: ["source-a", "source-b"] },
    });
    expect(text).toContain('["source-a","source-b"]');
    expect(text).toContain("read-only");
    expect(text).toContain("Do not edit");
    expect(text).not.toContain("Publish a structured");
    expect(text).not.toContain("deep_plan_analyze_sources");
  });

  it.each(["execution", "validation"] as const)(
    "keeps an explicitly readonly %s turn focused on review",
    (phase) => {
      const text = buildDeepPlanInstructions({ phase, readOnly: true });
      expect(text).toContain("read-only review of the approved plan");
      expect(text).toContain(
        "without implementing steps, editing workspace files, or running mutating commands",
      );
      expect(text).toContain("Deep Plan tools may persist review findings");
      expect(text).toContain("Continue implementation only in a later execution turn");
      expect(text).not.toContain("Implement only the approved plan version");
      expect(text).not.toContain("Validate the complete approved outcome automatically");
    },
  );

  it("requires frozen full-chat coverage, current-task precedence, and explicit user approval", () => {
    const text = buildDeepPlanInstructions({ phase: "planning" });
    expect(text).toContain("read every page");
    expect(text).toContain(
      "requirements, decisions, open issues, rejected approaches, and conflicts",
    );
    expect(text).toContain("The current task wins over history");
    expect(text).toContain(
      "Do not carry resolved, superseded, or unrelated blockers into the current task",
    );
    expect(text).toContain("ask the user about meaningful unresolved conflicts");
    expect(text).toContain("Every step needs an acceptance criterion and a concrete check");
    expect(text).toContain("Wait for the user to approve its exact version");
    expect(text).toContain("Planning is read-only");
    expect(text).toContain("Deep Plan tools may persist");
  });

  it.each(["execution", "validation"] as const)(
    "requires the implementing agent to validate %s",
    (phase) => {
      const text = buildDeepPlanInstructions({ phase });
      expect(text).toContain("automatically");
      expect(text).toContain("same agent and model");
      expect(text).toContain("do not request an independent reviewer");
      expect(text).toContain(
        "Only recorded passing evidence and final validation complete this run",
      );
      expect(text).toContain("deep_plan_adjust_procedure");
    },
  );

  it("retains Codex policy in application context independently of mode catalog text", () => {
    const context = buildCodexAdditionalContext(
      { model: "gpt-5.6", reasoningEffort: "high" },
      {
        preview: false,
        workspace: true,
        workspaceWrite: false,
        coordination: false,
        threadContext: true,
        projectMemory: false,
        knowledgeGraph: false,
        deepPlan: { phase: "planning" },
      },
      "plan",
    );
    expect(context.t3_code_deep_plan?.value).toContain("deep_plan_publish");
    expect(context.t3_code_deep_plan?.kind).toBe("application");
    expect(
      buildRuntimeInstructions({ harness: "Claude", deepPlan: { phase: "execution" } }),
    ).toContain("deep_plan_step_update");
    expect(buildRuntimeInstructions({ harness: "Claude" })).not.toContain("<deep_plan>");
  });

  it.each([buildOpenAiSystemInstructions, buildOpenRouterSystemInstructions])(
    "keeps native provider plan turns read-only while requiring durable plans",
    (build) => {
      const text = build({
        cwd: "/workspace",
        sandboxMode: "read-only",
        interactionMode: "plan",
        fetchWorker: false,
        deepPlan: { phase: "planning" },
      });
      expect(text).toContain("do not modify files or run mutating commands");
      expect(text).toContain("deep_plan_publish");
    },
  );
  it.each([buildOpenAiSystemInstructions, buildOpenRouterSystemInstructions])(
    "honors readonly execution bindings in native instructions",
    (build) => {
      const text = build({
        cwd: "/workspace",
        sandboxMode: "danger-full-access",
        interactionMode: "default",
        fetchWorker: false,
        deepPlan: { phase: "execution", readOnly: true },
      });
      expect(text).toContain(
        "Read-only: inspect the workspace but do not modify files or run mutating commands",
      );
      expect(text).toContain("read-only review of the approved plan");
      expect(text).not.toContain("Prefer workspace_edit");
      expect(text).not.toContain("Implement only the approved plan version");
    },
  );
});

describe("Deep Plan provider support", () => {
  it("requires declared readonly planning and an actual MCP transport", () => {
    expect(
      providerDeepPlanSupport({ sessionModelSwitch: "in-session", mcp: "sessionConfig" }).supported,
    ).toBe(false);
    expect(
      providerDeepPlanSupport({
        sessionModelSwitch: "in-session",
        mcp: "unsupported",
        deepPlan: DEEP_PLAN_PROVIDER_SUPPORT.codex,
      }).supported,
    ).toBe(false);
    expect(
      providerDeepPlanSupport({
        sessionModelSwitch: "in-session",
        mcp: "nativeConfig",
        deepPlan: DEEP_PLAN_PROVIDER_SUPPORT.codex,
      }),
    ).toEqual(DEEP_PLAN_PROVIDER_SUPPORT.codex);
  });

  it("gives unsupported adapters a concrete reason", () => {
    for (const support of [
      DEEP_PLAN_PROVIDER_SUPPORT.opencode,
      DEEP_PLAN_PROVIDER_SUPPORT.grok,
      DEEP_PLAN_PROVIDER_SUPPORT.antigravity,
      DEEP_PLAN_PROVIDER_SUPPORT.gemini,
    ]) {
      expect(support.supported).toBe(false);
      expect(support.reason.length).toBeGreaterThan(20);
    }
  });
});
