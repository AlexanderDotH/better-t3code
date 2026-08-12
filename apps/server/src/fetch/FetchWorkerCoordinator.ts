import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  ProviderDriverKind,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  type IsoDateTime,
  type ModelSelection,
  type OrchestrationSession,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
  type ProviderRuntimeEvent,
  type ServerProviderFetchWorkerCommandExecutionPolicy,
  type TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runtimeEventToActivities } from "../orchestration/Layers/ProviderRuntimeIngestion.ts";
import {
  planFetchExploration,
  type FetchExplorationPlanningOutcome,
} from "./FetchExplorationPlanner.ts";

export const FETCH_WORKER_TIMEOUT = Duration.minutes(5);
export const FETCH_ABORT_FORCE_DELAY = Duration.seconds(5);
export const FETCH_WORKER_FINDINGS_MAX_CHARS = 32_000;
export const FETCH_CONTEXT_MAX_CHARS = 64_000;
const FETCH_TRANSCRIPT_FLUSH_CHARS = 2_048;
const FINDINGS_TRUNCATION_MARKER = "\n... [worker findings truncated at 32,000 characters]";
const CONTEXT_TRUNCATION_MARKER = "\n... [truncated fairly for Fetch context]";
const FAILURE_DETAIL_MAX_CHARS = 1_000;
const FAILURE_DETAIL_TRUNCATION_MARKER = "... [failure detail truncated]";

export interface FetchWorkerAssignment {
  readonly scope: string;
  readonly questions: ReadonlyArray<string>;
}

export type FetchWorkerOutcomeStatus = "completed" | "error" | "timed-out" | "interrupted";

export interface FetchWorkerOutcome {
  readonly index: number;
  readonly scope: string;
  readonly status: FetchWorkerOutcomeStatus;
  readonly findings: string;
  readonly detail?: string;
}

export type FetchApprovalAction = "accept" | "decline" | "fail-worker";

export interface FetchRunInput {
  readonly threadId: ThreadId;
  readonly parentTurnId?: TurnId;
  readonly cwd: string;
  readonly userRequest: string;
  readonly modelSelection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly maxRecommendedWorkers: number;
  readonly commandExecutionPolicy: ServerProviderFetchWorkerCommandExecutionPolicy;
  /** Remaining main-provider input capacity available to Fetch context. */
  readonly contextMaxChars?: number;
  /** Present only for an Auto-selected Spark run. */
  readonly lunaFallback?: {
    readonly modelSelection: ModelSelection;
    readonly providerDriver: ProviderDriverKind;
    readonly maxRecommendedWorkers: number;
    readonly commandExecutionPolicy: ServerProviderFetchWorkerCommandExecutionPolicy;
  };
}

export interface FetchRunResult {
  readonly runId: string;
  readonly status: "skipped" | "completed" | "cancelled" | "unavailable";
  readonly context?: string;
  readonly warnings: ReadonlyArray<string>;
  readonly plannedWorkers: number;
  readonly completedWorkers: number;
  readonly successfulWorkers: number;
  readonly providerInstanceId: ModelSelection["instanceId"];
  readonly providerDriver: ProviderDriverKind;
  readonly modelSelection: ModelSelection;
}

export interface FetchHandoffInput {
  readonly threadId: ThreadId;
  readonly runId: string;
}

export interface FetchInterruptInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly requestedAt: IsoDateTime;
}

export type FetchWorkerCoordinatorError =
  | OrchestrationDispatchError
  | ProjectionRepositoryError
  | PlatformError.PlatformError;

export interface FetchWorkerCoordinatorShape {
  readonly run: (
    input: FetchRunInput,
  ) => Effect.Effect<FetchRunResult, FetchWorkerCoordinatorError>;
  readonly handoffToMain: <A, E, R>(
    input: FetchHandoffInput,
    sendMainEffect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<boolean, E, R>;
  readonly requestInterrupt: (
    input: FetchInterruptInput,
  ) => Effect.Effect<boolean, FetchWorkerCoordinatorError>;
  readonly hasActiveRun: (threadId: ThreadId) => Effect.Effect<boolean>;
}

export class FetchWorkerCoordinator extends Context.Service<
  FetchWorkerCoordinator,
  FetchWorkerCoordinatorShape
>()("t3/fetch/FetchWorkerCoordinator") {}

export function buildFetchWorkerPrompt(input: {
  readonly userRequest: string;
  readonly scope: string;
  readonly questions: ReadonlyArray<string>;
}): string {
  const questions = input.questions.map((question) => `- ${question}`).join("\n");
  return `T3 FETCH — READ-ONLY REPOSITORY EXPLORATION

Original user request:
${input.userRequest}

Your independent scope:
${input.scope}

Questions to answer:
${questions}

Return concise exploratory evidence with exact paths, symbols, existing conventions, focused tests, and risks. Clearly distinguish confirmed evidence from inference.

Policy:
- Do not edit files, apply patches, create files, or change repository state.
- Do not run mutating commands or make external changes.
- Use the authenticated T3 workspace_context tool for batched repository searches and bounded reads when it is available. Otherwise use only provider-native bounded file, path, and text-search tools.
- Do not execute shell or terminal commands, including read-only Git commands, and do not use general-purpose code execution tools to invoke them indirectly.
- Do not ask the user questions; work only from the supplied request and repository.
- Do not start or delegate to nested agents.
- Do not implement the requested change. Return discovery findings only.`;
}

export function fetchApprovalAction(input: {
  readonly requestType: string;
  readonly providerDriver: ProviderDriverKind;
  readonly commandExecutionPolicy: ServerProviderFetchWorkerCommandExecutionPolicy;
}): FetchApprovalAction {
  if (input.requestType === "tool_user_input") return "fail-worker";
  if (input.requestType === "file_read_approval") return "accept";
  return "decline";
}

function modelOptionsLabel(selection: ModelSelection): string {
  if (!selection.options || selection.options.length === 0) return "default traits";
  return selection.options.map(({ id, value }) => `${id}=${String(value)}`).join(", ");
}

function workerFixedSection(outcome: FetchWorkerOutcome): string {
  const heading = `\n## Worker ${outcome.index + 1}: ${outcome.scope}\n`;
  if (outcome.status === "completed" && outcome.findings.trim().length > 0) return heading;
  const rawDetail = outcome.detail?.trim();
  const detail =
    rawDetail && rawDetail.length > FAILURE_DETAIL_MAX_CHARS
      ? `${rawDetail.slice(
          0,
          FAILURE_DETAIL_MAX_CHARS - FAILURE_DETAIL_TRUNCATION_MARKER.length,
        )}${FAILURE_DETAIL_TRUNCATION_MARKER}`
      : rawDetail;
  return `${heading}[${outcome.status}${detail ? `: ${detail}` : ""}]\n`;
}

function allocateFairly(lengths: ReadonlyArray<number>, budget: number): number[] {
  const allocations = lengths.map(() => 0);
  let remaining = Math.max(0, budget);
  let pending = lengths.map((_, index) => index);
  while (pending.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / pending.length);
    if (share === 0) {
      for (const index of pending.slice(0, remaining)) allocations[index]! += 1;
      break;
    }
    const completed = pending.filter((index) => lengths[index]! <= share);
    if (completed.length === 0) {
      for (const index of pending) allocations[index]! += share;
      remaining -= share * pending.length;
      for (const index of pending.slice(0, remaining)) allocations[index]! += 1;
      break;
    }
    for (const index of completed) {
      allocations[index] = lengths[index]!;
      remaining -= lengths[index]!;
    }
    const completedSet = new Set(completed);
    pending = pending.filter((index) => !completedSet.has(index));
  }
  return allocations;
}

