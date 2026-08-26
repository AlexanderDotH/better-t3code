import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationSubagentStatus,
  OrchestrationSubagentSummary,
  SubagentId,
  ThreadId,
} from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ProjectAgentClaimSetPayload,
  ProjectAgentClaimReleasedPayload,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadForkedPayload,
  ThreadForkWorkspaceUpdatedPayload,
  ThreadForkHandoffCompletedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadHarnessSyncLinkedPayload,
  ThreadHarnessSyncMessageImportedPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadSettledPayload,
  ThreadPinnedPayload,
  ThreadPinReorderedPayload,
  ThreadSnoozedPayload,
  ThreadUnpinnedPayload,
  ThreadUnarchivedPayload,
  ThreadUnsettledPayload,
  ThreadUnsnoozedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadSubagentProgressSetPayload,
  ThreadSubagentStateSetPayload,
  ThreadSubagentUpsertedPayload,
  ThreadTurnAbortSettledPayload,
  ThreadTurnDiffCompletedPayload,
} from "./Schemas.ts";
import { makeAbortInteractionResolutionActivities } from "./abortInteractionSettlement.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
const TERMINAL_SUBAGENT_STATUSES = new Set<OrchestrationSubagentStatus>([
  "completed",
  "interrupted",
  "error",
  "unavailable",
]);

function retainFrozenWithNativeLimit<T extends { readonly historyOrigin?: unknown }>(
  rows: ReadonlyArray<T>,
  nativeLimit: number,
): T[] {
  const frozen = rows.filter((row) => row.historyOrigin !== undefined);
  const native = rows.filter((row) => row.historyOrigin === undefined).slice(-nativeLimit);
  return [...frozen, ...native];
}

