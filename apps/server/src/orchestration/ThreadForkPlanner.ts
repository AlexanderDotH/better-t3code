import {
  EventId,
  MessageId,
  OrchestrationProposedPlanId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationHistoryOrigin,
  type OrchestrationReadModel,
  type ThreadForkCommand,
  type ThreadForkHistory,
  type ThreadForkHistoryCheckpoint,
  type ThreadForkHistoryMessage,
  type ThreadForkHistoryProposedPlan,
  type ThreadForkHistorySubagent,
  type ThreadForkHistoryTurn,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { measureProviderForkHandoff } from "./providerTranscriptHandoff.ts";
import {
  retainThreadActivitiesAfterRevert,
  retainThreadMessagesAfterRevert,
  retainThreadProposedPlansAfterRevert,
} from "./projector.ts";

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

interface MutableHistoryState {
  messages: ThreadForkHistoryMessage[];
  proposedPlans: ThreadForkHistoryProposedPlan[];
  activities: ThreadForkHistory["activities"][number][];
  subagents: ThreadForkHistorySubagent[];
  turns: ThreadForkHistoryTurn[];
  checkpoints: ThreadForkHistoryCheckpoint[];
  session: {
    readonly status:
      | "idle"
      | "starting"
      | "running"
      | "ready"
      | "interrupted"
      | "stopped"
      | "error";
    readonly activeTurnId: TurnId | null;
    readonly providerInstanceId?: ThreadForkHistoryTurn["providerInstanceId"];
    readonly providerForkCursor?: ThreadForkHistoryTurn["providerForkCursor"];
  } | null;
  frozenThroughOrdinal: number;
  nextOrdinal: number;
}

function invariant(command: ThreadForkCommand, detail: string) {
  return new OrchestrationCommandInvariantError({
    commandType: command.type,
    detail,
  });
}

function historyOrigin(
  sourceThreadId: ThreadId,
  sourceId: string,
  ordinal: number,
): OrchestrationHistoryOrigin {
  return { sourceThreadId, sourceId, ordinal };
}

function allHistoryRows(history: ThreadForkHistory) {
  return [
    ...history.messages,
    ...history.proposedPlans,
    ...history.activities,
    ...history.subagents,
    ...history.turns,
    ...history.checkpoints,
  ];
}

function mutableHistory(history?: ThreadForkHistory): MutableHistoryState {
  const initial = history ?? {
    messages: [],
    proposedPlans: [],
    activities: [],
    subagents: [],
    turns: [],
    checkpoints: [],
  };
  const lastOrdinal = allHistoryRows(initial).reduce(
    (latest, row) => Math.max(latest, row.historyOrigin.ordinal),
    -1,
  );
  return {
    messages: [...initial.messages],
    proposedPlans: [...initial.proposedPlans],
    activities: [...initial.activities],
    subagents: [...initial.subagents],
    turns: [...initial.turns],
    checkpoints: [...initial.checkpoints],
    session: null,
    frozenThroughOrdinal: lastOrdinal,
    nextOrdinal: lastOrdinal + 1,
  };
}

function nextOrigin(state: MutableHistoryState, sourceThreadId: ThreadId, sourceId: string) {
  const origin = historyOrigin(sourceThreadId, sourceId, state.nextOrdinal);
  state.nextOrdinal += 1;
  return origin;
}

function forkHistory(state: MutableHistoryState): ThreadForkHistory {
  return {
    messages: state.messages.map((message) => ({ ...message, streaming: false })),
    proposedPlans: state.proposedPlans,
    activities: state.activities,
    subagents: state.subagents,
    turns: state.turns,
    checkpoints: state.checkpoints,
  };
}

function filterHistoryAtOrdinal(history: ThreadForkHistory, ordinal: number): ThreadForkHistory {
  const retain = (row: { readonly historyOrigin: OrchestrationHistoryOrigin }) =>
    row.historyOrigin.ordinal <= ordinal;
  return {
    messages: history.messages.filter(retain).map((message) => ({ ...message, streaming: false })),
    proposedPlans: history.proposedPlans.filter(retain),
    activities: history.activities.filter(retain),
    subagents: history.subagents.filter(retain),
    turns: history.turns.filter(retain),
    checkpoints: history.checkpoints.filter(retain),
  };
}

function inheritedBoundaryOrdinal(
  history: ThreadForkHistory,
  boundary: ThreadForkCommand["boundary"],
): number | null {
  if (boundary.kind === "message") {
    return (
      history.messages.find((message) => message.id === boundary.messageId)?.historyOrigin
        .ordinal ?? null
    );
  }
  return (
    history.proposedPlans.find((plan) => plan.id === boundary.planId)?.historyOrigin.ordinal ?? null
  );
}

function nativeBoundaryIndex(
  events: ReadonlyArray<OrchestrationEvent>,
  boundary: ThreadForkCommand["boundary"],
): number {
  if (boundary.kind === "message") {
    return events.findIndex(
      (event) =>
        (event.type === "thread.message-sent" ||
          event.type === "thread.harness-sync-message-imported") &&
        event.payload.subagentId === undefined &&
        event.payload.messageId === boundary.messageId &&
        !event.payload.streaming,
    );
  }
  return events.findIndex(
    (event) =>
      event.type === "thread.proposed-plan-upserted" &&
      event.payload.subagentId === undefined &&
      event.payload.proposedPlan.id === boundary.planId,
  );
}

function hasStreamingBoundary(
  events: ReadonlyArray<OrchestrationEvent>,
  command: ThreadForkCommand,
): boolean {
  if (command.boundary.kind !== "message") return false;
  const messageId = command.boundary.messageId;
  return events.some(
    (event) =>
      (event.type === "thread.message-sent" ||
        event.type === "thread.harness-sync-message-imported") &&
      event.payload.subagentId === undefined &&
      event.payload.messageId === messageId &&
      event.payload.streaming,
  );
}

function upsertMessage(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  payload: Extract<
    OrchestrationEvent,
    { readonly type: "thread.message-sent" | "thread.harness-sync-message-imported" }
  >["payload"],
) {
  if (payload.subagentId !== undefined) return;
  const existingIndex = state.messages.findIndex((message) => message.id === payload.messageId);
  if (existingIndex >= 0) {
    const existing = state.messages[existingIndex]!;
    state.messages[existingIndex] = {
      ...existing,
      text: payload.streaming
        ? `${existing.text}${payload.text}`
        : payload.text.length > 0
          ? payload.text
          : existing.text,
      ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
      turnId: payload.turnId,
      streaming: payload.streaming,
      updatedAt: payload.updatedAt,
    };
    return;
  }
  state.messages.push({
    id: payload.messageId,
    role: payload.role,
    text: payload.text,
    ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
    turnId: payload.turnId,
    streaming: payload.streaming,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    historyOrigin: nextOrigin(state, sourceThreadId, payload.messageId),
  });
}

function upsertPlan(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  payload: Extract<
    OrchestrationEvent,
    { readonly type: "thread.proposed-plan-upserted" }
  >["payload"],
) {
  if (payload.subagentId !== undefined) return;
  const existing = state.proposedPlans.find((plan) => plan.id === payload.proposedPlan.id);
  const next = {
    ...payload.proposedPlan,
    historyOrigin:
      existing?.historyOrigin ?? nextOrigin(state, sourceThreadId, payload.proposedPlan.id),
  };
  state.proposedPlans = [
    ...state.proposedPlans.filter((plan) => plan.id !== payload.proposedPlan.id),
    next,
  ].toSorted((left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal);
}

function upsertActivity(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  payload: Extract<OrchestrationEvent, { readonly type: "thread.activity-appended" }>["payload"],
) {
  if (payload.subagentId !== undefined) return;
  const existing = state.activities.find((activity) => activity.id === payload.activity.id);
  const next = {
    ...payload.activity,
    historyOrigin:
      existing?.historyOrigin ?? nextOrigin(state, sourceThreadId, payload.activity.id),
  };
  state.activities = [
    ...state.activities.filter((activity) => activity.id !== payload.activity.id),
    next,
  ].toSorted((left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal);
}

function upsertSubagent(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  subagent: Extract<
    OrchestrationEvent,
    { readonly type: "thread.subagent-upserted" }
  >["payload"]["subagent"],
) {
  const existing = state.subagents.find((entry) => entry.id === subagent.id);
  const lifecycle =
    existing === undefined || subagent.updatedAt.localeCompare(existing.updatedAt) >= 0
      ? subagent
      : existing;
  const next: ThreadForkHistorySubagent = {
    ...existing,
    ...subagent,
    parentId: subagent.parentId ?? existing?.parentId ?? null,
    path: subagent.path ?? existing?.path ?? null,
    nickname: subagent.nickname ?? existing?.nickname ?? null,
    role: subagent.role ?? existing?.role ?? null,
    task: subagent.task ?? existing?.task ?? null,
    model: subagent.model ?? existing?.model ?? null,
    reasoningEffort: subagent.reasoningEffort ?? existing?.reasoningEffort ?? null,
    serviceTier: subagent.serviceTier ?? existing?.serviceTier,
    status: lifecycle.status,
    statusMessage: lifecycle.statusMessage,
    latestProgress: lifecycle.latestProgress,
    latestTurn: lifecycle.latestTurn,
    startedAt:
      existing === undefined || subagent.startedAt.localeCompare(existing.startedAt) < 0
        ? subagent.startedAt
        : existing.startedAt,
    updatedAt: lifecycle.updatedAt,
    completedAt: lifecycle.completedAt,
    historyOrigin: existing?.historyOrigin ?? nextOrigin(state, sourceThreadId, subagent.id),
  };
  state.subagents = [...state.subagents.filter((entry) => entry.id !== subagent.id), next].toSorted(
    (left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal,
  );
}

function placeholderSubagent(input: {
  readonly state: MutableHistoryState;
  readonly sourceThreadId: ThreadId;
  readonly subagentId: SubagentId;
  readonly updatedAt: string;
  readonly status?: ThreadForkHistorySubagent["status"];
}): ThreadForkHistorySubagent {
  const status = input.status ?? "starting";
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
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: input.updatedAt,
    updatedAt: input.updatedAt,
    completedAt: ["completed", "interrupted", "error", "unavailable"].includes(status)
      ? input.updatedAt
      : null,
    historyOrigin: nextOrigin(input.state, input.sourceThreadId, input.subagentId),
  };
}

function updateSubagentState(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  payload: Extract<OrchestrationEvent, { readonly type: "thread.subagent-state-set" }>["payload"],
) {
  let index = state.subagents.findIndex((subagent) => subagent.id === payload.subagentId);
  if (index < 0) {
    state.subagents.push(
      placeholderSubagent({
        state,
        sourceThreadId,
        subagentId: payload.subagentId,
        updatedAt: payload.updatedAt,
        status: payload.status,
      }),
    );
    index = state.subagents.length - 1;
  }
  const existing = state.subagents[index]!;
  if (payload.updatedAt.localeCompare(existing.updatedAt) < 0) return;
  state.subagents[index] = {
    ...existing,
    status: payload.status,
    statusMessage: payload.statusMessage,
    updatedAt: payload.updatedAt,
    completedAt: ["completed", "interrupted", "error", "unavailable"].includes(payload.status)
      ? payload.updatedAt
      : null,
  };
}

function updateSubagentProgress(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  payload: Extract<
    OrchestrationEvent,
    { readonly type: "thread.subagent-progress-set" }
  >["payload"],
) {
  let index = state.subagents.findIndex((subagent) => subagent.id === payload.subagentId);
  if (index < 0) {
    state.subagents.push(
      placeholderSubagent({
        state,
        sourceThreadId,
        subagentId: payload.subagentId,
        updatedAt: payload.updatedAt,
      }),
    );
    index = state.subagents.length - 1;
  }
  const existing = state.subagents[index]!;
  if (payload.updatedAt.localeCompare(existing.updatedAt) < 0) return;
  state.subagents[index] = {
    ...existing,
    latestProgress: payload.progress,
    updatedAt: payload.updatedAt,
  };
}

function upsertTurn(state: MutableHistoryState, turn: ThreadForkHistoryTurn) {
  if (turn.turnId === null) {
    state.turns = [...state.turns.filter((entry) => entry.turnId !== null), turn];
    return;
  }
  state.turns = [...state.turns.filter((entry) => entry.turnId !== turn.turnId), turn].toSorted(
    (left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal,
  );
}

function turnStateFromCheckpoint(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function applyTurnEvent(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  event: OrchestrationEvent,
) {
  switch (event.type) {
    case "thread.turn-start-requested": {
      upsertTurn(state, {
        turnId: null,
        pendingMessageId: event.payload.messageId,
        assistantMessageId: null,
        state: "pending",
        requestedAt: event.payload.createdAt,
        startedAt: null,
        completedAt: null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
        ...(event.payload.sourceProposedPlan !== undefined
          ? { sourceProposedPlan: event.payload.sourceProposedPlan }
          : {}),
        historyOrigin:
          event.payload.historyOrigin ?? nextOrigin(state, sourceThreadId, event.payload.messageId),
      });
      return;
    }
    case "thread.session-set": {
      const session = event.payload.session;
      state.session = {
        status: session.status,
        activeTurnId: session.activeTurnId,
        ...(session.providerInstanceId !== undefined
          ? { providerInstanceId: session.providerInstanceId }
          : {}),
        ...(session.providerForkCursor !== undefined
          ? { providerForkCursor: session.providerForkCursor }
          : {}),
      };
      if (session.status === "running" && session.activeTurnId !== null) {
        const pending = state.turns.find((turn) => turn.turnId === null);
        const existing = state.turns.find((turn) => turn.turnId === session.activeTurnId);
        state.turns = state.turns
          .map((turn) =>
            turn.historyOrigin.ordinal > state.frozenThroughOrdinal &&
            turn.turnId !== null &&
            turn.turnId !== session.activeTurnId &&
            turn.state === "running"
              ? { ...turn, state: "completed" as const, completedAt: session.updatedAt }
              : turn,
          )
          .filter((turn) => turn.turnId !== null);
        upsertTurn(state, {
          turnId: session.activeTurnId,
          pendingMessageId: existing?.pendingMessageId ?? pending?.pendingMessageId ?? null,
          assistantMessageId: existing?.assistantMessageId ?? null,
          state:
            existing?.state === "completed" || existing?.state === "error"
              ? existing.state
              : "running",
          requestedAt: existing?.requestedAt ?? pending?.requestedAt ?? session.updatedAt,
          startedAt: existing?.startedAt ?? pending?.requestedAt ?? session.updatedAt,
          completedAt: existing?.completedAt ?? null,
          checkpointTurnCount: existing?.checkpointTurnCount ?? null,
          checkpointRef: existing?.checkpointRef ?? null,
          checkpointStatus: existing?.checkpointStatus ?? null,
          checkpointFiles: existing?.checkpointFiles ?? [],
          ...(session.providerInstanceId !== undefined
            ? { providerInstanceId: session.providerInstanceId }
            : existing?.providerInstanceId !== undefined
              ? { providerInstanceId: existing.providerInstanceId }
              : {}),
          ...(session.providerForkCursor !== undefined
            ? { providerForkCursor: session.providerForkCursor }
            : existing?.providerForkCursor !== undefined
              ? { providerForkCursor: existing.providerForkCursor }
              : {}),
          ...(existing?.sourceProposedPlan !== undefined
            ? { sourceProposedPlan: existing.sourceProposedPlan }
            : pending?.sourceProposedPlan !== undefined
              ? { sourceProposedPlan: pending.sourceProposedPlan }
              : {}),
          historyOrigin:
            existing?.historyOrigin ??
            (pending === undefined
              ? nextOrigin(state, sourceThreadId, session.activeTurnId)
              : historyOrigin(sourceThreadId, session.activeTurnId, pending.historyOrigin.ordinal)),
        });
        return;
      }
      const settledState =
        session.status === "error"
          ? "error"
          : session.status === "idle" || session.status === "ready"
            ? "completed"
            : session.status === "starting" || session.status === "running"
              ? null
              : "interrupted";
      if (settledState !== null) {
        state.turns = state.turns.map((turn) =>
          turn.historyOrigin.ordinal > state.frozenThroughOrdinal && turn.state === "running"
            ? {
                ...turn,
                state: settledState,
                completedAt: session.updatedAt,
                ...(session.providerInstanceId !== undefined
                  ? { providerInstanceId: session.providerInstanceId }
                  : {}),
                ...(session.providerForkCursor !== undefined
                  ? { providerForkCursor: session.providerForkCursor }
                  : {}),
              }
            : turn,
        );
      }
      return;
    }
    case "thread.turn-interrupt-requested": {
      if (event.payload.turnId === undefined) return;
      const existing = state.turns.find((turn) => turn.turnId === event.payload.turnId);
      if (existing !== undefined) {
        upsertTurn(state, {
          ...existing,
          state: "interrupted",
          completedAt: existing.completedAt ?? event.payload.createdAt,
        });
      }
      return;
    }
    case "thread.turn-abort-settled": {
      if (event.payload.turnId === null) return;
      const existing = state.turns.find((turn) => turn.turnId === event.payload.turnId);
      if (existing !== undefined) {
        upsertTurn(state, {
          ...existing,
          state: event.payload.outcome === "force-failed" ? "error" : "interrupted",
          completedAt: event.payload.settledAt,
        });
      }
      return;
    }
    case "thread.turn-diff-completed": {
      const existing = state.turns.find((turn) => turn.turnId === event.payload.turnId);
      const stillRunning =
        state.session?.status === "running" && state.session.activeTurnId === event.payload.turnId;
      upsertTurn(state, {
        turnId: event.payload.turnId,
        pendingMessageId: existing?.pendingMessageId ?? null,
        assistantMessageId: event.payload.assistantMessageId,
        state: stillRunning
          ? (existing?.state ?? "running")
          : turnStateFromCheckpoint(event.payload.status),
        requestedAt: existing?.requestedAt ?? event.payload.completedAt,
        startedAt: existing?.startedAt ?? event.payload.completedAt,
        completedAt: stillRunning ? (existing?.completedAt ?? null) : event.payload.completedAt,
        checkpointTurnCount: event.payload.checkpointTurnCount,
        checkpointRef: event.payload.checkpointRef,
        checkpointStatus: event.payload.status,
        checkpointFiles: event.payload.files,
        ...(existing?.providerInstanceId !== undefined
          ? { providerInstanceId: existing.providerInstanceId }
          : {}),
        ...(existing?.providerForkCursor !== undefined
          ? { providerForkCursor: existing.providerForkCursor }
          : {}),
        ...(existing?.sourceProposedPlan !== undefined
          ? { sourceProposedPlan: existing.sourceProposedPlan }
          : {}),
        historyOrigin:
          existing?.historyOrigin ??
          event.payload.historyOrigin ??
          nextOrigin(state, sourceThreadId, event.payload.turnId),
      });
      const checkpoint = state.checkpoints.find((entry) => entry.turnId === event.payload.turnId);
      if (checkpoint?.status !== "missing" && event.payload.status === "missing") return;
      const nextCheckpoint: ThreadForkHistoryCheckpoint = {
        turnId: event.payload.turnId,
        checkpointTurnCount: event.payload.checkpointTurnCount,
        checkpointRef: event.payload.checkpointRef,
        status: event.payload.status,
        files: event.payload.files,
        assistantMessageId: event.payload.assistantMessageId,
        completedAt: event.payload.completedAt,
        historyOrigin:
          checkpoint?.historyOrigin ??
          event.payload.historyOrigin ??
          nextOrigin(state, sourceThreadId, event.payload.checkpointRef),
      };
      state.checkpoints = [
        ...state.checkpoints.filter((entry) => entry.turnId !== event.payload.turnId),
        nextCheckpoint,
      ].toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount);
      return;
    }
    default:
      return;
  }
}

function applyAssistantMessageToTurn(
  state: MutableHistoryState,
  sourceThreadId: ThreadId,
  event: Extract<
    OrchestrationEvent,
    { readonly type: "thread.message-sent" | "thread.harness-sync-message-imported" }
  >,
) {
  if (
    event.payload.subagentId !== undefined ||
    event.payload.role !== "assistant" ||
    event.payload.turnId === null
  ) {
    return;
  }
  const existing = state.turns.find((turn) => turn.turnId === event.payload.turnId);
  const stillRunning =
    state.session?.status === "running" && state.session.activeTurnId === event.payload.turnId;
  upsertTurn(state, {
    turnId: event.payload.turnId,
    pendingMessageId: existing?.pendingMessageId ?? null,
    assistantMessageId: event.payload.messageId,
    state: !event.payload.streaming && !stillRunning ? "completed" : (existing?.state ?? "running"),
    requestedAt: existing?.requestedAt ?? event.payload.createdAt,
    startedAt: existing?.startedAt ?? event.payload.createdAt,
    completedAt:
      !event.payload.streaming && !stillRunning
        ? (existing?.completedAt ?? event.payload.updatedAt)
        : (existing?.completedAt ?? null),
    checkpointTurnCount: existing?.checkpointTurnCount ?? null,
    checkpointRef: existing?.checkpointRef ?? null,
    checkpointStatus: existing?.checkpointStatus ?? null,
    checkpointFiles: existing?.checkpointFiles ?? [],
    ...(existing?.providerInstanceId !== undefined
      ? { providerInstanceId: existing.providerInstanceId }
      : {}),
    ...(existing?.providerForkCursor !== undefined
      ? { providerForkCursor: existing.providerForkCursor }
      : {}),
    ...(existing?.sourceProposedPlan !== undefined
      ? { sourceProposedPlan: existing.sourceProposedPlan }
      : {}),
    historyOrigin:
      existing?.historyOrigin ?? nextOrigin(state, sourceThreadId, event.payload.turnId),
  });
}

function applyRevert(state: MutableHistoryState, turnCount: number) {
  state.checkpoints = state.checkpoints.filter(
    (checkpoint) =>
      checkpoint.historyOrigin.ordinal <= state.frozenThroughOrdinal ||
      checkpoint.checkpointTurnCount <= turnCount,
  );
  const retainedTurnIds = new Set(state.checkpoints.map((checkpoint) => checkpoint.turnId));
  state.turns = state.turns.filter(
    (turn) =>
      turn.historyOrigin.ordinal <= state.frozenThroughOrdinal ||
      turn.turnId === null ||
      retainedTurnIds.has(turn.turnId),
  );
  const isFrozen = (row: { readonly historyOrigin: OrchestrationHistoryOrigin }) =>
    row.historyOrigin.ordinal <= state.frozenThroughOrdinal;
  state.messages = [
    ...retainThreadMessagesAfterRevert(state.messages, retainedTurnIds, turnCount, isFrozen),
  ];
  state.proposedPlans = [
    ...retainThreadProposedPlansAfterRevert(state.proposedPlans, retainedTurnIds, isFrozen),
  ];
  state.activities = [
    ...retainThreadActivitiesAfterRevert(state.activities, retainedTurnIds, isFrozen),
  ];
}

function reconstructPrefix(
  command: ThreadForkCommand,
  sourceEvents: ReadonlyArray<OrchestrationEvent>,
): Effect.Effect<ThreadForkHistory, OrchestrationCommandInvariantError> {
  const sortedEvents = [...sourceEvents].toSorted((left, right) => left.sequence - right.sequence);
  const inherited = sortedEvents.find((event) => event.type === "thread.forked");
  const inheritedHistory =
    inherited?.type === "thread.forked" ? inherited.payload.history : undefined;
  if (inheritedHistory !== undefined) {
    const ordinal = inheritedBoundaryOrdinal(inheritedHistory, command.boundary);
    if (ordinal !== null) {
      return Effect.succeed(filterHistoryAtOrdinal(inheritedHistory, ordinal));
    }
  }

  const boundaryIndex = nativeBoundaryIndex(sortedEvents, command.boundary);
  if (boundaryIndex < 0) {
    const boundaryLabel =
      command.boundary.kind === "message"
        ? `Message '${command.boundary.messageId}'`
        : `Proposed plan '${command.boundary.planId}'`;
    return Effect.fail(
      invariant(
        command,
        hasStreamingBoundary(sortedEvents, command)
          ? `${boundaryLabel} is not complete and cannot be used as a fork boundary.`
          : `${boundaryLabel} does not exist on source thread '${command.sourceThreadId}'.`,
      ),
    );
  }

  const state = mutableHistory(inheritedHistory);
  const inheritedSequence = inherited?.sequence ?? 0;
  for (const event of sortedEvents.slice(0, boundaryIndex + 1)) {
    if (event.sequence <= inheritedSequence) continue;
    switch (event.type) {
      case "thread.message-sent":
      case "thread.harness-sync-message-imported":
        applyAssistantMessageToTurn(state, command.sourceThreadId, event);
        upsertMessage(state, command.sourceThreadId, event.payload);
        break;
      case "thread.proposed-plan-upserted":
        upsertPlan(state, command.sourceThreadId, event.payload);
        break;
      case "thread.activity-appended":
        upsertActivity(state, command.sourceThreadId, event.payload);
        break;
      case "thread.subagent-upserted":
        upsertSubagent(state, command.sourceThreadId, event.payload.subagent);
        break;
      case "thread.subagent-state-set":
        updateSubagentState(state, command.sourceThreadId, event.payload);
        break;
      case "thread.subagent-progress-set":
        updateSubagentProgress(state, command.sourceThreadId, event.payload);
        break;
      case "thread.reverted":
        applyRevert(state, event.payload.turnCount);
        break;
      default:
        applyTurnEvent(state, command.sourceThreadId, event);
        break;
    }
  }
  return Effect.succeed(forkHistory(state));
}

const remapHistory = Effect.fn("remapThreadForkHistory")(function* (input: {
  readonly sourceThreadId: ThreadId;
  readonly destinationThreadId: ThreadId;
  readonly history: ThreadForkHistory;
}) {
  const crypto = yield* Crypto.Crypto;
  const messageIds = new Map<MessageId, MessageId>();
  const planIds = new Map<string, OrchestrationProposedPlanId>();
  const activityIds = new Map<EventId, EventId>();
  const subagentIds = new Map<SubagentId, SubagentId>();
  const turnIds = new Map<TurnId, TurnId>();

  const remapMessageId = Effect.fnUntraced(function* (id: MessageId) {
    const existing = messageIds.get(id);
    if (existing !== undefined) return existing;
    const next = MessageId.make(yield* crypto.randomUUIDv4);
    messageIds.set(id, next);
    return next;
  });
  const remapPlanId = Effect.fnUntraced(function* (id: string) {
    const existing = planIds.get(id);
    if (existing !== undefined) return existing;
    const next = OrchestrationProposedPlanId.make(yield* crypto.randomUUIDv4);
    planIds.set(id, next);
    return next;
  });
  const remapActivityId = Effect.fnUntraced(function* (id: EventId) {
    const existing = activityIds.get(id);
    if (existing !== undefined) return existing;
    const next = EventId.make(yield* crypto.randomUUIDv4);
    activityIds.set(id, next);
    return next;
  });
  const remapSubagentId = Effect.fnUntraced(function* (id: SubagentId) {
    const existing = subagentIds.get(id);
    if (existing !== undefined) return existing;
    const next = SubagentId.make(yield* crypto.randomUUIDv4);
    subagentIds.set(id, next);
    return next;
  });
  const remapTurnId = Effect.fnUntraced(function* (id: TurnId) {
    const existing = turnIds.get(id);
    if (existing !== undefined) return existing;
    const next = TurnId.make(yield* crypto.randomUUIDv4);
    turnIds.set(id, next);
    return next;
  });
  const origin = (sourceId: string, ordinal: number) =>
    historyOrigin(input.sourceThreadId, sourceId, ordinal);

  const messages = yield* Effect.forEach(input.history.messages, (message) =>
    Effect.gen(function* () {
      return {
        ...message,
        id: yield* remapMessageId(message.id),
        turnId: message.turnId === null ? null : yield* remapTurnId(message.turnId),
        historyOrigin: origin(message.id, message.historyOrigin.ordinal),
      };
    }),
  );
  const proposedPlans = yield* Effect.forEach(input.history.proposedPlans, (plan) =>
    Effect.gen(function* () {
      return {
        ...plan,
        id: yield* remapPlanId(plan.id),
        turnId: plan.turnId === null ? null : yield* remapTurnId(plan.turnId),
        historyOrigin: origin(plan.id, plan.historyOrigin.ordinal),
      };
    }),
  );
  const activities = yield* Effect.forEach(input.history.activities, (activity) =>
    Effect.gen(function* () {
      return {
        ...activity,
        id: yield* remapActivityId(activity.id),
        turnId: activity.turnId === null ? null : yield* remapTurnId(activity.turnId),
        historyOrigin: origin(activity.id, activity.historyOrigin.ordinal),
      };
    }),
  );
  const subagents = yield* Effect.forEach(input.history.subagents, (subagent) =>
    Effect.gen(function* () {
      return {
        ...subagent,
        id: yield* remapSubagentId(subagent.id),
        parentId: subagent.parentId === null ? null : yield* remapSubagentId(subagent.parentId),
        latestTurn:
          subagent.latestTurn === null
            ? null
            : {
                ...subagent.latestTurn,
                turnId: yield* remapTurnId(subagent.latestTurn.turnId),
                assistantMessageId:
                  subagent.latestTurn.assistantMessageId === null
                    ? null
                    : yield* remapMessageId(subagent.latestTurn.assistantMessageId),
                historyOrigin: origin(subagent.latestTurn.turnId, subagent.historyOrigin.ordinal),
                ...(subagent.latestTurn.sourceProposedPlan !== undefined
                  ? {
                      sourceProposedPlan:
                        subagent.latestTurn.sourceProposedPlan.threadId === input.sourceThreadId
                          ? {
                              threadId: input.destinationThreadId,
                              planId: yield* remapPlanId(
                                subagent.latestTurn.sourceProposedPlan.planId,
                              ),
                            }
                          : subagent.latestTurn.sourceProposedPlan,
                    }
                  : {}),
              },
        historyOrigin: origin(subagent.id, subagent.historyOrigin.ordinal),
      };
    }),
  );
  const turns = yield* Effect.forEach(input.history.turns, (turn) =>
    Effect.gen(function* () {
      return {
        ...turn,
        turnId: turn.turnId === null ? null : yield* remapTurnId(turn.turnId),
        pendingMessageId:
          turn.pendingMessageId === null ? null : yield* remapMessageId(turn.pendingMessageId),
        assistantMessageId:
          turn.assistantMessageId === null ? null : yield* remapMessageId(turn.assistantMessageId),
        historyOrigin: origin(turn.historyOrigin.sourceId, turn.historyOrigin.ordinal),
        ...(turn.sourceProposedPlan !== undefined
          ? {
              sourceProposedPlan:
                turn.sourceProposedPlan.threadId === input.sourceThreadId
                  ? {
                      threadId: input.destinationThreadId,
                      planId: yield* remapPlanId(turn.sourceProposedPlan.planId),
                    }
                  : turn.sourceProposedPlan,
            }
          : {}),
      };
    }),
  );
  const checkpoints = yield* Effect.forEach(input.history.checkpoints, (checkpoint) =>
    Effect.gen(function* () {
      return {
        ...checkpoint,
        turnId: yield* remapTurnId(checkpoint.turnId),
        assistantMessageId:
          checkpoint.assistantMessageId === null
            ? null
            : yield* remapMessageId(checkpoint.assistantMessageId),
        historyOrigin: origin(checkpoint.checkpointRef, checkpoint.historyOrigin.ordinal),
      };
    }),
  );

  return { messages, proposedPlans, activities, subagents, turns, checkpoints };
});

function makeEventBase(input: {
  readonly eventId: EventId;
  readonly command: ThreadForkCommand;
}): Omit<PlannedEvent, "type" | "payload"> {
  return {
    eventId: input.eventId,
    aggregateKind: "thread",
    aggregateId: input.command.threadId,
    occurredAt: input.command.createdAt,
    commandId: input.command.commandId,
    causationEventId: null,
    correlationId: input.command.commandId,
    metadata: {},
  };
}

export const planThreadFork = Effect.fn("planThreadFork")(function* (input: {
  readonly command: ThreadForkCommand;
  readonly readModel: OrchestrationReadModel;
  readonly sourceEvents: ReadonlyArray<OrchestrationEvent>;
}) {
  const sourceThread = input.readModel.threads.find(
    (thread) => thread.id === input.command.sourceThreadId,
  );
  if (sourceThread === undefined) {
    return yield* invariant(
      input.command,
      `Source thread '${input.command.sourceThreadId}' does not exist.`,
    );
  }
  if (sourceThread.deletedAt !== null) {
    return yield* invariant(
      input.command,
      `Source thread '${input.command.sourceThreadId}' has been deleted and cannot be forked.`,
    );
  }
  if (input.readModel.threads.some((thread) => thread.id === input.command.threadId)) {
    return yield* invariant(
      input.command,
      `Thread '${input.command.threadId}' already exists and cannot be used as a fork target.`,
    );
  }
  if (input.command.workspace.mode === "worktree" && input.command.workspace.baseBranch === null) {
    return yield* invariant(
      input.command,
      "Worktree forks require a base branch before workspace preparation can begin.",
    );
  }
  const project = input.readModel.projects.find((entry) => entry.id === sourceThread.projectId);
  if (project === undefined || project.deletedAt !== null) {
    return yield* invariant(
      input.command,
      `Source thread '${input.command.sourceThreadId}' does not belong to an active project.`,
    );
  }

  const sourceHistory = yield* reconstructPrefix(input.command, input.sourceEvents);
  let providerForkCursor: ThreadForkHistoryTurn["providerForkCursor"];
  for (let index = sourceHistory.turns.length - 1; index >= 0; index -= 1) {
    const turn = sourceHistory.turns[index];
    if (
      turn?.providerInstanceId === input.command.modelSelection.instanceId &&
      turn.providerForkCursor !== undefined
    ) {
      providerForkCursor = turn.providerForkCursor;
      break;
    }
  }
  const history = yield* remapHistory({
    sourceThreadId: input.command.sourceThreadId,
    destinationThreadId: input.command.threadId,
    history: sourceHistory,
  });
  const handoff = measureProviderForkHandoff(history);

  const crypto = yield* Crypto.Crypto;
  const createdEventId = EventId.make(yield* crypto.randomUUIDv4);
  const forkedEventId = EventId.make(yield* crypto.randomUUIDv4);
  const createdEvent: PlannedEvent = {
    ...makeEventBase({ eventId: createdEventId, command: input.command }),
    type: "thread.created",
    payload: {
      threadId: input.command.threadId,
      projectId: sourceThread.projectId,
      title: `${sourceThread.title} (fork)`,
      modelSelection: input.command.modelSelection,
      runtimeMode: input.command.runtimeMode,
      interactionMode: input.command.interactionMode,
      branch: input.command.workspace.baseBranch,
      worktreePath: null,
      createdAt: input.command.createdAt,
      updatedAt: input.command.createdAt,
    },
  };
  const localWorkspace = input.command.workspace.mode === "local";
  const forkedEvent: PlannedEvent = {
    ...makeEventBase({ eventId: forkedEventId, command: input.command }),
    causationEventId: createdEventId,
    type: "thread.forked",
    payload: {
      threadId: input.command.threadId,
      fork: {
        provenance: {
          sourceThreadId: input.command.sourceThreadId,
          sourceTitle: sourceThread.title,
          boundary: input.command.boundary,
          forkedAt: input.command.createdAt,
        },
        workspace: {
          spec: input.command.workspace,
          status: localWorkspace ? "ready" : "pending",
          preparedAt: localWorkspace ? input.command.createdAt : null,
          lastError: null,
        },
        handoff: {
          status: "pending",
          historyInputChars: handoff.historyInputChars,
          historyAttachmentCount: handoff.historyAttachmentCount,
          remainingInputChars: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
          remainingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
          completedAt: null,
        },
        ...(providerForkCursor !== undefined ? { providerForkCursor } : {}),
      },
      history,
    },
  };
  return [createdEvent, forkedEvent] as const;
});
