// @effect-diagnostics nodeBuiltinImport:off - Approval fingerprints must be computed in the pure command decision.
import {
  DEEP_PLAN_MAX_OPERATIONS,
  DEEP_PLAN_REVIEW_ROUND_LIMIT,
  deriveDeepPlanImplementationThreadId,
  deriveDeepPlanRunId,
  isDeepPlanRun,
  type DeepPlanDocument,
  type DeepPlanError,
  type DeepPlanRun,
  type DeepPlanReviewTarget,
  type StoredDeepPlanRun,
  type ThreadDeepPlanAdvanceCommand,
  type ThreadDeepPlanStartCommand,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import { derive } from "@t3tools/provider-core/server/IdAllocator";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { deepPlanTurnHasResult, reviewTarget } from "./deepPlanNextAction.ts";

export class DeepPlanDecisionError extends Schema.TaggedError<DeepPlanDecisionError>()(
  "DeepPlanDecisionError",
  {
    commandType: Schema.String,
    detail: Schema.String,
    context: Schema.Struct({ deepPlanCode: Schema.String }),
  },
) {}

export function invalidDeepPlanCommand(
  command: { readonly type: string },
  detail: string,
  code: DeepPlanError["code"] = "invalid-transition",
) {
  return new DeepPlanDecisionError({
    commandType: command.type,
    detail,
    context: { deepPlanCode: code },
  });
}

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

function deepPlanApprovalKey(plan: DeepPlanDocument): string {
  return fingerprint(plan);
}

type ActiveTurn = DeepPlanRun["activeTurns"][number];
type StepState = DeepPlanRun["steps"][number];

function pendingReview(): DeepPlanRun["finalReview"] {
  return {
    status: "pending",
    submission: null,
    reviews: [],
    roundLimit: DEEP_PLAN_REVIEW_ROUND_LIMIT,
    unsubmittedTurns: 0,
  };
}

function isReviewTurn(turn: Pick<ActiveTurn, "kind">): boolean {
  return turn.kind === "review" || turn.kind === "finalReview";
}

function matchesTarget(turn: ActiveTurn, target: DeepPlanReviewTarget): boolean {
  return turn.stepId === (target.kind === "step" ? target.stepId : null);
}

function replaceStep(run: DeepPlanRun, step: StepState): DeepPlanRun {
  return {
    ...run,
    steps: run.steps.map((existing) => (existing.stepId === step.stepId ? step : existing)),
  };
}

function pause(
  run: DeepPlanRun,
  request: Omit<NonNullable<DeepPlanRun["pause"]>, "at">,
  at: string,
): DeepPlanRun {
  return { ...run, phase: "paused", pause: { ...request, at } };
}

function resume(run: DeepPlanRun): DeepPlanRun {
  const pause = run.pause;
  const moreRounds = pause?.kind === "reviewLimit";
  const finalReview =
    run.finalReview.status !== "pending" || run.activeTurns.some((turn) => turn.stepId === null);
  const phase =
    run.plan === null
      ? "planning"
      : run.approval === null
        ? "awaitingApproval"
        : finalReview
          ? "finalReview"
          : "implementing";
  return {
    ...run,
    phase,
    pause: null,
    activeTurns: run.activeTurns.map((turn) => ({ ...turn, attempt: 0 })),
    steps: run.steps.map((step) => ({
      ...step,
      unsubmittedTurns: 0,
      roundLimit:
        moreRounds && pause.stepId === step.stepId
          ? step.roundLimit + DEEP_PLAN_REVIEW_ROUND_LIMIT
          : step.roundLimit,
    })),
    finalReview: {
      ...run.finalReview,
      unsubmittedTurns: 0,
      roundLimit:
        moreRounds && pause.stepId === undefined
          ? run.finalReview.roundLimit + DEEP_PLAN_REVIEW_ROUND_LIMIT
          : run.finalReview.roundLimit,
    },
  };
}

export const startDeepPlanRun = Effect.fn("startDeepPlanRun")(function* (
  command: ThreadDeepPlanStartCommand,
  current?: StoredDeepPlanRun | null,
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  const id = deriveDeepPlanRunId(command.commandId);
  if (isDeepPlanRun(current) && current.threadId !== command.threadId) {
    return yield* invalidDeepPlanCommand(
      command,
      "This thread belongs to a Deep Plan owned by another thread.",
      "operation-conflict",
    );
  }
  if (isDeepPlanRun(current)) {
    if (current.id === id) return current;
    if (current.phase === "implementing" || current.phase === "finalReview") {
      return yield* invalidDeepPlanCommand(
        command,
        "Pause the current Deep Plan before starting another run.",
      );
    }
  }
  return {
    schemaVersion: 2,
    id,
    threadId: command.threadId,
    phase: "planning",
    revision: 0,
    plan: null,
    approvalKey: null,
    approval: null,
    chats: command.chats,
    includeProjectChats: command.includeProjectChats,
    steps: [],
    finalReview: pendingReview(),
    activeTurns: [],
    operations: [],
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
    pause: null,
  };
});

const requireRun = Effect.fn("DeepPlanDecision.requireRun")(function* (
  run: StoredDeepPlanRun | null | undefined,
  command: ThreadDeepPlanUpdateCommand | ThreadDeepPlanAdvanceCommand,
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  if (!isDeepPlanRun(run) || run.id !== command.runId || run.threadId !== command.threadId) {
    return yield* invalidDeepPlanCommand(
      command,
      "Deep Plan run does not belong to this thread.",
      "run-not-found",
    );
  }
  return run;
});

function currentRevisionError(
  run: DeepPlanRun,
  command: ThreadDeepPlanUpdateCommand | ThreadDeepPlanAdvanceCommand,
) {
  return invalidDeepPlanCommand(
    command,
    `Deep Plan revision ${command.expectedRevision} is stale; current revision is ${run.revision}.`,
    "stale-revision",
  );
}

const applyMutation = Effect.fn("DeepPlanDecision.applyMutation")(function* (
  run: DeepPlanRun,
  command: ThreadDeepPlanUpdateCommand,
  baseTurnCount: number,
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  const mutation = command.mutation;
  switch (mutation.type) {
    case "publish-plan": {
      if (command.byThreadId !== run.threadId)
        return yield* invalidDeepPlanCommand(
          command,
          "Only the planning thread can publish a Deep Plan.",
          "actor-mismatch",
        );
      if (run.phase !== "planning" && run.phase !== "awaitingApproval" && run.phase !== "paused")
        return yield* invalidDeepPlanCommand(
          command,
          "Pause the Deep Plan before publishing a new version.",
        );
      const plan: DeepPlanDocument = {
        ...mutation.plan,
        schemaVersion: 2,
        version: (run.plan?.version ?? 0) + 1,
      };
      return {
        ...run,
        phase: "awaitingApproval",
        plan,
        approvalKey: deepPlanApprovalKey(plan),
        approval: null,
        steps: plan.steps.map((step) => ({
          stepId: step.id,
          status: "pending",
          laneId: null,
          baseTurnCount: null,
          submission: null,
          reviews: [],
          roundLimit: DEEP_PLAN_REVIEW_ROUND_LIMIT,
          unsubmittedTurns: 0,
        })),
        finalReview: pendingReview(),
        activeTurns: [],
        pause: null,
      };
    }
    case "approve": {
      if (run.phase !== "awaitingApproval" || run.plan === null)
        return yield* invalidDeepPlanCommand(
          command,
          "Publish a Deep Plan before approving implementation.",
        );
      if (mutation.planVersion !== run.plan.version || mutation.approvalKey !== run.approvalKey)
        return yield* invalidDeepPlanCommand(
          command,
          "Deep Plan approval references a stale plan version.",
          "stale-plan",
        );
      const primaryThreadId =
        mutation.implementationThread === "current"
          ? run.threadId
          : deriveDeepPlanImplementationThreadId(run.id, mutation.planVersion);
      return {
        ...run,
        phase: "implementing",
        approval: {
          planVersion: mutation.planVersion,
          approvalKey: mutation.approvalKey,
          implementation: mutation.implementation,
          reviewer: mutation.reviewer ?? command.defaultReviewer ?? mutation.implementation,
          approvedAt: command.createdAt,
          parallelism: mutation.parallelism,
          lanes: Array.from({ length: mutation.parallelism }, (_, index) => {
            const laneId = `v${mutation.planVersion}:${index + 1}`;
            const threadId =
              index === 0 ? primaryThreadId : derive.deepPlanLaneThread({ runId: run.id, laneId });
            return { laneId, threadId };
          }),
          baseTurnCount,
        },
        pause: null,
      };
    }
    case "pause":
      if (run.phase === "paused") return run;
      if (run.phase !== "implementing" && run.phase !== "finalReview")
        return yield* invalidDeepPlanCommand(
          command,
          "Only a Deep Plan that is being implemented can pause.",
        );
      return pause(
        run,
        { kind: "user", reason: mutation.reason ?? "Paused by the user." },
        command.createdAt,
      );
    case "resume":
      if (run.phase !== "paused")
        return yield* invalidDeepPlanCommand(command, "Only a paused Deep Plan can resume.");
      return resume(run);
    case "cancel":
      return { ...run, phase: "cancelled", pause: null };
    case "block": {
      const planning =
        command.byThreadId === run.threadId &&
        (run.phase === "planning" || run.phase === "awaitingApproval" || run.phase === "paused");
      const implementation = run.activeTurns.find(
        (turn) =>
          !isReviewTurn(turn) &&
          turn.threadId === command.byThreadId &&
          turn.commandId === command.byTurnCommandId,
      );
      if (!planning && implementation === undefined)
        return yield* invalidDeepPlanCommand(
          command,
          "Only the planner or active implementer can report a blocker.",
          "actor-mismatch",
        );
      return pause(
        run,
        {
          kind: "blocked",
          reason: mutation.reason,
          ...(implementation?.stepId == null ? {} : { stepId: implementation.stepId }),
        },
        command.createdAt,
      );
    }
    case "submit":
    case "review-verdict": {
      const review = mutation.type === "review-verdict";
      const turn = run.activeTurns.find(
        (turn) =>
          isReviewTurn(turn) === review &&
          matchesTarget(turn, mutation.target) &&
          turn.threadId === command.byThreadId &&
          turn.commandId === command.byTurnCommandId &&
          (mutation.type !== "review-verdict" || turn.round === mutation.round),
      );
      if (turn === undefined)
        return yield* invalidDeepPlanCommand(
          command,
          "This thread has no matching active Deep Plan turn.",
          "actor-mismatch",
        );
      const step = run.steps.find((step) => step.stepId === turn.stepId);
      const state = step ?? run.finalReview;
      if (mutation.type === "submit") {
        if (state.submission?.turnCommandId === turn.commandId)
          return yield* invalidDeepPlanCommand(
            command,
            "This Deep Plan turn already submitted its work.",
          );
        const submission = {
          summary: mutation.summary,
          changedFiles: mutation.changedFiles,
          turnCommandId: turn.commandId,
          at: command.createdAt,
        };
        return step === undefined
          ? { ...run, finalReview: { ...run.finalReview, submission } }
          : replaceStep(run, { ...step, submission });
      }
      const latest = state.reviews.at(-1);
      if (latest?.round !== mutation.round || latest.verdict !== null)
        return yield* invalidDeepPlanCommand(
          command,
          "This Deep Plan turn has no pending review verdict.",
        );
      const reviews = [
        ...state.reviews.slice(0, -1),
        {
          ...latest,
          verdict: mutation.verdict,
          summary: mutation.summary,
          findings: mutation.findings,
          completedAt: command.createdAt,
        },
      ];
      return step === undefined
        ? { ...run, finalReview: { ...run.finalReview, reviews, status: mutation.verdict } }
        : replaceStep(run, {
            ...step,
            reviews,
            status: mutation.verdict === "approved" ? "verified" : "changesRequested",
          });
    }
  }
});

export const updateDeepPlanRun = Effect.fn("updateDeepPlanRun")(function* (
  current: StoredDeepPlanRun | null | undefined,
  command: ThreadDeepPlanUpdateCommand,
  baseTurnCount = 0,
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  const run = yield* requireRun(current, command);
  // Parallel lanes keep moving the revision; these mutations are bound to their active turn instead.
  const turnBound =
    command.mutation.type === "submit" || command.mutation.type === "review-verdict";
  const operationFingerprint = fingerprint({
    threadId: command.threadId,
    runId: command.runId,
    ...(turnBound ? {} : { expectedRevision: command.expectedRevision }),
    byThreadId: command.byThreadId,
    byTurnCommandId: command.byTurnCommandId,
    mutation: command.mutation,
  });
  const operation = run.operations.find((entry) => entry.operationId === command.operationId);
  if (operation !== undefined) {
    if (operation.fingerprint !== operationFingerprint)
      return yield* invalidDeepPlanCommand(
        command,
        "Deep Plan operation ID was reused with different content.",
        "operation-conflict",
      );
    return run;
  }
  if (!turnBound && run.revision !== command.expectedRevision)
    return yield* currentRevisionError(run, command);
  if (run.phase === "completed" || run.phase === "cancelled")
    return yield* invalidDeepPlanCommand(command, "Finished Deep Plans cannot be updated.");

  const next = yield* applyMutation(run, command, baseTurnCount);
  const revision = run.revision + 1;
  return {
    ...next,
    revision,
    updatedAt: command.createdAt,
    operations: [
      ...run.operations.slice(-(DEEP_PLAN_MAX_OPERATIONS - 1)),
      {
        operationId: command.operationId,
        fingerprint: operationFingerprint,
        revision,
      },
    ],
  };
});

const startTurn = Effect.fn("DeepPlanDecision.startTurn")(function* (
  run: DeepPlanRun,
  command: ThreadDeepPlanAdvanceCommand,
  transition: Extract<ThreadDeepPlanAdvanceCommand["transition"], { type: "start-turn" }>,
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  const { turn } = transition;
  const approval = run.approval;
  if (approval === null || run.plan === null)
    return yield* invalidDeepPlanCommand(
      command,
      "The Deep Plan must be approved before starting a turn.",
      "approval-required",
    );

  const target = reviewTarget(turn);
  const review = isReviewTurn(turn);
  const step = run.steps.find((step) => step.stepId === turn.stepId);
  const definition = run.plan.steps.find((step) => step.id === turn.stepId);
  if (
    (turn.kind === "finalReview" || turn.kind === "finalFix") !== (target.kind === "final") ||
    (target.kind === "step" && (step === undefined || definition === undefined))
  )
    return yield* invalidDeepPlanCommand(
      command,
      "The turn does not match a step in the approved Deep Plan.",
    );

  const lane =
    target.kind === "final"
      ? approval.lanes[0]
      : approval.lanes.find((lane) => lane.laneId === turn.laneId);
  const previous = run.activeTurns.find((candidate) => candidate.commandId === transition.replaces);
  if (
    lane === undefined ||
    (target.kind === "final" && turn.laneId !== lane.laneId) ||
    (step?.laneId != null && step.laneId !== lane.laneId) ||
    (transition.replaces !== undefined &&
      (previous === undefined ||
        previous.kind !== turn.kind ||
        previous.stepId !== turn.stepId ||
        previous.laneId !== turn.laneId ||
        previous.round !== turn.round ||
        previous.attempt + (transition.retryReason === "restarted" ? 0 : 1) !== turn.attempt ||
        transition.retryReason === undefined)) ||
    (transition.replaces === undefined &&
      (turn.attempt !== 0 || transition.retryReason !== undefined))
  )
    return yield* invalidDeepPlanCommand(
      command,
      "The turn does not match its assigned Deep Plan lane or retry.",
    );

  if (previous !== undefined && deepPlanTurnHasResult(run, previous))
    return yield* invalidDeepPlanCommand(
      command,
      "The Deep Plan turn already recorded its result.",
    );

  const expectedThreadId = review
    ? derive.deepPlanReviewThread({
        runId: run.id,
        planVersion: approval.planVersion,
        target,
        round: turn.round,
      })
    : lane.threadId;
  if (
    expectedThreadId !== turn.threadId ||
    (review && approval.lanes.some((lane) => lane.threadId === turn.threadId))
  )
    return yield* invalidDeepPlanCommand(
      command,
      "The turn does not match its Deep Plan thread.",
      "target-unavailable",
    );

  const otherTurns = run.activeTurns.filter((candidate) => candidate !== previous);
  if (
    otherTurns.some(
      (candidate) =>
        candidate.threadId === turn.threadId ||
        candidate.stepId === turn.stepId ||
        (!review && !isReviewTurn(candidate) && candidate.laneId === turn.laneId),
    )
  )
    return yield* invalidDeepPlanCommand(
      command,
      "The Deep Plan target or lane already has an active turn.",
    );

  const state = step ?? run.finalReview;
  const lastReview = state.reviews.at(-1);
  if (previous === undefined) {
    if (turn.round !== (lastReview?.round ?? 0) + 1 || turn.round > state.roundLimit)
      return yield* invalidDeepPlanCommand(
        command,
        "The Deep Plan turn does not match the next review round.",
      );
    switch (turn.kind) {
      case "implement":
        if (
          step?.status !== "pending" ||
          definition?.dependencies.some(
            (dependency) =>
              !run.steps.some((step) => step.stepId === dependency && step.status === "verified") ||
              otherTurns.some((turn) => turn.stepId === dependency),
          )
        )
          return yield* invalidDeepPlanCommand(
            command,
            "The Deep Plan step is not ready to implement.",
          );
        break;
      case "review":
        if (step?.status !== "inReview" || state.submission === null)
          return yield* invalidDeepPlanCommand(
            command,
            "The Deep Plan step must have a submission before review.",
          );
        break;
      case "fix":
      case "finalFix":
        if (state.status !== "changesRequested")
          return yield* invalidDeepPlanCommand(
            command,
            "The Deep Plan target has no requested changes.",
          );
        break;
      case "finalReview":
        if (
          run.steps.some((step) => step.status !== "verified") ||
          otherTurns.length !== 0 ||
          (state.status !== "pending" && (state.status !== "inReview" || state.submission === null))
        )
          return yield* invalidDeepPlanCommand(
            command,
            "Every step must finish its review before final review.",
          );
        break;
    }
  }

  const reviews = review
    ? [
        ...(previous === undefined ? state.reviews : state.reviews.slice(0, -1)),
        {
          round: turn.round,
          reviewThreadId: turn.threadId,
          reviewer: approval.reviewer,
          diff: transition.diff ?? null,
          verdict: null,
          summary: null,
          findings: [],
          retries: previous === undefined ? 0 : (lastReview?.retries ?? 0) + 1,
          startedAt: command.createdAt,
          completedAt: null,
        },
      ]
    : state.reviews;
  const progress = {
    submission: review ? state.submission : null,
    reviews,
    unsubmittedTurns:
      previous === undefined
        ? 0
        : state.unsubmittedTurns + (transition.retryReason === "missingResult" ? 1 : 0),
  };
  const next: DeepPlanRun = {
    ...run,
    activeTurns: [
      ...otherTurns,
      { ...turn, commandId: command.commandId, startedAt: command.createdAt },
    ],
  };
  if (step !== undefined) {
    return replaceStep(next, {
      ...step,
      ...progress,
      status: review ? "inReview" : "implementing",
      laneId: lane.laneId,
      baseTurnCount: step.baseTurnCount ?? transition.baseTurnCount ?? 0,
    });
  }
  return {
    ...next,
    phase: "finalReview",
    finalReview: { ...run.finalReview, ...progress, status: "inReview" },
  };
});

const settleTurn = Effect.fn("DeepPlanDecision.settleTurn")(function* (
  run: DeepPlanRun,
  command: ThreadDeepPlanAdvanceCommand,
  turnCommandId: ActiveTurn["commandId"],
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  const turn = run.activeTurns.find((turn) => turn.commandId === turnCommandId);
  if (turn === undefined)
    return yield* invalidDeepPlanCommand(command, "The Deep Plan turn is no longer active.");
  const step = run.steps.find((step) => step.stepId === turn.stepId);
  const state = step ?? run.finalReview;
  const review = isReviewTurn(turn);
  if (
    review
      ? state.reviews.at(-1)?.verdict == null
      : state.submission?.turnCommandId !== turnCommandId
  )
    return yield* invalidDeepPlanCommand(
      command,
      "The Deep Plan turn ended without a required submission or verdict.",
    );
  const next: DeepPlanRun = {
    ...run,
    activeTurns: run.activeTurns.filter((candidate) => candidate !== turn),
  };
  if (review)
    return turn.kind === "finalReview" && next.finalReview.status === "approved"
      ? { ...next, phase: "completed" }
      : next;
  return step === undefined
    ? { ...next, finalReview: { ...next.finalReview, status: "inReview" } }
    : replaceStep(next, { ...step, status: "inReview" });
});

export const advanceDeepPlanRun = Effect.fn("advanceDeepPlanRun")(function* (
  current: StoredDeepPlanRun | null | undefined,
  command: ThreadDeepPlanAdvanceCommand,
): Effect.fn.Return<DeepPlanRun, DeepPlanDecisionError> {
  const run = yield* requireRun(current, command);
  if (run.revision !== command.expectedRevision) return yield* currentRevisionError(run, command);
  if (run.phase !== "implementing" && run.phase !== "finalReview")
    return yield* invalidDeepPlanCommand(command, "Only a running Deep Plan can advance.");
  const transition = command.transition;
  let next;
  switch (transition.type) {
    case "start-turn":
      next = yield* startTurn(run, command, transition);
      break;
    case "settle-turn":
      next = yield* settleTurn(run, command, transition.turnCommandId);
      break;
    case "pause":
      next = pause(run, transition.pause, command.createdAt);
      break;
  }
  return { ...next, revision: run.revision + 1, updatedAt: command.createdAt };
});
