import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  FETCH_CONTEXT_MAX_CHARS,
  FETCH_WORKER_FINDINGS_MAX_CHARS,
  buildFetchContext,
  buildFetchWorkerPrompt,
  fetchApprovalAction,
  type FetchWorkerOutcome,
} from "./FetchWorkerCoordinator.ts";

const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-5.6-luna",
  options: [
    { id: "reasoningEffort", value: "low" },
    { id: "serviceTier", value: "priority" },
  ],
};

const providerDriver = ProviderDriverKind.make("codex");

function outcome(index: number, input: Partial<FetchWorkerOutcome> = {}): FetchWorkerOutcome {
  return {
    index,
    scope: `Inspect area ${index}`,
    status: "completed",
    findings: `Finding ${index}`,
    ...input,
  };
}

describe("FetchWorkerCoordinator helpers", () => {
  it("gives a worker only its read-only repository discovery assignment", () => {
    const prompt = buildFetchWorkerPrompt({
      userRequest: "Change authentication and update its tests",
      scope: "Map the authentication boundary",
      questions: ["Where is session validation?", "Which focused tests cover it?"],
    });

    expect(prompt).toContain("Change authentication and update its tests");
    expect(prompt).toContain("Map the authentication boundary");
    expect(prompt).toContain("Where is session validation?");
    expect(prompt).toContain("exact paths");
    expect(prompt).toContain("Do not edit files");
    expect(prompt).toContain("workspace_context");
    expect(prompt).toContain("Do not execute shell or terminal commands");
    expect(prompt).toContain("Do not start or delegate to nested agents");
  });

  it("accepts file reads while declining every shell command", () => {
    expect(fetchApprovalAction("file_read_approval")).toBe("accept");
    expect(fetchApprovalAction("command_execution_approval")).toBe("decline");
    expect(fetchApprovalAction("exec_command_approval")).toBe("decline");
    expect(fetchApprovalAction("apply_patch_approval")).toBe("decline");
    expect(fetchApprovalAction("tool_user_input")).toBe("fail-worker");
  });

  it("builds a fair bounded context with provider traits and explicit truncation markers", () => {
    const oversized = "x".repeat(FETCH_WORKER_FINDINGS_MAX_CHARS);
    const context = buildFetchContext({
      plannedWorkers: 3,
      modelSelection,
      providerDriver,
      outcomes: [
        outcome(0, { findings: oversized }),
        outcome(1, { findings: oversized }),
        outcome(2, { status: "timed-out", findings: "", detail: "five-minute timeout" }),
      ],
    });

    expect(context).toBeDefined();
    expect(context!.length).toBeLessThanOrEqual(FETCH_CONTEXT_MAX_CHARS);
    expect(context).toContain("T3 FETCH CONTEXT");
    expect(context).toContain("codex-work / gpt-5.6-luna");
    expect(context).toContain("reasoningEffort=low");
    expect(context).toContain("Inspect area 0");
    expect(context).toContain("Inspect area 1");
    expect(context).toContain("timed-out");
    expect(context).toContain("truncated fairly");

    const firstLength = context!
      .split("## Worker 1:")[1]!
      .split("## Worker 2:")[0]!
      .split("")
      .filter((value) => value === "x").length;
    const secondLength = context!
      .split("## Worker 2:")[1]!
      .split("## Worker 3:")[0]!
      .split("")
      .filter((value) => value === "x").length;
    expect(Math.abs(firstLength - secondLength)).toBeLessThanOrEqual(1);
  });

  it("preserves fair worker shares when the main request leaves little input space", () => {
    const context = buildFetchContext({
      plannedWorkers: 2,
      modelSelection,
      providerDriver,
      outcomes: [
        outcome(0, { findings: "§".repeat(4_000) }),
        outcome(1, { findings: "¤".repeat(4_000) }),
      ],
      maxChars: 1_200,
    });

    expect(context).toHaveLength(1_200);
    const firstShare = context!.split("").filter((value) => value === "§").length;
    const secondShare = context!.split("").filter((value) => value === "¤").length;
    expect(Math.abs(firstShare - secondShare)).toBeLessThanOrEqual(1);
    expect(context).toContain("truncated fairly");
  });

  it("bounds provider failure details so successful evidence keeps its fair share", () => {
    const context = buildFetchContext({
      plannedWorkers: 2,
      modelSelection,
      providerDriver,
      outcomes: [
        outcome(0, {
          status: "error",
          findings: "",
          detail: "provider-stack-line ".repeat(10_000),
        }),
        outcome(1, { findings: "USEFUL-EVIDENCE ".repeat(500) }),
      ],
      maxChars: 3_000,
    });

    expect(context).toHaveLength(3_000);
    expect(context).toContain("failure detail truncated");
    expect(context).toContain("USEFUL-EVIDENCE");
    expect(context).toContain("truncated fairly");
  });

  it("omits Fetch context when no worker produced findings", () => {
    expect(
      buildFetchContext({
        plannedWorkers: 2,
        modelSelection,
        providerDriver,
        outcomes: [
          outcome(0, { status: "error", findings: "", detail: "provider error" }),
          outcome(1, { status: "interrupted", findings: "", detail: "cancelled" }),
        ],
      }),
    ).toBeUndefined();
  });
});
