import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ComposerMode, composerModeToProviderInteractionMode } from "./composerMode.ts";
import {
  DeepPlanApproveMutation,
  DeepPlanDocument,
  DeepPlanRun,
  ThreadDeepPlanUpdateCommand,
} from "./deepPlanning.ts";
import { ExecutionEnvironmentCapabilities } from "./environment.ts";
import { OrchestrationProposedPlan, OrchestrationThread } from "./legacyOrchestration.ts";
import { OrchestrationV2Command } from "./orchestrationV2.ts";
import { ProviderInteractionMode } from "./providerPolicy.ts";

const decodePlan = Schema.decodeUnknownSync(DeepPlanDocument);
const decodeRun = Schema.decodeUnknownSync(DeepPlanRun);
const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
const decodeMode = Schema.decodeUnknownSync(ComposerMode);
const decodeProviderMode = Schema.decodeUnknownSync(ProviderInteractionMode);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeProposedPlan = Schema.decodeSync(OrchestrationProposedPlan);
const decodeApproval = Schema.decodeUnknownSync(DeepPlanApproveMutation);
const decodeInternalUpdate = Schema.decodeUnknownSync(ThreadDeepPlanUpdateCommand);
const decodeClientCommand = Schema.decodeUnknownSync(OrchestrationV2Command);
const now = "2026-10-16T10:00:00.000Z";
const implementation = { instanceId: "codex", model: "gpt-5.4" };

const step = {
  id: "step-1",
  title: "Update the settings form",
  description: "Show the saved review model",
  dependencies: [],
  acceptanceCriteria: [
    {
      id: "criterion-1",
      description: "The selection survives reload",
      checkMethod: "Reload the settings page",
    },
  ],
};
const plan = {
  schemaVersion: 2,
  version: 1,
  goal: "Configure the reviewer",
  scope: ["Settings"],
  nonGoals: ["Changing the default implementation model"],
  decisions: [{ id: "decision-1", text: "Save the agent model selection" }],
  affectedAreas: ["settings"],
  steps: [step],
  finalValidation: { description: "Check the settings workflow", checkMethod: "Run focused tests" },
};
const stepState = {
  stepId: "step-1",
  status: "pending",
  laneId: null,
  baseTurnCount: null,
  submission: null,
  reviews: [],
  roundLimit: 3,
  unsubmittedTurns: 0,
};
const finalReview = {
  status: "pending",
  submission: null,
  reviews: [],
  roundLimit: 3,
  unsubmittedTurns: 0,
};
const approval = {
  planVersion: 1,
  approvalKey: "approval-key",
  approvedAt: now,
  implementation,
  reviewer: implementation,
  parallelism: 1,
  lanes: [{ laneId: "lane-1", threadId: "implementation-thread" }],
  baseTurnCount: 0,
};
const run = {
  schemaVersion: 2,
  id: "run-1",
  threadId: "thread-1",
  phase: "implementing",
  revision: 2,
  plan,
  approval,
  approvalKey: "approval-key",
  chats: [],
  includeProjectChats: false,
  steps: [stepState],
  finalReview,
  activeTurns: [],
  operations: [],
  createdAt: now,
  updatedAt: now,
  pause: null,
};
const approvedReview = {
  round: 1,
  reviewThreadId: "review-thread",
  reviewer: implementation,
  diff: null,
  verdict: "approved",
  summary: "The setting persists after reload",
  findings: [],
  retries: 0,
  startedAt: now,
  completedAt: now,
};
const verifiedStep = {
  ...stepState,
  status: "verified",
  laneId: "lane-1",
  reviews: [approvedReview],
};
const approveMutation = {
  type: "approve",
  planVersion: 1,
  approvalKey: "approval-key",
  implementation,
  implementationThread: "new",
  parallelism: 2,
};
const updateCommand = {
  type: "thread.deep-plan.update",
  commandId: "command-1",
  threadId: "thread-1",
  runId: "run-1",
  expectedRevision: 1,
  operationId: "operation-1",
  createdAt: now,
};

