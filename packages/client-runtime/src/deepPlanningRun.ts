import {
  DEEP_PLAN_REVIEW_ROUND_LIMIT,
  isDeepPlanRun,
  type DeepPlanExecutionContext,
  type DeepPlanLegacyRun,
  type DeepPlanPauseKind,
  type DeepPlanReview,
  type DeepPlanRun,
  type DeepPlanRunReference,
  type DeepPlanStep,
  type DeepPlanStepStatus,
  type EnvironmentId,
  type StoredDeepPlanRun,
  type ThreadId,
} from "@t3tools/contracts";
import {
  createInterfaceTranslator,
  type InterfaceMessageKey,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";

const english = createInterfaceTranslator({ language: "en", locale: "en-US" });

type DeepPlanThread = {
  readonly id: ThreadId;
  readonly environmentId?: EnvironmentId | undefined;
  readonly deepPlan?: StoredDeepPlanRun | null | undefined;
  readonly deepPlanExecution?: DeepPlanExecutionContext | undefined;
};

export function isDeepPlanLegacyRun(
  run: StoredDeepPlanRun | null | undefined,
): run is DeepPlanLegacyRun {
  return run?.schemaVersion === 1;
}

export function selectDurableDeepPlan(
  thread: DeepPlanThread | null | undefined,
  environmentThreads: ReadonlyArray<DeepPlanThread> = [],
): StoredDeepPlanRun | null {
  if (!thread) return null;
  const belongsToThread = (run: StoredDeepPlanRun) =>
    run.threadId === thread.id ||
    (isDeepPlanRun(run) &&
      (run.approval?.lanes.some((lane) => lane.threadId === thread.id) ||
        (run.threadId === thread.deepPlanExecution?.runThreadId &&
          run.id === thread.deepPlanExecution.runId)));
  if (thread.deepPlan && belongsToThread(thread.deepPlan)) return thread.deepPlan;
  for (const owner of environmentThreads) {
    if (thread.environmentId && owner.environmentId !== thread.environmentId) continue;
    if (owner.deepPlan?.threadId === owner.id && belongsToThread(owner.deepPlan)) {
      return owner.deepPlan;
    }
  }
  return null;
}

export function getDeepPlanApprovalBlockReason(
  run: StoredDeepPlanRun | null | undefined,
  translator = english,
): string | null {
  if (isDeepPlanLegacyRun(run)) return translator.message("chat.deepPlan.status.legacy");
  if (!run?.plan) return translator.message("chat.deepPlan.approvalUnpublished");
  if (run.phase !== "awaitingApproval")
    return translator.message("chat.deepPlan.approvalNotPending");
  if (!run.approvalKey) return translator.message("chat.deepPlan.approvalKeyMissing");
  return null;
}

export function getDeepPlanProposalBlockReason(
  proposal: { readonly deepPlan?: DeepPlanRunReference } | null | undefined,
  run: StoredDeepPlanRun | null | undefined,
  translator = english,
): string | null {
  if (!proposal?.deepPlan) return null;
  if (isDeepPlanLegacyRun(run)) return translator.message("chat.deepPlan.status.legacy");
  if (
    !run ||
    run.id !== proposal.deepPlan.runId ||
    run.plan?.version !== proposal.deepPlan.planVersion
  ) {
    return translator.message("chat.deepPlan.approvalChanged");
  }
  return getDeepPlanApprovalBlockReason(run, translator);
}

export interface DeepPlanStepPresentation {
  readonly step: DeepPlanStep;
  readonly status: DeepPlanStepStatus;
  readonly laneId: DeepPlanRun["steps"][number]["laneId"];
  readonly review: DeepPlanReview | null;
  readonly verdict: DeepPlanReview | null;
  readonly roundLimit: number;
}

export function selectDeepPlanSteps(
  run: StoredDeepPlanRun | null | undefined,
): ReadonlyArray<DeepPlanStepPresentation> {
  if (!run || isDeepPlanLegacyRun(run) || !run.plan) return [];
  const states = new Map(run.steps.map((state) => [state.stepId, state]));
  return run.plan.steps.map((step) => {
    const state = states.get(step.id);
    return {
      step,
      status: state?.status ?? "pending",
      laneId: state?.laneId ?? null,
      review: state?.reviews.at(-1) ?? null,
      verdict: state?.reviews.findLast((review) => review.verdict !== null) ?? null,
      roundLimit: state?.roundLimit ?? DEEP_PLAN_REVIEW_ROUND_LIMIT,
    };
  });
}

export type DeepPlanRunAction = "pause" | "resume" | "cancel";

interface DeepPlanControls {
  readonly toggle: Exclude<DeepPlanRunAction, "cancel"> | null;
  readonly cancel: boolean;
}

export function selectDeepPlanRunControls(run: StoredDeepPlanRun): DeepPlanControls {
  if (isDeepPlanLegacyRun(run)) return { toggle: null, cancel: false };
  switch (run.phase) {
    case "implementing":
    case "finalReview":
      return { toggle: "pause", cancel: true };
    case "paused":
      return { toggle: "resume", cancel: true };
    case "planning":
    case "awaitingApproval":
      return { toggle: null, cancel: true };
    case "completed":
    case "cancelled":
      return { toggle: null, cancel: false };
  }
}

// Only a blocker carries the agent's own words; other pause reasons are server-written English.
const PAUSE_LABELS = {
  user: "chat.deepPlan.status.pausedByUser",
  reviewLimit: "chat.deepPlan.status.pausedReviewLimit",
  turnFailed: "chat.deepPlan.status.pausedTurnFailed",
  unavailable: "chat.deepPlan.status.pausedUnavailable",
} as const satisfies Record<Exclude<DeepPlanPauseKind, "blocked">, InterfaceMessageKey>;

interface DeepPlanStatus {
  readonly label: string;
  readonly tone: "neutral" | "info" | "warning" | "success";
  readonly stepId?: string;
  readonly threadId?: ThreadId;
}

export function selectDeepPlanStatus(
  run: StoredDeepPlanRun,
  threadShells: ReadonlyArray<Pick<DeepPlanThread, "id">> = [],
  { message, number }: InterfaceTranslator = english,
): DeepPlanStatus {
  if (isDeepPlanLegacyRun(run)) {
    return { label: message("chat.deepPlan.status.legacy"), tone: "neutral" };
  }
  switch (run.phase) {
    case "planning":
      return { label: message("chat.deepPlan.status.planning"), tone: "info" };
    case "awaitingApproval":
      return { label: message("chat.deepPlan.status.awaitingApproval"), tone: "neutral" };
    case "paused": {
      const stepId = run.pause?.stepId;
      const laneId = run.steps.find((step) => step.stepId === stepId)?.laneId;
      const lane = run.approval?.lanes.find((candidate) => candidate.laneId === laneId);
      const threadId = threadShells.find((shell) => shell.id === lane?.threadId)?.id;
      return {
        label: !run.pause
          ? message("chat.deepPlan.status.paused")
          : run.pause.kind === "blocked"
            ? message("chat.deepPlan.status.pauseReason", { reason: run.pause.reason })
            : message(PAUSE_LABELS[run.pause.kind]),
        tone: "warning",
        ...(stepId ? { stepId } : {}),
        ...(threadId ? { threadId } : {}),
      };
    }
    case "completed":
      return {
        label: message("chat.deepPlan.status.completed", {
          completed: number(run.steps.filter((step) => step.status === "verified").length),
          total: number(run.plan?.steps.length ?? 0),
        }),
        tone: "success",
      };
    case "cancelled":
      return { label: message("chat.deepPlan.status.cancelled"), tone: "neutral" };
    case "finalReview": {
      const turn = run.activeTurns.find(
        (turn) => turn.kind === "finalReview" || turn.kind === "finalFix",
      );
      return {
        label: message(
          turn?.kind === "finalFix" ? "chat.deepPlan.status.finalFix" : "chat.deepPlan.finalReview",
        ),
        tone: "info",
        ...(turn ? { threadId: turn.threadId } : {}),
      };
    }
    case "implementing": {
      const steps = run.plan?.steps ?? [];
      const activeSteps = steps.flatMap((step, index) => {
        const turn = run.activeTurns.find((turn) => turn.stepId === step.id);
        return turn ? [{ stepId: step.id, stepNumber: number(index + 1), turn }] : [];
      });
      if (activeSteps.length > 1) {
        return {
          label: message("chat.deepPlan.status.activeLanes", {
            count: number(activeSteps.length),
            steps: activeSteps.map(({ stepNumber }) => stepNumber).join(", "),
          }),
          tone: "info",
        };
      }
      const active = activeSteps[0];
      if (!active) return { label: message("chat.deepPlan.status.waiting"), tone: "neutral" };
      const { stepId, stepNumber, turn } = active;
      const destination = { stepId, threadId: turn.threadId, tone: "info" as const };
      if (turn.kind === "review") {
        const limit =
          run.steps.find((step) => step.stepId === stepId)?.roundLimit ??
          DEEP_PLAN_REVIEW_ROUND_LIMIT;
        return {
          ...destination,
          label: message("chat.deepPlan.status.reviewStep", {
            step: stepNumber,
            round: number(turn.round),
            limit: number(limit),
          }),
        };
      }
      if (turn.kind === "fix") {
        return {
          ...destination,
          label: message("chat.deepPlan.status.fixStep", { step: stepNumber }),
        };
      }
      return {
        ...destination,
        label: message("chat.deepPlan.status.implementStep", {
          step: stepNumber,
          total: number(steps.length),
        }),
      };
    }
  }
}
