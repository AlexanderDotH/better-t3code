import { describe, expect, it } from "vite-plus/test";

import { buildCodexAdditionalContext } from "./CodexDeveloperInstructions.ts";
import { buildDeepPlanInstructions } from "./DeepPlanInstructions.ts";
import { DEEP_PLAN_PROVIDER_SUPPORT, providerDeepPlanSupport } from "./DeepPlanSupport.ts";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";
import { buildOpenAiSystemInstructions } from "./openai/OpenAiAdapterSystemPrompt.ts";
import { buildOpenRouterSystemInstructions } from "./openrouter/OpenRouterAdapter.ts";

describe("Deep Plan provider instructions", () => {
  it("requires a separate reviewer after implementation submits its changes", () => {
    const text = buildDeepPlanInstructions({ phase: "execution" });
    expect(text).toContain("deep_plan_submit");
    expect(text).not.toContain("do not request an independent reviewer");
    expect(text).not.toContain("deep_plan_step_update");
  });

  it("explicitly ends obsolete Deep Plan requirements for an unbound turn", () => {
    const text = buildDeepPlanInstructions(undefined);
    expect(text).toContain("Deep Plan is inactive for this turn");
    expect(text).toContain("Previous Deep Plan requirements have expired");
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

  it("requires planners to explore, read selected chats and resolve decisions before proposing", () => {
    const text = buildDeepPlanInstructions({ phase: "planning" });
    expect(text).toContain("deep_plan_explore");
    expect(text).toContain("t3_thread_read");
    expect(text).toContain("historical evidence");
    expect(text).toContain("ask the user to resolve any material conflict or open decision");
    expect(text).toContain("checkMethod");
    expect(text).toContain("Wait for the user to approve");
    expect(text.indexOf("deep_plan_explore")).toBeLessThan(text.indexOf("t3_thread_read"));
  });

  it("gives reviewers an independent context and requires scoped findings and a verdict", () => {
    const text = buildDeepPlanInstructions({ phase: "review", readOnly: true });
    expect(text).toContain("Start with deep_plan_review_context");
    expect(text).toContain("check every criterion yourself");
    expect(text).toContain("Search for reusable helpers and services");
    expect(text).toContain("Cite the violated rule");
    expect(text).toContain("Keep workspace files unchanged");
    expect(text).toContain("deep_plan_review_verdict");
    expect(text).not.toContain("deep_plan_submit");
    expect(text).toContain("Run the relevant checks");
    const readOnlyReview = buildRuntimeInstructions({
      harness: "Cursor",
      interactionMode: "plan",
      deepPlan: { phase: "review", readOnly: true },
    });
    expect(readOnlyReview).toContain("commands and checks are unavailable");
    expect(readOnlyReview).toContain("check results reported in the submission");
    expect(readOnlyReview).not.toContain("Run the relevant checks");
  });

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
    expect(
      Object.entries(context)
        .filter(([key]) => key.startsWith("t3_code_deep_plan"))
        .map(([, entry]) => entry.value)
        .join(""),
    ).toContain("deep_plan_publish");
    expect(context.t3_code_deep_plan?.kind).toBe("application");
    expect(
      buildRuntimeInstructions({ harness: "Claude", deepPlan: { phase: "execution" } }),
    ).toContain("deep_plan_submit");
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
    "honors read-only review bindings in native instructions",
    (build) => {
      const text = build({
        cwd: "/workspace",
        sandboxMode: "danger-full-access",
        interactionMode: "default",
        fetchWorker: false,
        deepPlan: { phase: "review", readOnly: true },
      });
      expect(text).toContain(
        "Read-only: inspect the workspace but do not modify files or run mutating commands",
      );
      expect(text).toContain("independent Deep Plan reviewer");
      expect(text).toContain("run the relevant checks with the available tools");
      expect(text).not.toContain("decision-complete plan");
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