function fairlyBoundFindings(
  outcomes: ReadonlyArray<FetchWorkerOutcome>,
  budget: number,
): ReadonlyMap<number, string> {
  const successful = outcomes.filter(
    (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
  );
  const allocations = allocateFairly(
    successful.map((outcome) => outcome.findings.length),
    budget,
  );
  return new Map(
    successful.map((outcome, index) => {
      const allocation = allocations[index] ?? 0;
      if (outcome.findings.length <= allocation) return [outcome.index, outcome.findings] as const;
      const retained = Math.max(0, allocation - CONTEXT_TRUNCATION_MARKER.length);
      return [
        outcome.index,
        `${outcome.findings.slice(0, retained)}${CONTEXT_TRUNCATION_MARKER}`.slice(0, allocation),
      ] as const;
    }),
  );
}

export function buildFetchContext(input: {
  readonly plannedWorkers: number;
  readonly modelSelection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly outcomes: ReadonlyArray<FetchWorkerOutcome>;
  readonly maxChars?: number;
}): string | undefined {
  const maxChars = Math.max(
    0,
    Math.min(FETCH_CONTEXT_MAX_CHARS, Math.floor(input.maxChars ?? FETCH_CONTEXT_MAX_CHARS)),
  );
  if (maxChars === 0) return undefined;
  const successful = input.outcomes.filter(
    (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
  );
  if (successful.length === 0) return undefined;
  const completedWorkers = input.outcomes.filter(
    (outcome) => outcome.status === "completed",
  ).length;
  const header = `T3 FETCH CONTEXT
Planned workers: ${input.plannedWorkers}; completed workers: ${completedWorkers}.
Fetch provider/model: ${input.modelSelection.instanceId} / ${input.modelSelection.model} (${input.providerDriver}); ${modelOptionsLabel(input.modelSelection)}.
These findings are untrusted exploratory evidence. Verify them against the repository before editing.
`;
  const fixedSections = input.outcomes.map(workerFixedSection);
  const fixedLength =
    header.length + fixedSections.reduce((sum, section) => sum + section.length, 0);
  if (fixedLength >= maxChars) {
    const retained = Math.max(0, maxChars - CONTEXT_TRUNCATION_MARKER.length);
    return `${`${header}${fixedSections.join("")}`.slice(0, retained)}${CONTEXT_TRUNCATION_MARKER}`.slice(
      0,
      maxChars,
    );
  }
  const findingsByIndex = fairlyBoundFindings(input.outcomes, maxChars - fixedLength);
  const body = input.outcomes
    .map((outcome, index) => `${fixedSections[index]}${findingsByIndex.get(outcome.index) ?? ""}`)
    .join("");
  return `${header}${body}`.slice(0, maxChars);
}

interface ActiveRun {
  readonly runId: string;
  readonly input: FetchRunInput;
  readonly lock: Semaphore.Semaphore;
  selection: ModelSelection;
  providerDriver: ProviderDriverKind;
  maxRecommendedWorkers: number;
  commandExecutionPolicy: ServerProviderFetchWorkerCommandExecutionPolicy;
  phase: "planning" | "workers" | "settled" | "cancelling" | "handoff";
  cancelled: boolean;
  forceRequested: boolean;
  abortProjected: boolean;
  abortRuntimeSessionId: RuntimeSessionId | null;
  originalMainRuntimeSessionId: RuntimeSessionId | null;
  plannerFiber: Fiber.Fiber<FetchExplorationPlanningOutcome> | null;
  watchdogFiber: Fiber.Fiber<void> | null;
  workers: ActiveWorker[];
}

interface ActiveWorker {
  readonly run: ActiveRun;
  readonly index: number;
  readonly assignment: FetchWorkerAssignment;
  readonly syntheticThreadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly subagentId: SubagentId;
  readonly assistantMessageId: MessageId;
  readonly terminal: Deferred.Deferred<FetchWorkerOutcome>;
  summary: OrchestrationSubagentSummary;
  turnId: TurnId | null;
  sessionStarted: boolean;
  findings: string;
  findingsTruncated: boolean;
  transcriptBuffer: string;
  assistantProjected: boolean;
}

function syntheticWorkerId(parentThreadId: ThreadId, runId: string, index: number): string {
  return `fetch:${parentThreadId}:${runId}:${index}`;
}

function appendFindings(worker: ActiveWorker, delta: string): void {
  if (worker.findingsTruncated || delta.length === 0) return;
  const available = FETCH_WORKER_FINDINGS_MAX_CHARS - worker.findings.length;
  if (delta.length <= available) {
    worker.findings += delta;
    return;
  }
  const retained = Math.max(0, available - FINDINGS_TRUNCATION_MARKER.length);
  worker.findings += `${delta.slice(0, retained)}${FINDINGS_TRUNCATION_MARKER}`.slice(0, available);
  worker.findingsTruncated = true;
}

function terminalStatus(event: ProviderRuntimeEvent): FetchWorkerOutcomeStatus | null {
  if (event.type === "turn.aborted") return "interrupted";
  if (event.type === "turn.completed") {
    if (event.payload.state === "completed") return "completed";
    if (event.payload.state === "interrupted" || event.payload.state === "cancelled") {
      return "interrupted";
    }
    return "error";
  }
  if (event.type === "session.exited") return "error";
  if (event.type === "session.state.changed" && event.payload.state === "error") return "error";
  return null;
}

function terminalDetail(event: ProviderRuntimeEvent): string | undefined {
  if (event.type === "turn.aborted") return event.payload.reason;
  if (event.type === "turn.completed") {
    return event.payload.errorMessage ?? event.payload.stopReason ?? undefined;
  }
  if (event.type === "session.exited") return event.payload.reason;
  if (event.type === "session.state.changed") return event.payload.reason;
  return undefined;
}

function isNestedAgentEvent(event: ProviderRuntimeEvent): boolean {
  return (
    event.subagentId !== undefined ||
    event.type === "subagent.discovered" ||
    event.type === "subagent.state.changed" ||
    ((event.type === "item.started" || event.type === "item.updated") &&
      event.payload.itemType === "collab_agent_tool_call")
  );
}

const BOUNDED_READ_TOOL_NAMES = new Set(["read", "grep", "glob", "list", "search", "find"]);

function isProviderNativeBoundedReadEvent(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >,
): boolean {
  if (event.payload.itemType !== "dynamic_tool_call") return false;
  if (!Predicate.isObject(event.payload.data)) return false;
  const nestedItem = Predicate.isObject(event.payload.data.item)
    ? event.payload.data.item
    : undefined;
  const candidates = [
    event.payload.data.toolName,
    event.payload.data.tool,
    event.payload.data.kind,
    nestedItem?.toolName,
    nestedItem?.tool,
    nestedItem?.kind,
  ];
  return candidates.some(
    (candidate) =>
      Predicate.isString(candidate) && BOUNDED_READ_TOOL_NAMES.has(candidate.trim().toLowerCase()),
  );
}

function isAuthenticatedWorkspaceContextEvent(
  event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >,
): boolean {
  if (event.payload.itemType !== "mcp_tool_call") return false;
  if (!Predicate.isObject(event.payload.data)) return false;
  const item = Predicate.isObject(event.payload.data.item) ? event.payload.data.item : undefined;
  const server = Predicate.isString(item?.server) ? item.server.trim().toLowerCase() : undefined;
  const tool = Predicate.isString(item?.tool) ? item.tool.trim().toLowerCase() : undefined;
  return server === "t3-code" && tool === "workspace_context";
}

function isMutationEvent(event: ProviderRuntimeEvent): boolean {
  if (event.type === "files.persisted") return true;
  if (
    event.type !== "item.started" &&
    event.type !== "item.updated" &&
    event.type !== "item.completed"
  ) {
    return false;
  }
  if (event.payload.itemType === "file_change") return true;
  if (event.payload.itemType === "command_execution") return true;
  if (event.payload.itemType === "mcp_tool_call") {
    return !isAuthenticatedWorkspaceContextEvent(event);
  }
  return event.payload.itemType === "dynamic_tool_call" && !isProviderNativeBoundedReadEvent(event);
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const providerService = yield* ProviderService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const coordinatorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const activeRuns = new Map<ThreadId, ActiveRun>();
  const workersByThread = new Map<ThreadId, ActiveWorker>();

  const commandId = Effect.fn("FetchWorkerCoordinator.commandId")(function* (
    runId: string,
    tag: string,
  ) {
    return CommandId.make(`server:fetch:${runId}:${tag}:${yield* crypto.randomUUIDv4}`);
  });

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const dispatchSummary = Effect.fn("FetchWorkerCoordinator.dispatchSummary")(function* (
    worker: ActiveWorker,
    summary: OrchestrationSubagentSummary,
  ) {
    worker.summary = summary;
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.upsert",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-summary`),
      threadId: worker.run.input.threadId,
      subagent: summary,
      createdAt: summary.updatedAt,
    });
  });

  const dispatchWorkerState = Effect.fn("FetchWorkerCoordinator.dispatchWorkerState")(function* (
    worker: ActiveWorker,
    status: OrchestrationSubagentStatus,
    statusMessage: string | null,
    updatedAt: string,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.state.set",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-state-${status}`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      status,
      statusMessage,
      updatedAt,
    });
  });

  const dispatchProgress = Effect.fn("FetchWorkerCoordinator.dispatchProgress")(function* (
    worker: ActiveWorker,
    input: { readonly kind: string; readonly summary: string; readonly detail: string | null },
    updatedAt: string,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.progress.set",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-progress`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      progress: { ...input, createdAt: updatedAt },
      updatedAt,
    });
  });

  const flushTranscript = Effect.fn("FetchWorkerCoordinator.flushTranscript")(function* (
    worker: ActiveWorker,
    createdAt: string,
  ) {
    if (worker.transcriptBuffer.length === 0) return;
    const delta = worker.transcriptBuffer;
    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.delta",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-assistant-delta`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      messageId: worker.assistantMessageId,
      delta,
      ...(worker.turnId !== null ? { turnId: worker.turnId } : {}),
      createdAt,
    });
    worker.transcriptBuffer = worker.transcriptBuffer.slice(delta.length);
    worker.assistantProjected = true;
  });

  const completeTranscript = Effect.fn("FetchWorkerCoordinator.completeTranscript")(function* (
    worker: ActiveWorker,
    createdAt: string,
  ) {
    yield* flushTranscript(worker, createdAt);
    if (!worker.assistantProjected) return;
    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-assistant-complete`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      messageId: worker.assistantMessageId,
      ...(worker.turnId !== null ? { turnId: worker.turnId } : {}),
      createdAt,
    });
  });

  const appendActivity = Effect.fn("FetchWorkerCoordinator.appendActivity")(function* (
    worker: ActiveWorker,
    event: ProviderRuntimeEvent,
  ) {
    const activities = runtimeEventToActivities(event);
    yield* Effect.forEach(
      activities,
      (activity) =>
        commandId(worker.run.runId, `worker-${worker.index}-activity`).pipe(
          Effect.flatMap((activityCommandId) =>
            orchestrationEngine.dispatch({
              type: "thread.activity.append",
              commandId: activityCommandId,
              threadId: worker.run.input.threadId,
              subagentId: worker.subagentId,
              activity: {
                ...activity,
                id: EventId.make(`fetch:${worker.run.runId}:${worker.index}:${activity.id}`),
                payload: {
                  ...(typeof activity.payload === "object" && activity.payload !== null
                    ? activity.payload
                    : { value: activity.payload }),
                  eventId: event.eventId,
                  provider: event.provider,
                  providerInstanceId: event.providerInstanceId ?? null,
                  runtimeSessionId: event.runtimeSessionId ?? null,
                  canonicalPayload: event.payload,
                },
              },
              createdAt: activity.createdAt,
            }),
          ),
        ),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
    const first = activities[0];
    if (first) {
      yield* dispatchProgress(
        worker,
        { kind: first.kind, summary: first.summary, detail: null },
        event.createdAt,
      );
    }
  });

  const settleWorker = (worker: ActiveWorker, status: FetchWorkerOutcomeStatus, detail?: string) =>
    Deferred.succeed(worker.terminal, {
      index: worker.index,
      scope: worker.assignment.scope,
      status,
      findings: worker.findings,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    }).pipe(Effect.ignore);

  const workerAbortTarget = (worker: ActiveWorker) => ({
    threadId: worker.syntheticThreadId,
    runtimeSessionId: worker.runtimeSessionId,
    turnId: worker.turnId,
    providerInstanceId: worker.run.selection.instanceId,
  });

  const interruptWorker = (worker: ActiveWorker) =>
    worker.sessionStarted
      ? providerService.interruptAbortTarget(workerAbortTarget(worker)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Fetch worker cooperative interrupt failed", {
              threadId: worker.syntheticThreadId,
              runtimeSessionId: worker.runtimeSessionId,
              cause: Cause.pretty(cause),
            }),
          ),
        )
      : Effect.void;

  const forceStopWorker = (worker: ActiveWorker) =>
    worker.sessionStarted
      ? providerService.forceStopAbortTarget(workerAbortTarget(worker)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Fetch worker force stop failed", {
              threadId: worker.syntheticThreadId,
              runtimeSessionId: worker.runtimeSessionId,
              cause: Cause.pretty(cause),
            }),
          ),
          Effect.timeoutOption(FETCH_ABORT_FORCE_DELAY),
          Effect.asVoid,
        )
      : Effect.void;

  const failForPolicyViolation = Effect.fn("FetchWorkerCoordinator.failForPolicyViolation")(
    function* (worker: ActiveWorker, detail: string) {
      yield* interruptWorker(worker).pipe(
        Effect.timeoutOption(FETCH_ABORT_FORCE_DELAY),
        Effect.asVoid,
      );
      yield* settleWorker(worker, "error", detail);
    },
  );

  const handleApproval = Effect.fn("FetchWorkerCoordinator.handleApproval")(function* (
    worker: ActiveWorker,
    event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
  ) {
    const action = fetchApprovalAction({
      requestType: event.payload.requestType,
      providerDriver: worker.run.providerDriver,
      commandExecutionPolicy: worker.run.commandExecutionPolicy,
    });
    if (action === "fail-worker") {
      yield* failForPolicyViolation(worker, "Fetch workers cannot request hidden user input.");
      return;
    }
    if (!event.requestId) {
      yield* failForPolicyViolation(worker, "Fetch worker emitted an approval without an id.");
      return;
    }
    const response = yield* Effect.exit(
      providerService.respondToRequest({
        threadId: worker.syntheticThreadId,
        requestId: ApprovalRequestId.make(event.requestId),
        decision: action,
      }),
    );
    if (Exit.isFailure(response)) {
      yield* failForPolicyViolation(
        worker,
        `Fetch approval handling failed: ${Cause.pretty(response.cause)}`,
      );
    }
  });

  const handleWorkerEvent = Effect.fn("FetchWorkerCoordinator.handleWorkerEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const worker = workersByThread.get(event.threadId);
    if (!worker) return;
    if (event.runtimeSessionId !== worker.runtimeSessionId) return;
    if (
      event.providerInstanceId !== undefined &&
      event.providerInstanceId !== worker.run.selection.instanceId
    ) {
      return;
    }
    if (worker.run.cancelled) return;

    if (isNestedAgentEvent(event)) {
      yield* failForPolicyViolation(worker, "Nested agents are prohibited in Fetch workers.");
      yield* appendActivity(worker, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to project a Fetch policy event", {
            eventId: event.eventId,
            threadId: event.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      return;
    }
    if (isMutationEvent(event)) {
      yield* failForPolicyViolation(worker, "A mutation-capable Fetch tool was blocked.");
      yield* appendActivity(worker, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to project a Fetch policy event", {
            eventId: event.eventId,
            threadId: event.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      return;
    }
    if (event.type === "user-input.requested") {
      yield* failForPolicyViolation(worker, "Fetch workers cannot request hidden user input.");
      yield* appendActivity(worker, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to project a Fetch policy event", {
            eventId: event.eventId,
            threadId: event.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      return;
    }
    if (event.type === "request.opened") yield* handleApproval(worker, event);

    if (event.type === "turn.started" && event.turnId) worker.turnId = event.turnId;
    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      appendFindings(worker, event.payload.delta);
      worker.transcriptBuffer += event.payload.delta;
    }
    if (
      event.type === "item.completed" &&
      event.payload.itemType === "assistant_message" &&
      worker.findings.length === 0 &&
      event.payload.detail
    ) {
      appendFindings(worker, event.payload.detail);
      worker.transcriptBuffer += event.payload.detail;
    }
    const status = terminalStatus(event);
    if (status) yield* settleWorker(worker, status, terminalDetail(event));

    yield* Effect.gen(function* () {
      yield* appendActivity(worker, event);
      if (event.type === "thread.started" && event.payload.providerThreadId) {
        yield* dispatchSummary(worker, {
          ...worker.summary,
          providerThreadId: event.payload.providerThreadId,
          updatedAt: event.createdAt,
        });
      }
      if (event.type === "turn.started") {
        yield* dispatchWorkerState(worker, "running", null, event.createdAt);
      }
      if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
        if (worker.transcriptBuffer.length >= FETCH_TRANSCRIPT_FLUSH_CHARS) {
          yield* flushTranscript(worker, event.createdAt);
        }
        yield* dispatchProgress(
          worker,
          { kind: "fetch.findings", summary: "Writing Fetch findings", detail: null },
          event.createdAt,
        );
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Fetch worker event projection failed", {
          eventId: event.eventId,
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  yield* Stream.runForEach(providerService.streamEvents, (event) =>
    handleWorkerEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Fetch worker event projection failed", {
          eventId: event.eventId,
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    ),
  ).pipe(Effect.forkIn(coordinatorScope));

  const makeWorker = Effect.fn("FetchWorkerCoordinator.makeWorker")(function* (
    run: ActiveRun,
    assignment: FetchWorkerAssignment,
    index: number,
  ) {
    const id = syntheticWorkerId(run.input.threadId, run.runId, index);
    const syntheticThreadId = ThreadId.make(id);
    const runtimeSessionId = RuntimeSessionId.make(`runtime:${id}`);
    const subagentId = SubagentId.make(id);
    const assistantMessageId = MessageId.make(`${id}:assistant`);
    const terminal = yield* Deferred.make<FetchWorkerOutcome>();
    const startedAt = yield* nowIso;
    const reasoningEffort =
      getModelSelectionStringOptionValue(run.selection, "reasoningEffort") ??
      getModelSelectionStringOptionValue(run.selection, "effort");
    const summary: OrchestrationSubagentSummary = {
      id: subagentId,
      origin: "t3-fetch",
      providerInstanceId: run.selection.instanceId,
      providerDriver: run.providerDriver,
      providerThreadId: syntheticThreadId,
      parentId: null,
      path: `fetch/${run.runId}/${index}`,
      name: `Fetch ${index + 1}`,
      nickname: null,
      role: "Fetch",
      task: assignment.scope,
      model: run.selection.model,
      reasoningEffort: reasoningEffort ?? null,
      depth: 1,
      status: "starting",
      statusMessage: null,
      latestProgress: null,
      latestTurn: null,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
    };
    const worker: ActiveWorker = {
      run,
      index,
      assignment,
      syntheticThreadId,
      runtimeSessionId,
      subagentId,
      assistantMessageId,
      terminal,
      summary,
      turnId: null,
      sessionStarted: false,
      findings: "",
      findingsTruncated: false,
      transcriptBuffer: "",
      assistantProjected: false,
    };
    workersByThread.set(syntheticThreadId, worker);
    yield* dispatchSummary(worker, summary);
    const prompt = buildFetchWorkerPrompt({
      userRequest: run.input.userRequest,
      scope: assignment.scope,
      questions: assignment.questions,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.message.import",
      commandId: yield* commandId(run.runId, `worker-${index}-user-message`),
      threadId: run.input.threadId,
      subagentId,
      message: {
        id: MessageId.make(`${id}:user`),
        role: "user",
        text: prompt,
        turnId: null,
        streaming: false,
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    });
    return worker;
  });

  const cleanupWorker = Effect.fn("FetchWorkerCoordinator.cleanupWorker")(function* (
    worker: ActiveWorker,
  ) {
    const target = {
      threadId: worker.syntheticThreadId,
      runtimeSessionId: worker.runtimeSessionId,
      providerInstanceId: worker.run.selection.instanceId,
    };
    const stopped = yield* providerService
      .stopTransientSession(target)
      .pipe(Effect.exit, Effect.timeoutOption(FETCH_ABORT_FORCE_DELAY));
    if (Option.isNone(stopped)) {
      yield* Effect.logWarning("Fetch transient session cleanup timed out", target);
      yield* forceStopWorker(worker);
    } else if (Exit.isFailure(stopped.value)) {
      yield* Effect.logWarning("Fetch transient session cleanup failed", {
        ...target,
        cause: Cause.pretty(stopped.value.cause),
      });
      yield* forceStopWorker(worker);
    }
    workersByThread.delete(worker.syntheticThreadId);
  });

  const finalizeWorker = Effect.fn("FetchWorkerCoordinator.finalizeWorker")(function* (
    worker: ActiveWorker,
    outcome: FetchWorkerOutcome,
  ) {
    return yield* Effect.gen(function* () {
      const completedAt = yield* nowIso;
      yield* completeTranscript(worker, completedAt).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to finalize a Fetch worker transcript", {
            threadId: worker.syntheticThreadId,
            runtimeSessionId: worker.runtimeSessionId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      const orchestrationStatus: OrchestrationSubagentStatus =
        outcome.status === "timed-out"
          ? "error"
          : outcome.status === "completed"
            ? "completed"
            : outcome.status;
      yield* dispatchSummary(worker, {
        ...worker.summary,
        status: orchestrationStatus,
        statusMessage:
          outcome.status === "timed-out" ? "Fetch worker timed out after five minutes." : null,
        latestProgress: {
          kind: `fetch.${outcome.status}`,
          summary:
            outcome.status === "completed"
              ? "Fetch findings ready"
              : outcome.status === "timed-out"
                ? "Fetch worker timed out"
                : outcome.status === "interrupted"
                  ? "Fetch worker interrupted"
                  : "Fetch worker failed",
          detail: outcome.detail ?? null,
          createdAt: completedAt,
        },
        latestTurn:
          worker.turnId === null
            ? worker.summary.latestTurn
            : {
                turnId: worker.turnId,
                state:
                  outcome.status === "completed"
                    ? "completed"
                    : outcome.status === "interrupted"
                      ? "interrupted"
                      : "error",
                requestedAt: worker.summary.startedAt,
                startedAt: worker.summary.startedAt,
                completedAt,
                assistantMessageId: worker.assistantProjected ? worker.assistantMessageId : null,
              },
        updatedAt: completedAt,
        completedAt,
      });
      return { ...outcome, findings: worker.findings };
    }).pipe(Effect.ensuring(cleanupWorker(worker)));
  });

  const runWorkerLifecycle = Effect.fn("FetchWorkerCoordinator.runWorkerLifecycle")(function* (
    worker: ActiveWorker,
  ) {
    if (worker.run.cancelled) {
      return {
        index: worker.index,
        scope: worker.assignment.scope,
        status: "interrupted",
        findings: worker.findings,
        detail: "Fetch was cancelled before this worker started.",
      } satisfies FetchWorkerOutcome;
    }
    const prompt = buildFetchWorkerPrompt({
      userRequest: worker.run.input.userRequest,
      scope: worker.assignment.scope,
      questions: worker.assignment.questions,
    });
    worker.sessionStarted = true;
    const started = yield* Effect.exit(
      providerService.startTransientSession(
        worker.syntheticThreadId,
        {
          threadId: worker.syntheticThreadId,
          purpose: "fetch-worker",
          runtimeSessionId: worker.runtimeSessionId,
          providerInstanceId: worker.run.selection.instanceId,
          cwd: worker.run.input.cwd,
          modelSelection: worker.run.selection,
          freshSession: true,
          approvalPolicy: "on-request",
          sandboxMode: "read-only",
          runtimeMode: "approval-required",
        },
        { workspaceContextThreadId: worker.run.input.threadId },
      ),
    );
    if (Exit.isFailure(started)) {
      const failed: FetchWorkerOutcome = {
        index: worker.index,
        scope: worker.assignment.scope,
        status: worker.run.cancelled ? "interrupted" : "error",
        findings: worker.findings,
        detail: Cause.pretty(started.cause),
      };
      return failed;
    }
    if (started.value.runtimeSessionId !== worker.runtimeSessionId) {
      const failed: FetchWorkerOutcome = {
        index: worker.index,
        scope: worker.assignment.scope,
        status: "error",
        findings: worker.findings,
        detail: "Transient provider session returned a mismatched runtime generation.",
      };
      return failed;
    }
    if (worker.run.cancelled) yield* settleWorker(worker, "interrupted", "Fetch was cancelled.");

    const sent = worker.run.cancelled
      ? null
      : yield* Effect.exit(
          providerService.sendTurn({
            threadId: worker.syntheticThreadId,
            input: prompt,
            modelSelection: worker.run.selection,
            interactionMode: "plan",
          }),
        );
    if (sent && Exit.isFailure(sent)) {
      yield* settleWorker(worker, "error", Cause.pretty(sent.cause));
    }
    if (sent && Exit.isSuccess(sent)) {
      worker.turnId = sent.value.turnId;
      const updatedAt = yield* nowIso;
      yield* dispatchSummary(worker, {
        ...worker.summary,
        status: "running",
        latestTurn: {
          turnId: sent.value.turnId,
          state: "running",
          requestedAt: updatedAt,
          startedAt: updatedAt,
          completedAt: null,
          assistantMessageId: null,
        },
        updatedAt,
      });
    }

    return yield* Deferred.await(worker.terminal);
  });

  const runWorker = Effect.fn("FetchWorkerCoordinator.runWorker")(function* (worker: ActiveWorker) {
    const lifecycle = runWorkerLifecycle(worker).pipe(
      Effect.flatMap((outcome) => finalizeWorker(worker, outcome)),
      Effect.timeoutOption(FETCH_WORKER_TIMEOUT),
    );
    const result = yield* lifecycle;
    if (Option.isSome(result)) return result.value;
    yield* forceStopWorker(worker);
    return yield* finalizeWorker(worker, {
      index: worker.index,
      scope: worker.assignment.scope,
      status: "timed-out",
      findings: worker.findings,
      detail: "Five-minute Fetch worker lifecycle timeout.",
    });
  });

  const runPlanner = Effect.fn("FetchWorkerCoordinator.runPlanner")(function* (run: ActiveRun) {
    const execute = (selection: ModelSelection) =>
      planFetchExploration({
        cwd: run.input.cwd,
        userRequest: run.input.userRequest,
        maxRecommendedWorkers: run.maxRecommendedWorkers,
        modelSelection: selection,
      }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));
    const firstFiber = yield* execute(run.selection).pipe(Effect.forkIn(coordinatorScope));
    run.plannerFiber = firstFiber;
    const firstExit = yield* Fiber.await(firstFiber);
    if (Exit.isFailure(firstExit)) return null;
    const typedReason = firstExit.value.fallbackReason as
      | FetchExplorationPlanningOutcome["fallbackReason"]
      | "model-unavailable"
      | "entitlement";
    if (typedReason !== "model-unavailable" && typedReason !== "entitlement") {
      return firstExit.value;
    }
    if (!run.input.lunaFallback) return firstExit.value;
    run.selection = run.input.lunaFallback.modelSelection;
    run.providerDriver = run.input.lunaFallback.providerDriver;
    run.maxRecommendedWorkers = run.input.lunaFallback.maxRecommendedWorkers;
    run.commandExecutionPolicy = run.input.lunaFallback.commandExecutionPolicy;
    const fallbackFiber = yield* execute(run.selection).pipe(Effect.forkIn(coordinatorScope));
    run.plannerFiber = fallbackFiber;
    const fallbackExit = yield* Fiber.await(fallbackFiber);
    return Exit.isSuccess(fallbackExit) ? fallbackExit.value : null;
  });

  const restoreMainSessionReady = Effect.fn("FetchWorkerCoordinator.restoreMainSessionReady")(
    function* (run: ActiveRun) {
      const thread = Option.getOrUndefined(
        yield* projectionSnapshotQuery.getThreadDetailById(run.input.threadId),
      );
      const session = thread?.session;
      if (!session || (session.status !== "starting" && session.status !== "interrupted")) return;
      if (
        run.abortProjected &&
        session.abortState?.runtimeSessionId !== run.abortRuntimeSessionId
      ) {
        return;
      }
      const updatedAt = yield* nowIso;
      const ready: OrchestrationSession = {
        ...session,
        status: "ready",
        runtimeSessionId: run.abortProjected
          ? run.originalMainRuntimeSessionId
          : session.runtimeSessionId,
        activeTurnId: null,
        abortState: null,
        updatedAt,
      };
      yield* orchestrationEngine.dispatch({
        type: "thread.session.set",
        commandId: yield* commandId(run.runId, "restore-main-ready"),
        threadId: run.input.threadId,
        session: ready,
        createdAt: updatedAt,
      });
    },
  );

  const runCore: FetchWorkerCoordinatorShape["run"] = Effect.fn("FetchWorkerCoordinator.runCore")(
    function* (input) {
      const runId = yield* crypto.randomUUIDv4;
      const lock = yield* Semaphore.make(1);
      const active: ActiveRun = {
        runId,
        input,
        lock,
        selection: input.modelSelection,
        providerDriver: input.providerDriver,
        maxRecommendedWorkers: input.maxRecommendedWorkers,
        commandExecutionPolicy: input.commandExecutionPolicy,
        phase: "planning",
        cancelled: false,
        forceRequested: false,
        abortProjected: false,
        abortRuntimeSessionId: null,
        originalMainRuntimeSessionId: null,
        plannerFiber: null,
        watchdogFiber: null,
        workers: [],
      };
      activeRuns.set(input.threadId, active);
      const warnings: string[] = [];
      const planning = yield* runPlanner(active);
      active.plannerFiber = null;
      if (active.cancelled || planning === null) {
        active.phase = "settled";
        yield* restoreMainSessionReady(active);
        return {
          runId,
          status: "cancelled",
          warnings,
          plannedWorkers: 0,
          completedWorkers: 0,
          successfulWorkers: 0,
          providerInstanceId: active.selection.instanceId,
          providerDriver: active.providerDriver,
          modelSelection: active.selection,
        };
      }
      const typedReason = planning.fallbackReason as
        | FetchExplorationPlanningOutcome["fallbackReason"]
        | "model-unavailable"
        | "entitlement";
      if (typedReason === "model-unavailable" || typedReason === "entitlement") {
        active.phase = "settled";
        warnings.push("The selected Fetch model is unavailable; the main turn will continue.");
        return {
          runId,
          status: "unavailable",
          warnings,
          plannedWorkers: 0,
          completedWorkers: 0,
          successfulWorkers: 0,
          providerInstanceId: active.selection.instanceId,
          providerDriver: active.providerDriver,
          modelSelection: active.selection,
        };
      }
      if (planning.fallbackReason === "planner-failed") {
        warnings.push(
          "Fetch planning failed; the main agent continued without repository workers.",
        );
      }
      if (planning.fallbackReason === "invalid-plan") {
        warnings.push(
          "Fetch returned an invalid plan; the main agent continued without repository workers.",
        );
      }
      if (planning.plan.decision === "skip") {
        active.phase = "settled";
        return {
          runId,
          status: "skipped",
          warnings,
          plannedWorkers: 0,
          completedWorkers: 0,
          successfulWorkers: 0,
          providerInstanceId: active.selection.instanceId,
          providerDriver: active.providerDriver,
          modelSelection: active.selection,
        };
      }

      active.phase = "workers";
      active.workers = Array.from(
        yield* Effect.forEach(planning.plan.workers, (assignment, index) =>
          makeWorker(active, assignment, index),
        ),
      );
      const outcomes = Array.from(
        yield* Effect.forEach(active.workers, runWorker, { concurrency: 1 }),
      );
      active.phase = "settled";
      if (active.cancelled) {
        yield* restoreMainSessionReady(active);
        return {
          runId,
          status: "cancelled",
          warnings,
          plannedWorkers: active.workers.length,
          completedWorkers: outcomes.filter((outcome) => outcome.status === "completed").length,
          successfulWorkers: 0,
          providerInstanceId: active.selection.instanceId,
          providerDriver: active.providerDriver,
          modelSelection: active.selection,
        };
      }
      const successfulWorkers = outcomes.filter(
        (outcome) => outcome.status === "completed" && outcome.findings.trim().length > 0,
      ).length;
      const context = buildFetchContext({
        plannedWorkers: active.workers.length,
        modelSelection: active.selection,
        providerDriver: active.providerDriver,
        outcomes,
        ...(input.contextMaxChars !== undefined ? { maxChars: input.contextMaxChars } : {}),
      });
      if (successfulWorkers === 0) {
        warnings.push(
          "Every Fetch worker failed or returned no findings; the main turn will continue.",
        );
      } else if (successfulWorkers < active.workers.length) {
        warnings.push("Fetch completed with partial results; failed workers were not retried.");
      }
      return {
        runId,
        status: "completed",
        ...(context !== undefined ? { context } : {}),
        warnings,
        plannedWorkers: active.workers.length,
        completedWorkers: outcomes.filter((outcome) => outcome.status === "completed").length,
        successfulWorkers,
        providerInstanceId: active.selection.instanceId,
        providerDriver: active.providerDriver,
        modelSelection: active.selection,
      };
    },
  );

  const run: FetchWorkerCoordinatorShape["run"] = (input) =>
    Effect.uninterruptibleMask((restore) =>
      restore(runCore(input)).pipe(
        Effect.catchCause((cause) => {
          const active = activeRuns.get(input.threadId);
          if (!active) return Effect.failCause(cause);
          const registeredWorkers = [...workersByThread.values()].filter(
            (worker) => worker.run === active,
          );
          const interrupted = Cause.hasInterruptsOnly(cause);
          const cleanup = Effect.uninterruptible(
            Effect.forEach(
              registeredWorkers,
              (worker) =>
                forceStopWorker(worker).pipe(
                  Effect.andThen(
                    finalizeWorker(worker, {
                      index: worker.index,
                      scope: worker.assignment.scope,
                      status: interrupted ? "interrupted" : "error",
                      findings: worker.findings,
                      detail: interrupted
                        ? "Fetch coordination was interrupted."
                        : `Fetch coordination failed internally. ${Cause.pretty(cause).slice(0, 1_000)}`,
                    }).pipe(
                      Effect.catchCause((projectionCause) =>
                        Effect.logWarning(
                          "Failed to terminalize a Fetch worker after run failure",
                          {
                            threadId: worker.syntheticThreadId,
                            runtimeSessionId: worker.runtimeSessionId,
                            cause: Cause.pretty(projectionCause),
                          },
                        ),
                      ),
                    ),
                  ),
                ),
              { concurrency: "unbounded", discard: true },
            ).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  active.workers = [];
                  active.phase = "settled";
                }),
              ),
            ),
          );
          if (interrupted) return cleanup.pipe(Effect.andThen(Effect.failCause(cause)));
          return cleanup.pipe(
            Effect.as({
              runId: active.runId,
              status: "completed" as const,
              warnings: [
                `Fetch coordination failed internally; the main turn will continue without findings. ${Cause.pretty(cause).slice(0, 1_000)}`,
              ],
              plannedWorkers: registeredWorkers.length,
              completedWorkers: 0,
              successfulWorkers: 0,
              providerInstanceId: active.selection.instanceId,
              providerDriver: active.providerDriver,
              modelSelection: active.selection,
            }),
          );
        }),
      ),
    );

  const projectAbortPhase = Effect.fn("FetchWorkerCoordinator.projectAbortPhase")(function* (
    run: ActiveRun,
    input: FetchInterruptInput,
    phase: "interrupting" | "force-stopping",
  ) {
    const thread = Option.getOrUndefined(
      yield* projectionSnapshotQuery.getThreadDetailById(run.input.threadId),
    );
    const session = thread?.session;
    if (!session) return;
    if (run.abortRuntimeSessionId === null) {
      run.originalMainRuntimeSessionId = session.runtimeSessionId;
      run.abortRuntimeSessionId =
        session.runtimeSessionId ??
        RuntimeSessionId.make(`fetch:${run.input.threadId}:${run.runId}`);
    }
    const abortRuntimeSessionId = run.abortRuntimeSessionId;
    if (abortRuntimeSessionId === null) return;
    const forceAt = DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(input.requestedAt), {
        milliseconds: Duration.toMillis(FETCH_ABORT_FORCE_DELAY),
      }),
    );
    yield* orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: yield* commandId(run.runId, `abort-${phase}`),
      threadId: run.input.threadId,
      session: {
        ...session,
        status: "starting",
        runtimeSessionId: abortRuntimeSessionId,
        abortState: {
          runtimeSessionId: abortRuntimeSessionId,
          targetTurnId: run.input.parentTurnId ?? session.activeTurnId,
          phase,
          requestedAt: input.requestedAt,
          forceAt,
        },
        updatedAt: input.requestedAt,
      },
      createdAt: input.requestedAt,
    });
    run.abortProjected = true;
  });

  const projectAbortPhaseBestEffort = (
    run: ActiveRun,
    input: FetchInterruptInput,
    phase: "interrupting" | "force-stopping",
  ) =>
    projectAbortPhase(run, input, phase).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to project Fetch cancellation state", {
          threadId: input.threadId,
          phase,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const forceRun = Effect.fn("FetchWorkerCoordinator.forceRun")(function* (run: ActiveRun) {
    run.forceRequested = true;
    yield* Effect.forEach(run.workers, forceStopWorker, { concurrency: "unbounded" }).pipe(
      Effect.asVoid,
    );
    yield* Effect.forEach(
      run.workers,
      (worker) => settleWorker(worker, "interrupted", "Fetch was force-stopped."),
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid);
  });

  const requestInterrupt: FetchWorkerCoordinatorShape["requestInterrupt"] = Effect.fn(
    "FetchWorkerCoordinator.requestInterrupt",
  )(function* (input) {
    const run = activeRuns.get(input.threadId);
    if (!run) return false;
    if (
      input.turnId !== undefined &&
      run.input.parentTurnId !== undefined &&
      input.turnId !== run.input.parentTurnId
    ) {
      return false;
    }
    return yield* run.lock.withPermits(1)(
      Effect.gen(function* () {
        if (run.phase === "handoff") return false;
        if (run.cancelled) {
          if (!run.forceRequested) {
            yield* projectAbortPhaseBestEffort(run, input, "force-stopping");
            yield* forceRun(run);
          }
          return true;
        }
        run.cancelled = true;
        run.phase = "cancelling";
        yield* projectAbortPhaseBestEffort(run, input, "interrupting");
        if (run.plannerFiber) {
          yield* Fiber.interrupt(run.plannerFiber).pipe(
            Effect.ignore,
            Effect.forkIn(coordinatorScope),
          );
        }
        yield* Effect.forEach(run.workers, interruptWorker, { concurrency: "unbounded" }).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.forkIn(coordinatorScope),
        );
        yield* Effect.forEach(
          run.workers,
          (worker) => settleWorker(worker, "interrupted", "Fetch was cancelled."),
          { concurrency: "unbounded" },
        ).pipe(Effect.asVoid);
        const watchdog = yield* Effect.sleep(FETCH_ABORT_FORCE_DELAY).pipe(
          Effect.flatMap(() =>
            run.lock.withPermits(1)(
              run.forceRequested || activeRuns.get(input.threadId) !== run
                ? Effect.void
                : projectAbortPhaseBestEffort(run, input, "force-stopping").pipe(
                    Effect.andThen(forceRun(run)),
                  ),
            ),
          ),
          Effect.forkIn(coordinatorScope),
        );
        run.watchdogFiber = watchdog;
        return true;
      }),
    );
  });

  const handoffToMain: FetchWorkerCoordinatorShape["handoffToMain"] = (input, sendMainEffect) => {
    const run = activeRuns.get(input.threadId);
    if (!run || run.runId !== input.runId) return Effect.succeed(false);
    return run.lock.withPermits(1)(
      Effect.gen(function* () {
        if (run.runId !== input.runId || activeRuns.get(input.threadId) !== run) return false;
        if (run.cancelled) {
          yield* restoreMainSessionReady(run).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to restore the main session after Fetch cancellation", {
                threadId: input.threadId,
                cause: Cause.pretty(cause),
              }),
            ),
          );
          activeRuns.delete(input.threadId);
          if (run.watchdogFiber) yield* Fiber.interrupt(run.watchdogFiber).pipe(Effect.ignore);
          return false;
        }
        run.phase = "handoff";
        if (run.watchdogFiber) yield* Fiber.interrupt(run.watchdogFiber).pipe(Effect.ignore);
        // Register the main-send fiber while Fetch still owns the per-thread
        // lock. Once forked, the prepared main runtime lease is owned by the
        // normal abort coordinator; do not hold this lock for ACP providers
        // whose send call can span the complete turn.
        yield* sendMainEffect.pipe(Effect.forkIn(coordinatorScope));
        if (activeRuns.get(input.threadId) === run) activeRuns.delete(input.threadId);
        return true;
      }),
    );
  };

  return {
    run,
    handoffToMain,
    requestInterrupt,
    hasActiveRun: (threadId) => Effect.sync(() => activeRuns.has(threadId)),
  } satisfies FetchWorkerCoordinatorShape;
});

export const FetchWorkerCoordinatorLive = Layer.effect(FetchWorkerCoordinator, make);
