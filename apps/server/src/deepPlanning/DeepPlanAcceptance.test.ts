import {
  CommandId,
  DeepPlanDocument,
  DeepPlanRun,
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanEvidence,
  type DeepPlanMutation,
  type DeepPlanSourceCoverage,
  type DeepPlanSourceSnapshot,
  type DeepPlanStepStatus,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  deepPlanApprovalKey,
  hasCompleteDeepPlanSources,
  startDeepPlanRun,
  updateDeepPlanRun,
} from "./deepPlanDecision.ts";

const createdAt = "2026-10-16T08:00:00.000Z";
const threadId = ThreadId.make("acceptance-deep-plan");
const runId = DeepPlanRunId.make("acceptance-run");
const source = {
  sourceId: DeepPlanSourceId.make("acceptance-source"),
  origin: {
    environmentId: EnvironmentId.make("acceptance-environment"),
    projectId: ProjectId.make("acceptance-project"),
    threadId: ThreadId.make("acceptance-source-thread"),
  },
  projectTitle: "Source project",
  threadTitle: "Original requirements",
  archived: true,
  capturedAt: createdAt,
  contentVersion: "source-v1",
  contentHash: "source-hash",
  messageCount: 2,
  activityCount: 0,
  attachmentCount: 0,
  recordCount: 2,
  forkOrigin: null,
} satisfies DeepPlanSourceSnapshot;
const sourceCoverage = {
  sourceId: source.sourceId,
  status: "summarized",
  importedRecordCount: source.recordCount,
  readRecordCount: source.recordCount,
  summary: {
    requirements: ["Preserve saved work"],
    decisions: [],
    openIssues: [],
    rejectedApproaches: [],
    conflicts: [],
    citedRecordIds: ["requirement-1", "requirement-2"],
  },
  error: null,
  updatedAt: createdAt,
} satisfies DeepPlanSourceCoverage;
const plan = {
  schemaVersion: 1,
  version: 1,
  goal: "Preserve saved work across reconnects",
  scope: ["Thread state"],
  decisions: [],
  affectedAreas: ["Thread persistence", "Thread display"],
  steps: [
    {
      id: "persistence",
      title: "Persist the work",
      description: "Save the approved work durably.",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "restore",
          description: "Saved work survives restart",
          checkMethod: "Restore a saved run",
        },
      ],
    },
    {
      id: "display",
      title: "Display the saved work",
      description: "Display the saved state after reconnecting.",
      dependencies: ["persistence"],
      acceptanceCriteria: [
        {
          id: "reconnect",
          description: "Reconnect shows current work",
          checkMethod: "Reconnect the client",
        },
      ],
    },
  ],
  finalValidation: {
    description: "Restore and display the whole approved workflow",
    checkMethod: "Run the focused reconnect acceptance scenario",
  },
} satisfies DeepPlanDocument;
const implementation = {
  instanceId: ProviderInstanceId.make("acceptance-provider"),
  model: "implementation-model",
};
const actor = { implementerId: `thread:${threadId}`, model: implementation };
const evidence = [
  { kind: "test", summary: "Focused acceptance check passed", createdAt },
] satisfies ReadonlyArray<DeepPlanEvidence>;
const startCommand = {
  type: "thread.deep-plan.start",
  commandId: CommandId.make("acceptance-start"),
  threadId,
  runId,
  sources: [source],
  createdAt,
} as const;

function commandFor(
  run: DeepPlanRun,
  mutation: DeepPlanMutation,
  operationId = `${mutation.type}:${run.revision}`,
): ThreadDeepPlanUpdateCommand {
  return {
    type: "thread.deep-plan.update",
    commandId: CommandId.make(`command:${operationId}`),
    threadId: run.threadId,
    runId: run.id,
    expectedRevision: run.revision,
    operationId,
    mutation,
    createdAt,
  };
}

function update(run: DeepPlanRun, mutation: DeepPlanMutation) {
  return updateDeepPlanRun(run, commandFor(run, mutation));
}

