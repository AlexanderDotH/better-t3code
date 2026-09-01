import {
  type ProviderEvent,
  type ProviderRuntimeEvent,
  type RuntimeSubagentState,
  RuntimeTaskId,
  type RuntimeTaskUsage,
  type SubagentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { makeCodexSubagentId } from "./CodexSessionRuntime.ts";
import {
  type CodexCollabAgentStatus,
  lifecycleItemFromEvent,
  nonNegativeInt,
  normalizeCodexCollabAgentStatus,
  readPayload,
  runtimeEventBase,
  stringArray,
  subagentDepthFromPath,
  toCanonicalItemType,
  toSubagentStateFromThreadStatus,
  trimText,
  unknownRecord,
} from "./CodexRuntimeEventShared.ts";

export function makeSubagentDiscoveredEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  providerThreadId: string,
  metadata?: {
    readonly parentSubagentId?: SubagentId;
    readonly agentPath?: string;
    readonly nickname?: string;
    readonly role?: string;
    readonly task?: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly depth?: number;
  },
): ProviderRuntimeEvent {
  const subagentId = makeCodexSubagentId(providerThreadId);
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    subagentId,
    type: "subagent.discovered",
    payload: {
      subagentId,
      providerThreadId,
      ...(metadata?.parentSubagentId ? { parentSubagentId: metadata.parentSubagentId } : {}),
      ...(trimText(metadata?.agentPath) ? { agentPath: trimText(metadata?.agentPath) } : {}),
      ...(trimText(metadata?.nickname) ? { nickname: trimText(metadata?.nickname) } : {}),
      ...(trimText(metadata?.role) ? { role: trimText(metadata?.role) } : {}),
      ...(trimText(metadata?.task) ? { task: trimText(metadata?.task) } : {}),
      ...(trimText(metadata?.model) ? { model: trimText(metadata?.model) } : {}),
      ...(trimText(metadata?.reasoningEffort)
        ? { reasoningEffort: trimText(metadata?.reasoningEffort) }
        : {}),
      ...(metadata?.depth !== undefined ? { depth: metadata.depth } : {}),
    },
  };
}

function makeSubagentStateChangedEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  subagentId: SubagentId,
  state: RuntimeSubagentState,
  statusMessage?: string | null,
): ProviderRuntimeEvent {
  return {
    ...runtimeEventBase(event, canonicalThreadId),
    subagentId,
    type: "subagent.state.changed",
    payload: {
      subagentId,
      state,
      ...(trimText(statusMessage) ? { statusMessage: trimText(statusMessage) } : {}),
    },
  };
}

function parentSubagentId(
  providerThreadId: string | undefined,
  rootProviderThreadId: string | undefined,
): SubagentId | undefined {
  if (!providerThreadId || providerThreadId === rootProviderThreadId) {
    return undefined;
  }
  return makeCodexSubagentId(providerThreadId);
}

export function mapSubagentActivityEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  rootProviderThreadId: string | undefined,
): ReadonlyArray<ProviderRuntimeEvent> {
  const item = lifecycleItemFromEvent(event);
  if (item?.type !== "subAgentActivity") {
    return [];
  }
  const providerThreadId = trimText(
    typeof item.agentThreadId === "string" ? item.agentThreadId : undefined,
  );
  const agentPath = trimText(typeof item.agentPath === "string" ? item.agentPath : undefined);
  if (!providerThreadId || providerThreadId === rootProviderThreadId || agentPath === "/root") {
    return [];
  }
  const depth = subagentDepthFromPath(agentPath);
  const subagentId = makeCodexSubagentId(providerThreadId);
  const kind = item.kind;
  const state =
    kind === "started" ? "starting" : kind === "interrupted" ? "interrupted" : undefined;
  return [
    makeSubagentDiscoveredEvent(event, canonicalThreadId, providerThreadId, {
      ...(event.subagentId ? { parentSubagentId: event.subagentId } : {}),
      ...(agentPath ? { agentPath } : {}),
      ...(depth !== undefined ? { depth } : {}),
    }),
    ...(state ? [makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, state)] : []),
  ];
}

function isCodexCollabAgentStatus(value: unknown): value is CodexCollabAgentStatus {
  return (
    value === "pendingInit" ||
    value === "running" ||
    value === "interrupted" ||
    value === "completed" ||
    value === "errored" ||
    value === "shutdown" ||
    value === "notFound"
  );
}

function collabToolFallbackState(tool: unknown, status: unknown): RuntimeSubagentState | undefined {
  if (status === "failed") {
    return "error";
  }
  switch (tool) {
    case "spawnAgent":
      return "starting";
    case "resumeAgent":
      return "running";
    case "closeAgent":
      return "completed";
    default:
      return undefined;
  }
}

