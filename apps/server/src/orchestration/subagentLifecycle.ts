import type {
  OrchestrationSubagentProgress,
  OrchestrationSubagentStatus,
  OrchestrationSubagentSummary,
} from "@t3tools/contracts";

const ACTIVE_SUBAGENT_STATUSES = new Set<OrchestrationSubagentStatus>([
  "starting",
  "running",
  "waiting",
]);

const STATUS_SUMMARIES: Record<OrchestrationSubagentStatus, string> = {
  starting: "Starting",
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  interrupted: "Interrupted",
  error: "Error",
  unavailable: "Unavailable",
};

export function isActiveSubagentStatus(status: OrchestrationSubagentStatus): boolean {
  return ACTIVE_SUBAGENT_STATUSES.has(status);
}

export function subagentStateProgress(
  status: OrchestrationSubagentStatus,
  createdAt: string,
  statusMessage?: string | null,
): OrchestrationSubagentProgress {
  return {
    kind: `state.${status}`,
    summary: statusMessage ?? STATUS_SUMMARIES[status],
    detail: null,
    createdAt,
  };
}

function terminalTurnStatus(
  subagent: OrchestrationSubagentSummary,
): "completed" | "interrupted" | "error" | null {
  const state = subagent.latestTurn?.state;
  return state === "completed" || state === "interrupted" || state === "error" ? state : null;
}

export function reconcileSubagentTerminalTurn(
  subagent: OrchestrationSubagentSummary,
): OrchestrationSubagentSummary {
  if (!isActiveSubagentStatus(subagent.status)) {
    return subagent;
  }

  const status = terminalTurnStatus(subagent);
  if (status === null) {
    return subagent;
  }

  const completedAt =
    subagent.latestTurn?.completedAt ?? subagent.completedAt ?? subagent.updatedAt;
  return {
    ...subagent,
    status,
    statusMessage: null,
    latestProgress: subagentStateProgress(status, completedAt),
    completedAt,
  };
}

export function settleSubagentAfterRuntimeLoss(
  subagent: OrchestrationSubagentSummary,
  settledAt: string,
): OrchestrationSubagentSummary {
  if (!isActiveSubagentStatus(subagent.status)) {
    return subagent;
  }

  const reconciled = reconcileSubagentTerminalTurn(subagent);
  if (!isActiveSubagentStatus(reconciled.status)) {
    return {
      ...reconciled,
      updatedAt:
        reconciled.updatedAt.localeCompare(reconciled.completedAt ?? settledAt) >= 0
          ? reconciled.updatedAt
          : (reconciled.completedAt ?? settledAt),
    };
  }

  const completedAt =
    subagent.updatedAt.localeCompare(settledAt) > 0 ? subagent.updatedAt : settledAt;
  return {
    ...subagent,
    status: "interrupted",
    statusMessage: null,
    latestProgress: subagentStateProgress("interrupted", completedAt),
    latestTurn:
      subagent.latestTurn?.state === "running"
        ? {
            ...subagent.latestTurn,
            state: "interrupted",
            completedAt,
          }
        : subagent.latestTurn,
    updatedAt: completedAt,
    completedAt,
  };
}