function approval(document: DeepPlanDocument = plan) {
  return {
    type: "approve",
    planVersion: document.version,
    approvalKey: deepPlanApprovalKey(document),
    implementation,
    implementationThreadId: threadId,
    implementerId: actor.implementerId,
  } as const;
}

function stepUpdate(
  run: DeepPlanRun,
  stepId: string,
  status: DeepPlanStepStatus,
  stepEvidence: ReadonlyArray<DeepPlanEvidence> = [],
) {
  return update(run, { type: "step-update", stepId, status, evidence: stepEvidence, actor });
}

const publishedRun = Effect.gen(function* () {
  const started = yield* startDeepPlanRun(startCommand);
  const covered = yield* update(started, { type: "source-coverage", coverage: [sourceCoverage] });
  return yield* update(covered, { type: "publish-plan", plan });
});

const approvedRun = Effect.gen(function* () {
  return yield* update(yield* publishedRun, approval());
});

const verifyStep = Effect.fnUntraced(function* (run: DeepPlanRun, stepId: string) {
  const started = yield* stepUpdate(run, stepId, "inProgress");
  const implemented = yield* stepUpdate(started, stepId, "implemented");
  return yield* stepUpdate(implemented, stepId, "verified", evidence);
});

const validationReadyRun = Effect.gen(function* () {
  const firstVerified = yield* verifyStep(yield* approvedRun, "persistence");
  return yield* verifyStep(firstVerified, "display");
});

const encodeRun = Schema.encodeSync(Schema.fromJsonString(DeepPlanRun));
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(DeepPlanRun));
const validationRequestId = (run: DeepPlanRun) =>
  `deep-plan:${run.id}:validation:${run.plan?.version}:${run.finalValidation.attempt}`;

