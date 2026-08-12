import {
  ApprovalRequestId,
  type AssistantDeliveryMode,
  CommandId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationProposedPlanId,
  type OrchestrationSubagentProgress,
  type OrchestrationSubagentSummary,
  CheckpointRef,
  classifyTaskAgentKind,
  isToolLifecycleItemType,
  type SubagentId,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationProposedPlan,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { isGitRepository } from "../../git/Utils.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadBackgroundLivenessService } from "../ThreadBackgroundLiveness.ts";
import { ThreadPlanProgressService } from "../ThreadPlanProgress.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from "../Services/ProviderRuntimeIngestion.ts";
import { TurnAbortCoordinator } from "../Services/TurnAbortCoordinator.ts";
import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  isActiveSubagentStatus,
  settleSubagentAfterRuntimeLoss,
  subagentStateProgress,
} from "../subagentLifecycle.ts";

const providerTargetKey = (threadId: ThreadId, subagentId?: SubagentId) =>
  subagentId === undefined ? String(threadId) : `${threadId}:subagent:${subagentId}`;

const providerTurnKey = (threadId: ThreadId, turnId: TurnId, subagentId?: SubagentId) =>
  subagentId === undefined
    ? `${threadId}:${turnId}`
    : `${providerTargetKey(threadId, subagentId)}:turn:${turnId}`;

const providerTaskKey = (threadId: ThreadId, taskId: string) => `${threadId}:${taskId}`;

// Fallback when the in-memory description cache no longer has the task name
// (server restart, session-exit sweep, TTL/capacity eviction): earlier
// task.started/task.progress activities for the task are persisted with it.
function findTaskTitleInActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  taskId: string,
): string | undefined {
  if (!activities) {
    return undefined;
  }
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || (activity.kind !== "task.started" && activity.kind !== "task.progress")) {
      continue;
    }
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as { taskId?: unknown; title?: unknown; detail?: unknown })
        : undefined;
    if (payload?.taskId !== taskId) {
      continue;
    }
    const title =
      typeof payload.title === "string"
        ? payload.title
        : activity.kind === "task.started" && typeof payload.detail === "string"
          ? payload.detail
          : undefined;
    if (title && title.trim().length > 0) {
      return title;
    }
  }
  return undefined;
}

interface AssistantSegmentState {
  baseKey: string;
  nextSegmentIndex: number;
  activeMessageId: MessageId | null;
}

type ContentDeltaRuntimeEvent = Extract<ProviderRuntimeEvent, { type: "content.delta" }>;

interface BufferedContentStream {
  readonly key: string;
  readonly threadId: ThreadId;
  readonly subagentId: SubagentId | undefined;
  readonly turnId: TurnId | null;
  readonly itemId: string | null;
  readonly streamKind: ContentDeltaRuntimeEvent["payload"]["streamKind"];
  readonly contentIndex: number | null;
  readonly summaryIndex: number | null;
  readonly firstEventId: EventId;
  readonly firstCreatedAt: string;
  segmentIndex: number;
  text: string;
  lastEvent: ProviderRuntimeEvent;
}

const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const TASK_DESCRIPTION_BY_TASK_CACHE_CAPACITY = 10_000;
const TASK_DESCRIPTION_BY_TASK_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
const MAX_BUFFERED_CONTENT_STREAM_CHARS = 64_000;
const MAX_BUFFERED_CONTENT_STREAMS = 20_000;
const STRICT_PROVIDER_LIFECYCLE_GUARD = process.env.T3CODE_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";

type TurnStartRequestedDomainEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>;

type TurnAbortSettledDomainEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-abort-settled" }
>;

type RuntimeIngestionDomainEvent = TurnStartRequestedDomainEvent | TurnAbortSettledDomainEvent;

type RuntimeIngestionInput =
  | {
      source: "runtime";
      event: ProviderRuntimeEvent;
    }
  | {
      source: "domain";
      event: RuntimeIngestionDomainEvent;
    };

type ProviderCommandSource = Pick<ProviderRuntimeEvent | OrchestrationEvent, "eventId">;

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.make(String(value));
}

function toApprovalRequestId(value: string | undefined): ApprovalRequestId | undefined {
  return value === undefined ? undefined : ApprovalRequestId.make(value);
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function hasAssistantMessageForTurn(
  messages: ReadonlyArray<OrchestrationMessage>,
  turnId: TurnId,
  options?: { readonly streamingOnly?: boolean },
): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role !== "assistant" || message.turnId !== turnId) {
      continue;
    }
    if (options?.streamingOnly === true && !message.streaming) {
      continue;
    }
    return true;
  }
  return false;
}

function findMessageById(
  messages: ReadonlyArray<OrchestrationMessage>,
  messageId: MessageId,
): OrchestrationMessage | undefined {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.id === messageId) {
      return message;
    }
  }
  return undefined;
}

function findProposedPlanById(
  proposedPlans: ReadonlyArray<
    Pick<OrchestrationProposedPlan, "id" | "createdAt" | "implementedAt" | "implementationThreadId">
  >,
  planId: string,
):
  | Pick<OrchestrationProposedPlan, "id" | "createdAt" | "implementedAt" | "implementationThreadId">
  | undefined {
  for (let index = 0; index < proposedPlans.length; index += 1) {
    const proposedPlan = proposedPlans[index];
    if (proposedPlan?.id === planId) {
      return proposedPlan;
    }
  }
  return undefined;
}

function hasCheckpointForTurn(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
  turnId: TurnId,
): boolean {
  for (let index = 0; index < checkpoints.length; index += 1) {
    if (checkpoints[index]?.turnId === turnId) {
      return true;
    }
  }
  return false;
}

function maxCheckpointTurnCount(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
): number {
  let maxTurnCount = 0;
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    if (checkpoint && checkpoint.checkpointTurnCount > maxTurnCount) {
      maxTurnCount = checkpoint.checkpointTurnCount;
    }
  }
  return maxTurnCount;
}

function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function normalizeProposedPlanMarkdown(planMarkdown: string | undefined): string | undefined {
  const trimmed = planMarkdown?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function hasRenderableAssistantText(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) > 0;
}

function proposedPlanIdForTurn(
  threadId: ThreadId,
  turnId: TurnId,
  subagentId?: SubagentId,
): string {
  return `plan:${providerTargetKey(threadId, subagentId)}:turn:${turnId}`;
}

function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId);
  if (turnId) {
    return proposedPlanIdForTurn(threadId, turnId, event.subagentId);
  }
  const targetKey = providerTargetKey(threadId, event.subagentId);
  if (event.itemId) {
    return `plan:${targetKey}:item:${event.itemId}`;
  }
  return `plan:${targetKey}:event:${event.eventId}`;
}

function assistantSegmentBaseKeyFromEvent(event: ProviderRuntimeEvent): string {
  const sourceId = event.itemId ?? event.turnId ?? event.eventId;
  return event.subagentId === undefined
    ? String(sourceId)
    : `${providerTargetKey(event.threadId, event.subagentId)}:${sourceId}`;
}

function assistantSegmentMessageId(baseKey: string, segmentIndex: number): MessageId {
  return MessageId.make(
    segmentIndex === 0 ? `assistant:${baseKey}` : `assistant:${baseKey}:segment:${segmentIndex}`,
  );
}

function shortSubagentName(subagentId: SubagentId): string {
  return `Agent ${subagentId.slice(0, 8)}`;
}

function subagentPathLeaf(agentPath: string | undefined): string | undefined {
  if (!agentPath) return undefined;
  const segments = agentPath.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1);
}

function subagentDepth(agentPath: string | undefined): number {
  if (!agentPath) return 0;
  const segments = agentPath.split("/").filter((segment) => segment.length > 0);
  return Math.max(0, segments.length - (segments[0] === "root" ? 1 : 0));
}

function placeholderSubagentSummary(
  event: ProviderRuntimeEvent,
  subagentId: SubagentId,
): OrchestrationSubagentSummary {
  return {
    id: subagentId,
    origin: "provider-native",
    providerInstanceId: event.providerInstanceId ?? null,
    providerDriver: event.provider,
    providerThreadId: event.providerRefs?.providerThreadId ?? subagentId,
    parentId: null,
    path: null,
    name: shortSubagentName(subagentId),
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    status: "starting",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: event.createdAt,
    updatedAt: event.createdAt,
    completedAt: null,
  };
}

function discoveredSubagentSummary(
  event: Extract<ProviderRuntimeEvent, { type: "subagent.discovered" }>,
  existing: OrchestrationSubagentSummary | undefined,
): OrchestrationSubagentSummary {
  const payload = event.payload;
  const path = payload.agentPath ?? existing?.path ?? null;
  const nickname = payload.nickname ?? existing?.nickname ?? null;
  const role = payload.role ?? existing?.role ?? null;
  const name =
    nickname ??
    subagentPathLeaf(path ?? undefined) ??
    role ??
    existing?.name ??
    shortSubagentName(payload.subagentId);
  return {
    id: payload.subagentId,
    origin: "provider-native",
    providerInstanceId: event.providerInstanceId ?? existing?.providerInstanceId ?? null,
    providerDriver: event.provider,
    providerThreadId: payload.providerThreadId,
    parentId: payload.parentSubagentId ?? existing?.parentId ?? null,
    path,
    name,
    nickname,
    role,
    task: payload.task ?? existing?.task ?? null,
    model: payload.model ?? existing?.model ?? null,
    reasoningEffort: payload.reasoningEffort ?? existing?.reasoningEffort ?? null,
    depth: payload.depth ?? (path ? subagentDepth(path) : (existing?.depth ?? 0)),
    status: existing?.status ?? "starting",
    statusMessage: existing?.statusMessage ?? null,
    latestProgress: existing?.latestProgress ?? null,
    latestTurn: existing?.latestTurn ?? null,
    startedAt: existing?.startedAt ?? event.createdAt,
    updatedAt:
      existing && existing.updatedAt.localeCompare(event.createdAt) > 0
        ? existing.updatedAt
        : event.createdAt,
    completedAt: existing?.completedAt ?? null,
  };
}

