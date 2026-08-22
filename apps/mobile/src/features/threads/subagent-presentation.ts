import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSubagentDetail,
  OrchestrationSubagentStatus,
  OrchestrationSubagentSummary,
  OrchestrationThreadActivity,
  SubagentId,
} from "@t3tools/contracts";

export const MOBILE_SUBAGENT_RECENT_MS = 30_000;

const ACTIVE_STATUSES = new Set<OrchestrationSubagentStatus>(["starting", "running", "waiting"]);

export function mobileSubagentDisplayName(
  agent: Pick<OrchestrationSubagentSummary, "id" | "name" | "nickname">,
): string {
  return agent.nickname?.trim() || agent.name.trim() || String(agent.id);
}

export function mobileSubagentTranscriptMetadata(
  agent: Pick<
    OrchestrationSubagentSummary,
    "origin" | "providerInstanceId" | "providerDriver" | "status" | "model" | "reasoningEffort"
  >,
): string[] {
  const provider =
    agent.origin === "provider-native"
      ? null
      : (agent.providerInstanceId ?? agent.providerDriver ?? null);
  return [agent.status, provider, agent.model, agent.reasoningEffort].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

export function mobileSubagentIsActive(status: OrchestrationSubagentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function terminalTimestamp(agent: OrchestrationSubagentSummary): number {
  const value = Date.parse(agent.completedAt ?? agent.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export function deriveMobileSubagentGroups(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  nowMs = Date.now(),
): {
  readonly active: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly recent: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly history: ReadonlyArray<OrchestrationSubagentSummary>;
} {
  const active = subagents.filter((agent) => mobileSubagentIsActive(agent.status));
  active.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const history = subagents.filter((agent) => !mobileSubagentIsActive(agent.status));
  history.sort((left, right) => terminalTimestamp(right) - terminalTimestamp(left));
  const recent = history.filter((agent) => {
    const completedAt = terminalTimestamp(agent);
    return completedAt > 0 && nowMs - completedAt <= MOBILE_SUBAGENT_RECENT_MS;
  });
  return { active, recent, history };
}

export function nextRecentSubagentExpiryDelayMs(
  recent: ReadonlyArray<OrchestrationSubagentSummary>,
  nowMs = Date.now(),
): number | null {
  const remaining = recent
    .map((agent) => terminalTimestamp(agent) + MOBILE_SUBAGENT_RECENT_MS - nowMs + 1)
    .filter((delay) => delay > 0);
  return remaining.length > 0 ? Math.min(...remaining) : null;
}

export type MobileSubagentTranscriptEntry =
  | {
      readonly type: "message";
      readonly id: OrchestrationMessage["id"];
      readonly createdAt: string;
      readonly message: OrchestrationMessage;
    }
  | {
      readonly type: "proposed-plan";
      readonly id: OrchestrationProposedPlan["id"];
      readonly createdAt: string;
      readonly proposedPlan: OrchestrationProposedPlan;
    }
  | {
      readonly type: "activity";
      readonly id: OrchestrationThreadActivity["id"];
      readonly createdAt: string;
      readonly activity: OrchestrationThreadActivity;
    };

export interface MobileSubagentHistoryState {
  readonly visible: boolean;
  readonly selectedSubagentId: SubagentId | null;
}

export type MobileSubagentHistoryAction =
  | { readonly type: "open"; readonly subagentId: SubagentId | null }
  | { readonly type: "select"; readonly subagentId: SubagentId }
  | { readonly type: "close" };

export const CLOSED_MOBILE_SUBAGENT_HISTORY_STATE: MobileSubagentHistoryState = {
  visible: false,
  selectedSubagentId: null,
};

export function mobileSubagentHistoryIsVisible(
  state: MobileSubagentHistoryState,
  routeIsFocused: boolean,
): boolean {
  return state.visible && routeIsFocused;
}

export function reduceMobileSubagentHistory(
  state: MobileSubagentHistoryState,
  action: MobileSubagentHistoryAction,
): MobileSubagentHistoryState {
  switch (action.type) {
    case "open":
      return { visible: true, selectedSubagentId: action.subagentId };
    case "select":
      return { ...state, selectedSubagentId: action.subagentId };
    case "close":
      return CLOSED_MOBILE_SUBAGENT_HISTORY_STATE;
  }
}

export function mobileSubagentTranscriptEntryKey(entry: MobileSubagentTranscriptEntry): string {
  return `${entry.type}:${entry.id}`;
}

export function deriveMobileSubagentTranscript(
  detail: Pick<OrchestrationSubagentDetail, "messages" | "proposedPlans" | "activities">,
): MobileSubagentTranscriptEntry[] {
  return [
    ...detail.messages.map<MobileSubagentTranscriptEntry>((message) => ({
      type: "message",
      id: message.id,
      createdAt: message.createdAt,
      message,
    })),
    ...detail.proposedPlans.map<MobileSubagentTranscriptEntry>((proposedPlan) => ({
      type: "proposed-plan",
      id: proposedPlan.id,
      createdAt: proposedPlan.createdAt,
      proposedPlan,
    })),
    ...detail.activities.map<MobileSubagentTranscriptEntry>((activity) => ({
      type: "activity",
      id: activity.id,
      createdAt: activity.createdAt,
      activity,
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