describe("Deep Planning compatibility", () => {
  it("keeps Deep Planning separate from provider interaction modes", () => {
    expect(decodeMode("deep-plan")).toBe("deep-plan");
    expect(composerModeToProviderInteractionMode("deep-plan")).toBe("plan");
    expect(() => decodeProviderMode("deep-plan")).toThrow();
    expect(decodeMode("chat")).toBe("chat");
    expect(composerModeToProviderInteractionMode("chat")).toBe("chat");
    expect(decodeProviderMode("chat")).toBe("chat");
  });

  it("accepts the live-review capability and treats other versions as unsupported", () => {
    expect(decodeCapabilities({}).deepPlanning).toBeUndefined();
    expect(
      decodeCapabilities({ deepPlanning: { version: 1, sourceExport: true, sourceImport: true } })
        .deepPlanning,
    ).toBeUndefined();
    expect(decodeCapabilities({ deepPlanning: { version: 2 } }).deepPlanning).toEqual({
      version: 2,
    });
    expect(decodeCapabilities({ deepPlanning: { version: 3 } }).deepPlanning).toBeUndefined();
  });

  it("normalizes a legacy Deep Plan in the V1 thread snapshot", () => {
    const { nonGoals: _nonGoals, ...legacyPlan } = plan;
    const thread = decodeThread({
      id: "thread-1",
      projectId: "project-1",
      title: "Existing chat",
      modelSelection: implementation,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      messages: [],
      activities: [],
      checkpoints: [],
      session: null,
      deepPlan: {
        id: "run-1",
        threadId: "thread-1",
        phase: "implementing",
        revision: 2,
        plan: { ...legacyPlan, schemaVersion: 1 },
        approval: {
          planVersion: 1,
          approvalKey: "approval-key",
          approvedAt: now,
          approvedBy: "user",
          implementation,
          implementationThreadId: "implementation-thread",
          implementerId: "implementation-thread",
        },
        approvalKey: "approval-key",
        sources: [],
        sourceCoverage: [],
        stepStates: [{ stepId: "step-1", status: "implemented", evidence: [], updatedAt: now }],
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
      },
    });
    expect(thread.interactionMode).toBe("default");
    expect(thread.deepPlan).toEqual({
      schemaVersion: 1,
      kind: "legacy",
      id: "run-1",
      threadId: "thread-1",
      goal: "Configure the reviewer",
      finished: false,
      updatedAt: now,
    });
    const finished = decodeThread({
      ...thread,
      deepPlan: {
        id: "run-2",
        threadId: "thread-1",
        updatedAt: now,
        plan: null,
        stepStates: [],
        finalValidation: { status: "passed" },
      },
    });
    expect(finished.deepPlan).toMatchObject({ kind: "legacy", finished: true });
  });

  it("preserves versioned Deep Plan metadata on existing plan and turn schemas", () => {
    const proposedPlan = decodeProposedPlan({
      id: "plan-1",
      turnId: null,
      planMarkdown: "Configure the reviewer",
      deepPlan: { runId: "run-1", planVersion: 2 },
      createdAt: now,
      updatedAt: now,
    });
    const turn = decodeClientCommand({
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: "command-1",
      threadId: "thread-2",
      messageId: "message-1",
      text: "Implement",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      sourcePlanRef: {
        threadId: "thread-1",
        planId: proposedPlan.id,
        deepPlan: proposedPlan.deepPlan,
      },
      createdAt: now,
    });
    expect(turn.type === "message.dispatch" ? turn.sourcePlanRef?.deepPlan : undefined).toEqual({
      runId: "run-1",
      planVersion: 2,
    });
  });
});

describe("Deep Plan documents", () => {
  it("requires unique stable step and acceptance criterion IDs", () => {
    expect(decodePlan(plan).nonGoals).toEqual(["Changing the default implementation model"]);
    expect(() => decodePlan({ ...plan, steps: [step, step] })).toThrow();
    expect(() =>
      decodePlan({
        ...plan,
        steps: [step, { ...step, id: "step-2", dependencies: ["step-1"] }],
      }),
    ).toThrow();
  });

  it("rejects missing and cyclic dependencies", () => {
    expect(() =>
      decodePlan({ ...plan, steps: [{ ...step, dependencies: ["unknown-step"] }] }),
    ).toThrow();
    expect(() => decodePlan({ ...plan, steps: [{ ...step, dependencies: [step.id] }] })).toThrow();
  });

  it("requires per-step checks and a final validation requirement", () => {
    expect(() => decodePlan({ ...plan, steps: [{ ...step, acceptanceCriteria: [] }] })).toThrow();
    expect(() => decodePlan({ ...plan, finalValidation: { description: "Check" } })).toThrow();
  });
});