it("requires a check method for each step criterion and final validation", () => {
  const decodePlan = Schema.decodeUnknownSync(DeepPlanDocument);
  expect(() =>
    decodePlan({ ...plan, steps: [{ ...plan.steps[0], acceptanceCriteria: [] }] }),
  ).toThrow();
  expect(() =>
    decodePlan({
      ...plan,
      steps: [
        {
          ...plan.steps[0],
          acceptanceCriteria: [{ id: "missing-check", description: "Check this" }],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    decodePlan({ ...plan, finalValidation: { description: "Check the whole task" } }),
  ).toThrow();
});

it.effect("blocks publication and approval until every frozen source is fully analyzed", () =>
  Effect.gen(function* () {
    const started = yield* startDeepPlanRun(startCommand);
    const incompleteCases: ReadonlyArray<{
      name: string;
      coverage: DeepPlanSourceCoverage | null;
    }> = [
      { name: "missing", coverage: null },
      {
        name: "unavailable",
        coverage: { ...sourceCoverage, status: "unavailable", error: "Disconnected" },
      },
      {
        name: "failed",
        coverage: { ...sourceCoverage, status: "failed", error: "Analysis failed" },
      },
      {
        name: "partly imported",
        coverage: { ...sourceCoverage, importedRecordCount: 1, readRecordCount: 1 },
      },
      { name: "partly read", coverage: { ...sourceCoverage, readRecordCount: 1 } },
      { name: "without summary", coverage: { ...sourceCoverage, summary: null } },
      {
        name: "without citations",
        coverage: { ...sourceCoverage, summary: { ...sourceCoverage.summary, citedRecordIds: [] } },
      },
    ];
    for (const testCase of incompleteCases) {
      const collecting =
        testCase.coverage === null
          ? started
          : yield* update(started, { type: "source-coverage", coverage: [testCase.coverage] });
      expect(hasCompleteDeepPlanSources(collecting), testCase.name).toBe(false);
      const publishError = yield* update(collecting, { type: "publish-plan", plan }).pipe(
        Effect.flip,
      );
      expect(publishError.detail, testCase.name).toContain("Every frozen source");

      const restoredPublished: DeepPlanRun = {
        ...collecting,
        phase: "awaitingApproval",
        plan,
        approvalKey: deepPlanApprovalKey(plan),
      };
      const approveError = yield* update(restoredPublished, approval()).pipe(Effect.flip);
      expect(approveError.detail, testCase.name).toContain("Every Deep Plan source");
      expect(restoredPublished.approval, testCase.name).toBeNull();
    }
  }),
);

it.effect("requires step checks and a matching final check before declaring completion", () =>
  Effect.gen(function* () {
    const approved = yield* approvedRun;
    const dependencyError = yield* stepUpdate(approved, "display", "inProgress").pipe(Effect.flip);
    expect(dependencyError.detail).toContain("dependencies must be verified");
    const started = yield* stepUpdate(approved, "persistence", "inProgress");
    const implemented = yield* stepUpdate(started, "persistence", "implemented");
    const earlyCheck = yield* update(implemented, {
      type: "validation-start",
      actor,
      requestId: validationRequestId(implemented),
    }).pipe(Effect.flip);
    expect(earlyCheck.detail).toContain("Every Deep Plan step must be verified");
    const noEvidence = yield* stepUpdate(implemented, "persistence", "verified").pipe(Effect.flip);
    expect(noEvidence.detail).toContain("require evidence");

    const firstVerified = yield* stepUpdate(implemented, "persistence", "verified", evidence);
    const allVerified = yield* verifyStep(firstVerified, "display");
    expect(allVerified.phase).toBe("validating");
    expect(allVerified.finalValidation.status).toBe("pending");
    const requestId = validationRequestId(allVerified);
    const missingStart = yield* update(allVerified, {
      type: "validation-complete",
      actor,
      requestId,
      status: "passed",
      evidence,
    }).pipe(Effect.flip);
    expect(missingStart.detail).toContain("active validation request");
    const checking = yield* update(allVerified, { type: "validation-start", actor, requestId });
    const missingEvidence = yield* update(checking, {
      type: "validation-complete",
      actor,
      requestId,
      status: "passed",
      evidence: [],
    }).pipe(Effect.flip);
    expect(missingEvidence.detail).toContain("explicit final validation evidence");
    const finished = yield* update(checking, {
      type: "validation-complete",
      actor,
      requestId,
      status: "passed",
      evidence,
    });
    expect(finished.phase).toBe("completed");
    expect(finished.finalValidation.evidence).toEqual(evidence);
    expect(decodeRun(encodeRun(finished)).phase).toBe("completed");
  }),
);

it.effect("requires new approval when an approved plan changes", () =>
  Effect.gen(function* () {
    const approved = yield* approvedRun;
    const implementing = yield* stepUpdate(approved, "persistence", "inProgress");
    const revisedPlan = { ...plan, version: 2, scope: ["Thread state", "Archived thread state"] };
    const revised = yield* update(implementing, { type: "publish-plan", plan: revisedPlan });
    expect(revised.phase).toBe("awaitingApproval");
    expect(revised.approval).toBeNull();
    expect(revised.stepStates.every((step) => step.status === "pending")).toBe(true);
    expect(revised.approvalKey).not.toBe(approved.approvalKey);
    const unapproved = yield* stepUpdate(revised, "persistence", "inProgress").pipe(Effect.flip);
    expect(unapproved.detail).toContain("approved implementing agent and model");
    const staleApproval = yield* update(revised, approval()).pipe(Effect.flip);
    expect(staleApproval.detail).toContain("stale plan version");
    const resumed = yield* update(revised, approval(revisedPlan));
    expect(resumed.phase).toBe("implementing");
    expect(resumed.approval?.planVersion).toBe(2);
  }),
);

it.effect("invalidates dependent checks and an active final check when verified work changes", () =>
  Effect.gen(function* () {
    const ready = yield* validationReadyRun;
    const requestId = validationRequestId(ready);
    const checking = yield* update(ready, { type: "validation-start", requestId, actor });
    const changed = yield* stepUpdate(checking, "persistence", "inProgress");
    expect(changed.phase).toBe("implementing");
    expect(changed.stepStates.find((step) => step.stepId === "display")).toMatchObject({
      status: "pending",
      evidence: [],
    });
    expect(changed.finalValidation).toMatchObject({
      status: "pending",
      evidence: [],
      attempt: 1,
      requestId: null,
    });
    const staleCheck = yield* update(changed, {
      type: "validation-complete",
      requestId,
      actor,
      status: "passed",
      evidence,
    }).pipe(Effect.flip);
    expect(staleCheck.detail).toContain("active validation request");
  }),
);

it.effect(
  "replays identical operations once and rejects duplicate conflicts, foreign runs, and stale revisions",
  () =>
    Effect.gen(function* () {
      const approved = yield* approvedRun;
      const command = commandFor(approved, {
        type: "step-update",
        stepId: "persistence",
        status: "inProgress",
        evidence: [],
        actor,
      });
      const updated = yield* updateDeepPlanRun(approved, command);
      expect(yield* updateDeepPlanRun(updated, command)).toBe(updated);
      const duplicate = yield* updateDeepPlanRun(updated, {
        ...command,
        mutation: { type: "pause" },
      }).pipe(Effect.flip);
      expect(duplicate.detail).toContain("reused with different content");
      const stale = yield* updateDeepPlanRun(updated, {
        ...command,
        operationId: "new-operation",
      }).pipe(Effect.flip);
      expect(stale.detail).toContain("revision");
      const foreignThread = yield* updateDeepPlanRun(updated, {
        ...commandFor(updated, { type: "pause" }),
        threadId: ThreadId.make("other-thread"),
      }).pipe(Effect.flip);
      expect(foreignThread.detail).toContain("does not belong to this thread");
      const foreignRun = yield* updateDeepPlanRun(updated, {
        ...commandFor(updated, { type: "pause" }),
        runId: DeepPlanRunId.make("other-run"),
      }).pipe(Effect.flip);
      expect(foreignRun.detail).toContain("does not belong to this thread");
      expect(updated.revision).toBe(approved.revision + 1);
      expect(updated.stepStates[0]?.status).toBe("inProgress");
    }),
);

it.effect("rejects updates by another implementing agent or model", () =>
  Effect.gen(function* () {
    const approved = yield* approvedRun;
    for (const foreignActor of [
      { ...actor, implementerId: "thread:another-agent" },
      { ...actor, model: { ...implementation, model: "another-model" } },
      {
        ...actor,
        model: { ...implementation, instanceId: ProviderInstanceId.make("another-provider") },
      },
      {
        ...actor,
        model: { ...implementation, options: [{ id: "reasoningEffort", value: "high" }] },
      },
    ]) {
      const rejected = yield* update(approved, {
        type: "step-update",
        stepId: "persistence",
        status: "inProgress",
        evidence: [],
        actor: foreignActor,
      }).pipe(Effect.flip);
      expect(rejected.detail).toContain("approved implementing agent and model");
    }
    expect(approved.stepStates[0]?.status).toBe("pending");
    const ready = yield* validationReadyRun;
    const rejectedValidation = yield* update(ready, {
      type: "validation-start",
      requestId: validationRequestId(ready),
      actor: { ...actor, model: { ...implementation, model: "another-model" } },
    }).pipe(Effect.flip);
    expect(rejectedValidation.detail).toContain("approved implementing agent and model");
  }),
);

it.effect("restores an approved run and its idempotency history after pausing", () =>
  Effect.gen(function* () {
    const approved = yield* approvedRun;
    const adjusted = yield* update(approved, {
      type: "procedure-adjust",
      reason: "Use the focused test fixture",
      changes: ["Reuse the existing test data"],
      actor,
    });
    const started = yield* stepUpdate(adjusted, "persistence", "inProgress");
    const pauseCommand = commandFor(started, {
      type: "pause",
      reason: "Continue after reconnecting",
    });
    const paused = yield* updateDeepPlanRun(started, pauseCommand);
    const restored = decodeRun(encodeRun(paused));
    expect(restored.approval).toEqual(approved.approval);
    expect(restored.procedureAdjustments).toHaveLength(1);
    expect(yield* updateDeepPlanRun(restored, pauseCommand)).toBe(restored);
    expect(yield* startDeepPlanRun(startCommand, restored)).toBe(restored);
    const pausedUpdate = yield* stepUpdate(restored, "persistence", "implemented").pipe(
      Effect.flip,
    );
    expect(pausedUpdate.detail).toContain("Resume the approved Deep Plan");
    const resumed = yield* update(restored, { type: "resume" });
    expect(resumed.phase).toBe("implementing");
    expect(resumed.stepStates[0]?.status).toBe("inProgress");
    expect(resumed.approvalKey).toBe(approved.approvalKey);
  }),
);

it.effect(
  "restores an active final check and rejects an old result after a failed check is retried",
  () =>
    Effect.gen(function* () {
      const ready = yield* validationReadyRun;
      const requestId = validationRequestId(ready);
      const checking = yield* update(ready, { type: "validation-start", requestId, actor });
      const restored = decodeRun(encodeRun(checking));
      expect(restored.phase).toBe("validating");
      expect(restored.finalValidation.requestId).toBe(requestId);
      const failed = yield* update(restored, {
        type: "validation-complete",
        requestId,
        actor,
        status: "failed",
        evidence,
      });
      expect(failed.phase).toBe("failed");
      const resumed = yield* update(decodeRun(encodeRun(failed)), { type: "resume" });
      expect(resumed.phase).toBe("validating");
      expect(resumed.finalValidation.status).toBe("pending");
      expect(resumed.finalValidation.evidence).toEqual([]);
      expect(resumed.finalValidation.attempt).toBe(1);
      const newRequestId = validationRequestId(resumed);
      expect(newRequestId).not.toBe(requestId);
      const oldStart = yield* update(resumed, { type: "validation-start", requestId, actor }).pipe(
        Effect.flip,
      );
      expect(oldStart.detail).toContain("stale or belongs to another run");
      const rechecking = yield* update(resumed, {
        type: "validation-start",
        requestId: newRequestId,
        actor,
      });
      const oldResult = yield* update(rechecking, {
        type: "validation-complete",
        requestId,
        actor,
        status: "passed",
        evidence,
      }).pipe(Effect.flip);
      expect(oldResult.detail).toContain("active validation request");
      const finished = yield* update(rechecking, {
        type: "validation-complete",
        requestId: newRequestId,
        actor,
        status: "passed",
        evidence,
      });
      expect(finished.phase).toBe("completed");
    }),
);

it.effect("requires a new final check after blocking an active validation", () =>
  Effect.gen(function* () {
    const ready = yield* validationReadyRun;
    const requestId = validationRequestId(ready);
    const checking = yield* update(ready, { type: "validation-start", requestId, actor });
    const blocked = yield* update(checking, { type: "block", reason: "The check needs a repair" });
    expect(blocked.phase).toBe("blocked");
    expect(blocked.finalValidation).toMatchObject({
      status: "pending",
      attempt: checking.finalValidation.attempt + 1,
      requestId: null,
      turnId: null,
      evidence: [],
    });
    const resumed = yield* update(decodeRun(encodeRun(blocked)), { type: "resume" });
    expect(resumed.phase).toBe("validating");
    const nextRequestId = validationRequestId(resumed);
    expect(nextRequestId).not.toBe(requestId);
    const rechecking = yield* update(resumed, {
      type: "validation-start",
      requestId: nextRequestId,
      actor,
    });
    const staleResult = yield* update(rechecking, {
      type: "validation-complete",
      requestId,
      actor,
      status: "passed",
      evidence,
    }).pipe(Effect.flip);
    expect(staleResult.detail).toContain("active validation request");
    const finished = yield* update(rechecking, {
      type: "validation-complete",
      requestId: nextRequestId,
      actor,
      status: "passed",
      evidence,
    });
    expect(finished.phase).toBe("completed");
  }),
);