function scopedActivityId(
  threadId: ThreadId,
  subagentId: SubagentId | undefined,
  activityId: EventId,
): EventId {
  if (subagentId === undefined) return activityId;
  return EventId.make(`subagent:${threadId}:${subagentId}:${activityId}`);
}

function scopeActivityForEvent(
  event: ProviderRuntimeEvent,
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  return {
    ...activity,
    id: scopedActivityId(event.threadId, event.subagentId, activity.id),
  };
}
function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent,
): ThreadTokenUsageSnapshot | undefined {
  if (event.type !== "thread.token-usage.updated" || event.payload.usage.usedTokens <= 0) {
    return undefined;
  }
  return event.payload.usage;
}

function normalizeRuntimeTurnState(
  value: string | undefined,
): "completed" | "failed" | "interrupted" | "cancelled" {
  switch (value) {
    case "failed":
    case "interrupted":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

function orchestrationSessionStatusFromRuntimeState(
  state: "starting" | "running" | "waiting" | "ready" | "interrupted" | "stopped" | "error",
): "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
  switch (state) {
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "ready":
      return "ready";
    case "interrupted":
      return "interrupted";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

function sessionStatusAllowsActiveTurn(
  status: ReturnType<typeof orchestrationSessionStatusFromRuntimeState>,
): boolean {
  return status === "starting" || status === "running";
}

function requestKindFromCanonicalRequestType(
  requestType: string | undefined,
): "command" | "file-read" | "file-change" | undefined {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return undefined;
  }
}

/**
 * Copies the optional TaskAgentLinkage bundle from a task.* runtime payload
 * into the persisted activity payload. Identity fields ride on every row so
 * client folds survive activity retention; absent fields stay absent.
 */
function taskLinkageActivityFields(payload: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    // Server-stamped classification: persisted rows are self-describing, so
    // clients trust the stamp instead of re-deriving agent-vs-background
    // from taskType denylists and marker heuristics (legacy rows without a
    // stamp keep the client fallback).
    agentKind: classifyTaskAgentKind({
      taskType: typeof payload.taskType === "string" ? payload.taskType : undefined,
      agentId: typeof payload.agentId === "string" ? payload.agentId : undefined,
    }),
  };
  for (const key of [
    "taskType",
    "agentId",
    "title",
    "role",
    "model",
    "effort",
    "toolUseId",
    "parentAgentId",
    "workflowName",
    "agentIndex",
    "phaseIndex",
    "phaseTitle",
    "phases",
    "attempt",
    "runHandles",
    "outputFile",
    "agentPath",
    "timelineBypass",
    "typedUsage",
    "status",
    "error",
  ] as const) {
    if (payload[key] !== undefined) {
      fields[key] = payload[key];
    }
  }
  return fields;
}

export function runtimeEventToActivities(
  event: ProviderRuntimeEvent,
  taskTitle?: string,
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence = (() => {
    const eventWithSequence = event as ProviderRuntimeEvent & { sessionSequence?: number };
    return eventWithSequence.sessionSequence !== undefined
      ? { sequence: eventWithSequence.sessionSequence }
      : {};
  })();
  switch (event.type) {
    case "request.opened": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.requested",
          summary:
            requestKind === "command"
              ? "Command approval requested"
              : requestKind === "file-read"
                ? "File-read approval requested"
                : requestKind === "file-change"
                  ? "File-change approval requested"
                  : "Approval requested",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.detail ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "request.resolved": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.resolved",
          summary: "Approval resolved",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.decision ? { decision: event.payload.decision } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "runtime.error",
          summary: "Runtime error",
          payload: {
            message: truncateDetail(event.payload.message),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.denied": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "tool.denied",
          summary: `Tool denied: ${event.payload.toolName}`,
          payload: {
            toolName: event.payload.toolName,
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.reason ? { detail: truncateDetail(event.payload.reason) } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.warning": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          // Use the adapter-supplied message as the row label so the work log
          // shows what the warning was about, not a generic "Runtime warning".
          summary: truncateDetail(event.payload.message, 120),
          payload: {
            message: truncateDetail(event.payload.message),
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.plan.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.plan.updated",
          summary: "Plan updated",
          payload: {
            plan: event.payload.plan,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.requested": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            questions: event.payload.questions,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.resolved": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.resolved",
          summary: "User input submitted",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            answers: event.payload.answers,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary:
            event.payload.taskType === "plan"
              ? "Plan task started"
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : "Task started",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
            ...taskLinkageActivityFields(event.payload as Record<string, unknown>),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.progress": {
      const linkage = taskLinkageActivityFields(event.payload as Record<string, unknown>);
      // Usage and activity are independent latest-state streams. Keeping them
      // under separate stable ids prevents a command/reasoning update from
      // replacing the last known token count (and prevents a usage-only tick
      // from blanking the last meaningful activity).
      const identityLinkage = { ...linkage };
      delete identityLinkage.typedUsage;
      delete identityLinkage.status;
      delete identityLinkage.error;
      const title =
        event.payload.description.trim().length > 0
          ? { title: truncateDetail(event.payload.description, 120) }
          : {};
      const hasProgressState =
        event.payload.typedUsage === undefined ||
        event.payload.summary !== undefined ||
        event.payload.lastToolName !== undefined ||
        event.payload.status !== undefined ||
        event.payload.error !== undefined;
      return [
        ...(hasProgressState
          ? [
              {
                // Stable per-task id: activity is "latest state", not
                // history, so each meaningful tick replaces the last. This
                // bounds a large fleet to one activity row per task.
                id: EventId.make(`task-progress:${event.threadId}:${event.payload.taskId}`),
                createdAt: event.createdAt,
                tone: "info" as const,
                kind: "task.progress" as const,
                summary:
                  event.payload.description.trim().length > 0
                    ? truncateDetail(event.payload.description, 120)
                    : "Reasoning update",
                payload: {
                  taskId: event.payload.taskId,
                  ...title,
                  detail: truncateDetail(event.payload.summary ?? event.payload.description),
                  ...(event.payload.summary
                    ? { summary: truncateDetail(event.payload.summary) }
                    : {}),
                  ...(event.payload.lastToolName
                    ? { lastToolName: event.payload.lastToolName }
                    : {}),
                  ...(event.payload.status ? { status: event.payload.status } : {}),
                  ...(event.payload.error ? { error: event.payload.error } : {}),
                  ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
                  ...identityLinkage,
                },
                turnId: toTurnId(event.turnId) ?? null,
                ...maybeSequence,
              },
            ]
          : []),
        ...(event.payload.typedUsage !== undefined
          ? [
              {
                id: EventId.make(`task-usage:${event.threadId}:${event.payload.taskId}`),
                createdAt: event.createdAt,
                tone: "info" as const,
                kind: "task.progress" as const,
                summary: "Task usage updated",
                payload: {
                  taskId: event.payload.taskId,
                  ...title,
                  ...identityLinkage,
                  usageSnapshot: true,
                  typedUsage: event.payload.typedUsage,
                },
                turnId: toTurnId(event.turnId) ?? null,
                ...maybeSequence,
              },
            ]
          : []),
      ];
    }

    case "task.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.updated",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status
                ? `Task ${event.payload.status}`
                : "Task updated",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
            ...(event.payload.endedAt ? { endedAt: event.payload.endedAt } : {}),
            ...(event.payload.isBackgrounded !== undefined
              ? { isBackgrounded: event.payload.isBackgrounded }
              : {}),
            ...taskLinkageActivityFields(event.payload as Record<string, unknown>),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.progress": {
      // Only agent-owned heartbeats are persisted: they feed the owning
      // agent's activity line. Parent-conversation tool progress stays
      // ephemeral (item lifecycle already covers it).
      if (event.payload.taskId === undefined) {
        return [];
      }
      return [
        {
          // Same stable-id treatment as task.progress: a heartbeat is
          // "what is this agent doing right now", so one row per task
          // (thread-scoped for the same global-PK collision reason).
          id: EventId.make(`tool-progress:${event.threadId}:${event.payload.taskId}`),
          createdAt: event.createdAt,
          tone: "info",
          kind: "tool.progress",
          summary: event.payload.toolName ?? "Tool progress",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.elapsedSeconds !== undefined
              ? { elapsedSeconds: event.payload.elapsedSeconds }
              : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.completed": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: {
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(taskTitle ? { title: truncateDetail(taskTitle, 120) } : {}),
            // summary + detail mirror task.progress: clients label the row from
            // summary and keep detail for the preview/expanded body.
            ...(event.payload.summary
              ? {
                  summary: truncateDetail(event.payload.summary),
                  detail: truncateDetail(event.payload.summary),
                }
              : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
            ...taskLinkageActivityFields(event.payload as Record<string, unknown>),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.state.changed": {
      if (event.payload.state !== "compacted") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-compaction",
          summary: "Context compacted",
          payload: {
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.token-usage.updated": {
      const payload = buildContextWindowActivityPayload(event);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.updated",
          summary: event.payload.title ?? "Tool updated",
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.completed": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.completed",
          summary: event.payload.title ?? "Tool",
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.started": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.started",
          summary: `${event.payload.title ?? "Tool"} started`,
          payload: {
            itemType: event.payload.itemType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    default:
      break;
  }

  return [];
}

function itemLifecycleProgress(
  event: ProviderRuntimeEvent,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationSubagentProgress | undefined {
  if (
    event.type !== "item.started" &&
    event.type !== "item.updated" &&
    event.type !== "item.completed"
  ) {
    return undefined;
  }

  const activity = activities[0];
  if (activity) {
    const payload = asUnknownRecord(activity.payload);
    const detail = typeof payload.detail === "string" ? payload.detail : null;
    return {
      kind: activity.kind,
      summary: activity.summary,
      detail,
      createdAt: event.createdAt,
    };
  }

  const lifecycle = event.type.slice("item.".length);
  const generic = (() => {
    switch (event.payload.itemType) {
      case "assistant_message":
        return lifecycle === "completed" ? "Response completed" : "Writing response";
      case "reasoning":
        return "Thinking";
      case "plan":
        return lifecycle === "completed" ? "Plan completed" : "Planning";
      case "user_message":
        return undefined;
      default:
        return event.payload.title;
    }
  })();
  if (!generic) return undefined;

  return {
    kind: `item.${event.payload.itemType}.${lifecycle}`,
    summary: generic,
    detail: event.payload.detail ? truncateDetail(event.payload.detail) : null,
    createdAt: event.createdAt,
  };
}

function mirrorsInteractionToRoot(event: ProviderRuntimeEvent): boolean {
  return (
    event.type === "request.opened" ||
    event.type === "request.resolved" ||
    event.type === "user-input.requested" ||
    event.type === "user-input.resolved"
  );
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function enrichActivityWithRuntimeContext(
  event: ProviderRuntimeEvent,
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const payload = asUnknownRecord(activity.payload);
  return {
    ...activity,
    payload: {
      ...payload,
      eventId: event.eventId,
      provider: event.provider,
      providerInstanceId: event.providerInstanceId ?? null,
      subagentId: event.subagentId ?? null,
      itemId: event.itemId ?? null,
      requestId: event.requestId ?? null,
      providerRefs: event.providerRefs ?? null,
      canonicalPayload: payload.canonicalPayload ?? event.payload,
    },
  };
}

function contentStreamKey(event: ContentDeltaRuntimeEvent, threadId: ThreadId): string {
  return [
    providerTargetKey(threadId, event.subagentId),
    event.turnId ?? "no-turn",
    event.itemId ?? "no-item",
    event.payload.streamKind,
    event.payload.contentIndex ?? "no-content-index",
    event.payload.summaryIndex ?? "no-summary-index",
  ].join(":");
}

function contentStreamActivityKind(
  streamKind: ContentDeltaRuntimeEvent["payload"]["streamKind"],
): string {
  switch (streamKind) {
    case "reasoning_text":
      return "reasoning.text";
    case "reasoning_summary_text":
      return "reasoning.summary";
    case "plan_text":
      return "stream.plan";
    case "command_output":
      return "stream.command-output";
    case "file_change_output":
      return "stream.file-change-output";
    case "unknown":
      return "stream.unknown";
    case "assistant_text":
      return "stream.assistant";
  }
}

function contentStreamActivitySummary(
  streamKind: ContentDeltaRuntimeEvent["payload"]["streamKind"],
): string {
  switch (streamKind) {
    case "reasoning_text":
      return "Thinking";
    case "reasoning_summary_text":
      return "Thinking summary";
    case "plan_text":
      return "Plan output";
    case "command_output":
      return "Command output";
    case "file_change_output":
      return "File-change output";
    case "unknown":
      return "Provider output";
    case "assistant_text":
      return "Assistant output";
  }
}

function safeContentStreamSplitIndex(value: string, requestedIndex: number): number {
  if (requestedIndex <= 0 || requestedIndex >= value.length) return requestedIndex;
  const before = value.charCodeAt(requestedIndex - 1);
  const after = value.charCodeAt(requestedIndex);
  const splitsSurrogatePair =
    before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return splitsSurrogatePair ? requestedIndex - 1 : requestedIndex;
}

const make = Effect.gen(function* () {
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const threadPlanProgress = yield* ThreadPlanProgressService;
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const serverSettingsService = yield* ServerSettingsService;
  const turnAbortCoordinator = yield* TurnAbortCoordinator;
  const providerCommandId = (event: ProviderCommandSource, tag: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`provider:${event.eventId}:${tag}:${uuid}`)),
    );

  const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () => Effect.succeed(new Set<MessageId>()),
  });

  const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
    capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
    lookup: () => Effect.succeed(""),
  });

  const assistantSegmentStateByTurnKey = yield* Cache.make<string, AssistantSegmentState>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () =>
      Effect.die(
        new Error("assistant segment state should be read through getOption before initialization"),
      ),
  });

  const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>({
    capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
    lookup: () => Effect.succeed({ text: "", createdAt: "" }),
  });

  // Task names arrive on task.started/task.progress but not on task.completed,
  // so remember them per task to title the completion activity.
  const taskDescriptionByTaskKey = yield* Cache.make<string, string>({
    capacity: TASK_DESCRIPTION_BY_TASK_CACHE_CAPACITY,
    timeToLive: TASK_DESCRIPTION_BY_TASK_TTL,
    lookup: () => Effect.succeed(""),
  });

  const rememberTaskDescription = (threadId: ThreadId, taskId: string, description: string) =>
    Cache.set(taskDescriptionByTaskKey, providerTaskKey(threadId, taskId), description);

  // Entries are left in place after completion so replayed or duplicate
  // terminal events stay titled; TTL, capacity, and the session-exit sweep
  // bound the cache.
  const lookupTaskDescription = (threadId: ThreadId, taskId: string) =>
    Cache.getOption(taskDescriptionByTaskKey, providerTaskKey(threadId, taskId)).pipe(
      Effect.map((description) =>
        Option.filter(description, (value) => value.length > 0).pipe(Option.getOrUndefined),
      ),
    );

  const bufferedContentStreams = new Map<string, BufferedContentStream>();

  const persistContentStreamSegment = Effect.fn("persistContentStreamSegment")(function* (input: {
    readonly stream: BufferedContentStream;
    readonly text: string;
    readonly complete: boolean;
    readonly flushReason: string;
  }) {
    if (input.text.length === 0) return;
    const eventWithSequence = input.stream.lastEvent as ProviderRuntimeEvent & {
      readonly sessionSequence?: number;
    };
    const canonicalPayload = {
      streamKind: input.stream.streamKind,
      contentIndex: input.stream.contentIndex,
      summaryIndex: input.stream.summaryIndex,
      text: input.text,
      segmentIndex: input.stream.segmentIndex,
      complete: input.complete,
      flushReason: input.flushReason,
    };
    const activity = enrichActivityWithRuntimeContext(input.stream.lastEvent, {
      id: scopedActivityId(
        input.stream.threadId,
        input.stream.subagentId,
        EventId.make(
          `content-stream:${input.stream.firstEventId}:segment:${input.stream.segmentIndex}`,
        ),
      ),
      createdAt: input.stream.firstCreatedAt,
      tone: "info",
      kind: contentStreamActivityKind(input.stream.streamKind),
      summary: contentStreamActivitySummary(input.stream.streamKind),
      payload: {
        streamKind: input.stream.streamKind,
        contentIndex: input.stream.contentIndex,
        summaryIndex: input.stream.summaryIndex,
        text: input.text,
        segmentIndex: input.stream.segmentIndex,
        complete: input.complete,
        flushReason: input.flushReason,
        firstEventId: input.stream.firstEventId,
        lastEventId: input.stream.lastEvent.eventId,
        canonicalPayload,
      },
      turnId: input.stream.turnId,
      ...(eventWithSequence.sessionSequence !== undefined
        ? { sequence: eventWithSequence.sessionSequence }
        : {}),
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: yield* providerCommandId(input.stream.lastEvent, "content-stream-append"),
      threadId: input.stream.threadId,
      ...(input.stream.subagentId !== undefined ? { subagentId: input.stream.subagentId } : {}),
      activity,
      createdAt: activity.createdAt,
    });
  });

  const spillOldestContentStream = Effect.fn("spillOldestContentStream")(function* () {
    const oldest = bufferedContentStreams.entries().next().value as
      | readonly [string, BufferedContentStream]
      | undefined;
    if (!oldest) return;
    const [key, stream] = oldest;
    yield* persistContentStreamSegment({
      stream,
      text: stream.text,
      complete: false,
      flushReason: "buffer-capacity",
    });
    bufferedContentStreams.delete(key);
  });

  const appendContentStreamDelta = Effect.fn("appendContentStreamDelta")(function* (
    event: ContentDeltaRuntimeEvent,
    threadId: ThreadId,
  ) {
    if (event.payload.streamKind === "assistant_text" || event.payload.delta.length === 0) return;
    const key = contentStreamKey(event, threadId);
    let stream = bufferedContentStreams.get(key);
    if (!stream) {
      if (bufferedContentStreams.size >= MAX_BUFFERED_CONTENT_STREAMS) {
        yield* spillOldestContentStream();
      }
      stream = {
        key,
        threadId,
        subagentId: event.subagentId,
        turnId: toTurnId(event.turnId) ?? null,
        itemId: event.itemId ?? null,
        streamKind: event.payload.streamKind,
        contentIndex: event.payload.contentIndex ?? null,
        summaryIndex: event.payload.summaryIndex ?? null,
        firstEventId: event.eventId,
        firstCreatedAt: event.createdAt,
        segmentIndex: 0,
        text: "",
        lastEvent: event,
      };
      bufferedContentStreams.set(key, stream);
    }
    stream.text += event.payload.delta;
    stream.lastEvent = event;

    while (stream.text.length >= MAX_BUFFERED_CONTENT_STREAM_CHARS) {
      const splitIndex = safeContentStreamSplitIndex(
        stream.text,
        MAX_BUFFERED_CONTENT_STREAM_CHARS,
      );
      const segment = stream.text.slice(0, splitIndex);
      yield* persistContentStreamSegment({
        stream,
        text: segment,
        complete: false,
        flushReason: "spill",
      });
      stream.text = stream.text.slice(splitIndex);
      stream.segmentIndex += 1;
    }
  });

  const flushContentStreams = Effect.fn("flushContentStreams")(function* (
    event: ProviderRuntimeEvent,
    threadId: ThreadId,
  ) {
    const eventTurnId = toTurnId(event.turnId) ?? null;
    const eventItemId = event.itemId ?? null;
    const shouldFlush = (stream: BufferedContentStream): boolean => {
      if (stream.threadId !== threadId) return false;
      if (stream.subagentId !== event.subagentId) return false;
      switch (event.type) {
        case "item.completed":
          return eventItemId !== null && stream.itemId === eventItemId;
        case "turn.completed":
        case "turn.aborted":
          return eventTurnId === null || stream.turnId === eventTurnId;
        case "runtime.error":
          return eventTurnId === null || stream.turnId === eventTurnId;
        case "session.exited":
          return true;
        default:
          return false;
      }
    };

    for (const [key, stream] of bufferedContentStreams.entries()) {
      if (!shouldFlush(stream)) continue;
      stream.lastEvent = event;
      yield* persistContentStreamSegment({
        stream,
        text: stream.text,
        complete: true,
        flushReason: event.type,
      });
      bufferedContentStreams.delete(key);
    }
  });

  const resolveThreadDetail = Effect.fn("resolveThreadDetail")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const resolveThreadShell = Effect.fn("resolveThreadShell")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const rememberAssistantMessageId = (
    threadId: ThreadId,
    turnId: TurnId,
    messageId: MessageId,
    subagentId?: SubagentId,
  ) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId, subagentId)).pipe(
      Effect.flatMap((existingIds) =>
        Cache.set(
          turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId, subagentId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: (ids) => {
              const nextIds = new Set(ids);
              nextIds.add(messageId);
              return nextIds;
            },
          }),
        ),
      ),
    );

  const forgetAssistantMessageId = (
    threadId: ThreadId,
    turnId: TurnId,
    messageId: MessageId,
    subagentId?: SubagentId,
  ) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId, subagentId)).pipe(
      Effect.flatMap((existingIds) =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: (ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(messageId);
            if (nextIds.size === 0) {
              return Cache.invalidate(
                turnMessageIdsByTurnKey,
                providerTurnKey(threadId, turnId, subagentId),
              );
            }
            return Cache.set(
              turnMessageIdsByTurnKey,
              providerTurnKey(threadId, turnId, subagentId),
              nextIds,
            );
          },
        }),
      ),
    );

  const getAssistantMessageIdsForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    subagentId?: SubagentId,
  ) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId, subagentId)).pipe(
      Effect.map((existingIds) =>
        Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>()),
      ),
    );

  const clearAssistantMessageIdsForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    subagentId?: SubagentId,
  ) => Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId, subagentId));

  const getAssistantSegmentStateForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    subagentId?: SubagentId,
  ) =>
    Cache.getOption(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId, subagentId));

  const setAssistantSegmentStateForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    state: AssistantSegmentState,
    subagentId?: SubagentId,
  ) =>
    Cache.set(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId, subagentId), state);

  const clearAssistantSegmentStateForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    subagentId?: SubagentId,
  ) =>
    Cache.invalidate(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId, subagentId));

  const getActiveAssistantMessageIdForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    subagentId?: SubagentId,
  ) =>
    getAssistantSegmentStateForTurn(threadId, turnId, subagentId).pipe(
      Effect.map((state) =>
        Option.flatMap(state, (entry) =>
          entry.activeMessageId ? Option.some(entry.activeMessageId) : Option.none(),
        ),
      ),
    );

  const startAssistantSegmentForTurn = (input: {
    threadId: ThreadId;
    turnId: TurnId;
    baseKey: string;
    subagentId?: SubagentId;
  }) =>
    getAssistantSegmentStateForTurn(input.threadId, input.turnId, input.subagentId).pipe(
      Effect.flatMap((existingState) =>
        Effect.gen(function* () {
          const nextState = Option.match(existingState, {
            onNone: () => ({
              baseKey: input.baseKey,
              nextSegmentIndex: 1,
              activeMessageId: assistantSegmentMessageId(input.baseKey, 0),
            }),
            onSome: (state) => {
              const segmentIndex = state.baseKey === input.baseKey ? state.nextSegmentIndex : 0;
              const messageId = assistantSegmentMessageId(input.baseKey, segmentIndex);
              return {
                baseKey: input.baseKey,
                nextSegmentIndex: state.baseKey === input.baseKey ? state.nextSegmentIndex + 1 : 1,
                activeMessageId: messageId,
              } satisfies AssistantSegmentState;
            },
          });
          yield* setAssistantSegmentStateForTurn(
            input.threadId,
            input.turnId,
            nextState,
            input.subagentId,
          );
          return nextState.activeMessageId!;
        }),
      ),
    );

  const getOrCreateAssistantMessageId = (input: {
    threadId: ThreadId;
    event: ProviderRuntimeEvent;
    turnId?: TurnId;
  }) =>
    Effect.gen(function* () {
      if (!input.turnId) {
        return assistantSegmentMessageId(assistantSegmentBaseKeyFromEvent(input.event), 0);
      }

      const activeMessageId = yield* getActiveAssistantMessageIdForTurn(
        input.threadId,
        input.turnId,
        input.event.subagentId,
      );
      if (Option.isSome(activeMessageId)) {
        return activeMessageId.value;
      }

      return yield* startAssistantSegmentForTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        baseKey: assistantSegmentBaseKeyFromEvent(input.event),
        ...(input.event.subagentId !== undefined ? { subagentId: input.event.subagentId } : {}),
      });
    });

  const appendBufferedAssistantText = (messageId: MessageId, delta: string) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Effect.gen(function* () {
          const nextText = Option.match(existingText, {
            onNone: () => delta,
            onSome: (text) => `${text}${delta}`,
          });
          if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
            yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText);
            return "";
          }

          // Safety valve: flush full buffered text as an assistant delta to cap memory.
          yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
          return nextText;
        }),
      ),
    );

  const takeBufferedAssistantText = (messageId: MessageId) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.getOrElse(existingText, () => "")),
        ),
      ),
    );

  const clearBufferedAssistantText = (messageId: MessageId) =>
    Cache.invalidate(bufferedAssistantTextByMessageId, messageId);

  const appendBufferedProposedPlan = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        return Cache.set(bufferedProposedPlanById, planId, {
          text: `${existing?.text ?? ""}${delta}`,
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        });
      }),
    );

  const takeBufferedProposedPlan = (planId: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) =>
        Cache.invalidate(bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(existingEntry)),
        ),
      ),
    );

  const clearBufferedProposedPlan = (planId: string) =>
    Cache.invalidate(bufferedProposedPlanById, planId);

  const clearAssistantMessageState = (messageId: MessageId) =>
    clearBufferedAssistantText(messageId);

  const flushBufferedAssistantMessage = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    subagentId?: SubagentId;
    messageId: MessageId;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      if (!hasRenderableAssistantText(bufferedText)) {
        return false;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: yield* providerCommandId(input.event, input.commandTag),
        threadId: input.threadId,
        ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
        messageId: input.messageId,
        delta: bufferedText,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        createdAt: input.createdAt,
      });
      return true;
    });

  const flushBufferedAssistantMessagesForTurn = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    subagentId?: SubagentId;
    turnId: TurnId;
    createdAt: string;
    commandTag: string;
  }) =>
    Effect.gen(function* () {
      const assistantMessageIds = yield* getAssistantMessageIdsForTurn(
        input.threadId,
        input.turnId,
        input.subagentId,
      );
      const flushedMessageIds = new Set<MessageId>();
      yield* Effect.forEach(
        assistantMessageIds,
        (messageId) =>
          flushBufferedAssistantMessage({
            event: input.event,
            threadId: input.threadId,
            ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
            messageId,
            turnId: input.turnId,
            createdAt: input.createdAt,
            commandTag: input.commandTag,
          }).pipe(
            Effect.tap((flushed) =>
              flushed ? Effect.sync(() => flushedMessageIds.add(messageId)) : Effect.void,
            ),
          ),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      return flushedMessageIds;
    });

  const finalizeAssistantMessage = (input: {
    event: ProviderCommandSource;
    threadId: ThreadId;
    subagentId?: SubagentId;
    messageId: MessageId;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    fallbackText?: string;
    hasProjectedMessage?: boolean;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      const text =
        bufferedText.length > 0
          ? bufferedText
          : (input.fallbackText?.trim().length ?? 0) > 0
            ? input.fallbackText!
            : "";
      const hasRenderableText = hasRenderableAssistantText(text);

      if (hasRenderableText) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: yield* providerCommandId(input.event, input.finalDeltaCommandTag),
          threadId: input.threadId,
          ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
          messageId: input.messageId,
          delta: text,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }

      if (input.hasProjectedMessage || hasRenderableText) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: yield* providerCommandId(input.event, input.commandTag),
          threadId: input.threadId,
          ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
          messageId: input.messageId,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }
      yield* clearAssistantMessageState(input.messageId);
    });

  const finalizeActiveAssistantSegmentForTurn = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    subagentId?: SubagentId;
    turnId: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    hasProjectedMessage: boolean;
    flushedMessageIds?: ReadonlySet<MessageId>;
  }) =>
    Effect.gen(function* () {
      const activeMessageId = yield* getActiveAssistantMessageIdForTurn(
        input.threadId,
        input.turnId,
        input.subagentId,
      );
      if (Option.isNone(activeMessageId)) {
        return;
      }

      yield* finalizeAssistantMessage({
        event: input.event,
        threadId: input.threadId,
        ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
        messageId: activeMessageId.value,
        turnId: input.turnId,
        createdAt: input.createdAt,
        commandTag: input.commandTag,
        finalDeltaCommandTag: input.finalDeltaCommandTag,
        hasProjectedMessage:
          input.hasProjectedMessage ||
          (input.flushedMessageIds?.has(activeMessageId.value) ?? false),
      });
      yield* forgetAssistantMessageId(
        input.threadId,
        input.turnId,
        activeMessageId.value,
        input.subagentId,
      );

      const state = yield* getAssistantSegmentStateForTurn(
        input.threadId,
        input.turnId,
        input.subagentId,
      );
      if (Option.isSome(state)) {
        yield* setAssistantSegmentStateForTurn(
          input.threadId,
          input.turnId,
          {
            ...state.value,
            activeMessageId: null,
          },
          input.subagentId,
        );
      }
    });

  const upsertProposedPlan = (input: {
    event: ProviderCommandSource;
    threadId: ThreadId;
    subagentId?: SubagentId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    planMarkdown: string | undefined;
    createdAt: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown);
      if (!planMarkdown) {
        return;
      }

      const existingPlan = findProposedPlanById(input.threadProposedPlans, input.planId);
      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: yield* providerCommandId(input.event, "proposed-plan-upsert"),
        threadId: input.threadId,
        ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
        proposedPlan: {
          id: input.planId,
          turnId: input.turnId ?? null,
          planMarkdown,
          implementedAt: existingPlan?.implementedAt ?? null,
          implementationThreadId: existingPlan?.implementationThreadId ?? null,
          createdAt: existingPlan?.createdAt ?? input.createdAt,
          updatedAt: input.updatedAt,
        },
        createdAt: input.updatedAt,
      });
    });

  const finalizeBufferedProposedPlan = (input: {
    event: ProviderCommandSource;
    threadId: ThreadId;
    subagentId?: SubagentId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    fallbackMarkdown?: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const bufferedPlan = yield* takeBufferedProposedPlan(input.planId);
      const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text);
      const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown);
      const planMarkdown = bufferedMarkdown ?? fallbackMarkdown;
      if (!planMarkdown) {
        return;
      }

      yield* upsertProposedPlan({
        event: input.event,
        threadId: input.threadId,
        ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
        threadProposedPlans: input.threadProposedPlans,
        planId: input.planId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        planMarkdown,
        createdAt:
          bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
            ? bufferedPlan.createdAt
            : input.updatedAt,
        updatedAt: input.updatedAt,
      });
      yield* clearBufferedProposedPlan(input.planId);
    });

  const flushContentStreamsForAbortSettlement = Effect.fn(
    "ProviderRuntimeIngestion.flushContentStreamsForAbortSettlement",
  )(function* (input: { readonly threadId: ThreadId; readonly turnId: TurnId }) {
    for (const [key, stream] of bufferedContentStreams.entries()) {
      if (
        stream.threadId !== input.threadId ||
        stream.subagentId !== undefined ||
        (stream.turnId !== null && stream.turnId !== input.turnId)
      ) {
        continue;
      }
      yield* persistContentStreamSegment({
        stream,
        text: stream.text,
        complete: true,
        flushReason: "thread.turn-abort-settled",
      });
      bufferedContentStreams.delete(key);
    }
  });

  const finalizeBufferedTurnContent = Effect.fn(
    "ProviderRuntimeIngestion.finalizeBufferedTurnContent",
  )(function* (input: {
    readonly event: ProviderCommandSource;
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly subagentId?: SubagentId;
    readonly settledAt: string;
  }) {
    const detailedThread = yield* resolveThreadDetail(input.threadId);
    const messages = input.subagentId === undefined ? (detailedThread?.messages ?? []) : [];
    const proposedPlans =
      input.subagentId === undefined ? (detailedThread?.proposedPlans ?? []) : [];
    const assistantMessageIds = yield* getAssistantMessageIdsForTurn(
      input.threadId,
      input.turnId,
      input.subagentId,
    );

    yield* Effect.forEach(
      assistantMessageIds,
      (assistantMessageId) =>
        finalizeAssistantMessage({
          event: input.event,
          threadId: input.threadId,
          ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
          messageId: assistantMessageId,
          turnId: input.turnId,
          createdAt: input.settledAt,
          commandTag: "assistant-complete-finalize",
          finalDeltaCommandTag: "assistant-delta-finalize-fallback",
          hasProjectedMessage:
            input.subagentId !== undefined ||
            findMessageById(messages, assistantMessageId) !== undefined,
        }),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
    yield* clearAssistantMessageIdsForTurn(input.threadId, input.turnId, input.subagentId);
    yield* clearAssistantSegmentStateForTurn(input.threadId, input.turnId, input.subagentId);

    yield* finalizeBufferedProposedPlan({
      event: input.event,
      threadId: input.threadId,
      ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
      threadProposedPlans: proposedPlans,
      planId: proposedPlanIdForTurn(input.threadId, input.turnId, input.subagentId),
      turnId: input.turnId,
      updatedAt: input.settledAt,
    });
    if (input.subagentId === undefined) {
      yield* flushContentStreamsForAbortSettlement({
        threadId: input.threadId,
        turnId: input.turnId,
      });
    }
  });

  const clearTurnStateForSession = (threadId: ThreadId, subagentId?: SubagentId) =>
    Effect.gen(function* () {
      const prefix =
        subagentId === undefined ? `${threadId}:` : `${providerTargetKey(threadId, subagentId)}:`;
      const proposedPlanPrefix =
        subagentId === undefined
          ? `plan:${threadId}:`
          : `plan:${providerTargetKey(threadId, subagentId)}:`;
      const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
      const assistantSegmentKeys = Array.from(yield* Cache.keys(assistantSegmentStateByTurnKey));
      const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
      const taskDescriptionKeys = Array.from(yield* Cache.keys(taskDescriptionByTaskKey));
      yield* Effect.forEach(
        turnKeys,
        (key) =>
          Effect.gen(function* () {
            if (!key.startsWith(prefix)) {
              return;
            }

            const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
            if (Option.isSome(messageIds)) {
              yield* Effect.forEach(messageIds.value, clearAssistantMessageState, {
                concurrency: 1,
              }).pipe(Effect.asVoid);
            }

            yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        assistantSegmentKeys,
        (key) =>
          key.startsWith(prefix)
            ? Cache.invalidate(assistantSegmentStateByTurnKey, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        proposedPlanKeys,
        (key) =>
          key.startsWith(proposedPlanPrefix)
            ? Cache.invalidate(bufferedProposedPlanById, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        taskDescriptionKeys,
        (key) =>
          key.startsWith(prefix) ? Cache.invalidate(taskDescriptionByTaskKey, key) : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    });

  const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fn(
    "getSourceProposedPlanReferenceForPendingTurnStart",
  )(function* (threadId: ThreadId) {
    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    });
    if (Option.isNone(pendingTurnStart)) {
      return null;
    }

    const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId;
    const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId;
    if (sourceThreadId === null || sourcePlanId === null) {
      return null;
    }

    return {
      sourceThreadId,
      sourcePlanId,
    } as const;
  });

  const getExpectedProviderTurnIdForThread = Effect.fn("getExpectedProviderTurnIdForThread")(
    function* (threadId: ThreadId) {
      const sessions = yield* providerService.listSessions();
      const session = sessions.find((entry) => entry.threadId === threadId);
      return session?.activeTurnId;
    },
  );

  const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fn(
    "getSourceProposedPlanReferenceForAcceptedTurnStart",
  )(function* (threadId: ThreadId, eventTurnId: TurnId | undefined) {
    if (eventTurnId === undefined) {
      return null;
    }

    const expectedTurnId = yield* getExpectedProviderTurnIdForThread(threadId);
    if (!sameId(expectedTurnId, eventTurnId)) {
      return null;
    }

    return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
  });

  const markSourceProposedPlanImplemented = Effect.fn("markSourceProposedPlanImplemented")(
    function* (
      sourceThreadId: ThreadId,
      sourcePlanId: OrchestrationProposedPlanId,
      implementationThreadId: ThreadId,
      implementedAt: string,
    ) {
      const sourceThread = yield* resolveThreadDetail(sourceThreadId);
      const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
      if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) {
        return;
      }

      const commandUuid = yield* crypto.randomUUIDv4;
      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: CommandId.make(
          `provider:source-proposed-plan-implemented:${implementationThreadId}:${commandUuid}`,
        ),
        threadId: sourceThread.id,
        proposedPlan: {
          ...sourcePlan,
          implementedAt,
          implementationThreadId,
          updatedAt: implementedAt,
        },
        createdAt: implementedAt,
      });
    },
  );

  const processRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      const thread = yield* resolveThreadShell(event.threadId);
      if (!thread) return;

      const projectedRuntimeSessionId = thread.session?.runtimeSessionId ?? null;
      if (
        projectedRuntimeSessionId !== null &&
        event.runtimeSessionId !== projectedRuntimeSessionId
      ) {
        return;
      }
      const mayAdoptRuntimeGeneration =
        thread.session === null ||
        thread.session.status === "starting" ||
        event.type === "session.started" ||
        event.type === "thread.started";
      if (
        projectedRuntimeSessionId === null &&
        event.runtimeSessionId !== undefined &&
        !mayAdoptRuntimeGeneration
      ) {
        return;
      }
      const runtimeSessionId = projectedRuntimeSessionId ?? event.runtimeSessionId ?? null;

      let loadedThreadDetail: OrchestrationThread | null | undefined;
      const getLoadedThreadDetail = () =>
        Effect.gen(function* () {
          if (loadedThreadDetail !== undefined) {
            return loadedThreadDetail;
          }
          loadedThreadDetail = (yield* resolveThreadDetail(thread.id)) ?? null;
          return loadedThreadDetail;
        });

      const now = event.createdAt;
      const eventTurnId = toTurnId(event.turnId);
      const activeTurnId = thread.session?.activeTurnId ?? null;
      const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
        threadId: thread.id,
      });
      const hasPendingTurnStart =
        Option.isSome(pendingTurnStart) && thread.session?.status === "starting";

      const eventSubagentId =
        event.type === "subagent.discovered" || event.type === "subagent.state.changed"
          ? event.payload.subagentId
          : event.subagentId;

      const ensureSubagentSummary = Effect.fn("ensureSubagentSummary")(function* (
        subagentId: SubagentId,
      ) {
        const detailedThread = yield* getLoadedThreadDetail();
        const existing = detailedThread?.subagents.find((entry) => entry.id === subagentId);
        if (existing) return existing;

        const placeholder = placeholderSubagentSummary(event, subagentId);
        yield* orchestrationEngine.dispatch({
          type: "thread.subagent.upsert",
          commandId: yield* providerCommandId(event, "subagent-placeholder-upsert"),
          threadId: thread.id,
          subagent: placeholder,
          createdAt: now,
        });
        return placeholder;
      });

      if (event.type === "subagent.discovered") {
        const detailedThread = yield* getLoadedThreadDetail();
        const existing = detailedThread?.subagents.find(
          (entry) => entry.id === event.payload.subagentId,
        );
        yield* orchestrationEngine.dispatch({
          type: "thread.subagent.upsert",
          commandId: yield* providerCommandId(event, "subagent-discovered-upsert"),
          threadId: thread.id,
          subagent: discoveredSubagentSummary(event, existing),
          createdAt: now,
        });
        return;
      }

      if (event.type === "subagent.state.changed") {
        yield* ensureSubagentSummary(event.payload.subagentId);
        yield* orchestrationEngine.dispatch({
          type: "thread.subagent.state.set",
          commandId: yield* providerCommandId(event, "subagent-state-set"),
          threadId: thread.id,
          subagentId: event.payload.subagentId,
          status: event.payload.state,
          statusMessage: event.payload.statusMessage ?? null,
          updatedAt: now,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.subagent.progress.set",
          commandId: yield* providerCommandId(event, "subagent-state-progress-set"),
          threadId: thread.id,
          subagentId: event.payload.subagentId,
          progress: subagentStateProgress(
            event.payload.state,
            event.createdAt,
            event.payload.statusMessage,
          ),
          updatedAt: now,
        });
        return;
      }

      if (eventSubagentId !== undefined) {
        const subagent = yield* ensureSubagentSummary(eventSubagentId);
        if (
          eventTurnId !== undefined &&
          (event.type === "turn.started" ||
            event.type === "turn.completed" ||
            event.type === "turn.aborted")
        ) {
          const previousTurn =
            subagent.latestTurn?.turnId === eventTurnId ? subagent.latestTurn : null;
          const state =
            event.type === "turn.started"
              ? "running"
              : event.type === "turn.aborted"
                ? "interrupted"
                : normalizeRuntimeTurnState(event.payload.state) === "failed"
                  ? "error"
                  : normalizeRuntimeTurnState(event.payload.state) === "completed"
                    ? "completed"
                    : "interrupted";
          yield* orchestrationEngine.dispatch({
            type: "thread.subagent.upsert",
            commandId: yield* providerCommandId(event, "subagent-latest-turn-upsert"),
            threadId: thread.id,
            subagent: {
              ...subagent,
              status: state,
              statusMessage: null,
              latestProgress: subagentStateProgress(state, now),
              latestTurn: {
                turnId: eventTurnId,
                state,
                requestedAt: previousTurn?.requestedAt ?? now,
                startedAt: event.type === "turn.started" ? now : (previousTurn?.startedAt ?? null),
                completedAt: event.type === "turn.started" ? null : now,
                assistantMessageId: previousTurn?.assistantMessageId ?? null,
                ...(previousTurn?.sourceProposedPlan !== undefined
                  ? { sourceProposedPlan: previousTurn.sourceProposedPlan }
                  : {}),
              },
              updatedAt: subagent.updatedAt.localeCompare(now) > 0 ? subagent.updatedAt : now,
              completedAt: event.type === "turn.started" ? null : now,
            },
            createdAt: now,
          });
        }
      }

      const conflictsWithActiveTurn =
        activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId);
      const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined;

      // A turn.started that conflicts with the active turn is legitimate when
      // the server itself has a turn start pending for this thread AND the
      // provider session already tracks the event's turn as its active turn:
      // steering a running turn makes some providers (e.g. opencode) open a
      // new turn without ever completing the superseded one. A stale
      // turn.started for some other turn id still gets rejected.
      const conflictingTurnStartIsPendingTurnStart =
        eventSubagentId === undefined && event.type === "turn.started" && conflictsWithActiveTurn
          ? sameId(yield* getExpectedProviderTurnIdForThread(thread.id), eventTurnId) &&
            Option.isSome(pendingTurnStart)
          : false;

      const shouldApplyThreadLifecycle = (() => {
        if (eventSubagentId !== undefined) {
          return false;
        }
        if (!STRICT_PROVIDER_LIFECYCLE_GUARD) {
          return true;
        }
        switch (event.type) {
          case "session.exited":
            return true;
          case "session.started":
          case "thread.started":
            return true;
          case "turn.started":
            return !conflictsWithActiveTurn || conflictingTurnStartIsPendingTurnStart;
          case "turn.completed":
            if (conflictsWithActiveTurn || missingTurnForActiveTurn) {
              return false;
            }
            // Only the active turn may close the lifecycle state.
            if (activeTurnId !== null && eventTurnId !== undefined) {
              return sameId(activeTurnId, eventTurnId);
            }
            // No active turn tracked: accept only completions that name their
            // turn (covers a real completion whose turn.started was lost). An
            // untargeted completion cannot prove it belongs to any turn this
            // thread ran — the known emitter was the Claude resume handshake
            // (system/init + result(num_turns: 0)), which is not a turn at
            // all — and applying it here stomps the "starting" lifecycle
            // state while a turn start is pending.
            return eventTurnId !== undefined;
          default:
            return true;
        }
      })();
      const abortState = thread.session?.abortState ?? null;
      const matchingAbortTerminal =
        shouldApplyThreadLifecycle &&
        abortState !== null &&
        event.runtimeSessionId === abortState.runtimeSessionId &&
        runtimeSessionId === abortState.runtimeSessionId &&
        (((event.type === "turn.completed" || event.type === "turn.aborted") &&
          eventTurnId !== undefined &&
          abortState.targetTurnId === eventTurnId) ||
          (event.type === "session.exited" &&
            (abortState.targetTurnId === null || abortState.targetTurnId === activeTurnId)));
      const acceptedTurnStartedSourcePlan =
        eventSubagentId === undefined && event.type === "turn.started" && shouldApplyThreadLifecycle
          ? yield* getSourceProposedPlanReferenceForAcceptedTurnStart(thread.id, eventTurnId)
          : null;

      if (event.type === "session.exited" && eventSubagentId === undefined) {
        const detailedThread = yield* getLoadedThreadDetail();
        yield* Effect.forEach(
          detailedThread?.subagents.filter((subagent) => isActiveSubagentStatus(subagent.status)) ??
            [],
          (subagent) => {
            const settled = settleSubagentAfterRuntimeLoss(subagent, now);
            return providerCommandId(event, "subagent-session-exit-upsert").pipe(
              Effect.flatMap((commandId) =>
                orchestrationEngine.dispatch({
                  type: "thread.subagent.upsert",
                  commandId,
                  threadId: thread.id,
                  subagent: settled,
                  createdAt: now,
                }),
              ),
            );
          },
          { concurrency: 1, discard: true },
        );
      }

      if (
        event.type === "session.started" ||
        event.type === "session.state.changed" ||
        event.type === "session.exited" ||
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        event.type === "turn.completed"
      ) {
        const status = (() => {
          switch (event.type) {
            case "session.state.changed": {
              const runtimeStatus = orchestrationSessionStatusFromRuntimeState(event.payload.state);
              return hasPendingTurnStart && runtimeStatus === "ready" ? "starting" : runtimeStatus;
            }
            case "turn.started":
              return "running";
            case "session.exited":
              return "stopped";
            case "turn.completed":
              return normalizeRuntimeTurnState(event.payload.state) === "failed"
                ? "error"
                : "ready";
            case "session.started":
            case "thread.started":
              // Provider thread/session start notifications can arrive during an
              // active or pending turn; preserve that lifecycle state.
              return activeTurnId !== null ? "running" : hasPendingTurnStart ? "starting" : "ready";
          }
        })();
        const nextActiveTurnId =
          event.type === "turn.started"
            ? (eventTurnId ?? null)
            : event.type === "turn.completed" || event.type === "session.exited"
              ? null
              : event.type === "session.state.changed" &&
                  !sessionStatusAllowsActiveTurn(
                    orchestrationSessionStatusFromRuntimeState(event.payload.state),
                  )
                ? null
                : activeTurnId;
        const lastError =
          event.type === "session.state.changed" && event.payload.state === "error"
            ? (event.payload.reason ?? thread.session?.lastError ?? "Provider session error")
            : event.type === "turn.completed" &&
                normalizeRuntimeTurnState(event.payload.state) === "failed"
              ? (event.payload.errorMessage ?? thread.session?.lastError ?? "Turn failed")
              : status === "ready"
                ? null
                : (thread.session?.lastError ?? null);

        if (shouldApplyThreadLifecycle && !matchingAbortTerminal) {
          if (event.type === "turn.started" && acceptedTurnStartedSourcePlan !== null) {
            yield* markSourceProposedPlanImplemented(
              acceptedTurnStartedSourcePlan.sourceThreadId,
              acceptedTurnStartedSourcePlan.sourcePlanId,
              thread.id,
              now,
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  "provider runtime ingestion failed to mark source proposed plan",
                  {
                    eventId: event.eventId,
                    eventType: event.type,
                    cause: Cause.pretty(cause),
                  },
                ),
              ),
            );
          }

          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: yield* providerCommandId(event, "thread-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status,
              providerName: event.provider,
              ...(event.providerInstanceId !== undefined
                ? { providerInstanceId: event.providerInstanceId }
                : {}),
              runtimeSessionId,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: nextActiveTurnId,
              abortState: thread.session?.abortState ?? null,
              lastError,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      const assistantDelta =
        event.type === "content.delta" && event.payload.streamKind === "assistant_text"
          ? event.payload.delta
          : undefined;
      const proposedPlanDelta =
        event.type === "turn.proposed.delta" ? event.payload.delta : undefined;

      if (event.type === "content.delta" && event.payload.streamKind !== "assistant_text") {
        yield* appendContentStreamDelta(event, thread.id);
      }

      if (assistantDelta && assistantDelta.length > 0) {
        const turnId = toTurnId(event.turnId);
        const assistantMessageId = yield* getOrCreateAssistantMessageId({
          threadId: thread.id,
          event,
          ...(turnId ? { turnId } : {}),
        });
        if (turnId) {
          yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId, eventSubagentId);
        }

        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableLegacyTokenStreaming ? "streaming" : "buffered"),
        );
        if (assistantDeliveryMode === "buffered") {
          const spillChunk = yield* appendBufferedAssistantText(assistantMessageId, assistantDelta);
          if (spillChunk.length > 0) {
            yield* orchestrationEngine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: yield* providerCommandId(event, "assistant-delta-buffer-spill"),
              threadId: thread.id,
              ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
              messageId: assistantMessageId,
              delta: spillChunk,
              ...(turnId ? { turnId } : {}),
              createdAt: now,
            });
          }
        } else {
          yield* orchestrationEngine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: yield* providerCommandId(event, "assistant-delta"),
            threadId: thread.id,
            ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
            messageId: assistantMessageId,
            delta: assistantDelta,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
          });
        }
      }

      const pauseForUserTurnId =
        event.type === "request.opened" || event.type === "user-input.requested"
          ? toTurnId(event.turnId)
          : undefined;
      if (pauseForUserTurnId) {
        const detailedThread = yield* getLoadedThreadDetail();
        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableLegacyTokenStreaming ? "streaming" : "buffered"),
        );
        const flushedMessageIds =
          assistantDeliveryMode === "buffered"
            ? yield* flushBufferedAssistantMessagesForTurn({
                event,
                threadId: thread.id,
                ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
                turnId: pauseForUserTurnId,
                createdAt: now,
                commandTag:
                  event.type === "request.opened"
                    ? "assistant-delta-flush-on-request-opened"
                    : "assistant-delta-flush-on-user-input-requested",
              })
            : new Set<MessageId>();
        yield* finalizeActiveAssistantSegmentForTurn({
          event,
          threadId: thread.id,
          ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
          turnId: pauseForUserTurnId,
          createdAt: now,
          commandTag:
            event.type === "request.opened"
              ? "assistant-complete-on-request-opened"
              : "assistant-complete-on-user-input-requested",
          finalDeltaCommandTag:
            event.type === "request.opened"
              ? "assistant-delta-finalize-on-request-opened"
              : "assistant-delta-finalize-on-user-input-requested",
          hasProjectedMessage:
            eventSubagentId !== undefined ||
            (detailedThread !== null &&
              hasAssistantMessageForTurn(detailedThread.messages, pauseForUserTurnId, {
                streamingOnly: true,
              })),
          flushedMessageIds,
        });
      }

      if (proposedPlanDelta && proposedPlanDelta.length > 0) {
        const planId = proposedPlanIdFromEvent(event, thread.id);
        yield* appendBufferedProposedPlan(planId, proposedPlanDelta, now);
      }

      const assistantCompletion =
        event.type === "item.completed" && event.payload.itemType === "assistant_message"
          ? {
              messageId: assistantSegmentMessageId(assistantSegmentBaseKeyFromEvent(event), 0),
              fallbackText: event.payload.detail,
            }
          : undefined;
      const proposedPlanCompletion =
        event.type === "turn.proposed.completed"
          ? {
              planId: proposedPlanIdFromEvent(event, thread.id),
              turnId: toTurnId(event.turnId),
              planMarkdown: event.payload.planMarkdown,
            }
          : undefined;

      if (assistantCompletion) {
        const detailedThread = yield* getLoadedThreadDetail();
        const messages = detailedThread?.messages ?? [];
        const turnId = toTurnId(event.turnId);
        const activeAssistantMessageId = turnId
          ? yield* getActiveAssistantMessageIdForTurn(thread.id, turnId, eventSubagentId)
          : Option.none<MessageId>();
        const hasAssistantMessagesForTurn =
          eventSubagentId === undefined && turnId !== undefined
            ? hasAssistantMessageForTurn(messages, turnId)
            : false;
        const assistantMessageId = Option.getOrElse(
          activeAssistantMessageId,
          () => assistantCompletion.messageId,
        );
        const existingAssistantMessage = findMessageById(messages, assistantMessageId);
        const shouldApplyFallbackCompletionText =
          !existingAssistantMessage || existingAssistantMessage.text.length === 0;

        const shouldSkipRedundantCompletion =
          Option.isNone(activeAssistantMessageId) &&
          turnId !== undefined &&
          hasAssistantMessagesForTurn &&
          (assistantCompletion.fallbackText?.trim().length ?? 0) === 0;

        if (!shouldSkipRedundantCompletion) {
          if (turnId && Option.isNone(activeAssistantMessageId)) {
            yield* rememberAssistantMessageId(
              thread.id,
              turnId,
              assistantMessageId,
              eventSubagentId,
            );
          }

          yield* finalizeAssistantMessage({
            event,
            threadId: thread.id,
            ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
            messageId: assistantMessageId,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
            commandTag: "assistant-complete",
            finalDeltaCommandTag: "assistant-delta-finalize",
            hasProjectedMessage:
              eventSubagentId !== undefined
                ? Option.isSome(activeAssistantMessageId)
                : existingAssistantMessage !== undefined,
            ...(assistantCompletion.fallbackText !== undefined && shouldApplyFallbackCompletionText
              ? { fallbackText: assistantCompletion.fallbackText }
              : {}),
          });

          if (turnId) {
            yield* forgetAssistantMessageId(thread.id, turnId, assistantMessageId, eventSubagentId);
          }
        }

        if (turnId) {
          yield* clearAssistantSegmentStateForTurn(thread.id, turnId, eventSubagentId);
        }
      }

      if (proposedPlanCompletion) {
        const detailedThread = yield* getLoadedThreadDetail();
        yield* finalizeBufferedProposedPlan({
          event,
          threadId: thread.id,
          ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
          threadProposedPlans: detailedThread?.proposedPlans ?? [],
          planId: proposedPlanCompletion.planId,
          ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
          fallbackMarkdown: proposedPlanCompletion.planMarkdown,
          updatedAt: now,
        });
      }

      if (
        event.type === "turn.completed" ||
        event.type === "turn.aborted" ||
        (event.type === "session.exited" && matchingAbortTerminal)
      ) {
        const turnId =
          event.type === "turn.completed" || event.type === "turn.aborted"
            ? toTurnId(event.turnId)
            : (abortState?.targetTurnId ?? activeTurnId ?? undefined);
        if (turnId) {
          yield* finalizeBufferedTurnContent({
            event,
            threadId: thread.id,
            ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
            turnId,
            settledAt: now,
          });
        }
      }

      if (matchingAbortTerminal && abortState !== null) {
        yield* turnAbortCoordinator.settleCooperative({
          threadId: thread.id,
          runtimeSessionId: abortState.runtimeSessionId,
          turnId: abortState.targetTurnId,
          settledAt: now,
        });
      }

      if (event.type === "session.exited") {
        yield* clearTurnStateForSession(thread.id, eventSubagentId);
      }

      if (event.type === "runtime.error" && eventSubagentId === undefined) {
        const runtimeErrorMessage = event.payload.message;

        const shouldApplyRuntimeError = !STRICT_PROVIDER_LIFECYCLE_GUARD
          ? true
          : activeTurnId === null || eventTurnId === undefined || sameId(activeTurnId, eventTurnId);

        if (shouldApplyRuntimeError) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: yield* providerCommandId(event, "runtime-error-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "error",
              providerName: event.provider,
              ...(event.providerInstanceId !== undefined
                ? { providerInstanceId: event.providerInstanceId }
                : {}),
              runtimeSessionId,
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: eventTurnId ?? null,
              abortState: thread.session?.abortState ?? null,
              lastError: runtimeErrorMessage,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      if (
        eventSubagentId === undefined &&
        event.type === "thread.metadata.updated" &&
        event.payload.name
      ) {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* providerCommandId(event, "thread-meta-update"),
          threadId: thread.id,
          title: event.payload.name,
        });
      }

      if (event.type === "turn.diff.updated" && eventSubagentId === undefined) {
        const turnId = toTurnId(event.turnId);
        const checkpointContext = turnId
          ? yield* projectionSnapshotQuery
              .getThreadCheckpointContext(thread.id)
              .pipe(Effect.map(Option.getOrUndefined))
          : undefined;
        const workspaceCwd =
          checkpointContext?.worktreePath ?? checkpointContext?.workspaceRoot ?? undefined;
        if (
          turnId &&
          checkpointContext &&
          checkpointContext.checkpointsEnabled &&
          workspaceCwd &&
          isGitRepository(workspaceCwd)
        ) {
          // Skip if a checkpoint already exists for this turn. A real
          // (non-placeholder) capture from CheckpointReactor should not
          // be clobbered, and dispatching a duplicate placeholder for the
          // same turnId would produce an unstable checkpointTurnCount.
          if (hasCheckpointForTurn(checkpointContext.checkpoints, turnId)) {
            // Already tracked; no-op.
          } else {
            const assistantMessageId = MessageId.make(
              `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
            );
            yield* orchestrationEngine.dispatch({
              type: "thread.turn.diff.complete",
              commandId: yield* providerCommandId(event, "thread-turn-diff-complete"),
              threadId: thread.id,
              turnId,
              completedAt: now,
              checkpointRef: CheckpointRef.make(`provider-diff:${event.eventId}`),
              status: "missing",
              files: [],
              assistantMessageId,
              checkpointTurnCount: maxCheckpointTurnCount(checkpointContext.checkpoints) + 1,
              createdAt: now,
            });
          }
        }
      }

      if (event.type === "task.started" || event.type === "task.progress") {
        const description = event.payload.description?.trim();
        if (description) {
          yield* rememberTaskDescription(thread.id, event.payload.taskId, description);
        }
      }
      // Working-indicator plan progress: current step while the turn runs,
      // cleared on settle so a finished plan never lingers as stale UI.
      // Events carrying a turn id that conflicts with the active turn are
      // stale (superseded turn) and must neither overwrite nor clear the
      // active turn's progress; session.exited always clears.
      if (event.type === "session.exited") {
        threadPlanProgress.clearThreadPlanProgress(thread.id);
      } else if (!conflictsWithActiveTurn) {
        if (event.type === "turn.plan.updated") {
          threadPlanProgress.recordPlanProgress(thread.id, event.payload.plan);
        } else if (event.type === "turn.completed" || event.type === "turn.aborted") {
          threadPlanProgress.clearThreadPlanProgress(thread.id);
        }
      }

      // Sidebar background liveness: fed from the same lifecycle stream,
      // read by the shell query at mapping time (no persistence).
      switch (event.type) {
        case "task.started":
        case "task.progress":
        case "task.updated":
        case "task.completed": {
          const payload = event.payload as {
            taskId: string;
            taskType?: string;
            status?: string;
            agentId?: string;
          };
          threadBackgroundLiveness.recordTaskLiveness({
            threadId: thread.id,
            taskId: payload.taskId,
            taskType: payload.taskType,
            status: payload.status,
            agentId: payload.agentId,
            kind:
              event.type === "task.started"
                ? "started"
                : event.type === "task.progress"
                  ? "progress"
                  : event.type === "task.updated"
                    ? "updated"
                    : "completed",
          });
          break;
        }
        case "session.exited":
          threadBackgroundLiveness.clearThreadLiveness(thread.id);
          break;
        default:
          break;
      }

      let taskTitle: string | undefined;
      if (event.type === "task.completed") {
        taskTitle = yield* lookupTaskDescription(thread.id, event.payload.taskId);
        if (!taskTitle) {
          const threadDetail = yield* getLoadedThreadDetail();
          taskTitle = findTaskTitleInActivities(threadDetail?.activities, event.payload.taskId);
        }
      }

      if (
        event.type === "item.completed" ||
        event.type === "turn.completed" ||
        event.type === "turn.aborted" ||
        event.type === "runtime.error" ||
        event.type === "session.exited"
      ) {
        yield* flushContentStreams(event, thread.id);
      }

      const runtimeActivities = runtimeEventToActivities(event, taskTitle);
      const enrichedActivities = runtimeActivities.map((activity) =>
        enrichActivityWithRuntimeContext(event, activity),
      );
      if (eventSubagentId !== undefined && mirrorsInteractionToRoot(event)) {
        yield* Effect.forEach(enrichedActivities, (activity) =>
          providerCommandId(event, "root-interaction-activity-append").pipe(
            Effect.flatMap((commandId) =>
              orchestrationEngine.dispatch({
                type: "thread.activity.append",
                commandId,
                threadId: thread.id,
                activity,
                createdAt: activity.createdAt,
              }),
            ),
          ),
        ).pipe(Effect.asVoid);
      }

      yield* Effect.forEach(
        enrichedActivities.map((activity) => scopeActivityForEvent(event, activity)),
        (activity) =>
          providerCommandId(event, "thread-activity-append").pipe(
            Effect.flatMap((commandId) =>
              orchestrationEngine.dispatch({
                type: "thread.activity.append",
                commandId,
                threadId: thread.id,
                ...(eventSubagentId !== undefined ? { subagentId: eventSubagentId } : {}),
                activity,
                createdAt: activity.createdAt,
              }),
            ),
          ),
      ).pipe(Effect.asVoid);

      if (eventSubagentId !== undefined) {
        const progress = itemLifecycleProgress(event, runtimeActivities);
        if (progress) {
          yield* orchestrationEngine.dispatch({
            type: "thread.subagent.progress.set",
            commandId: yield* providerCommandId(event, "subagent-item-progress-set"),
            threadId: thread.id,
            subagentId: eventSubagentId,
            progress,
            updatedAt: now,
          });
        }
      }
    });

  const processDomainEvent = Effect.fn("ProviderRuntimeIngestion.processDomainEvent")(function* (
    event: RuntimeIngestionDomainEvent,
  ) {
    if (event.type !== "thread.turn-abort-settled" || event.payload.turnId === null) {
      return;
    }
    yield* finalizeBufferedTurnContent({
      event,
      threadId: event.payload.threadId,
      turnId: event.payload.turnId,
      settledAt: event.payload.settledAt,
    });
  });

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime" ? processRuntimeEvent(input.event) : processDomainEvent(input.event);

  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider runtime ingestion failed to process event", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: ProviderRuntimeIngestionShape["start"] = () =>
    Effect.gen(function* () {
      yield* forkParked(
        Stream.runForEach(providerService.streamEvents, (event) =>
          worker.enqueue({ source: "runtime", event }),
        ),
      );
      yield* forkParked(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (
            event.type !== "thread.turn-start-requested" &&
            event.type !== "thread.turn-abort-settled"
          ) {
            return Effect.void;
          }
          return worker.enqueue({ source: "domain", event });
        }),
      );
    });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make,
).pipe(Layer.provide(ProjectionTurnRepositoryLive));
