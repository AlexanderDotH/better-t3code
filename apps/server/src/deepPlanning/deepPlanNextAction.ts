import {
  MessageId,
  type CommandId,
  type DeepPlanActiveTurn,
  type DeepPlanAdvanceTransition,
  type DeepPlanLane,
  type DeepPlanReviewTarget,
  type DeepPlanRun,
  type DeepPlanStepState,
  type OrchestrationV2Run,
  type RunId,
  type StoredDeepPlanRun,
  type ThreadId,
} from "@t3tools/contracts";
import { derive } from "@t3tools/provider-core/server/IdAllocator";

type StartTurn = Extract<DeepPlanAdvanceTransition, { type: "start-turn" }>;
type Turn = StartTurn["turn"];

export type DeepPlanNextAction =
  | Omit<StartTurn, "prompt" | "diff" | "latestRunId">
  | Exclude<DeepPlanAdvanceTransition, StartTurn>;

export interface DeepPlanObservation {
  readonly availability: "idle" | "busy" | "unavailable";
  readonly latestRunId: RunId | null;
  readonly runs: ReadonlyArray<
    Pick<OrchestrationV2Run, "id" | "ordinal" | "userMessageId" | "status">
  >;
}

type Observations = ReadonlyMap<ThreadId, DeepPlanObservation>;

export function isRunningDeepPlan(run: StoredDeepPlanRun | null | undefined): run is DeepPlanRun {
  return run?.schemaVersion === 2 && (run.phase === "implementing" || run.phase === "finalReview");
}

export function deepPlanTurnMessageId(commandId: CommandId): MessageId {
  return MessageId.make(commandId + ":message");
}

export function reviewTarget(turn: Pick<Turn, "stepId">): DeepPlanReviewTarget {
  return turn.stepId === null ? { kind: "final" } : { kind: "step", stepId: turn.stepId };
}

function latestOrdinal(observation: DeepPlanObservation | undefined): number {
  return observation?.runs.reduce((latest, run) => Math.max(latest, run.ordinal), 0) ?? 0;
}

function canBeginParallelLanes(
  run: DeepPlanRun,
  primary: DeepPlanLane,
  obs: Observations,
): boolean {
  if (run.steps.some((step) => step.laneId === primary.laneId && step.status !== "implementing")) {
    return true;
  }
  const primaryTurn = run.activeTurns.find(
    (turn) => turn.laneId === primary.laneId && turn.kind === "implement",
  );
  return (
    primaryTurn !== undefined &&
    obs
      .get(primary.threadId)
      ?.runs.some(
        (candidate) =>
          candidate.userMessageId === deepPlanTurnMessageId(primaryTurn.commandId) &&
          (candidate.status === "running" ||
            candidate.status === "waiting" ||
            candidate.status === "completed"),
      ) === true
  );
}

function pause(
  kind: "turnFailed" | "unavailable" | "reviewLimit",
  reason: string,
  stepId: DeepPlanStepState["stepId"] | null,
): DeepPlanNextAction {
  return { type: "pause", pause: { kind, reason, ...(stepId === null ? {} : { stepId }) } };
}

function isReview(kind: Turn["kind"]): boolean {
  return kind === "review" || kind === "finalReview";
}

export function deepPlanTurnHasResult(
  run: DeepPlanRun,
  active: Pick<DeepPlanActiveTurn, "kind" | "stepId" | "threadId" | "round" | "commandId">,
): boolean {
  const state = run.steps.find((step) => step.stepId === active.stepId) ?? run.finalReview;
  if (!isReview(active.kind)) return state.submission?.turnCommandId === active.commandId;
  const review = state.reviews.at(-1);
  return (
    review?.round === active.round &&
    review.reviewThreadId === active.threadId &&
    review.verdict !== null
  );
}

function nextActiveTurn(
  run: DeepPlanRun,
  active: DeepPlanActiveTurn,
  obs: Observations,
): DeepPlanNextAction | null {
  const observation = obs.get(active.threadId);
  if (observation === undefined || observation.availability === "unavailable") {
    return pause(
      "unavailable",
      "A thread assigned to this Deep Plan is unavailable.",
      active.stepId,
    );
  }
  const persisted = observation.runs.find(
    (candidate) => candidate.userMessageId === deepPlanTurnMessageId(active.commandId),
  );
  if (
    persisted === undefined ||
    ["queued", "preparing", "starting", "running", "waiting"].includes(persisted.status)
  ) {
    return null;
  }
  if (deepPlanTurnHasResult(run, active)) {
    return { type: "settle-turn", turnCommandId: active.commandId };
  }

  const state = run.steps.find((step) => step.stepId === active.stepId) ?? run.finalReview;
  const completed = persisted.status === "completed";
  // Startup recovery cancels in-flight runs; provider failures and user stops end failed or interrupted.
  const restarted = persisted.status === "cancelled";
  if (
    !restarted &&
    (completed ? state.unsubmittedTurns > 0 : active.attempt > state.unsubmittedTurns)
  ) {
    return pause(
      "turnFailed",
      completed
        ? isReview(active.kind)
          ? "The reviewer finished without recording a verdict."
          : "The implementer finished without submitting their work."
        : "The provider turn ended before the Deep Plan could continue.",
      active.stepId,
    );
  }
  if (observation.availability === "busy") return null;
  const { commandId, startedAt: _startedAt, ...turn } = active;
  return {
    type: "start-turn",
    turn: { ...turn, attempt: restarted ? turn.attempt : turn.attempt + 1 },
    replaces: commandId,
    retryReason: completed ? "missingResult" : restarted ? "restarted" : "failed",
  };
}

