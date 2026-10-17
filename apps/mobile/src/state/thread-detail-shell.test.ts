import { selectDurableDeepPlan } from "@t3tools/client-runtime/deep-planning";
import {
  DeepPlanRunId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadDetailToShell } from "./thread-detail-shell";

const environmentId = EnvironmentId.make("environment-local");
const threadId = ThreadId.make("deep-planning-thread");
const now = "2026-10-16T12:00:00.000Z";
const run: DeepPlanRun = {
  id: DeepPlanRunId.make("durable-run"),
  threadId,
  phase: "collecting",
  revision: 2,
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
  createdAt: now,
  updatedAt: now,
  pauseReason: null,
};
const thread: OrchestrationThread = {
  id: threadId,
  projectId: ProjectId.make("project-1"),
  title: "Deep planning",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
  runtimeMode: "full-access",
  interactionMode: "plan",
  deepPlan: run,
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  subagents: [],
  checkpoints: [],
  session: null,
};

describe("mobile detail recovery", () => {
  it("recovers the durable Deep Plan from detail before a shell is available", () => {
    const recovered = threadDetailToShell(environmentId, thread);
    expect(selectDurableDeepPlan(recovered)).toEqual(run);
  });

  it.each([null, undefined])(
    "clears the recovered run when the latest snapshot has deepPlan=%s",
    (deepPlan) => {
      const recovered = threadDetailToShell(environmentId, { ...thread, deepPlan });
      expect(selectDurableDeepPlan(recovered)).toBeNull();
      expect(recovered.deepPlan).toBeNull();
    },
  );
});
