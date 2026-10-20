import {
  DeepPlanRunId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deepPlanProviderContext } from "./DeepPlanProviderContext.ts";
import { canContinueDeepPlan } from "./DeepPlanContinuation.ts";

const owner = ThreadId.make("deep-owner");
const implementer = ThreadId.make("deep-implementer");
const selectedModel: ModelSelection = {
  instanceId: ProviderInstanceId.make("selected-provider"),
  model: "selected-model",
};
const approvedModel: ModelSelection = {
  instanceId: ProviderInstanceId.make("approved-provider"),
  model: "approved-model",
};
const createdAt = "2026-10-16T08:00:00.000Z";
const planningRun: DeepPlanRun = {
  id: DeepPlanRunId.make("deep-run"),
  threadId: owner,
  phase: "planning",
  revision: 1,
  plan: null,
  approval: null,
  approvalKey: null,
  sources: [],
  sourceCoverage: [],
  stepStates: [],
  finalValidation: {
    status: "pending",
    evidence: [],
    updatedAt: null,
    attempt: 0,
    requestId: null,
    turnId: null,
  },
  procedureAdjustments: [],
  operations: [],
  createdAt,
  updatedAt: createdAt,
  pauseReason: null,
};
const approvedRun: DeepPlanRun = {
  ...planningRun,
  phase: "implementing",
  plan: {
    schemaVersion: 1,
    version: 1,
    goal: "Preserve the selected mode",
    scope: ["Provider permission handling"],
    decisions: [],
    affectedAreas: ["Provider"],
    steps: [
      {
        id: "preserve-mode",
        title: "Preserve the selected mode",
        description: "Honor explicit read-only turns during approved implementation.",
        dependencies: [],
        acceptanceCriteria: [
          {
            id: "plan-is-readonly",
            description: "An explicit Plan turn stays read-only.",
            checkMethod: "Inspect the bound provider context.",
          },
        ],
      },
    ],
    finalValidation: {
      description: "Check permission transitions",
      checkMethod: "Run the provider regression tests",
    },
  },
  approvalKey: "approved-plan",
  approval: {
    planVersion: 1,
    approvalKey: "approved-plan",
    approvedAt: createdAt,
    approvedBy: "user",
    implementation: approvedModel,
    implementationThreadId: implementer,
    implementerId: "approved-agent",
  },
};

describe("deepPlanProviderContext", () => {
  it.each(["collecting", "planning", "awaitingApproval"] as const)(
    "only binds %s to a planning turn and never overrides Build",
    (phase) => {
      expect(
        deepPlanProviderContext({ ...planningRun, phase }, owner, selectedModel, "default"),
      ).toBeUndefined();
      expect(
        deepPlanProviderContext({ ...planningRun, phase }, owner, selectedModel),
      ).toBeUndefined();
      expect(
        deepPlanProviderContext({ ...planningRun, phase }, owner, selectedModel, "plan"),
      ).toMatchObject({
        phase: "planning",
        readOnly: true,
        modelSelection: selectedModel,
        approvedPlanVersion: null,
      });
    },
  );

  it.each(["collecting", "planning"] as const)(
    "does not automatically continue an unapproved %s run outside Plan mode",
    (phase) => {
      expect(canContinueDeepPlan({ ...planningRun, phase }, "default")).toBe(false);
      expect(canContinueDeepPlan({ ...planningRun, phase }, "plan")).toBe(true);
      expect(canContinueDeepPlan(approvedRun, "default")).toBe(true);
    },
  );

  it("preserves explicit Plan mode while keeping the approved implementing model", () => {
    expect(deepPlanProviderContext(approvedRun, implementer, selectedModel, "plan")).toMatchObject({
      phase: "execution",
      readOnly: true,
      runThreadId: owner,
      approvedPlanVersion: 1,
      modelSelection: approvedModel,
    });
  });

  it("allows the approved implementation to resume normally in Build mode", () => {
    expect(
      deepPlanProviderContext(approvedRun, implementer, selectedModel, "default"),
    ).toMatchObject({
      phase: "execution",
      readOnly: false,
      modelSelection: approvedModel,
    });
  });

  it("keeps final validation bound to the implementing model and honors a Plan turn", () => {
    const run: DeepPlanRun = { ...approvedRun, phase: "validating" };
    expect(deepPlanProviderContext(run, implementer, selectedModel, "default")).toMatchObject({
      phase: "validation",
      readOnly: false,
      modelSelection: approvedModel,
    });
    expect(deepPlanProviderContext(run, implementer, selectedModel, "plan")).toMatchObject({
      phase: "validation",
      readOnly: true,
      modelSelection: approvedModel,
    });
  });

  it("does not bind absent runs, unrelated threads or an obsolete approval", () => {
    expect(deepPlanProviderContext(null, owner, selectedModel)).toBeUndefined();
    expect(deepPlanProviderContext(planningRun, implementer, selectedModel)).toBeUndefined();
    expect(deepPlanProviderContext(approvedRun, owner, selectedModel)).toBeUndefined();
    const run: DeepPlanRun = {
      ...approvedRun,
      approval: { ...approvedRun.approval!, planVersion: 2 },
    };
    expect(deepPlanProviderContext(run, implementer, selectedModel)).toBeUndefined();
  });

  it.each(["paused", "blocked", "completed", "failed"] as const)(
    "does not force a provider context for a %s run",
    (phase) => {
      expect(
        deepPlanProviderContext({ ...approvedRun, phase }, implementer, selectedModel, "plan"),
      ).toBeUndefined();
    },
  );
});