export function mapCollabAgentEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  rootProviderThreadId: string | undefined,
): ReadonlyArray<ProviderRuntimeEvent> {
  const item = lifecycleItemFromEvent(event);
  if (item?.type !== "collabAgentToolCall") {
    return [];
  }

  const agentStates = unknownRecord(item.agentsStates) ?? {};
  const receiverThreadIds = stringArray(item.receiverThreadIds);
  const providerThreadIds = Array.from(
    new Set([...receiverThreadIds, ...Object.keys(agentStates)]),
  ).filter(
    (providerThreadId) =>
      providerThreadId.trim().length > 0 && providerThreadId !== rootProviderThreadId,
  );
  const senderThreadId = trimText(
    typeof item.senderThreadId === "string" ? item.senderThreadId : undefined,
  );
  const parentId = event.subagentId ?? parentSubagentId(senderThreadId, rootProviderThreadId);
  const task = trimText(typeof item.prompt === "string" ? item.prompt : undefined);
  const model = trimText(typeof item.model === "string" ? item.model : undefined);
  const reasoningEffort = trimText(
    typeof item.reasoningEffort === "string" ? item.reasoningEffort : undefined,
  );
  const events: Array<ProviderRuntimeEvent> = [];

  for (const providerThreadId of providerThreadIds) {
    events.push(
      makeSubagentDiscoveredEvent(event, canonicalThreadId, providerThreadId, {
        ...(parentId ? { parentSubagentId: parentId } : {}),
        ...(task ? { task } : {}),
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }),
    );

    const stateRecord = unknownRecord(agentStates[providerThreadId]);
    const rawState = stateRecord?.status;
    const state = isCodexCollabAgentStatus(rawState)
      ? normalizeCodexCollabAgentStatus(rawState)
      : collabToolFallbackState(item.tool, item.status);
    if (!state) {
      continue;
    }
    events.push(
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        makeCodexSubagentId(providerThreadId),
        state,
        typeof stateRecord?.message === "string" ? stateRecord.message : undefined,
      ),
    );
  }

  return events;
}

function threadSpawnMetadata(thread: EffectCodexSchema.V2ThreadStartedNotification["thread"]): {
  readonly agentPath?: string;
  readonly nickname?: string;
  readonly role?: string;
  readonly parentProviderThreadId?: string;
  readonly depth?: number;
} {
  const source = thread.source;
  const subAgent = typeof source === "object" && "subAgent" in source ? source.subAgent : undefined;
  const spawn =
    typeof subAgent === "object" && "thread_spawn" in subAgent ? subAgent.thread_spawn : undefined;
  const agentPath = trimText(spawn?.agent_path);
  const nickname = trimText(thread.agentNickname) ?? trimText(spawn?.agent_nickname);
  const role = trimText(thread.agentRole) ?? trimText(spawn?.agent_role);
  const parentProviderThreadId =
    trimText(thread.parentThreadId) ?? trimText(spawn?.parent_thread_id);
  const depth = spawn ? nonNegativeInt(spawn.depth) : subagentDepthFromPath(agentPath);
  return {
    ...(agentPath ? { agentPath } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(parentProviderThreadId ? { parentProviderThreadId } : {}),
    ...(depth !== undefined ? { depth } : {}),
  };
}

export function mapChildThreadEvents(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  rootProviderThreadId: string | undefined,
): ReadonlyArray<ProviderRuntimeEvent> {
  const subagentId = event.subagentId;
  const providerThreadId = event.providerThreadId;
  if (!subagentId || !providerThreadId) {
    return [];
  }

  if (event.method === "thread/started") {
    const payload = readPayload(EffectCodexSchema.V2ThreadStartedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const metadata = threadSpawnMetadata(payload.thread);
    const parentId = parentSubagentId(metadata.parentProviderThreadId, rootProviderThreadId);
    const task = trimText(payload.thread.preview);
    return [
      makeSubagentDiscoveredEvent(event, canonicalThreadId, providerThreadId, {
        ...(parentId ? { parentSubagentId: parentId } : {}),
        ...(metadata.agentPath ? { agentPath: metadata.agentPath } : {}),
        ...(metadata.nickname ? { nickname: metadata.nickname } : {}),
        ...(metadata.role ? { role: metadata.role } : {}),
        ...(task ? { task } : {}),
        ...(metadata.depth !== undefined ? { depth: metadata.depth } : {}),
      }),
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        subagentId,
        toSubagentStateFromThreadStatus(payload.thread.status),
      ),
    ];
  }

  if (event.method === "thread/status/changed") {
    const payload = readPayload(EffectCodexSchema.V2ThreadStatusChangedNotification, event.payload);
    return payload
      ? [
          makeSubagentStateChangedEvent(
            event,
            canonicalThreadId,
            subagentId,
            toSubagentStateFromThreadStatus(payload.status),
          ),
        ]
      : [];
  }

  if (event.method === "thread/closed" || event.method === "thread/archived") {
    return [makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, "completed")];
  }

  if (event.method === "thread/unarchived" || event.method === "turn/started") {
    return [makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, "running")];
  }

  if (event.method === "turn/completed") {
    const payload = readPayload(EffectCodexSchema.V2TurnCompletedNotification, event.payload);
    if (!payload) {
      return [];
    }
    const state =
      payload.turn.status === "failed"
        ? "error"
        : payload.turn.status === "interrupted"
          ? "interrupted"
          : "completed";
    return [
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        subagentId,
        state,
        payload.turn.error?.message,
      ),
    ];
  }

  if (event.method === "error") {
    const payload = readPayload(EffectCodexSchema.V2ErrorNotification, event.payload);
    return [
      makeSubagentStateChangedEvent(
        event,
        canonicalThreadId,
        subagentId,
        payload?.willRetry ? "running" : "error",
        payload?.error.message ?? event.message,
      ),
    ];
  }

  return [];
}

