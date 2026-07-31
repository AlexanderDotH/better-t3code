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
  starting: {
    label: "Starting",
    fallbackActivity: "Starting agent",
    tone: "progress",
  },
  running: {
    label: "Running",
    fallbackActivity: "Working",
    tone: "progress",
  },
  waiting: {
    label: "Waiting",
    fallbackActivity: "Waiting",
    tone: "progress",
  },
  completed: {
    label: "Completed",
    fallbackActivity: "Completed",
    tone: "success",
  },
  interrupted: {
    label: "Interrupted",
    fallbackActivity: "Interrupted",
    tone: "danger",
  },
  error: {
    label: "Error",
    fallbackActivity: "Failed",
    tone: "danger",
  },
  unavailable: {
    label: "Unavailable",
    fallbackActivity: "Unavailable",
    tone: "danger",
  },
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

export interface SubagentGroups {
  readonly active: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly finished: ReadonlyArray<OrchestrationSubagentSummary>;
}

type SubagentNameSource = Pick<OrchestrationSubagentSummary, "id" | "nickname">;

export const ASTERIX_AGENT_NAMES = [
  "Asterix",
  "Obelix",
  "Idefix",
  "Miraculix",
  "Majestix",
  "Gutemine",
  "Troubadix",
  "Automatix",
  "Verleihnix",
  "Falbala",
  "Methusalix",
  "Numerobis",
  "Kleopatra",
  "Julius Cäsar",
  "Teefax",
  "Grautvornix",
  "Osolemirnix",
  "Stellartoix",
  "Maestria",
  "Orthopädix",
  "Goudurix",
  "Pepe",
  "Pyradonis",
  "Epidemais",
  "Adrenaline",
  "Selfix",
  "Aspix",
  "Greulix",
  "Acidenitrix",
  "Caligula Minus",
  "Tullius Destructivus",
  "Marcus Sacapus",
] as const;

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
  return firstNonEmpty(agent.nickname) ?? asterixAgentName(agent.id);
}

export function isSubagentActiveStatus(status: OrchestrationSubagentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function groupSubagents(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
): SubagentGroups {
  const active = subagents
    .filter((agent) => isSubagentActiveStatus(agent.status))
    .toSorted(compareActiveAgents);
  const finished = subagents
    .filter((agent) => !isSubagentActiveStatus(agent.status))
    .toSorted(compareFinishedAgents);

  return { active, finished };
}

export function resolveSubagentStatusPresentation(
  agent: Pick<OrchestrationSubagentSummary, "status" | "statusMessage" | "latestProgress">,
): SubagentStatusPresentation {
  const status = STATUS_PRESENTATION[agent.status];
  const progressSummary = firstNonEmpty(agent.latestProgress?.summary);
  const statusMessage = firstNonEmpty(agent.statusMessage);

  return {
    label: status.label,
    activity: progressSummary ?? statusMessage ?? status.fallbackActivity,
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

function asterixAgentName(id: SubagentId): string {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ASTERIX_AGENT_NAMES[(hash >>> 0) % ASTERIX_AGENT_NAMES.length] ?? "Asterix";
}

function compareActiveAgents(
  left: OrchestrationSubagentSummary,
  right: OrchestrationSubagentSummary,
): number {
  return (
    left.startedAt.localeCompare(right.startedAt) ||
    left.depth - right.depth ||
    compareSubagentIdentity(left, right)
  );
}

function compareFinishedAgents(
  left: OrchestrationSubagentSummary,
  right: OrchestrationSubagentSummary,
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || compareSubagentIdentity(left, right);
}

function compareSubagentIdentity(
  left: OrchestrationSubagentSummary,
  right: OrchestrationSubagentSummary,
): number {
  return (
    resolveSubagentDisplayName(left).localeCompare(resolveSubagentDisplayName(right)) ||
    String(left.id).localeCompare(String(right.id))
  );
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
