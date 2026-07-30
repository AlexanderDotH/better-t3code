import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSubagentDetail,
  OrchestrationSubagentStatus,
  OrchestrationSubagentSummary,
  OrchestrationThreadActivity,
  SubagentId,
} from "@t3tools/contracts";

const ACTIVE_STATUSES = new Set<OrchestrationSubagentStatus>(["starting", "running", "waiting"]);

const STATUS_PRESENTATION = {
  starting: { label: "Starting", fallbackActivity: "Starting agent", tone: "progress" },
  running: { label: "Running", fallbackActivity: "Working", tone: "progress" },
  waiting: { label: "Waiting", fallbackActivity: "Waiting", tone: "progress" },
  completed: { label: "Completed", fallbackActivity: "Completed", tone: "success" },
  interrupted: { label: "Interrupted", fallbackActivity: "Interrupted", tone: "danger" },
  error: { label: "Error", fallbackActivity: "Failed", tone: "danger" },
  unavailable: { label: "Unavailable", fallbackActivity: "Unavailable", tone: "danger" },
} as const satisfies Record<
  OrchestrationSubagentStatus,
  {
    readonly label: string;
    readonly fallbackActivity: string;
    readonly tone: SubagentStatusTone;
  }
>;

export type SubagentStatusTone = "progress" | "warning" | "success" | "danger" | "neutral";

export interface SubagentStatusPresentation {
  readonly label: string;
  readonly activity: string;
  readonly detail: string | null;
  readonly tone: SubagentStatusTone;
  readonly isActive: boolean;
}

type SubagentNameSource = Pick<
  OrchestrationSubagentSummary,
  "id" | "name" | "nickname" | "role" | "path"
>;

export type SubagentTranscriptEntry =
  | {
      readonly kind: "message";
      readonly id: OrchestrationMessage["id"];
      readonly createdAt: string;
      readonly message: OrchestrationMessage;
    }
  | {
      readonly kind: "proposed-plan";
      readonly id: OrchestrationProposedPlan["id"];
      readonly createdAt: string;
      readonly proposedPlan: OrchestrationProposedPlan;
    }
  | {
      readonly kind: "activity";
      readonly id: OrchestrationThreadActivity["id"];
      readonly createdAt: string;
      readonly activity: OrchestrationThreadActivity;
    };

export function resolveSubagentDisplayName(agent: SubagentNameSource): string {
  const explicitName = firstNonEmpty(agent.nickname, agent.name, agent.role);
  if (explicitName) {
    return explicitName;
  }

  const pathName = lastPathSegment(agent.path);
  if (pathName) {
    return `Agent ${pathName}`;
  }

  return `Agent ${fallbackIdentifier(agent.id)}`;
}

export function isSubagentActiveStatus(status: OrchestrationSubagentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function resolveSubagentStatusPresentation(
  agent: Pick<OrchestrationSubagentSummary, "status" | "statusMessage" | "latestProgress">,
): SubagentStatusPresentation {
  const status = STATUS_PRESENTATION[agent.status];
  return {
    label: status.label,
    activity:
      firstNonEmpty(agent.latestProgress?.summary) ??
      firstNonEmpty(agent.statusMessage) ??
      status.fallbackActivity,
    detail: firstNonEmpty(agent.latestProgress?.detail),
    tone: status.tone,
    isActive: isSubagentActiveStatus(agent.status),
  };
}

export function deriveSubagentTranscriptEntries(
  detail: Pick<OrchestrationSubagentDetail, "messages" | "proposedPlans" | "activities">,
): SubagentTranscriptEntry[] {
  const messages: SubagentTranscriptEntry[] = detail.messages.map((message) => ({
    kind: "message",
    id: message.id,
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlans: SubagentTranscriptEntry[] = detail.proposedPlans.map((proposedPlan) => ({
    kind: "proposed-plan",
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  const activities: SubagentTranscriptEntry[] = detail.activities.map((activity) => ({
    kind: "activity",
    id: activity.id,
    createdAt: activity.createdAt,
    activity,
  }));

  return [...messages, ...proposedPlans, ...activities].toSorted(compareTranscriptEntries);
}

function firstNonEmpty(...values: ReadonlyArray<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function lastPathSegment(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  return firstNonEmpty(segments.at(-1));
}

function fallbackIdentifier(id: SubagentId): string {
  const providerTail = /([^:/]+)$/.exec(String(id))?.[1] ?? String(id);
  const token = /([^-]+)$/.exec(providerTail)?.[1] ?? providerTail;
  const normalized = token.replace(/[^a-z0-9]+/gi, "").slice(-8);
  return normalized || "unknown";
}

function compareTranscriptEntries(
  left: SubagentTranscriptEntry,
  right: SubagentTranscriptEntry,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    transcriptEntryRank(left) - transcriptEntryRank(right) ||
    String(left.id).localeCompare(String(right.id))
  );
}

function transcriptEntryRank(entry: SubagentTranscriptEntry): number {
  if (entry.kind === "message") {
    return 0;
  }
  if (entry.kind === "proposed-plan") {
    return 1;
  }
  return 2;
}