function nextReviewTurn(
  run: DeepPlanRun,
  lane: DeepPlanLane,
  state: DeepPlanRun["finalReview"] | DeepPlanStepState,
): DeepPlanNextAction | null {
  const stepId = "stepId" in state ? state.stepId : null;
  const round = (state.reviews.at(-1)?.round ?? 0) + 1;
  if (round > state.roundLimit) {
    return pause(
      "reviewLimit",
      stepId === null
        ? "The final review reached its round limit."
        : "This step reached its review round limit.",
      stepId,
    );
  }
  const fixing = state.status === "changesRequested";
  const threadId = fixing
    ? lane.threadId
    : derive.deepPlanReviewThread({
        runId: run.id,
        planVersion: run.approval!.planVersion,
        target: reviewTarget({ stepId }),
        round,
      });
  return {
    type: "start-turn",
    turn: {
      kind: stepId === null ? (fixing ? "finalFix" : "finalReview") : fixing ? "fix" : "review",
      threadId,
      laneId: lane.laneId,
      stepId,
      round,
      attempt: 0,
    },
  };
}

export function decideNext(run: DeepPlanRun, obs: Observations): DeepPlanNextAction | null {
  if (!isRunningDeepPlan(run) || run.approval === null || run.plan === null) return null;
  if (obs.get(run.threadId)?.availability === "unavailable") {
    return pause("unavailable", "The thread that owns this Deep Plan is unavailable.", null);
  }
  const [primary, ...secondary] = run.approval.lanes;
  if (primary === undefined) return null;

  for (const lane of run.approval.lanes) {
    const laneObs = obs.get(lane.threadId);
    if (
      laneObs?.availability === "unavailable" ||
      (laneObs === undefined &&
        (lane === primary || run.steps.some((step) => step.laneId === lane.laneId)))
    ) {
      return pause(
        "unavailable",
        "An implementation thread for this Deep Plan is unavailable.",
        null,
      );
    }
  }

  for (const turn of run.activeTurns) {
    const action = nextActiveTurn(run, turn, obs);
    if (action !== null) return action;
  }

  const activeSteps = new Set(run.activeTurns.map((turn) => turn.stepId));
  if (run.steps.every((step) => step.status === "verified")) {
    if (
      run.activeTurns.length !== 0 ||
      run.approval.lanes.some((lane) => obs.get(lane.threadId)?.availability === "busy")
    )
      return null;
    return run.finalReview.status === "approved"
      ? null
      : nextReviewTurn(run, primary, run.finalReview);
  }

  const steps = new Map(run.steps.map((step) => [step.stepId, step]));
  for (const definition of run.plan.steps) {
    const state = steps.get(definition.id);
    if (state === undefined || activeSteps.has(state.stepId)) continue;
    if (state.status !== "inReview" && state.status !== "changesRequested") continue;
    const lane = run.approval.lanes.find((lane) => lane.laneId === state.laneId);
    if (lane === undefined) continue;
    const action = nextReviewTurn(run, lane, state);
    if (
      action?.type === "pause" ||
      state.status === "inReview" ||
      obs.get(lane.threadId)?.availability === "idle"
    )
      return action;
  }

  const ready = run.plan.steps.find(
    (step) =>
      steps.get(step.id)?.status === "pending" &&
      step.dependencies.every(
        (dependency) =>
          steps.get(dependency)?.status === "verified" && !activeSteps.has(dependency),
      ),
  );
  if (ready === undefined) return null;

  // The primary baseline must exist before a secondary lane can edit their shared worktree.
  const availableLanes = canBeginParallelLanes(run, primary, obs)
    ? [primary, ...secondary]
    : [primary];
  const lane = availableLanes.find(
    ({ laneId, threadId }) =>
      obs.get(threadId)?.availability !== "busy" &&
      !run.activeTurns.some((turn) => turn.laneId === laneId) &&
      !run.steps.some((step) => step.laneId === laneId && step.status !== "verified"),
  );
  if (lane === undefined) return null;
  return {
    type: "start-turn",
    turn: {
      kind: "implement",
      threadId: lane.threadId,
      laneId: lane.laneId,
      stepId: ready.id,
      round: 1,
      attempt: 0,
    },
    baseTurnCount: latestOrdinal(obs.get(lane.threadId)),
  };
}
