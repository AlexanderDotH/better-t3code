import type { MobileProposedPlan } from "./plan-parallelism-review";
import { describe, expect, it } from "vite-plus/test";
import {
  buildPlanParallelismReviewCacheKey,
  createPlanParallelismReviewRequest,
} from "@t3tools/client-runtime/plan-implementation";
import {
  DeepPlanRunId,
  EnvironmentId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type ServerProvider,
} from "@t3tools/contracts";

import { resolveMobilePlanParallelismReviewDescriptor } from "./plan-parallelism-review";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  availability: "available",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-13T10:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 4 },
};
const plan: MobileProposedPlan = {
  id: PlanId.make("plan-1"),
  turnId: null,
  planMarkdown: "# Plan",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};
const threadId = ThreadId.make("thread-1");
const input = {
  enabled: true,
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  plan,
  implementationProvider: provider,
  reviewerSelection: { instanceId: provider.instanceId, model: "gpt-5.6-sol" },
  providers: [provider],
};
const deepPlanDocument: NonNullable<DeepPlanRun["plan"]> = {
  schemaVersion: 1,
  version: 2,
  goal: "Ship Deep Plans",
  scope: ["Mobile"],
  affectedAreas: ["Composer"],
  decisions: [],
  steps: [
    {
      id: "step",
      title: "Step",
      description: "Do the work",
      dependencies: [],
      acceptanceCriteria: [{ id: "done", description: "Done", checkMethod: "Run tests" }],
    },
  ],
  finalValidation: { description: "Validate", checkMethod: "Run tests" },
};
const deepPlanRun: DeepPlanRun = {
  id: DeepPlanRunId.make("deep-run"),
  threadId,
  phase: "awaitingApproval",
  revision: 4,
  plan: deepPlanDocument,
  approval: null,
  approvalKey: "approval-key",
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
  createdAt: plan.updatedAt,
  updatedAt: "2026-08-13T11:30:00.000Z",
  pauseReason: null,
};

function deepPlanDescriptor(planVersion: number) {
  const descriptor = resolveMobilePlanParallelismReviewDescriptor({
    ...input,
    plan: { ...plan, deepPlan: { runId: deepPlanRun.id, planVersion } },
    deepPlanRun: { ...deepPlanRun, plan: { ...deepPlanDocument, version: planVersion } },
  });
  if (!descriptor) throw new Error("Expected a reviewable Deep Plan");
  return descriptor;
}

describe("mobile plan parallelism review", () => {
  it("uses a ready reviewer", () => {
    expect(resolveMobilePlanParallelismReviewDescriptor(input)).not.toBeNull();
  });

  it("asks the server about the Deep Plan run instead of the turn item", () => {
    expect(createPlanParallelismReviewRequest(deepPlanDescriptor(2))).toEqual({
      threadId,
      planId: plan.id,
      deepPlan: { runId: deepPlanRun.id, planVersion: 2 },
      expectedPlanUpdatedAt: deepPlanRun.updatedAt,
      implementationProviderInstanceId: provider.instanceId,
    });
  });

  it("does not reuse a cached review across Deep Plan versions", () => {
    expect(buildPlanParallelismReviewCacheKey(deepPlanDescriptor(2))).not.toBe(
      buildPlanParallelismReviewCacheKey(deepPlanDescriptor(3)),
    );
  });

  it.each<[string, DeepPlanRun | null]>([
    ["is not loaded", null],
    ["moved to another version", { ...deepPlanRun, plan: { ...deepPlanDocument, version: 3 } }],
    ["is no longer awaiting approval", { ...deepPlanRun, phase: "paused" }],
  ])("skips the review when the Deep Plan run %s", (_label, run) => {
    expect(
      resolveMobilePlanParallelismReviewDescriptor({
        ...input,
        plan: { ...plan, deepPlan: { runId: deepPlanRun.id, planVersion: 2 } },
        deepPlanRun: run,
      }),
    ).toBeNull();
  });

  it("falls back when the reviewer is unavailable", () => {
    expect(
      resolveMobilePlanParallelismReviewDescriptor({
        ...input,
        providers: [
          {
            ...provider,
            enabled: false,
            installed: false,
            status: "disabled",
            availability: "unavailable",
          },
        ],
      }),
    ).toBeNull();
  });
});
