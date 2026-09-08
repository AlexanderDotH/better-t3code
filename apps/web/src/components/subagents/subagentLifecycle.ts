import type { OrchestrationSubagentStatus, OrchestrationSubagentSummary } from "@t3tools/contracts";

export const SUBAGENT_TERMINAL_COLOR_MS = 30_000;

const ACTIVE_STATUSES = new Set<OrchestrationSubagentStatus>(["starting", "running", "waiting"]);

export type SubagentLifecycleStage = "working" | "success" | "failure" | "stale";

export interface SubagentLifecycleEntry {
  readonly agent: OrchestrationSubagentSummary;
  readonly stage: SubagentLifecycleStage;
  readonly terminalAtMs: number | null;
  readonly transitionAtMs: number | null;
}

export interface SubagentLifecyclePartition {
  readonly visible: ReadonlyArray<SubagentLifecycleEntry>;
  readonly archived: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly nextTransitionAtMs: number | null;
}

function parseTimestamp(...timestamps: ReadonlyArray<string | null>): number | null {
  for (const timestamp of timestamps) {
    if (timestamp === null) {
      continue;
    }
    const timestampMs = Date.parse(timestamp);
    if (Number.isFinite(timestampMs)) {
      return timestampMs;
    }
  }
  return null;
}

function lifecycleEntry(
  agent: OrchestrationSubagentSummary,
  nowMs: number,
): SubagentLifecycleEntry | null {
  if (ACTIVE_STATUSES.has(agent.status)) {
    return {
      agent,
      stage: "working",
      terminalAtMs: null,
      transitionAtMs: null,
    };
  }

  const terminalAtMs = parseTimestamp(agent.completedAt, agent.updatedAt);
  const stage = agent.status === "completed" ? "success" : "failure";
  if (terminalAtMs === null || !Number.isFinite(nowMs)) {
    return {
      agent,
      stage,
      terminalAtMs,
      transitionAtMs: null,
    };
  }

  const archiveAtMs = terminalAtMs + SUBAGENT_TERMINAL_COLOR_MS;
  if (nowMs >= archiveAtMs) {
    return null;
  }
  return {
    agent,
    stage,
    terminalAtMs,
    transitionAtMs: archiveAtMs,
  };
}

function sortableTimestamp(timestamp: string | null): number {
  if (timestamp === null) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : Number.NEGATIVE_INFINITY;
}

function compareVisibleEntries(
  left: SubagentLifecycleEntry,
  right: SubagentLifecycleEntry,
): number {
  return (
    sortableTimestamp(right.agent.startedAt) - sortableTimestamp(left.agent.startedAt) ||
    String(left.agent.id).localeCompare(String(right.agent.id))
  );
}

function compareArchivedAgents(
  left: OrchestrationSubagentSummary,
  right: OrchestrationSubagentSummary,
): number {
  return (
    sortableTimestamp(right.completedAt ?? right.updatedAt) -
      sortableTimestamp(left.completedAt ?? left.updatedAt) ||
    String(left.id).localeCompare(String(right.id))
  );
}

export function partitionSubagentsByLifecycle(input: {
  readonly subagents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly nowMs: number;
}): SubagentLifecyclePartition {
  const visible: SubagentLifecycleEntry[] = [];
  const archived: OrchestrationSubagentSummary[] = [];
  let nextTransitionAtMs: number | null = null;

  for (const agent of input.subagents) {
    const entry = lifecycleEntry(agent, input.nowMs);
    if (entry === null) {
      archived.push(agent);
      continue;
    }
    visible.push(entry);
    if (
      entry.transitionAtMs !== null &&
      (nextTransitionAtMs === null || entry.transitionAtMs < nextTransitionAtMs)
    ) {
      nextTransitionAtMs = entry.transitionAtMs;
    }
  }

  visible.sort(compareVisibleEntries);
  archived.sort(compareArchivedAgents);
  return { visible, archived, nextTransitionAtMs };
}