describe("Deep Plan completion", () => {
  it("requires the latest review to approve from a thread outside the implementation lane", () => {
    expect(decodeRun({ ...run, steps: [verifiedStep] }).steps[0]?.status).toBe("verified");
    for (const reviews of [
      [],
      [{ ...approvedReview, reviewThreadId: "implementation-thread" }],
      [approvedReview, { ...approvedReview, round: 2, verdict: "changesRequested" }],
    ]) {
      expect(() => decodeRun({ ...run, steps: [{ ...verifiedStep, reviews }] })).toThrow();
    }
  });

  it("requires verified steps and a final approval outside the implementation lanes", () => {
    const completed = {
      ...run,
      phase: "completed",
      steps: [verifiedStep],
      finalReview: {
        ...finalReview,
        status: "approved",
        reviews: [{ ...approvedReview, reviewThreadId: "final-review-thread" }],
      },
    };
    expect(decodeRun(completed).phase).toBe("completed");
    expect(() => decodeRun({ ...completed, steps: [stepState] })).toThrow();
    expect(() => decodeRun({ ...completed, finalReview })).toThrow();
    expect(() =>
      decodeRun({
        ...completed,
        finalReview: {
          ...completed.finalReview,
          reviews: [
            ...completed.finalReview.reviews,
            { ...approvedReview, round: 2, verdict: "changesRequested" },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      decodeRun({
        ...completed,
        finalReview: {
          ...completed.finalReview,
          reviews: [{ ...approvedReview, reviewThreadId: "implementation-thread" }],
        },
      }),
    ).toThrow();
    expect(() => decodeRun({ ...completed, approval: { ...approval, planVersion: 2 } })).toThrow();
    expect(() => decodeRun({ ...completed, steps: [verifiedStep, verifiedStep] })).toThrow();
  });

  it("caps the number of retained operations", () => {
    const operations = Array.from({ length: 51 }, (_, revision) => ({
      operationId: "operation-" + revision,
      fingerprint: "fingerprint-" + revision,
      revision,
    }));
    expect(decodeRun({ ...run, operations: operations.slice(1) }).operations).toHaveLength(50);
    expect(() => decodeRun({ ...run, operations })).toThrow();
  });

  it("requires approval parallelism from one to four lanes", () => {
    expect(decodeApproval(approveMutation).parallelism).toBe(2);
    expect(() => decodeApproval({ ...approveMutation, parallelism: 0 })).toThrow();
    expect(() => decodeApproval({ ...approveMutation, parallelism: 5 })).toThrow();
    expect(() => decodeRun({ ...run, approval: { ...approval, parallelism: 2 } })).toThrow();
  });

  it("keeps planning and execution mutations behind the authenticated agent boundary", () => {
    const target = { kind: "step", stepId: "step-1" };
    const { schemaVersion: _schemaVersion, version: _version, ...draft } = plan;
    const mutations = [
      { type: "publish-plan", plan: draft },
      { type: "submit", target, summary: "Changed settings", changedFiles: ["settings.ts"] },
      { type: "block", reason: "The check environment is unavailable" },
      {
        type: "review-verdict",
        target,
        round: 1,
        verdict: "approved",
        summary: "Check passed",
        findings: [],
      },
    ];
    for (const mutation of mutations) {
      const command = { ...updateCommand, byThreadId: "worker-thread", mutation };
      expect(decodeInternalUpdate(command)).toMatchObject({
        byThreadId: "worker-thread",
        mutation,
      });
      expect(() => decodeInternalUpdate({ ...command, byThreadId: undefined })).toThrow();
      expect(() => decodeClientCommand(command)).toThrow();
    }
    expect(() =>
      decodeClientCommand({
        ...updateCommand,
        type: "thread.deep-plan.advance",
        transition: { type: "settle-turn", turnCommandId: "turn-command" },
      }),
    ).toThrow();
  });

  it("allows clients to control a Deep Plan without setting server-only fields", () => {
    for (const mutation of [
      approveMutation,
      { type: "pause" },
      { type: "resume" },
      { type: "cancel" },
    ]) {
      expect(
        decodeClientCommand({
          ...updateCommand,
          mutation,
          byThreadId: "other-thread",
          defaultReviewer: implementation,
        }),
      ).toEqual({
        ...updateCommand,
        mutation,
      });
    }
    expect(
      decodeInternalUpdate({
        ...updateCommand,
        mutation: approveMutation,
        defaultReviewer: implementation,
      }),
    ).toMatchObject({ defaultReviewer: implementation });
  });

  it("accepts up to twenty explicit chat references when starting a run", () => {
    const chats = Array.from({ length: 21 }, (_, index) => ({
      environmentId: "environment-1",
      projectId: "project-1",
      threadId: "source-thread-" + index,
    }));
    const start = {
      type: "thread.deep-plan.start",
      commandId: "start-command",
      threadId: "thread-1",
      chats: chats.slice(1),
      includeProjectChats: false,
      createdAt: now,
    };
    expect(decodeClientCommand(start)).toEqual(start);
    expect(() => decodeClientCommand({ ...start, chats })).toThrow();
  });
});
