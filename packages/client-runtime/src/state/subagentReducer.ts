import type {
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationSubagentDetail,
  OrchestrationSubagentStatus,
  OrchestrationSubagentSummary,
  OrchestrationThreadActivity,
  SubagentId,
} from "@t3tools/contracts";

export type SubagentDetailReducerResult =
  | { readonly kind: "updated"; readonly subagent: OrchestrationSubagentDetail }
  | { readonly kind: "deleted" }
  | { readonly kind: "unchanged" };

const TERMINAL_SUBAGENT_STATUSES = new Set<OrchestrationSubagentStatus>([
  "completed",
  "interrupted",
  "error",
  "unavailable",
]);

function maxIsoDate(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function minIsoDate(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right;
}

function placeholderSubagent(
  subagentId: SubagentId,
  updatedAt: string,
  status: OrchestrationSubagentStatus = "starting",
): OrchestrationSubagentSummary {
  return {
    id: subagentId,
    providerThreadId: subagentId,
    parentId: null,
    path: null,
    name: `Agent ${subagentId.slice(0, 8)}`,
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: updatedAt,
    updatedAt,
    completedAt: TERMINAL_SUBAGENT_STATUSES.has(status) ? updatedAt : null,
  };
}

function mergeSubagentSummary(
  existing: OrchestrationSubagentSummary,
  incoming: OrchestrationSubagentSummary,
): OrchestrationSubagentSummary {
  const lifecycle = incoming.updatedAt.localeCompare(existing.updatedAt) >= 0 ? incoming : existing;
  return {
    ...existing,
    ...incoming,
    parentId: incoming.parentId ?? existing.parentId,
    path: incoming.path ?? existing.path,
    nickname: incoming.nickname ?? existing.nickname,
    role: incoming.role ?? existing.role,
    task: incoming.task ?? existing.task,
    model: incoming.model ?? existing.model,
    reasoningEffort: incoming.reasoningEffort ?? existing.reasoningEffort,
    status: lifecycle.status,
    statusMessage: lifecycle.statusMessage,
    latestProgress: lifecycle.latestProgress,
    latestTurn: lifecycle.latestTurn,
    startedAt: minIsoDate(existing.startedAt, incoming.startedAt),
    updatedAt: lifecycle.updatedAt,
    completedAt: lifecycle.completedAt,
  };
}

function upsertSubagent(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  incoming: OrchestrationSubagentSummary,
): ReadonlyArray<OrchestrationSubagentSummary> {
  const existing = subagents.find((entry) => entry.id === incoming.id);
  if (existing === undefined) {
    return [...subagents, incoming];
  }
  const merged = mergeSubagentSummary(existing, incoming);
  return subagents.map((entry) => (entry.id === incoming.id ? merged : entry));
}

function updateSubagentState(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  input: {
    readonly subagentId: SubagentId;
    readonly status: OrchestrationSubagentStatus;
    readonly statusMessage: string | null;
    readonly updatedAt: string;
  },
): ReadonlyArray<OrchestrationSubagentSummary> {
  const existing =
    subagents.find((entry) => entry.id === input.subagentId) ??
    placeholderSubagent(input.subagentId, input.updatedAt, input.status);
  if (input.updatedAt.localeCompare(existing.updatedAt) < 0) {
    return subagents;
  }
  return upsertSubagent(subagents, {
    ...existing,
    status: input.status,
    statusMessage: input.statusMessage,
    updatedAt: input.updatedAt,
    completedAt: TERMINAL_SUBAGENT_STATUSES.has(input.status) ? input.updatedAt : null,
  });
}

function updateSubagentProgress(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  input: {
    readonly subagentId: SubagentId;
    readonly progress: OrchestrationSubagentSummary["latestProgress"];
    readonly updatedAt: string;
  },
): ReadonlyArray<OrchestrationSubagentSummary> {
  const existing =
    subagents.find((entry) => entry.id === input.subagentId) ??
    placeholderSubagent(input.subagentId, input.updatedAt);
  if (input.updatedAt.localeCompare(existing.updatedAt) < 0) {
    return subagents;
  }
  return upsertSubagent(subagents, {
    ...existing,
    latestProgress: input.progress,
    updatedAt: input.updatedAt,
  });
}

/**
 * Applies only subagent-summary events. Returning the original array marks an
 * irrelevant or stale event without a second result wrapper.
 */
export function applySubagentSummaryEvent(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  event: OrchestrationEvent,
): ReadonlyArray<OrchestrationSubagentSummary> {
  switch (event.type) {
    case "thread.subagent-upserted":
      return upsertSubagent(subagents, event.payload.subagent);
    case "thread.subagent-state-set":
      return updateSubagentState(subagents, event.payload);
    case "thread.subagent-progress-set":
      return updateSubagentProgress(subagents, event.payload);
    default:
      return subagents;
  }
}

function routedToSubagent(event: OrchestrationEvent, subagentId: SubagentId): boolean {
  switch (event.type) {
    case "thread.message-sent":
    case "thread.proposed-plan-upserted":
    case "thread.activity-appended":
      return event.payload.subagentId === subagentId;
    default:
      return false;
  }
}

function mergeMessage(
  messages: ReadonlyArray<OrchestrationMessage>,
  incoming: OrchestrationMessage,
): ReadonlyArray<OrchestrationMessage> {
  const existing = messages.find((entry) => entry.id === incoming.id);
  if (existing === undefined) {
    return [...messages, incoming];
  }
  return messages.map((entry) =>
    entry.id !== incoming.id
      ? entry
      : {
          ...entry,
          text: incoming.streaming
            ? `${entry.text}${incoming.text}`
            : incoming.text.length > 0
              ? incoming.text
              : entry.text,
          streaming: incoming.streaming,
          ...(incoming.turnId !== undefined ? { turnId: incoming.turnId } : {}),
          ...(incoming.streaming ? {} : { updatedAt: incoming.updatedAt }),
          ...(incoming.attachments !== undefined ? { attachments: incoming.attachments } : {}),
        },
  );
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  const sequence =
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
  if (sequence !== 0) {
    return sequence;
  }
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * Reduces a filtered subagent stream into one read-only selected transcript.
 * Events for another child are ignored defensively even though the server
 * already filters the stream.
 */
export function applySubagentDetailEvent(
  subagent: OrchestrationSubagentDetail,
  event: OrchestrationEvent,
): SubagentDetailReducerResult {
  if (event.type === "thread.deleted") {
    return { kind: "deleted" };
  }

  if (event.type === "thread.subagent-upserted") {
    if (event.payload.subagent.id !== subagent.id) {
      return { kind: "unchanged" };
    }
    return {
      kind: "updated",
      subagent: {
        ...mergeSubagentSummary(subagent, event.payload.subagent),
        messages: subagent.messages,
        proposedPlans: subagent.proposedPlans,
        activities: subagent.activities,
      },
    };
  }

  if (event.type === "thread.subagent-state-set") {
    if (event.payload.subagentId !== subagent.id) {
      return { kind: "unchanged" };
    }
    const [updated] = updateSubagentState([subagent], event.payload);
    return updated === undefined || updated === subagent
      ? { kind: "unchanged" }
      : {
          kind: "updated",
          subagent: {
            ...updated,
            messages: subagent.messages,
            proposedPlans: subagent.proposedPlans,
            activities: subagent.activities,
          },
        };
  }

  if (event.type === "thread.subagent-progress-set") {
    if (event.payload.subagentId !== subagent.id) {
      return { kind: "unchanged" };
    }
    const [updated] = updateSubagentProgress([subagent], event.payload);
    return updated === undefined || updated === subagent
      ? { kind: "unchanged" }
      : {
          kind: "updated",
          subagent: {
            ...updated,
            messages: subagent.messages,
            proposedPlans: subagent.proposedPlans,
            activities: subagent.activities,
          },
        };
  }

  if (!routedToSubagent(event, subagent.id)) {
    return { kind: "unchanged" };
  }

  switch (event.type) {
    case "thread.message-sent": {
      const message: OrchestrationMessage = {
        id: event.payload.messageId,
        role: event.payload.role,
        text: event.payload.text,
        ...(event.payload.attachments === undefined
          ? {}
          : { attachments: event.payload.attachments }),
        turnId: event.payload.turnId,
        streaming: event.payload.streaming,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      };
      return {
        kind: "updated",
        subagent: {
          ...subagent,
          messages: mergeMessage(subagent.messages, message),
          updatedAt: maxIsoDate(subagent.updatedAt, event.occurredAt),
        },
      };
    }
    case "thread.proposed-plan-upserted": {
      const proposedPlans = [
        ...subagent.proposedPlans.filter((entry) => entry.id !== event.payload.proposedPlan.id),
        event.payload.proposedPlan,
      ].toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
      return {
        kind: "updated",
        subagent: {
          ...subagent,
          proposedPlans,
          updatedAt: maxIsoDate(subagent.updatedAt, event.occurredAt),
        },
      };
    }
    case "thread.activity-appended": {
      const activities = [
        ...subagent.activities.filter((entry) => entry.id !== event.payload.activity.id),
        event.payload.activity,
      ].toSorted(compareActivities);
      return {
        kind: "updated",
        subagent: {
          ...subagent,
          activities,
          updatedAt: maxIsoDate(subagent.updatedAt, event.occurredAt),
        },
      };
    }
    default:
      return { kind: "unchanged" };
  }
}
