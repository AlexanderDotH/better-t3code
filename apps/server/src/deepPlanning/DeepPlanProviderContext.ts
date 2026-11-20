import {
  DeepPlanExecutionContext,
  isDeepPlanRun,
  type DeepPlanRun,
  type ModelSelection,
  type OrchestrationV2Run,
  type ProviderInteractionMode,
  type RunId,
  type StoredDeepPlanRun,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { deepPlanTurnMessageId, reviewTarget } from "./deepPlanNextAction.ts";

export const deepPlanGrantMatches = Schema.toEquivalence(DeepPlanExecutionContext);

type ProviderTurn = Pick<
  OrchestrationV2Run,
  "id" | "threadId" | "status" | "deepPlanRunId" | "userMessageId"
>;

function deepPlanActiveTurn(run: DeepPlanRun, turn: ProviderTurn) {
  return run.activeTurns.find(
    (active) =>
      active.threadId === turn.threadId &&
      turn.userMessageId === deepPlanTurnMessageId(active.commandId),
  );
}

export function deepPlanProviderContext(input: {
  readonly run: StoredDeepPlanRun | null | undefined;
  readonly turn: ProviderTurn | undefined;
  readonly modelSelection: ModelSelection;
  readonly interactionMode: ProviderInteractionMode;
  readonly threadGrant?: DeepPlanExecutionContext | undefined;
}): DeepPlanExecutionContext | undefined {
  const { run, turn, interactionMode, modelSelection, threadGrant } = input;
  if (
    !run ||
    !isDeepPlanRun(run) ||
    !turn ||
    turn.deepPlanRunId !== run.id ||
    (turn.status !== "starting" && turn.status !== "running" && turn.status !== "waiting") ||
    run.phase === "completed" ||
    run.phase === "cancelled"
  ) {
    return undefined;
  }

  const grantIdentity = { runId: run.id, runThreadId: run.threadId };
  const assignment = deepPlanActiveTurn(run, turn);
  if (assignment === undefined) {
    return interactionMode === "plan" &&
      threadGrant === undefined &&
      turn.threadId === run.threadId &&
      (run.phase === "planning" || run.phase === "awaitingApproval" || run.phase === "paused")
      ? {
          ...grantIdentity,
          turnId: turn.id,
          approvedPlanVersion: null,
          phase: "planning",
          readOnly: true,
          modelSelection,
        }
      : undefined;
  }

  const approval = run.approval;
  if (
    interactionMode !== "default" ||
    approval === null ||
    run.plan?.version !== approval.planVersion ||
    run.approvalKey !== approval.approvalKey
  ) {
    return undefined;
  }

  const lane = approval.lanes.find((candidate) => candidate.laneId === assignment.laneId);
  const reviewing = assignment.kind === "review" || assignment.kind === "finalReview";
  if (
    reviewing
      ? approval.lanes.some(({ threadId }) => threadId === turn.threadId)
      : lane?.threadId !== turn.threadId
  ) {
    return undefined;
  }

  const scope = { ...grantIdentity, approvedPlanVersion: approval.planVersion };
  const grant: DeepPlanExecutionContext = reviewing
    ? {
        ...scope,
        phase: "review",
        readOnly: true,
        modelSelection: approval.reviewer,
        review: { target: reviewTarget(assignment), round: assignment.round },
      }
    : {
        ...scope,
        phase: "execution",
        ...(assignment.laneId === null ? {} : { laneId: assignment.laneId }),
        modelSelection: approval.implementation,
      };

  if ((reviewing || turn.threadId !== run.threadId) && threadGrant === undefined) return undefined;
  if (threadGrant !== undefined && !deepPlanGrantMatches(grant, threadGrant)) return undefined;
  return { ...grant, turnId: turn.id };
}

export const resolveLiveDeepPlan = Effect.fn("DeepPlanProviderContext.resolveLiveDeepPlan")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly turnId?: RunId;
    readonly modelSelection: ModelSelection;
    readonly interactionMode: ProviderInteractionMode;
  }) {
    const projections = yield* ProjectionStoreV2;
    const actor = yield* projections.getThreadShell(input.threadId);
    if (actor === null || actor.archivedAt !== null || actor.deletedAt !== null) return undefined;

    const turnId = input.turnId ?? actor.activeRunId;
    if (turnId === null || (actor.activeRunId !== null && actor.activeRunId !== turnId)) {
      return undefined;
    }
    const { runs } = yield* projections.getThreadRecords(actor.id, ["runs"], {
      runIds: [turnId],
    });
    const turn = runs[0];
    if (turn?.deepPlanRunId === undefined) return undefined;

    const assigned = actor.deepPlanExecution;
    const assigner =
      assigned === undefined || assigned.runThreadId === actor.id
        ? actor
        : yield* projections.getThreadShell(assigned.runThreadId);
    const assignedRun = assigner?.deepPlan;
    // A grant from a finished or replaced run must not shadow a Deep Plan this thread now owns.
    const threadGrant =
      assigned !== undefined &&
      isDeepPlanRun(assignedRun) &&
      assignedRun.id === assigned.runId &&
      assignedRun.threadId === assigner?.id &&
      assignedRun.phase !== "completed" &&
      assignedRun.phase !== "cancelled"
        ? assigned
        : undefined;
    const owner = threadGrant === undefined ? actor : assigner;
    if (owner === null || owner.archivedAt !== null || owner.deletedAt !== null) return undefined;
    const run = owner.deepPlan;
    if (!run || !isDeepPlanRun(run) || run.threadId !== owner.id) return undefined;

    const grant = deepPlanProviderContext({
      run,
      turn,
      modelSelection: input.modelSelection,
      interactionMode: input.interactionMode,
      ...(threadGrant === undefined ? {} : { threadGrant }),
    });
    return grant === undefined
      ? undefined
      : { run, grant, assignment: deepPlanActiveTurn(run, turn) };
  },
);
