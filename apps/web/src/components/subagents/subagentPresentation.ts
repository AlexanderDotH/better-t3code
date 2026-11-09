import { EventId, MessageId, SubagentId } from "@t3tools/contracts";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationSubagentDetail,
  OrchestrationSubagentStatus,
  OrchestrationSubagentSummary,
  OrchestrationThreadActivity,
} from "@t3tools/contracts/legacy";

const ACTIVE_STATUSES = new Set<OrchestrationSubagentStatus>(["starting", "running", "waiting"]);

export function runtimeSubagentSummary(agent: RuntimeSubagent): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make(agent.id),
    origin: "provider-native",
    providerInstanceId: null,
    providerDriver: null,
    providerThreadId: agent.childThreadId ?? agent.id,
    parentId: agent.parentAgentId ? SubagentId.make(agent.parentAgentId) : null,
    path: null,
    name: agent.title,
    nickname: agent.title,
    role: agent.role,
    task: agent.prompt ?? agent.title,
    model: agent.model,
    reasoningEffort: agent.effort,
    depth: agent.parentAgentId ? 1 : 0,
    status:
      agent.status === "failed"
        ? "error"
        : agent.status === "cancelled"
          ? "interrupted"
          : agent.status === "pending"
            ? "starting"
            : agent.status === "idle"
              ? "waiting"
              : agent.status,
    statusMessage: agent.error ?? agent.progress,
    latestProgress: null,
    latestTurn: null,
    startedAt: agent.startedAt ?? agent.firstSeenAt,
    updatedAt: agent.updatedAt,
    completedAt: agent.completedAt,
  };
}

export function runtimeSubagentTranscript(agent: RuntimeSubagent): OrchestrationSubagentDetail {
  const summary = runtimeSubagentSummary(agent);
  return {
    ...summary,
    messages: agent.result
      ? [
          {
            id: MessageId.make(`${agent.id}:result`),
            role: "assistant",
            text: agent.result,
            turnId: null,
            streaming: false,
            createdAt: agent.completedAt ?? agent.updatedAt,
            updatedAt: agent.updatedAt,
          },
        ]
      : [],
    proposedPlans: [],
    activities: agent.progress
      ? [
          {
            id: EventId.make(`${agent.id}:progress`),
            tone: "info",
            kind: "subagent.progress",
            summary: agent.progress,
            payload: null,
            turnId: null,
            createdAt: agent.updatedAt,
          },
        ]
      : [],
  };
}

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

function isSubagentActiveStatus(status: OrchestrationSubagentStatus): boolean {
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

export function resolveSubagentTranscriptMetadata(
  agent: Pick<
    OrchestrationSubagentSummary,
    | "origin"
    | "providerInstanceId"
    | "providerDriver"
    | "role"
    | "model"
    | "reasoningEffort"
    | "serviceTier"
  >,
): string[] {
  if (agent.origin === "t3-fetch") {
    return [
      "Fetch",
      firstNonEmpty(agent.providerInstanceId, agent.providerDriver),
      firstNonEmpty(agent.model),
      formatReasoningEffort(agent.reasoningEffort),
      formatServiceTier(agent.serviceTier),
    ].filter((value): value is string => value !== null);
  }

  if (agent.origin === "t3-managed") {
    return [
      "Subagent",
      firstNonEmpty(agent.providerInstanceId, agent.providerDriver),
      firstNonEmpty(agent.model),
      formatReasoningEffort(agent.reasoningEffort),
      formatServiceTier(agent.serviceTier),
    ].filter((value): value is string => value !== null);
  }

  return [
    agent.role,
    agent.model,
    formatReasoningEffort(agent.reasoningEffort),
    formatServiceTier(agent.serviceTier),
  ].filter((value): value is string => firstNonEmpty(value) !== null);
}

function formatReasoningEffort(value: string | null): string | null {
  const effort = firstNonEmpty(value);
  return effort ? `Reasoning ${effort}` : null;
}

function formatServiceTier(value: string | null | undefined): string | null {
  const tier = firstNonEmpty(value);
  if (tier === "priority" || tier === "fast") return "Fast";
  if (tier === "default") return "Standard";
  return tier;
}

export function deriveSubagentTranscriptEntries(
  detail: Pick<OrchestrationSubagentDetail, "status" | "messages" | "proposedPlans" | "activities">,
): SubagentTranscriptEntry[] {
  const active = isSubagentActiveStatus(detail.status);
  const messages: SubagentTranscriptEntry[] = detail.messages.map((message) => ({
    kind: "message",
    id: message.id,
    createdAt: message.createdAt,
    // A crashed provider may leave a streaming snapshot in the persisted transcript.
    message: !active && message.streaming ? { ...message, streaming: false } : message,
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
