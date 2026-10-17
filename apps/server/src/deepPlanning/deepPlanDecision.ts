import {
  type DeepPlanActor,
  type DeepPlanDocument,
  type DeepPlanError,
  type DeepPlanFinalValidation,
  type DeepPlanRun,
  type DeepPlanStepStatus,
  type ThreadDeepPlanStartCommand,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!Predicate.isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function fingerprint(value: unknown): string {
  return NodeCrypto.createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

export function deepPlanApprovalKey(plan: DeepPlanDocument): string {
  return fingerprint(plan);
}

function invalid(
  command: { readonly type: string },
  detail: string,
  code: DeepPlanError["code"] = "invalid-transition",
) {
  return new OrchestrationCommandInvariantError({
    commandType: command.type,
    detail,
    context: { deepPlanCode: code },
  });
}

function pendingFinalValidation(attempt = 0): DeepPlanFinalValidation {
  return {
    status: "pending",
    evidence: [],
    updatedAt: null,
    attempt,
    requestId: null,
    turnId: null,
  };
}

function validationAfterSuspension(run: DeepPlanRun): DeepPlanFinalValidation {
  return run.phase === "validating" && run.finalValidation.status === "inProgress"
    ? pendingFinalValidation(run.finalValidation.attempt + 1)
    : run.finalValidation;
}

export function hasCompleteDeepPlanSources(run: DeepPlanRun): boolean {
  return run.sources.every((source) => {
    const coverage = run.sourceCoverage.find((entry) => entry.sourceId === source.sourceId);
    return (
      coverage !== undefined &&
      coverage.status === "summarized" &&
      coverage.importedRecordCount === source.recordCount &&
      coverage.readRecordCount === source.recordCount &&
      coverage.summary !== null &&
      (source.recordCount === 0 || coverage.summary.citedRecordIds.length > 0)
    );
  });
}

function actorMatches(run: DeepPlanRun, actor: DeepPlanActor): boolean {
  return (
    run.approval !== null &&
    actor.implementerId === run.approval.implementerId &&
    fingerprint(actor.model) === fingerprint(run.approval.implementation)
  );
}

function hasCurrentApproval(run: DeepPlanRun): boolean {
  return (
    run.plan !== null &&
    run.approval !== null &&
    run.approval.planVersion === run.plan.version &&
    run.approval.approvalKey === deepPlanApprovalKey(run.plan)
  );
}

function resumedPhase(run: DeepPlanRun): DeepPlanRun["phase"] {
  if (run.plan === null) return run.sources.length > 0 ? "planning" : "collecting";
  if (!hasCurrentApproval(run)) return "awaitingApproval";
  return run.stepStates.every((step) => step.status === "verified") ? "validating" : "implementing";
}

function dependentStepIds(plan: DeepPlanDocument, changedStepId: string): ReadonlySet<string> {
  const invalidated = new Set([changedStepId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of plan.steps) {
      if (!invalidated.has(step.id) && step.dependencies.some((id) => invalidated.has(id))) {
        invalidated.add(step.id);
        changed = true;
      }
    }
  }
  invalidated.delete(changedStepId);
  return invalidated;
}

const allowedStepTransitions: Record<DeepPlanStepStatus, ReadonlyArray<DeepPlanStepStatus>> = {
  pending: ["pending", "inProgress", "blocked"],
  inProgress: ["inProgress", "implemented", "failed", "blocked"],
  implemented: ["implemented", "verified", "inProgress", "failed", "blocked"],
  verified: ["verified", "inProgress", "failed"],
  failed: ["failed", "inProgress", "blocked"],
  blocked: ["blocked", "inProgress"],
};

export const startDeepPlanRun = Effect.fn("startDeepPlanRun")(function* (
  command: ThreadDeepPlanStartCommand,
  current?: DeepPlanRun | null,
): Effect.fn.Return<DeepPlanRun, OrchestrationCommandInvariantError> {
  if (current != null && current.threadId !== command.threadId) {
    return yield* invalid(
      command,
      "This thread is implementing a Deep Plan owned by another thread.",
      "operation-conflict",
    );
  }
  if (current?.id === command.runId) {
    if (current.threadId !== command.threadId) {
      return yield* invalid(command, "Deep Plan run belongs to another thread.");
    }
    if (
      command.sources !== undefined &&
      fingerprint(command.sources) !== fingerprint(current.sources)
    ) {
      return yield* invalid(command, "Deep Plan run sources are already frozen.");
    }
    return current;
  }
  if (current?.phase === "implementing" || current?.phase === "validating") {
    return yield* invalid(command, "Pause the current Deep Plan before starting another run.");
  }
  const sources = command.sources ?? [];
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    return yield* invalid(command, "Deep Plan source IDs must be unique.");
  }
  return {
    id: command.runId,
    threadId: command.threadId,
    phase: sources.length > 0 ? "planning" : "collecting",
    revision: 0,
    plan: null,
    approvalKey: null,
    approval: null,
    sources,
    sourceCoverage: [],
    stepStates: [],
    finalValidation: pendingFinalValidation(),
    procedureAdjustments: [],
    operations: [],
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
    pauseReason: null,
  };
});

export const updateDeepPlanRun = Effect.fn("updateDeepPlanRun")(function* (
  run: DeepPlanRun | null | undefined,
  command: ThreadDeepPlanUpdateCommand,
): Effect.fn.Return<DeepPlanRun, OrchestrationCommandInvariantError> {
  if (run == null || run.id !== command.runId || run.threadId !== command.threadId) {
    return yield* invalid(
      command,
      "Deep Plan run does not belong to this thread.",
      "run-not-found",
    );
  }
  const operationFingerprint = fingerprint({
    threadId: command.threadId,
    runId: command.runId,
    expectedRevision: command.expectedRevision,
    mutation: command.mutation,
  });
  const operation = run.operations.find((entry) => entry.operationId === command.operationId);
  if (operation !== undefined) {
    if (operation.fingerprint !== operationFingerprint) {
      return yield* invalid(
        command,
        "Deep Plan operation ID was reused with different content.",
        "operation-conflict",
      );
    }
    return run;
  }
  if (run.revision !== command.expectedRevision) {
    return yield* invalid(
      command,
      `Deep Plan revision ${command.expectedRevision} is stale; current revision is ${run.revision}.`,
      "stale-revision",
    );
  }
  if (run.phase === "completed") {
    return yield* invalid(command, "Completed Deep Plans cannot be updated.");
  }
  const mutation = command.mutation;
  if ("actor" in mutation && (!hasCurrentApproval(run) || !actorMatches(run, mutation.actor))) {
    return yield* invalid(
      command,
      "Deep Plan updates require the approved implementing agent and model.",
      hasCurrentApproval(run) ? "actor-mismatch" : "approval-required",
    );
  }
  let next: DeepPlanRun = run;
  switch (mutation.type) {
    case "sources-set": {
      if (run.plan !== null || (run.phase !== "collecting" && run.phase !== "planning")) {
        return yield* invalid(command, "Deep Plan sources cannot change after planning.");
      }
      if (run.sources.length > 0 && fingerprint(run.sources) !== fingerprint(mutation.sources)) {
        return yield* invalid(
          command,
          "Deep Plan source snapshots are immutable; start a new run to change sources.",
        );
      }
      if (
        new Set(mutation.sources.map((source) => source.sourceId)).size !== mutation.sources.length
      ) {
        return yield* invalid(command, "Deep Plan source IDs must be unique.");
      }
      next = { ...run, sources: mutation.sources, phase: "planning" };
      break;
    }
    case "source-coverage": {
      if (run.plan !== null || (run.phase !== "collecting" && run.phase !== "planning")) {
        return yield* invalid(
          command,
          "Deep Plan source coverage is frozen with the published plan.",
        );
      }
      const coverage = new Map(run.sourceCoverage.map((entry) => [entry.sourceId, entry]));
      const seen = new Set<string>();
      for (const entry of mutation.coverage) {
        const source = run.sources.find((candidate) => candidate.sourceId === entry.sourceId);
        const previous = coverage.get(entry.sourceId);
        if (source === undefined || seen.has(entry.sourceId)) {
          return yield* invalid(
            command,
            "Deep Plan coverage must reference unique frozen sources.",
          );
        }
        if (
          entry.importedRecordCount > source.recordCount ||
          entry.readRecordCount > entry.importedRecordCount ||
          (previous !== undefined &&
            (entry.importedRecordCount < previous.importedRecordCount ||
              entry.readRecordCount < previous.readRecordCount))
        ) {
          return yield* invalid(
            command,
            "Deep Plan source coverage counts must match the frozen snapshot and cannot regress.",
          );
        }
        seen.add(entry.sourceId);
        coverage.set(entry.sourceId, entry);
      }
      next = { ...run, sourceCoverage: [...coverage.values()], phase: "planning" };
      break;
    }
    case "publish-plan": {
      if (run.phase === "paused" || run.phase === "collecting") {
        return yield* invalid(
          command,
          "Finish collecting sources and resume the Deep Plan before publishing.",
        );
      }
      if (!hasCompleteDeepPlanSources(run)) {
        return yield* invalid(
          command,
          "Every frozen source must be imported, read, and summarized before publishing a Deep Plan.",
          "sources-incomplete",
        );
      }
      if (mutation.plan.version !== (run.plan?.version ?? 0) + 1) {
        return yield* invalid(command, "Deep Plan versions must increase by one.", "stale-plan");
      }
      next = {
        ...run,
        phase: "awaitingApproval",
        plan: mutation.plan,
        approvalKey: deepPlanApprovalKey(mutation.plan),
        approval: null,
        stepStates: mutation.plan.steps.map((step) => ({
          stepId: step.id,
          status: "pending",
          evidence: [],
          updatedAt: command.createdAt,
        })),
        finalValidation: pendingFinalValidation(),
        pauseReason: null,
      };
      break;
    }
    case "approve": {
      if (run.phase !== "awaitingApproval" || run.plan === null) {
        return yield* invalid(
          command,
          "A published Deep Plan must await approval before implementation.",
        );
      }
      if (!hasCompleteDeepPlanSources(run)) {
        return yield* invalid(
          command,
          "Every Deep Plan source must be imported, read, and summarized before approval.",
          "sources-incomplete",
        );
      }
      if (
        mutation.planVersion !== run.plan.version ||
        mutation.approvalKey !== deepPlanApprovalKey(run.plan)
      ) {
        return yield* invalid(
          command,
          "Deep Plan approval references a stale plan version.",
          "stale-plan",
        );
      }
      if (mutation.implementerId !== `thread:${mutation.implementationThreadId}`) {
        return yield* invalid(
          command,
          "Deep Plan implementer must be bound to the implementation thread.",
        );
      }
      next = {
        ...run,
        phase: "implementing",
        approval: {
          planVersion: mutation.planVersion,
          approvalKey: mutation.approvalKey,
          implementation: mutation.implementation,
          implementationThreadId: mutation.implementationThreadId,
          implementerId: mutation.implementerId,
          ...(mutation.requestedParallelism === undefined
            ? {}
            : { requestedParallelism: mutation.requestedParallelism }),
          approvedAt: command.createdAt,
          approvedBy: "user",
        },
        pauseReason: null,
      };
      break;
    }
    case "step-update": {
      if (run.phase === "paused" || run.plan === null) {
        return yield* invalid(command, "Resume the approved Deep Plan before updating steps.");
      }
      const step = run.plan.steps.find((entry) => entry.id === mutation.stepId);
      const state = run.stepStates.find((entry) => entry.stepId === mutation.stepId);
      if (step === undefined || state === undefined) {
        return yield* invalid(command, "Deep Plan step does not exist in the approved plan.");
      }
      if (!allowedStepTransitions[state.status].includes(mutation.status)) {
        return yield* invalid(
          command,
          `Deep Plan step cannot change from ${state.status} to ${mutation.status}.`,
        );
      }
      if (
        (mutation.status === "inProgress" ||
          mutation.status === "implemented" ||
          mutation.status === "verified") &&
        step.dependencies.some(
          (id) =>
            !run.stepStates.some((entry) => entry.stepId === id && entry.status === "verified"),
        )
      ) {
        return yield* invalid(command, "Deep Plan step dependencies must be verified first.");
      }
      if (
        (mutation.status === "verified" || mutation.status === "failed") &&
        mutation.evidence.length === 0
      ) {
        return yield* invalid(command, "Deep Plan verification and failures require evidence.");
      }
      const invalidatesValidation = state.status === "verified" && mutation.status !== "verified";
      const invalidatedDependencies = invalidatesValidation
        ? dependentStepIds(run.plan, step.id)
        : new Set<string>();
      const stepStates = run.stepStates.map((entry) =>
        entry.stepId === mutation.stepId
          ? {
              stepId: mutation.stepId,
              status: mutation.status,
              evidence: mutation.evidence,
              updatedAt: command.createdAt,
            }
          : invalidatedDependencies.has(entry.stepId)
            ? {
                stepId: entry.stepId,
                status: "pending" as const,
                evidence: [],
                updatedAt: command.createdAt,
              }
            : entry,
      );
      const allVerified = stepStates.every((entry) => entry.status === "verified");
      const finalValidation =
        invalidatesValidation || run.finalValidation.status === "failed"
          ? pendingFinalValidation(run.finalValidation.attempt + 1)
          : run.finalValidation;
      next = {
        ...run,
        stepStates,
        phase:
          mutation.status === "failed"
            ? "failed"
            : mutation.status === "blocked"
              ? "blocked"
              : allVerified
                ? "validating"
                : "implementing",
        finalValidation,
        pauseReason: null,
      };
      break;
    }
    case "validation-start": {
      if (
        run.phase !== "validating" ||
        !run.stepStates.every((step) => step.status === "verified")
      ) {
        return yield* invalid(
          command,
          "Every Deep Plan step must be verified before final validation.",
        );
      }
      const expectedRequestId = `deep-plan:${run.id}:validation:${run.plan?.version ?? 0}:${run.finalValidation.attempt}`;
      if (mutation.requestId !== expectedRequestId) {
        return yield* invalid(
          command,
          "Deep Plan validation request is stale or belongs to another run.",
        );
      }
      if (run.finalValidation.status !== "pending" && run.finalValidation.status !== "inProgress") {
        return yield* invalid(
          command,
          "Deep Plan final validation must be pending before starting.",
        );
      }
      next = {
        ...run,
        finalValidation: {
          ...run.finalValidation,
          status: "inProgress",
          requestId: mutation.requestId,
          turnId: mutation.turnId ?? run.finalValidation.turnId,
          updatedAt: command.createdAt,
        },
      };
      break;
    }
    case "validation-complete": {
      if (
        run.phase !== "validating" ||
        run.finalValidation.status !== "inProgress" ||
        mutation.requestId !== run.finalValidation.requestId
      ) {
        return yield* invalid(
          command,
          "Deep Plan final validation must match the active validation request.",
        );
      }
      if (
        !run.stepStates.every((step) => step.status === "verified") ||
        mutation.evidence.length === 0
      ) {
        return yield* invalid(
          command,
          "Deep Plan completion requires all steps verified and explicit final validation evidence.",
        );
      }
      next = {
        ...run,
        phase: mutation.status === "passed" ? "completed" : "failed",
        finalValidation: {
          ...run.finalValidation,
          status: mutation.status,
          evidence: mutation.evidence,
          updatedAt: command.createdAt,
        },
      };
      break;
    }
    case "procedure-adjust": {
      if ((run.phase !== "implementing" && run.phase !== "validating") || run.plan === null) {
        return yield* invalid(
          command,
          "Procedure adjustments require an active approved Deep Plan.",
        );
      }
      next = {
        ...run,
        procedureAdjustments: [
          ...run.procedureAdjustments,
          {
            id: command.operationId,
            planVersion: run.plan.version,
            reason: mutation.reason,
            changes: mutation.changes,
            actor: mutation.actor,
            createdAt: command.createdAt,
          },
        ],
      };
      break;
    }
    case "pause":
      next = {
        ...run,
        phase: "paused",
        pauseReason: mutation.reason ?? null,
        finalValidation: validationAfterSuspension(run),
      };
      break;
    case "block":
      next = {
        ...run,
        phase: "blocked",
        pauseReason: mutation.reason,
        finalValidation: validationAfterSuspension(run),
      };
      break;
    case "resume": {
      if (run.phase !== "paused" && run.phase !== "failed" && run.phase !== "blocked") {
        return yield* invalid(command, "Only paused, failed, or blocked Deep Plans can resume.");
      }
      next = {
        ...run,
        phase: resumedPhase(run),
        pauseReason: null,
        finalValidation:
          run.finalValidation.status === "failed"
            ? pendingFinalValidation(run.finalValidation.attempt + 1)
            : run.finalValidation,
      };
      break;
    }
  }
  const revision = run.revision + 1;
  return {
    ...next,
    revision,
    updatedAt: command.createdAt,
    operations: [
      ...run.operations,
      { operationId: command.operationId, fingerprint: operationFingerprint, revision },
    ],
  };
});