function maxIsoDate(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function minIsoDate(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right;
}

function placeholderSubagent(input: {
  readonly subagentId: SubagentId;
  readonly updatedAt: string;
  readonly status?: OrchestrationSubagentStatus;
}): OrchestrationSubagentSummary {
  return {
    id: input.subagentId,
    origin: "provider-native",
    providerInstanceId: null,
    providerDriver: null,
    providerThreadId: input.subagentId,
    parentId: null,
    path: null,
    name: `Agent ${input.subagentId.slice(0, 8)}`,
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    status: input.status ?? "starting",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: input.updatedAt,
    updatedAt: input.updatedAt,
    completedAt:
      input.status !== undefined && TERMINAL_SUBAGENT_STATUSES.has(input.status)
        ? input.updatedAt
        : null,
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
): OrchestrationSubagentSummary[] {
  const existing = subagents.find((entry) => entry.id === incoming.id);
  if (!existing) {
    return [...subagents, incoming];
  }
  const merged = mergeSubagentSummary(existing, incoming);
  return subagents.map((entry) => (entry.id === incoming.id ? merged : entry));
}

function setSubagentState(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  input: {
    readonly subagentId: SubagentId;
    readonly status: OrchestrationSubagentStatus;
    readonly statusMessage: string | null;
    readonly updatedAt: string;
  },
): OrchestrationSubagentSummary[] {
  const existing =
    subagents.find((entry) => entry.id === input.subagentId) ??
    placeholderSubagent({
      subagentId: input.subagentId,
      updatedAt: input.updatedAt,
      status: input.status,
    });
  const updated =
    input.updatedAt.localeCompare(existing.updatedAt) < 0
      ? existing
      : {
          ...existing,
          status: input.status,
          statusMessage: input.statusMessage,
          updatedAt: input.updatedAt,
          completedAt: TERMINAL_SUBAGENT_STATUSES.has(input.status) ? input.updatedAt : null,
        };
  return upsertSubagent(subagents, updated);
}

function setSubagentProgress(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
  input: {
    readonly subagentId: SubagentId;
    readonly progress: OrchestrationSubagentSummary["latestProgress"];
    readonly updatedAt: string;
  },
): OrchestrationSubagentSummary[] {
  const existing =
    subagents.find((entry) => entry.id === input.subagentId) ??
    placeholderSubagent({
      subagentId: input.subagentId,
      updatedAt: input.updatedAt,
    });
  const updated =
    input.updatedAt.localeCompare(existing.updatedAt) < 0
      ? existing
      : {
          ...existing,
          latestProgress: input.progress,
          updatedAt: input.updatedAt,
        };
  return upsertSubagent(subagents, updated);
}

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

/**
 * Turn state to settle a still-running latest turn with when its session
 * leaves the "running" status, or null while the session is (re)starting or
 * running and the turn must stay unsettled.
 */
function settledTurnStateForSessionStatus(
  status: OrchestrationSession["status"],
): "completed" | "interrupted" | "error" | null {
  switch (status) {
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
    case "starting":
    case "running":
      return null;
  }
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function decodeForEvent<A>(
  schema: Schema.Decoder<A, never>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(toProjectorDecodeError(`${eventType}:${field}`)),
  );
}

export function retainThreadMessagesAfterRevert<T extends OrchestrationMessage>(
  messages: ReadonlyArray<T>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
  isFrozen: (message: T) => boolean = (message) => message.historyOrigin !== undefined,
): ReadonlyArray<T> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (isFrozen(message)) {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) =>
      message.role === "user" && !isFrozen(message) && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !isFrozen(message) &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) =>
      message.role === "assistant" && !isFrozen(message) && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !isFrozen(message) &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

export function retainThreadActivitiesAfterRevert<
  T extends OrchestrationThread["activities"][number],
>(
  activities: ReadonlyArray<T>,
  retainedTurnIds: ReadonlySet<string>,
  isFrozen: (activity: T) => boolean = (activity) => activity.historyOrigin !== undefined,
): ReadonlyArray<T> {
  return activities.filter(
    (activity) =>
      isFrozen(activity) || activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

export function retainThreadProposedPlansAfterRevert<
  T extends OrchestrationThread["proposedPlans"][number],
>(
  proposedPlans: ReadonlyArray<T>,
  retainedTurnIds: ReadonlySet<string>,
  isFrozen: (plan: T) => boolean = (plan) => plan.historyOrigin !== undefined,
): ReadonlyArray<T> {
  return proposedPlans.filter(
    (proposedPlan) =>
      isFrozen(proposedPlan) ||
      proposedPlan.turnId === null ||
      retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            defaultThreadEnvMode: null,
            checkpointsEnabled: payload.checkpointsEnabled,
            faviconPath: payload.faviconPath ?? null,
            scripts: payload.scripts,
            coordinationClaims: [],
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.defaultThreadEnvMode !== undefined
                    ? { defaultThreadEnvMode: payload.defaultThreadEnvMode }
                    : {}),
                  ...(payload.checkpointsEnabled !== undefined
                    ? { checkpointsEnabled: payload.checkpointsEnabled }
                    : {}),
                  ...(payload.faviconPath !== undefined
                    ? { faviconPath: payload.faviconPath }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                  coordinationClaims: [],
                }
              : project,
          ),
        })),
      );

    case "project.agent-claim-set":
      return decodeForEvent(ProjectAgentClaimSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  coordinationClaims: [
                    ...project.coordinationClaims.filter(
                      (lease) => lease.threadId !== payload.threadId,
                    ),
                    payload,
                  ],
                  updatedAt: maxIsoDate(project.updatedAt, payload.updatedAt),
                }
              : project,
          ),
        })),
      );

    case "project.agent-claim-released":
      return decodeForEvent(
        ProjectAgentClaimReleasedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  coordinationClaims: project.coordinationClaims.filter(
                    (lease) =>
                      lease.threadId !== payload.threadId ||
                      (payload.expectedTurnId !== null && lease.turnId !== payload.expectedTurnId),
                  ),
                  updatedAt: maxIsoDate(project.updatedAt, payload.releasedAt),
                }
              : project,
          ),
        })),
      );

    case "project.agent-message-sent":
    case "project.agent-inbox-acknowledged":
      // Message bodies and per-recipient cursors stay in their compact SQL
      // projections; they do not inflate the orchestration command model.
      return Effect.succeed(nextBase);

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            deletedAt: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            subagents: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.forked":
      return decodeForEvent(ThreadForkedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            fork: payload.fork,
            messages: payload.history.messages,
            proposedPlans: payload.history.proposedPlans,
            activities: payload.history.activities,
            subagents: payload.history.subagents,
            checkpoints: payload.history.checkpoints,
            latestTurn: null,
            session: null,
            updatedAt: event.occurredAt,
          }),
        })),
      );

    case "thread.fork-workspace-updated":
      return decodeForEvent(
        ThreadForkWorkspaceUpdatedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (thread?.fork === undefined) return nextBase;
          if (thread.fork.workspace.status === "ready") return nextBase;
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              fork: {
                ...thread.fork,
                workspace: {
                  ...thread.fork.workspace,
                  status: payload.status,
                  preparedAt: payload.preparedAt,
                  lastError: payload.lastError,
                },
              },
              updatedAt: payload.createdAt,
            }),
          };
        }),
      );

    case "thread.fork-handoff-completed":
      return decodeForEvent(
        ThreadForkHandoffCompletedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (thread?.fork === undefined || thread.fork.handoff.status === "completed") {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              fork: {
                ...thread.fork,
                handoff: {
                  ...thread.fork.handoff,
                  status: "completed",
                  completedAt: payload.completedAt,
                },
              },
              updatedAt: payload.completedAt,
            }),
          };
        }),
      );

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: payload.archivedAt,
            titleRegeneration: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.settled":
      return decodeForEvent(ThreadSettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            settledOverride: "settled",
            settledAt: payload.settledAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unsettled":
      return decodeForEvent(ThreadUnsettledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            settledOverride: payload.reason === "user" ? "active" : null,
            settledAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.snoozed":
      return decodeForEvent(ThreadSnoozedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            snoozedUntil: payload.snoozedUntil,
            snoozedAt: payload.snoozedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unsnoozed":
      return decodeForEvent(ThreadUnsnoozedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            snoozedUntil: null,
            snoozedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.pinned":
      return decodeForEvent(ThreadPinnedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            pinnedAt: payload.pinnedAt,
            ...(payload.pinOrderKey !== undefined ? { pinOrderKey: payload.pinOrderKey } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unpinned":
      return decodeForEvent(ThreadUnpinnedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            pinnedAt: null,
            // Unpin clears the slot: re-pinning is "pin again", not "restore
            // an ancient position".
            pinOrderKey: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.pin-reordered":
      return decodeForEvent(ThreadPinReorderedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            pinOrderKey: payload.orderKey,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.titleRegeneration !== undefined
              ? { titleRegeneration: payload.titleRegeneration }
              : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
    case "thread.harness-sync-message-imported":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          event.type === "thread.message-sent"
            ? MessageSentPayloadSchema
            : ThreadHarnessSyncMessageImportedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }
        if (payload.subagentId !== undefined) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = retainFrozenWithNativeLimit(messages, MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.harness-sync-linked":
      return decodeForEvent(
        ThreadHarnessSyncLinkedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (
            thread?.harnessSync !== undefined &&
            thread.harnessSync !== null &&
            thread.harnessSync.lastSyncedAt.localeCompare(payload.lastSyncedAt) > 0
          ) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              harnessSync: {
                providerInstanceId: payload.providerInstanceId,
                providerLabel: payload.providerLabel,
                activity: payload.activity,
                sourceUpdatedAt: payload.sourceUpdatedAt,
                lastSyncedAt: payload.lastSyncedAt,
              },
              updatedAt: maxIsoDate(event.occurredAt, payload.lastSyncedAt),
            }),
          };
        }),
      );

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );

        // Leaving the "running" session status is the turn-end signal: settle
        // a still-running latest turn so its duration reflects the whole turn.
        const settledTurnState = settledTurnStateForSessionStatus(session.status);
        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? {
                    turnId: session.activeTurnId,
                    state: "running",
                    requestedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.requestedAt
                        : session.updatedAt,
                    startedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? (thread.latestTurn.startedAt ?? session.updatedAt)
                        : session.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.assistantMessageId
                        : null,
                  }
                : thread.latestTurn !== null &&
                    thread.latestTurn.state === "running" &&
                    settledTurnState !== null
                  ? {
                      ...thread.latestTurn,
                      state: settledTurnState,
                      // A running turn's completedAt can only hold a mid-turn
                      // placeholder checkpoint timestamp — the session leaving
                      // "running" is the authoritative turn end.
                      completedAt: session.updatedAt,
                    }
                  : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-abort-settled":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnAbortSettledPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        const session = thread?.session;
        if (
          !thread ||
          !session ||
          session.abortState === null ||
          session.runtimeSessionId !== payload.runtimeSessionId ||
          session.abortState.runtimeSessionId !== payload.runtimeSessionId ||
          session.abortState.targetTurnId !== payload.turnId
        ) {
          return nextBase;
        }

        const cooperative = payload.outcome === "cooperative";
        const failed = payload.outcome === "force-failed";
        const nextSession: OrchestrationSession = {
          ...session,
          status: cooperative ? "ready" : failed ? "error" : "stopped",
          runtimeSessionId: cooperative ? session.runtimeSessionId : null,
          activeTurnId: null,
          abortState: null,
          lastError:
            payload.detail !== undefined
              ? payload.detail
              : failed
                ? "Provider force-stop failed."
                : session.lastError,
          updatedAt: payload.settledAt,
        };
        const abortResolutionActivities = makeAbortInteractionResolutionActivities({
          settlementEventId: event.eventId,
          settlementSequence: event.sequence,
          targetTurnId: payload.turnId,
          outcome: payload.outcome,
          settledAt: payload.settledAt,
          activities: thread.activities,
        });
        const settlementActivityIds = new Set(
          abortResolutionActivities.map((activity) => activity.id),
        );
        const activities =
          abortResolutionActivities.length === 0
            ? thread.activities
            : [
                ...thread.activities.filter((activity) => !settlementActivityIds.has(activity.id)),
                ...abortResolutionActivities,
              ].toSorted(compareThreadActivities);
        const retainedActivities = retainFrozenWithNativeLimit(activities, 500);
        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session: nextSession,
            activities: retainedActivities,
            latestTurn:
              payload.turnId !== null &&
              thread.latestTurn?.turnId === payload.turnId &&
              thread.latestTurn.state === "running"
                ? {
                    ...thread.latestTurn,
                    state: failed ? "error" : "interrupted",
                    completedAt: payload.settledAt,
                  }
                : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }
        if (payload.subagentId !== undefined) {
          return nextBase;
        }

        const proposedPlans = retainFrozenWithNativeLimit(
          [
            ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
            payload.proposedPlan,
          ].toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          ),
          200,
        );

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = retainFrozenWithNativeLimit(
          [
            ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
            checkpoint,
          ].toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount),
          MAX_THREAD_CHECKPOINTS,
        );

        // Mid-turn diff updates produce placeholder checkpoints; record the
        // checkpoint, but don't settle a turn its session is still running.
        const turnStillRunning =
          thread.session?.status === "running" && thread.session.activeTurnId === payload.turnId;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn: turnStillRunning
              ? thread.latestTurn
              : {
                  turnId: payload.turnId,
                  state: checkpointStatusToLatestTurnState(payload.status),
                  requestedAt:
                    thread.latestTurn?.turnId === payload.turnId
                      ? thread.latestTurn.requestedAt
                      : payload.completedAt,
                  startedAt:
                    thread.latestTurn?.turnId === payload.turnId
                      ? (thread.latestTurn.startedAt ?? payload.completedAt)
                      : payload.completedAt,
                  completedAt: payload.completedAt,
                  assistantMessageId: payload.assistantMessageId,
                },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = retainFrozenWithNativeLimit(
            thread.checkpoints
              .filter(
                (entry) =>
                  entry.historyOrigin !== undefined ||
                  entry.checkpointTurnCount <= payload.turnCount,
              )
              .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount),
            MAX_THREAD_CHECKPOINTS,
          );
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainFrozenWithNativeLimit(
            retainThreadMessagesAfterRevert(thread.messages, retainedTurnIds, payload.turnCount),
            MAX_THREAD_MESSAGES,
          );
          const proposedPlans = retainFrozenWithNativeLimit(
            retainThreadProposedPlansAfterRevert(thread.proposedPlans, retainedTurnIds),
            200,
          );
          const activities = retainFrozenWithNativeLimit(
            retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds),
            500,
          );

          const latestCheckpoint =
            checkpoints.findLast((checkpoint) => checkpoint.historyOrigin === undefined) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }
          if (payload.subagentId !== undefined) {
            return nextBase;
          }

          const activities = retainFrozenWithNativeLimit(
            [
              ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
              payload.activity,
            ].toSorted(compareThreadActivities),
            500,
          );

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.subagent-upserted":
      return decodeForEvent(
        ThreadSubagentUpsertedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              subagents: upsertSubagent(thread.subagents, payload.subagent),
              updatedAt: maxIsoDate(thread.updatedAt, event.occurredAt),
            }),
          };
        }),
      );

    case "thread.subagent-state-set":
      return decodeForEvent(
        ThreadSubagentStateSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              subagents: setSubagentState(thread.subagents, payload),
              updatedAt: maxIsoDate(thread.updatedAt, event.occurredAt),
            }),
          };
        }),
      );

    case "thread.subagent-progress-set":
      return decodeForEvent(
        ThreadSubagentProgressSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              subagents: setSubagentProgress(thread.subagents, payload),
              updatedAt: maxIsoDate(thread.updatedAt, event.occurredAt),
            }),
          };
        }),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
