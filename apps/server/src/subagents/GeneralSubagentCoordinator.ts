import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  type IsoDateTime,
  type ModelSelection,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type RuntimeMode,
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
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runtimeEventToActivities } from "../orchestration/Layers/ProviderRuntimeIngestion.ts";
import { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import {
  listGeneralSubagentModels,
  resolveGeneralSubagentSelection,
} from "./GeneralSubagentSelection.ts";

import {
  GeneralSubagentCancelInput,
  GeneralSubagentCancelResult,
  GeneralSubagentError,
  GeneralSubagentModelsResult,
  type GeneralSubagentSnapshot,
  GeneralSubagentSpawnInput,
  GeneralSubagentSpawnResult,
  GeneralSubagentWaitInput,
  GeneralSubagentWaitResult,
} from "./GeneralSubagentProtocol.ts";

export const GENERAL_SUBAGENT_TIMEOUT = Duration.minutes(30);
export const GENERAL_SUBAGENT_ABORT_FORCE_DELAY = Duration.seconds(5);
export const GENERAL_SUBAGENT_OUTPUT_MAX_CHARS = 64_000;
const GENERAL_SUBAGENT_TRANSCRIPT_FLUSH_CHARS = 2_048;
const GENERAL_SUBAGENT_RESULT_LIMIT = 256;
const OUTPUT_TRUNCATION_MARKER = "\n... [subagent output truncated at 64,000 characters]";
const isGeneralSubagentError = Schema.is(GeneralSubagentError);

export type GeneralSubagentApprovalAction = "accept" | "decline" | "fail-agent";

export function buildGeneralSubagentPrompt(input: {
  readonly task: string;
  readonly parentThreadId: string;
}): string {
  return `T3 GENERAL-PURPOSE SUBAGENT

You are a direct implementation agent delegated by the root thread ${input.parentThreadId}. Work in the same workspace and under the root thread's existing project claims.

Your task:
${input.task}

Execution contract:
- Complete this concrete scope end to end. You may inspect, edit, and test files when the task requires it and the inherited runtime permissions allow it.
- Keep changes inside this scope, preserve unrelated and concurrent work, and coordinate through the parent result instead of widening ownership.
- Use focused verification proportionate to the change. Report exact files changed, tests run, results, and any remaining risk.
- Do not ask the user questions; return blockers and required decisions to the parent agent.
- Do not spawn nested agents.
- Do not claim the parent task is complete. Return your scoped outcome so the parent can integrate and verify it.`;
}

export function generalSubagentApprovalAction(requestType: string): GeneralSubagentApprovalAction {
  if (requestType === "tool_user_input") return "fail-agent";
  if (requestType === "file_read_approval") return "accept";
  return "decline";
}

export interface GeneralSubagentCaller {
  readonly parentThreadId: ThreadId;
  readonly callerProviderInstanceId: ProviderInstanceId;
}

export interface GeneralSubagentCoordinatorShape {
  readonly listModels: (
    input: GeneralSubagentCaller,
  ) => Effect.Effect<GeneralSubagentModelsResult, GeneralSubagentError>;
  readonly spawn: (
    input: GeneralSubagentCaller & GeneralSubagentSpawnInput,
  ) => Effect.Effect<GeneralSubagentSpawnResult, GeneralSubagentError>;
  readonly wait: (
    input: GeneralSubagentCaller & GeneralSubagentWaitInput,
  ) => Effect.Effect<GeneralSubagentWaitResult, GeneralSubagentError>;
  readonly cancel: (
    input: GeneralSubagentCaller & GeneralSubagentCancelInput,
  ) => Effect.Effect<GeneralSubagentCancelResult, GeneralSubagentError>;
}

export class GeneralSubagentCoordinator extends Context.Service<
  GeneralSubagentCoordinator,
  GeneralSubagentCoordinatorShape
>()("t3/subagents/GeneralSubagentCoordinator") {}

type GeneralSubagentOutcomeStatus = "completed" | "interrupted" | "error" | "timed-out";

interface GeneralSubagentOutcome {
  readonly status: GeneralSubagentOutcomeStatus;
  readonly detail?: string;
}

interface ActiveGeneralSubagent {
  readonly parentThreadId: ThreadId;
  readonly parentTurnId: TurnId | null;
  readonly parentRuntimeSessionId: RuntimeSessionId | null;
  readonly parentProviderInstanceId: ProviderInstanceId | null;
  readonly syntheticThreadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly subagentId: SubagentId;
  readonly assistantMessageId: MessageId;
  readonly task: string;
  readonly selection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly terminal: Deferred.Deferred<GeneralSubagentOutcome>;
  readonly completed: Deferred.Deferred<void>;
  summary: OrchestrationSubagentSummary;
  turnId: TurnId | null;
  sessionStarted: boolean;
  cancelled: boolean;
  finalizing: boolean;
  finalized: boolean;
  output: string;
  outputTruncated: boolean;
  detail: string | null;
  transcriptBuffer: string;
  assistantProjected: boolean;
  lastProgressFingerprint: string | null;
}

function terminalStatus(event: ProviderRuntimeEvent): GeneralSubagentOutcomeStatus | null {
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

function appendOutput(worker: ActiveGeneralSubagent, delta: string): void {
  if (worker.outputTruncated || delta.length === 0) return;
  const available = GENERAL_SUBAGENT_OUTPUT_MAX_CHARS - worker.output.length;
  if (delta.length <= available) {
    worker.output += delta;
    return;
  }
  const retained = Math.max(0, available - OUTPUT_TRUNCATION_MARKER.length);
  worker.output += `${delta.slice(0, retained)}${OUTPUT_TRUNCATION_MARKER}`.slice(0, available);
  worker.outputTruncated = true;
}

export function assistantTextFromCompletedItem(event: ProviderRuntimeEvent): string | undefined {
  if (event.type !== "item.completed" || event.payload.itemType !== "assistant_message") {
    return undefined;
  }
  if (event.payload.detail) return event.payload.detail;
  const data = event.payload.data;
  if (typeof data !== "object" || data === null || !("text" in data)) return undefined;
  return typeof data.text === "string" && data.text.length > 0 ? data.text : undefined;
}

function orchestrationStatus(status: GeneralSubagentOutcomeStatus): OrchestrationSubagentStatus {
  if (status === "timed-out") return "error";
  return status;
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const providerService = yield* ProviderService;
  const providerRegistry = yield* ProviderRegistry;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const resourceGovernor = Option.getOrUndefined(
    yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
  );
  const coordinatorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const workersById = new Map<SubagentId, ActiveGeneralSubagent>();
  const workersByThread = new Map<ThreadId, ActiveGeneralSubagent>();
  const settledOrder: SubagentId[] = [];
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const commandId = Effect.fn("GeneralSubagentCoordinator.commandId")(function* (
    worker: ActiveGeneralSubagent,
    tag: string,
  ) {
    return CommandId.make(
      `server:general-subagent:${worker.subagentId}:${tag}:${yield* crypto.randomUUIDv4}`,
    );
  });

  const dispatchSummary = Effect.fn("GeneralSubagentCoordinator.dispatchSummary")(function* (
    worker: ActiveGeneralSubagent,
    summary: OrchestrationSubagentSummary,
  ) {
    worker.summary = summary;
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.upsert",
      commandId: yield* commandId(worker, "summary"),
      threadId: worker.parentThreadId,
      subagent: summary,
      createdAt: summary.updatedAt,
    });
  });

  const dispatchState = Effect.fn("GeneralSubagentCoordinator.dispatchState")(function* (
    worker: ActiveGeneralSubagent,
    status: OrchestrationSubagentStatus,
    statusMessage: string | null,
    updatedAt: IsoDateTime,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.state.set",
      commandId: yield* commandId(worker, `state-${status}`),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      status,
      statusMessage,
      updatedAt,
    });
  });

  const dispatchProgress = Effect.fn("GeneralSubagentCoordinator.dispatchProgress")(function* (
    worker: ActiveGeneralSubagent,
    progress: { readonly kind: string; readonly summary: string; readonly detail: string | null },
    updatedAt: IsoDateTime,
  ) {
    const fingerprint = `${progress.kind}\u0000${progress.summary}\u0000${progress.detail ?? ""}`;
    if (worker.lastProgressFingerprint === fingerprint) return;
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.progress.set",
      commandId: yield* commandId(worker, "progress"),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      progress: { ...progress, createdAt: updatedAt },
      updatedAt,
    });
    worker.lastProgressFingerprint = fingerprint;
  });

  const flushTranscript = Effect.fn("GeneralSubagentCoordinator.flushTranscript")(function* (
    worker: ActiveGeneralSubagent,
    createdAt: IsoDateTime,
  ) {
    if (worker.transcriptBuffer.length === 0) return;
    const delta = worker.transcriptBuffer;
    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.delta",
      commandId: yield* commandId(worker, "assistant-delta"),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      messageId: worker.assistantMessageId,
      delta,
      ...(worker.turnId !== null ? { turnId: worker.turnId } : {}),
      createdAt,
    });
    worker.transcriptBuffer = worker.transcriptBuffer.slice(delta.length);
    worker.assistantProjected = true;
  });

  const completeTranscript = Effect.fn("GeneralSubagentCoordinator.completeTranscript")(function* (
    worker: ActiveGeneralSubagent,
    createdAt: IsoDateTime,
  ) {
    yield* flushTranscript(worker, createdAt);
    if (!worker.assistantProjected) return;
    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: yield* commandId(worker, "assistant-complete"),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      messageId: worker.assistantMessageId,
      ...(worker.turnId !== null ? { turnId: worker.turnId } : {}),
      createdAt,
    });
  });

  const appendActivity = Effect.fn("GeneralSubagentCoordinator.appendActivity")(function* (
    worker: ActiveGeneralSubagent,
    event: ProviderRuntimeEvent,
  ) {
    const activities = runtimeEventToActivities(event);
    yield* Effect.forEach(
      activities,
      (activity) =>
        commandId(worker, "activity").pipe(
          Effect.flatMap((activityCommandId) =>
            orchestrationEngine.dispatch({
              type: "thread.activity.append",
              commandId: activityCommandId,
              threadId: worker.parentThreadId,
              subagentId: worker.subagentId,
              activity: {
                ...activity,
                id: EventId.make(`general:${worker.subagentId}:${activity.id}`),
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
      { concurrency: 1, discard: true },
    );
    const first = activities[0];
    if (first) {
      yield* dispatchProgress(
        worker,
        { kind: first.kind, summary: first.summary, detail: null },
        event.createdAt,
      );
    }
  });

  const settleWorker = (
    worker: ActiveGeneralSubagent,
    status: GeneralSubagentOutcomeStatus,
    detail?: string,
  ) =>
    Deferred.succeed(worker.terminal, {
      status,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    }).pipe(Effect.ignore);

  const abortTarget = (worker: ActiveGeneralSubagent) => ({
    threadId: worker.syntheticThreadId,
    runtimeSessionId: worker.runtimeSessionId,
    turnId: worker.turnId,
    providerInstanceId: worker.selection.instanceId,
  });

  const interruptWorker = (worker: ActiveGeneralSubagent) =>
    Effect.gen(function* () {
      if (resourceGovernor) {
        yield* resourceGovernor.cancelThread(worker.syntheticThreadId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("General subagent resource cancellation failed", {
              subagentId: worker.subagentId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
      if (!worker.sessionStarted) return;
      yield* providerService.interruptAbortTarget(abortTarget(worker)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("General subagent cooperative interrupt failed", {
            subagentId: worker.subagentId,
            runtimeSessionId: worker.runtimeSessionId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    });

  const forceStopWorker = (worker: ActiveGeneralSubagent) =>
    worker.sessionStarted
      ? providerService.forceStopAbortTarget(abortTarget(worker)).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("General subagent force stop failed", {
              subagentId: worker.subagentId,
              runtimeSessionId: worker.runtimeSessionId,
              cause: Cause.pretty(cause),
            }),
          ),
          Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY),
          Effect.asVoid,
        )
      : Effect.void;

  const handleApproval = Effect.fn("GeneralSubagentCoordinator.handleApproval")(function* (
    worker: ActiveGeneralSubagent,
    event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
  ) {
    const action = generalSubagentApprovalAction(event.payload.requestType);
    if (action === "fail-agent") {
      worker.cancelled = true;
      yield* interruptWorker(worker);
      yield* settleWorker(worker, "error", "General subagents cannot ask hidden user questions.");
      return;
    }
    if (!event.requestId) {
      yield* settleWorker(worker, "error", "General subagent emitted an approval without an id.");
      return;
    }
    const responded = yield* Effect.exit(
      providerService.respondToRequest({
        threadId: worker.syntheticThreadId,
        requestId: ApprovalRequestId.make(event.requestId),
        decision: action,
      }),
    );
    if (Exit.isFailure(responded)) {
      yield* settleWorker(
        worker,
        "error",
        `General subagent approval handling failed: ${Cause.pretty(responded.cause)}`,
      );
    }
  });

  const handleWorkerEvent = Effect.fn("GeneralSubagentCoordinator.handleWorkerEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    if (
      (event.type === "turn.completed" || event.type === "turn.aborted") &&
      event.turnId !== undefined
    ) {
      const rootWorkers = [...workersByThread.values()].filter(
        (worker) =>
          !worker.finalizing &&
          !worker.finalized &&
          worker.parentThreadId === event.threadId &&
          worker.parentTurnId === event.turnId &&
          (worker.parentRuntimeSessionId === null ||
            event.runtimeSessionId === undefined ||
            worker.parentRuntimeSessionId === event.runtimeSessionId) &&
          (worker.parentProviderInstanceId === null ||
            event.providerInstanceId === undefined ||
            worker.parentProviderInstanceId === event.providerInstanceId),
      );
      yield* Effect.forEach(
        rootWorkers,
        (worker) => {
          worker.cancelled = true;
          return interruptWorker(worker).pipe(
            Effect.andThen(
              settleWorker(worker, "interrupted", "The parent turn completed before the subagent."),
            ),
          );
        },
        { concurrency: "unbounded", discard: true },
      );
    }

    const worker = workersByThread.get(event.threadId);
    if (!worker || worker.finalized) return;
    if (event.runtimeSessionId !== worker.runtimeSessionId) return;
    if (
      event.providerInstanceId !== undefined &&
      event.providerInstanceId !== worker.selection.instanceId
    ) {
      return;
    }

    if (event.type === "request.opened") yield* handleApproval(worker, event);
    if (event.type === "user-input.requested") {
      worker.cancelled = true;
      yield* interruptWorker(worker);
      yield* settleWorker(worker, "error", "General subagents cannot ask hidden user questions.");
    }
    if (event.type === "turn.started" && event.turnId) worker.turnId = event.turnId;
    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      appendOutput(worker, event.payload.delta);
      worker.transcriptBuffer += event.payload.delta;
    }
    const completedAssistantText = assistantTextFromCompletedItem(event);
    if (worker.output.length === 0 && completedAssistantText !== undefined) {
      appendOutput(worker, completedAssistantText);
      worker.transcriptBuffer += completedAssistantText;
    }

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
        yield* dispatchState(worker, "running", null, event.createdAt);
      }
      if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
        if (worker.transcriptBuffer.length >= GENERAL_SUBAGENT_TRANSCRIPT_FLUSH_CHARS) {
          yield* flushTranscript(worker, event.createdAt);
        }
        yield* dispatchProgress(
          worker,
          { kind: "subagent.output", summary: "Writing delegated result", detail: null },
          event.createdAt,
        );
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("General subagent event projection failed", {
          eventId: event.eventId,
          subagentId: worker.subagentId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

    const status = terminalStatus(event);
    if (status) yield* settleWorker(worker, status, terminalDetail(event));
  });

  yield* Stream.runForEach(providerService.streamEvents, (event) =>
    handleWorkerEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("General subagent event handling failed", {
          eventId: event.eventId,
          cause: Cause.pretty(cause),
        }),
      ),
    ),
  ).pipe(Effect.forkIn(coordinatorScope));

  const snapshot = (worker: ActiveGeneralSubagent): GeneralSubagentSnapshot => ({
    agentId: worker.subagentId,
    status: worker.summary.status,
    providerInstanceId: worker.selection.instanceId,
    providerDriver: worker.providerDriver,
    model: worker.selection.model,
    reasoningEffort: worker.summary.reasoningEffort,
    task: worker.task,
    output: worker.output.trim().length > 0 ? worker.output : null,
    detail: worker.detail,
  });

  const pruneSettled = () => {
    while (settledOrder.length > GENERAL_SUBAGENT_RESULT_LIMIT) {
      const evicted = settledOrder.shift();
      if (evicted !== undefined) workersById.delete(evicted);
    }
  };

  const cleanupWorker = Effect.fn("GeneralSubagentCoordinator.cleanupWorker")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    workersByThread.delete(worker.syntheticThreadId);
    if (resourceGovernor) {
      yield* resourceGovernor.cancelThread(worker.syntheticThreadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("General subagent resource cleanup failed", {
            subagentId: worker.subagentId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    }
    if (worker.sessionStarted) {
      const target = {
        threadId: worker.syntheticThreadId,
        runtimeSessionId: worker.runtimeSessionId,
        providerInstanceId: worker.selection.instanceId,
      };
      const stopped = yield* providerService
        .stopTransientSession(target)
        .pipe(Effect.exit, Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY));
      if (Option.isNone(stopped) || Exit.isFailure(stopped.value)) {
        yield* forceStopWorker(worker);
      }
    }
  });

  const finalizeWorker = Effect.fn("GeneralSubagentCoordinator.finalizeWorker")(function* (
    worker: ActiveGeneralSubagent,
    outcome: GeneralSubagentOutcome,
  ) {
    if (worker.finalizing || worker.finalized) return;
    worker.finalizing = true;
    yield* Effect.gen(function* () {
      worker.detail = outcome.detail?.trim() || null;
      const completedAt = yield* nowIso;
      yield* completeTranscript(worker, completedAt).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("General subagent transcript finalization failed", {
            subagentId: worker.subagentId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      const status = orchestrationStatus(outcome.status);
      const finalSummary: OrchestrationSubagentSummary = {
        ...worker.summary,
        status,
        statusMessage:
          outcome.status === "timed-out"
            ? "General subagent timed out after thirty minutes."
            : outcome.detail?.trim() || null,
        latestProgress: {
          kind: `subagent.${outcome.status}`,
          summary:
            outcome.status === "completed"
              ? "Delegated work complete"
              : outcome.status === "interrupted"
                ? "Delegated work interrupted"
                : outcome.status === "timed-out"
                  ? "Delegated work timed out"
                  : "Delegated work failed",
          detail: outcome.detail?.trim() || null,
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
      };
      worker.summary = finalSummary;
      threadBackgroundLiveness.recordTaskLiveness({
        threadId: worker.parentThreadId,
        taskId: worker.subagentId,
        taskType: "subagent",
        status,
        kind: "completed",
      });
      yield* dispatchSummary(worker, finalSummary);
    }).pipe(
      Effect.ensuring(
        cleanupWorker(worker).pipe(
          Effect.andThen(
            Effect.sync(() => {
              settledOrder.push(worker.subagentId);
              pruneSettled();
              worker.finalizing = false;
              worker.finalized = true;
            }),
          ),
          Effect.andThen(Deferred.succeed(worker.completed, undefined).pipe(Effect.ignore)),
        ),
      ),
    );
  });

  const runWorkerLifecycle = Effect.fn("GeneralSubagentCoordinator.runWorkerLifecycle")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    if (resourceGovernor) {
      const admitted = yield* resourceGovernor.awaitAdmission({
        threadId: worker.syntheticThreadId,
        provider: worker.providerDriver,
        providerInstanceId: worker.selection.instanceId,
        configurationKey: ResourceProtection.resourceConfigurationKey([
          "general-subagent",
          worker.providerDriver,
          worker.selection.instanceId,
          worker.selection,
        ]),
      });
      if (!admitted) {
        return {
          status: "interrupted",
          detail: "General subagent was cancelled while waiting for free memory.",
        } satisfies GeneralSubagentOutcome;
      }
    }
    if (worker.cancelled) {
      return {
        status: "interrupted",
        detail: "General subagent was cancelled before its provider session started.",
      } satisfies GeneralSubagentOutcome;
    }

    worker.sessionStarted = true;
    const started = yield* Effect.exit(
      providerService.startTransientSession(
        worker.syntheticThreadId,
        {
          threadId: worker.syntheticThreadId,
          purpose: "subagent-worker",
          runtimeSessionId: worker.runtimeSessionId,
          providerInstanceId: worker.selection.instanceId,
          cwd: worker.cwd,
          modelSelection: worker.selection,
          freshSession: true,
          runtimeMode: worker.runtimeMode,
        },
        { workspaceContextThreadId: worker.parentThreadId, mcpMode: "full" },
      ),
    );
    if (Exit.isFailure(started)) {
      return {
        status: worker.cancelled ? "interrupted" : "error",
        detail: Cause.pretty(started.cause),
      } satisfies GeneralSubagentOutcome;
    }
    if (started.value.runtimeSessionId !== worker.runtimeSessionId) {
      return {
        status: "error",
        detail: "Transient provider session returned a mismatched runtime generation.",
      } satisfies GeneralSubagentOutcome;
    }

    const sent = yield* Effect.exit(
      providerService.sendTurn({
        threadId: worker.syntheticThreadId,
        input: buildGeneralSubagentPrompt({
          task: worker.task,
          parentThreadId: worker.parentThreadId,
        }),
        modelSelection: worker.selection,
        interactionMode: "default",
      }),
    );
    if (Exit.isFailure(sent)) {
      return { status: "error", detail: Cause.pretty(sent.cause) } satisfies GeneralSubagentOutcome;
    }
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
    return yield* Deferred.await(worker.terminal);
  });

  const runWorker = Effect.fn("GeneralSubagentCoordinator.runWorker")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    const result = yield* runWorkerLifecycle(worker).pipe(
      Effect.timeoutOption(GENERAL_SUBAGENT_TIMEOUT),
    );
    if (Option.isSome(result)) {
      yield* finalizeWorker(worker, result.value);
      return;
    }
    yield* forceStopWorker(worker);
    yield* finalizeWorker(worker, {
      status: "timed-out",
      detail: "Thirty-minute general subagent lifecycle timeout.",
    });
  });

  const resolveParent = Effect.fn("GeneralSubagentCoordinator.resolveParent")(function* (
    parentThreadId: ThreadId,
  ) {
    const [threadOption, workspaceOption] = yield* Effect.all([
      projectionSnapshotQuery.getThreadDetailById(parentThreadId),
      projectionSnapshotQuery.getThreadCheckpointContext(parentThreadId),
    ]);
    const thread = Option.getOrUndefined(threadOption);
    const workspace = Option.getOrUndefined(workspaceOption);
    if (!thread || !workspace || thread.deletedAt !== null || thread.archivedAt !== null) {
      return yield* new GeneralSubagentError({
        reason: "thread-unavailable",
        detail: `Parent thread '${parentThreadId}' is not available for delegation.`,
      });
    }
    return {
      thread,
      cwd: workspace.worktreePath ?? workspace.workspaceRoot,
      parentTurnId: thread.session?.activeTurnId ?? null,
      parentRuntimeSessionId: thread.session?.runtimeSessionId ?? null,
      parentProviderInstanceId: thread.session?.providerInstanceId ?? null,
    };
  });

  const publicError =
    (operation: string) =>
    (cause: unknown): GeneralSubagentError =>
      isGeneralSubagentError(cause)
        ? cause
        : new GeneralSubagentError({
            reason: "operation-failed",
            detail: `${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          });

  const listModelsEffect = Effect.fn("GeneralSubagentCoordinator.listModels")(function* (
    input: GeneralSubagentCaller,
  ) {
    const parent = yield* resolveParent(input.parentThreadId);
    const providers = yield* providerRegistry.getProviders;
    return {
      providers: listGeneralSubagentModels({
        providers,
        callerProviderInstanceId: input.callerProviderInstanceId,
        parentModelSelection: parent.thread.modelSelection,
      }),
    };
  });
  const listModels: GeneralSubagentCoordinatorShape["listModels"] = (input) =>
    listModelsEffect(input).pipe(Effect.mapError(publicError("Listing subagent models")));

  const spawnEffect = Effect.fn("GeneralSubagentCoordinator.spawn")(function* (
    input: GeneralSubagentCaller & GeneralSubagentSpawnInput,
  ) {
    const parent = yield* resolveParent(input.parentThreadId);
    const providers = yield* providerRegistry.getProviders;
    const resolution = resolveGeneralSubagentSelection({
      providers,
      callerProviderInstanceId: input.callerProviderInstanceId,
      parentModelSelection: parent.thread.modelSelection,
      request: {
        ...(input.providerInstanceId !== undefined
          ? { providerInstanceId: input.providerInstanceId }
          : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
      },
    });
    if (resolution.status === "unavailable") {
      return yield* new GeneralSubagentError({
        reason: resolution.reason,
        detail: resolution.detail,
      });
    }

    const uuid = yield* crypto.randomUUIDv4;
    const id = `general:${input.parentThreadId}:${uuid}`;
    const syntheticThreadId = ThreadId.make(id);
    const runtimeSessionId = RuntimeSessionId.make(`runtime:${id}`);
    const subagentId = SubagentId.make(id);
    const assistantMessageId = MessageId.make(`${id}:assistant`);
    const terminal = yield* Deferred.make<GeneralSubagentOutcome>();
    const completed = yield* Deferred.make<void>();
    const startedAt = yield* nowIso;
    const reasoningEffort =
      getModelSelectionStringOptionValue(resolution.selection, "reasoningEffort") ??
      getModelSelectionStringOptionValue(resolution.selection, "effort");
    const summary: OrchestrationSubagentSummary = {
      id: subagentId,
      origin: "t3-managed",
      providerInstanceId: resolution.selection.instanceId,
      providerDriver: resolution.provider.driver,
      providerThreadId: syntheticThreadId,
      parentId: null,
      path: `general/${uuid}`,
      name: input.name ?? "General subagent",
      nickname: null,
      role: "General",
      task: input.task,
      model: resolution.selection.model,
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
    const worker: ActiveGeneralSubagent = {
      parentThreadId: input.parentThreadId,
      parentTurnId: parent.parentTurnId,
      parentRuntimeSessionId: parent.parentRuntimeSessionId,
      parentProviderInstanceId: parent.parentProviderInstanceId,
      syntheticThreadId,
      runtimeSessionId,
      subagentId,
      assistantMessageId,
      task: input.task,
      selection: resolution.selection,
      providerDriver: resolution.provider.driver,
      cwd: parent.cwd,
      runtimeMode: parent.thread.runtimeMode,
      terminal,
      completed,
      summary,
      turnId: null,
      sessionStarted: false,
      cancelled: false,
      finalizing: false,
      finalized: false,
      output: "",
      outputTruncated: false,
      detail: null,
      transcriptBuffer: "",
      assistantProjected: false,
      lastProgressFingerprint: null,
    };
    workersById.set(subagentId, worker);
    workersByThread.set(syntheticThreadId, worker);
    threadBackgroundLiveness.recordTaskLiveness({
      threadId: input.parentThreadId,
      taskId: subagentId,
      taskType: "subagent",
      status: "starting",
      kind: "started",
    });
    const initialized = yield* Effect.exit(
      Effect.gen(function* () {
        yield* dispatchSummary(worker, summary);
        const prompt = buildGeneralSubagentPrompt({
          task: input.task,
          parentThreadId: input.parentThreadId,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.message.import",
          commandId: yield* commandId(worker, "user-message"),
          threadId: input.parentThreadId,
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
      }),
    );
    if (Exit.isFailure(initialized)) {
      const detail = `General subagent initialization failed: ${Cause.pretty(initialized.cause)}`;
      yield* finalizeWorker(worker, { status: "error", detail }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("General subagent initialization cleanup failed", {
            subagentId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      workersById.delete(subagentId);
      const settledIndex = settledOrder.lastIndexOf(subagentId);
      if (settledIndex >= 0) settledOrder.splice(settledIndex, 1);
      return yield* new GeneralSubagentError({ reason: "spawn-failed", detail });
    }
    yield* runWorker(worker).pipe(
      Effect.catchCause((cause) =>
        finalizeWorker(worker, {
          status: Cause.hasInterruptsOnly(cause) ? "interrupted" : "error",
          detail: Cause.pretty(cause),
        }),
      ),
      Effect.forkIn(coordinatorScope),
    );
    return {
      agentId: subagentId,
      status: "starting" as const,
      providerInstanceId: resolution.selection.instanceId,
      providerDriver: resolution.provider.driver,
      model: resolution.selection.model,
      reasoningEffort: reasoningEffort ?? null,
    };
  });
  const spawn: GeneralSubagentCoordinatorShape["spawn"] = (input) =>
    spawnEffect(input).pipe(Effect.mapError(publicError("Spawning the general subagent")));

  const resolveOwnedWorkers = Effect.fn("GeneralSubagentCoordinator.resolveOwnedWorkers")(
    function* (parentThreadId: ThreadId, agentIds: ReadonlyArray<SubagentId>) {
      const workers: ActiveGeneralSubagent[] = [];
      for (const agentId of agentIds) {
        const worker = workersById.get(agentId);
        if (!worker || worker.parentThreadId !== parentThreadId) {
          return yield* new GeneralSubagentError({
            reason: "agent-unavailable",
            detail: `General subagent '${agentId}' is not owned by parent thread '${parentThreadId}'.`,
          });
        }
        workers.push(worker);
      }
      return workers;
    },
  );

  const wait: GeneralSubagentCoordinatorShape["wait"] = Effect.fn(
    "GeneralSubagentCoordinator.wait",
  )(function* (input) {
    const workers = yield* resolveOwnedWorkers(input.parentThreadId, input.agentIds);
    const active = workers.filter((worker) => !worker.finalized);
    const timeoutSeconds = input.timeoutSeconds ?? 30;
    const waited =
      active.length === 0
        ? Option.some<void>(undefined)
        : yield* Effect.all(
            active.map((worker) => Deferred.await(worker.completed)),
            {
              concurrency: "unbounded",
              discard: true,
            },
          ).pipe(Effect.timeoutOption(Duration.seconds(timeoutSeconds)));
    return {
      agents: workers.map(snapshot),
      allTerminal: workers.every((worker) => worker.finalized),
      timedOut: Option.isNone(waited),
    };
  });

  const cancelEffect = Effect.fn("GeneralSubagentCoordinator.cancel")(function* (
    input: GeneralSubagentCaller & GeneralSubagentCancelInput,
  ) {
    const [worker] = yield* resolveOwnedWorkers(input.parentThreadId, [input.agentId]);
    if (!worker) {
      return yield* new GeneralSubagentError({
        reason: "agent-unavailable",
        detail: `General subagent '${input.agentId}' is not available.`,
      });
    }
    if (worker.finalized) {
      return { agent: snapshot(worker), cancelled: false };
    }
    worker.cancelled = true;
    yield* interruptWorker(worker).pipe(
      Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY),
      Effect.asVoid,
    );
    yield* settleWorker(worker, "interrupted", "Cancelled by the parent agent.");
    yield* Deferred.await(worker.completed).pipe(
      Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY),
      Effect.asVoid,
    );
    if (!worker.finalized) {
      yield* forceStopWorker(worker);
      yield* finalizeWorker(worker, {
        status: "interrupted",
        detail: "Cancelled by the parent agent.",
      });
    }
    return { agent: snapshot(worker), cancelled: true };
  });
  const cancel: GeneralSubagentCoordinatorShape["cancel"] = (input) =>
    cancelEffect(input).pipe(Effect.mapError(publicError("Cancelling the general subagent")));

  return GeneralSubagentCoordinator.of({ listModels, spawn, wait, cancel });
});

export const GeneralSubagentCoordinatorLive = Layer.effect(GeneralSubagentCoordinator, make);