export function suppressGenericChildThreadEvent(event: ProviderEvent): boolean {
  if (!event.subagentId) {
    return false;
  }
  return (
    event.method === "thread/started" ||
    event.method === "thread/status/changed" ||
    event.method === "thread/archived" ||
    event.method === "thread/unarchived" ||
    event.method === "thread/closed"
  );
}

export function mapCollabAgentEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
): ReadonlyArray<ProviderRuntimeEvent> {
  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? (event.payload as Record<string, unknown>)
      : undefined;
  const agentThreadId = typeof payload?.agentThreadId === "string" ? payload.agentThreadId : "";
  if (!payload || agentThreadId.length === 0) {
    return [];
  }
  const base = runtimeEventBase(event, canonicalThreadId);
  const taskId = RuntimeTaskId.make(agentThreadId);
  const subagentId = makeCodexSubagentId(agentThreadId);
  const subagentStateChanged = (state: RuntimeSubagentState, statusMessage?: string | null) =>
    makeSubagentStateChangedEvent(event, canonicalThreadId, subagentId, state, statusMessage);
  const agentPath = typeof payload.agentPath === "string" ? payload.agentPath : undefined;
  const pathLeaf = agentPath?.split("/").findLast((segment) => segment.length > 0);
  const nickname = typeof payload.nickname === "string" ? payload.nickname : undefined;
  const role =
    (typeof payload.role === "string" ? payload.role : undefined) ?? pathLeaf ?? "general-purpose";
  // A bare thread id is not a name. Omitting the title lets the client fold
  // keep the real one from task.started instead of clobbering it (probe
  // finding: progress rows renamed math_one to its UUID).
  const knownName = nickname ?? pathLeaf;
  const title = knownName ?? agentThreadId;
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  const effort = typeof payload.effort === "string" ? payload.effort.trim() : "";
  // Identity repeated on every status patch so rows are self-describing when
  // the start row ages out of activity retention (review finding: a
  // reconstructed agent had a UUID name and no role/path).
  const linkage = {
    role,
    ...(knownName ? { title: knownName } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(agentPath ? { agentPath } : {}),
    timelineBypass: true,
  } as const;

  switch (event.method) {
    case "collabAgent/started":
      return [
        subagentStateChanged("starting"),
        {
          ...base,
          type: "task.started",
          payload: {
            taskId,
            description: title,
            title,
            ...linkage,
            ...(typeof payload.parentThreadId === "string"
              ? { parentAgentId: payload.parentThreadId }
              : {}),
          },
        },
      ];
    case "collabAgent/metadataUpdated":
      return [
        {
          ...base,
          type: "task.updated",
          payload: { taskId, ...linkage },
        },
      ];
    case "collabAgent/activity": {
      const activityKind = typeof payload.activityKind === "string" ? payload.activityKind : "";
      if (activityKind === "interrupted") {
        return [
          subagentStateChanged("interrupted"),
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: "interrupted", ...linkage },
          },
        ];
      }
      if (activityKind === "started") {
        // Wire-probe finding: children often register via subAgentActivity
        // alone (no thread/started with a spawn source), so this is the one
        // shot at a task.started with a real name — agentPath leaf beats a
        // bare thread-id title.
        return [
          subagentStateChanged("starting"),
          {
            ...base,
            type: "task.started",
            payload: {
              taskId,
              description: title,
              title,
              ...linkage,
            },
          },
        ];
      }
      // Reading a child's result also emits "interacted" after its turn is idle.
      // Only the child's turn or thread lifecycle can prove it resumed work.
      return [];
    }
    case "collabAgent/turnStarted":
      return [
        subagentStateChanged("running"),
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status: "running", ...linkage },
        },
      ];
    case "collabAgent/turnCompleted": {
      // Idle, not terminal: the identity is resumable via sendInput/resume.
      const turn =
        typeof payload.turn === "object" && payload.turn !== null
          ? (payload.turn as Record<string, unknown>)
          : undefined;
      const turnStatus = typeof turn?.status === "string" ? turn.status : undefined;
      const status =
        turnStatus === "failed"
          ? ("failed" as const)
          : turnStatus === "interrupted"
            ? ("interrupted" as const)
            : ("idle" as const);
      const subagentState =
        status === "failed" ? "error" : status === "interrupted" ? "interrupted" : "completed";
      const turnError =
        typeof turn?.error === "object" && turn.error !== null
          ? (turn.error as Record<string, unknown>)
          : undefined;
      return [
        subagentStateChanged(
          subagentState,
          typeof turnError?.message === "string" ? turnError.message : undefined,
        ),
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status, ...linkage },
        },
      ];
    }
    case "collabAgent/statusChanged": {
      const status =
        typeof payload.status === "object" && payload.status !== null
          ? (payload.status as Record<string, unknown>)
          : undefined;
      const statusType = typeof status?.type === "string" ? status.type : undefined;
      if (statusType === "systemError") {
        // Silently dropping this once left children stuck running forever.
        return [
          subagentStateChanged("error"),
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: "failed", ...linkage },
          },
        ];
      }
      if (statusType === "active") {
        const flags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
        const waiting = flags.some(
          (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
        );
        return [
          subagentStateChanged(waiting ? "waiting" : "running"),
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: waiting ? "waiting" : "running", ...linkage },
          },
        ];
      }
      if (statusType === "idle") {
        return [
          subagentStateChanged("completed"),
          {
            ...base,
            type: "task.updated",
            payload: { taskId, status: "idle", ...linkage },
          },
        ];
      }
      return [];
    }
    case "collabAgent/tokenUsage": {
      // Cumulative per child thread: always the `total` breakdown, never
      // `last` (which shrinks on follow-ups). Client folds max-merge.
      const tokenUsage =
        typeof payload.tokenUsage === "object" && payload.tokenUsage !== null
          ? (payload.tokenUsage as Record<string, unknown>)
          : undefined;
      const total =
        typeof tokenUsage?.total === "object" && tokenUsage.total !== null
          ? (tokenUsage.total as Record<string, unknown>)
          : undefined;
      const count = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
      // Same validation as every other field: RuntimeTaskUsage.totalTokens
      // is NonNegativeInt, so NaN/Infinity/negative wire values must miss.
      const totalTokens = count(total?.totalTokens);
      if (totalTokens === undefined) {
        return [];
      }
      const typedUsage: RuntimeTaskUsage = {
        totalTokens,
        ...(count(total?.inputTokens) !== undefined
          ? { inputTokens: count(total?.inputTokens) }
          : {}),
        ...(count(total?.cachedInputTokens) !== undefined
          ? { cachedInputTokens: count(total?.cachedInputTokens) }
          : {}),
        ...(count(total?.outputTokens) !== undefined
          ? { outputTokens: count(total?.outputTokens) }
          : {}),
        ...(count(total?.reasoningOutputTokens) !== undefined
          ? { reasoningOutputTokens: count(total?.reasoningOutputTokens) }
          : {}),
      };
      return [
        {
          ...base,
          type: "task.progress",
          payload: {
            taskId,
            description: title,
            ...linkage,
            typedUsage,
          },
        },
      ];
    }
    case "collabAgent/item": {
      const item =
        typeof payload.item === "object" && payload.item !== null
          ? (payload.item as Record<string, unknown>)
          : undefined;
      const itemTypeRaw = typeof item?.type === "string" ? item.type : undefined;
      if (!itemTypeRaw) {
        return [];
      }
      // A loose summary from the raw item: the child stream is untyped at
      // this boundary (synthetic event payload), so read best-effort fields
      // rather than force a schema decode.
      const looseSummary =
        (typeof item?.command === "string" ? item.command : undefined) ??
        (typeof item?.title === "string" ? item.title : undefined) ??
        (typeof item?.query === "string" ? item.query : undefined);
      const canonical = toCanonicalItemType(itemTypeRaw);
      const summary = looseSummary ?? canonical.replaceAll("_", " ");
      return [
        {
          ...base,
          type: "task.progress",
          payload: {
            taskId,
            description: title,
            ...linkage,
            summary,
          },
        },
      ];
    }
    case "collabAgent/closed":
      return [
        subagentStateChanged("interrupted"),
        {
          ...base,
          type: "task.updated",
          payload: { taskId, status: "interrupted", ...linkage },
        },
      ];
    default:
      return [];
  }
}
