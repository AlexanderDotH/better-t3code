import {
  MessageId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  type IsoDateTime,
  type ModelSelection,
  type OrchestrationSubagentSummary,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type RuntimeMode,
  type TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { getCodexServiceTierOptionValue } from "../codexModelOptions.ts";
import type {
  GeneralSubagentActionSnapshot,
  GeneralSubagentIdentity,
  GeneralSubagentSnapshot,
} from "./GeneralSubagentProtocol.ts";
import {
  parseGeneralSubagentFinalResult,
  type GeneralSubagentOutcome,
} from "./GeneralSubagentPolicy.ts";

export const GENERAL_SUBAGENT_RESULT_LIMIT = 256;

export type GeneralSubagentAdmission = "admitted" | "limit" | "nested";

export interface ActiveGeneralSubagent {
  readonly parentThreadId: ThreadId;
  readonly parentTurnId: TurnId | null;
  readonly parentRuntimeSessionId: RuntimeSessionId | null;
  readonly parentProviderInstanceId: ProviderInstanceId | null;
  readonly syntheticThreadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly subagentId: SubagentId;
  assistantMessageId: MessageId;
  task: string;
  readonly selection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  terminal: Deferred.Deferred<GeneralSubagentOutcome>;
  completed: Deferred.Deferred<void>;
  wake: Deferred.Deferred<void>;
  readonly disposed: Deferred.Deferred<void>;
  readonly retainSession: boolean;
  readonly followUps: Array<{ readonly task: string }>;
  readonly mailbox: string[];
  summary: OrchestrationSubagentSummary;
  turnId: TurnId | null;
  turnSequence: number;
  turnActive: boolean;
  sessionStarted: boolean;
  cancelled: boolean;
  disposeRequested: boolean;
  disposing: boolean;
  finalizing: boolean;
  finalized: boolean;
  finalAssistantMessage: string | null;
  detail: string | null;
  transcriptBuffer: string;
  assistantProjected: boolean;
  lastProgressFingerprint: string | null;
}

export interface GeneralSubagentWorkerInput {
  readonly uuid: string;
  readonly parentThreadId: ThreadId;
  readonly parentTurnId: TurnId | null;
  readonly parentRuntimeSessionId: RuntimeSessionId | null;
  readonly parentProviderInstanceId: ProviderInstanceId | null;
  readonly selection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly retainSession: boolean;
  readonly task: string;
  readonly name?: string;
  readonly startedAt: IsoDateTime;
}

export const makeActiveGeneralSubagent = Effect.fn("GeneralSubagentState.makeWorker")(function* (
  input: GeneralSubagentWorkerInput,
) {
  const id = `general:${input.parentThreadId}:${input.uuid}`;
  const syntheticThreadId = ThreadId.make(id);
  const runtimeSessionId = RuntimeSessionId.make(`runtime:${id}`);
  const subagentId = SubagentId.make(id);
  const reasoningEffort =
    getModelSelectionStringOptionValue(input.selection, "reasoningEffort") ??
    getModelSelectionStringOptionValue(input.selection, "effort");
  const serviceTier =
    input.providerDriver === "codex" ? getCodexServiceTierOptionValue(input.selection) : undefined;
  const summary: OrchestrationSubagentSummary = {
    id: subagentId,
    origin: "t3-managed",
    providerInstanceId: input.selection.instanceId,
    providerDriver: input.providerDriver,
    providerThreadId: syntheticThreadId,
    parentId: null,
    path: `general/${input.uuid}`,
    name: input.name ?? "General subagent",
    nickname: null,
    role: "General",
    task: input.task,
    model: input.selection.model,
    reasoningEffort: reasoningEffort ?? null,
    ...(serviceTier ? { serviceTier } : {}),
    depth: 1,
    status: "starting",
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    completedAt: null,
  };
  const worker: ActiveGeneralSubagent = {
    parentThreadId: input.parentThreadId,
    parentTurnId: input.parentTurnId,
    parentRuntimeSessionId: input.parentRuntimeSessionId,
    parentProviderInstanceId: input.parentProviderInstanceId,
    syntheticThreadId,
    runtimeSessionId,
    subagentId,
    assistantMessageId: MessageId.make(`${id}:assistant`),
    task: input.task,
    selection: input.selection,
    providerDriver: input.providerDriver,
    cwd: input.cwd,
    runtimeMode: input.runtimeMode,
    terminal: yield* Deferred.make<GeneralSubagentOutcome>(),
    completed: yield* Deferred.make<void>(),
    wake: yield* Deferred.make<void>(),
    disposed: yield* Deferred.make<void>(),
    retainSession: input.retainSession,
    followUps: [],
    mailbox: [],
    summary,
    turnId: null,
    turnSequence: 0,
    turnActive: false,
    sessionStarted: false,
    cancelled: false,
    disposeRequested: false,
    disposing: false,
    finalizing: false,
    finalized: false,
    finalAssistantMessage: null,
    detail: null,
    transcriptBuffer: "",
    assistantProjected: false,
    lastProgressFingerprint: null,
  };
  return { worker, summary, reasoningEffort: reasoningEffort ?? null };
});

export function generalSubagentIdentity(worker: ActiveGeneralSubagent): GeneralSubagentIdentity {
  return {
    agentId: worker.subagentId,
    status: worker.summary.status,
    providerInstanceId: worker.selection.instanceId,
    providerDriver: worker.providerDriver,
    model: worker.selection.model,
    reasoningEffort: worker.summary.reasoningEffort,
  };
}

export function generalSubagentActionSnapshot(
  worker: ActiveGeneralSubagent,
): GeneralSubagentActionSnapshot {
  return {
    ...generalSubagentIdentity(worker),
    task: worker.task,
    output: worker.finalAssistantMessage,
    detail: worker.detail,
  };
}

export function generalSubagentSnapshot(worker: ActiveGeneralSubagent): GeneralSubagentSnapshot {
  const message =
    worker.finalAssistantMessage ??
    worker.detail ??
    `Subagent ${worker.summary.status} without a final assistant message.`;
  return {
    ...generalSubagentIdentity(worker),
    result: generalSubagentIsBusy(worker)
      ? null
      : parseGeneralSubagentFinalResult(message, worker.subagentId),
  };
}

export function generalSubagentIsBusy(worker: ActiveGeneralSubagent): boolean {
  return (
    !worker.finalized &&
    (worker.turnActive ||
      worker.followUps.length > 0 ||
      worker.summary.status === "starting" ||
      worker.summary.status === "running")
  );
}

export function makeGeneralSubagentStateStore(settledResultLimit = GENERAL_SUBAGENT_RESULT_LIMIT) {
  const workersById = new Map<SubagentId, ActiveGeneralSubagent>();
  const workersByThread = new Map<ThreadId, ActiveGeneralSubagent>();
  const settledOrder: SubagentId[] = [];

  const pruneSettled = () => {
    while (settledOrder.length > settledResultLimit) {
      const evicted = settledOrder.shift();
      if (evicted !== undefined) workersById.delete(evicted);
    }
  };

  const admit = (
    worker: ActiveGeneralSubagent,
    maximumDirectChildren: number,
  ): GeneralSubagentAdmission => {
    if (workersByThread.has(worker.parentThreadId)) return "nested";
    const liveDirectChildren = Array.from(workersById.values()).filter(
      (candidate) => candidate.parentThreadId === worker.parentThreadId && !candidate.finalized,
    ).length;
    if (liveDirectChildren >= maximumDirectChildren) return "limit";
    workersById.set(worker.subagentId, worker);
    workersByThread.set(worker.syntheticThreadId, worker);
    return "admitted";
  };

  const markSettled = (worker: ActiveGeneralSubagent): void => {
    worker.finalized = true;
    workersByThread.delete(worker.syntheticThreadId);
    settledOrder.push(worker.subagentId);
    pruneSettled();
  };

  const forget = (worker: ActiveGeneralSubagent): void => {
    workersById.delete(worker.subagentId);
    workersByThread.delete(worker.syntheticThreadId);
    const settledIndex = settledOrder.lastIndexOf(worker.subagentId);
    if (settledIndex >= 0) settledOrder.splice(settledIndex, 1);
  };

  return {
    admit,
    markSettled,
    forget,
    getById: (subagentId: SubagentId) => workersById.get(subagentId),
    getByThread: (threadId: ThreadId) => workersByThread.get(threadId),
    all: () => Array.from(workersById.values()),
    allByThread: () => Array.from(workersByThread.values()),
  };
}

export type GeneralSubagentStateStore = ReturnType<typeof makeGeneralSubagentStateStore>;
