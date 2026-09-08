import {
  ApprovalRequestId,
  MessageId,
  type IsoDateTime,
  type OrchestrationSubagentSummary,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import {
  assistantTextFromCompletedItem,
  buildGeneralSubagentFollowUpPrompt,
  buildGeneralSubagentPrompt,
  generalSubagentApprovalAction,
  generalSubagentOrchestrationStatus,
  generalSubagentTerminalDetail,
  generalSubagentTerminalStatus,
  type GeneralSubagentOutcome,
  type GeneralSubagentOutcomeStatus,
} from "./GeneralSubagentPolicy.ts";
import {
  GENERAL_SUBAGENT_TRANSCRIPT_FLUSH_CHARS,
  type GeneralSubagentProjection,
} from "./GeneralSubagentProjection.ts";
import {
  type ActiveGeneralSubagent,
  type GeneralSubagentStateStore,
} from "./GeneralSubagentState.ts";
import {
  GENERAL_SUBAGENT_ABORT_FORCE_DELAY,
  type GeneralSubagentTransport,
} from "./GeneralSubagentTransport.ts";

export interface GeneralSubagentLifecycleDependencies {
  readonly state: GeneralSubagentStateStore;
  readonly transport: GeneralSubagentTransport;
  readonly projection: GeneralSubagentProjection;
  readonly orchestrationEngine: OrchestrationEngineService["Service"];
  readonly threadBackgroundLiveness: ThreadBackgroundLivenessService["Service"];
  readonly coordinatorScope: Scope.Closeable;
  readonly nowIso: Effect.Effect<IsoDateTime>;
  readonly timeout: Duration.Duration;
}

export function makeGeneralSubagentLifecycle(dependencies: GeneralSubagentLifecycleDependencies) {
  const {
    state,
    transport,
    projection,
    orchestrationEngine,
    threadBackgroundLiveness,
    coordinatorScope,
    nowIso,
    timeout,
  } = dependencies;
  const {
    appendActivity,
    commandId,
    completeTranscript,
    dispatchProgress,
    dispatchState,
    dispatchSummary,
    flushTranscript,
  } = projection;

  const settleWorker = (
    worker: ActiveGeneralSubagent,
    status: GeneralSubagentOutcomeStatus,
    detail?: string,
  ) =>
    Deferred.succeed(worker.terminal, {
      status,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    }).pipe(Effect.ignore);

  const handleApproval = Effect.fn("GeneralSubagentLifecycle.handleApproval")(function* (
    worker: ActiveGeneralSubagent,
    event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
  ) {
    const action = generalSubagentApprovalAction(event.payload.requestType);
    if (action === "fail-agent") {
      worker.cancelled = true;
      yield* transport.interrupt(worker);
      yield* settleWorker(worker, "error", "General subagents cannot ask hidden user questions.");
      return;
    }
    if (!event.requestId) {
      yield* settleWorker(worker, "error", "General subagent emitted an approval without an id.");
      return;
    }
    const responded = yield* Effect.exit(
      transport.respondToRequest(worker, ApprovalRequestId.make(event.requestId), action),
    );
    if (Exit.isFailure(responded)) {
      yield* settleWorker(
        worker,
        "error",
        `General subagent approval handling failed: ${Cause.pretty(responded.cause)}`,
      );
    }
  });

  const handleWorkerEvent = Effect.fn("GeneralSubagentLifecycle.handleWorkerEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    if (
      (event.type === "turn.completed" || event.type === "turn.aborted") &&
      event.turnId !== undefined
    ) {
      const rootWorkers = state
        .allByThread()
        .filter(
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
          worker.disposeRequested = true;
          return transport
            .interrupt(worker)
            .pipe(
              Effect.andThen(
                settleWorker(
                  worker,
                  "interrupted",
                  "The parent turn completed before the subagent.",
                ),
              ),
              Effect.andThen(Deferred.succeed(worker.wake, undefined).pipe(Effect.ignore)),
            );
        },
        { concurrency: "unbounded", discard: true },
      );
    }

    const worker = state.getByThread(event.threadId);
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
      yield* transport.interrupt(worker);
      yield* settleWorker(worker, "error", "General subagents cannot ask hidden user questions.");
    }
    if (event.type === "turn.started" && event.turnId) worker.turnId = event.turnId;
    if (event.type === "session.exited") worker.sessionStarted = false;
    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      worker.transcriptBuffer += event.payload.delta;
    }
    const completedAssistantText = assistantTextFromCompletedItem(event);
    if (completedAssistantText !== undefined) {
      worker.finalAssistantMessage = completedAssistantText;
      if (!worker.assistantProjected && worker.transcriptBuffer.length === 0) {
        worker.transcriptBuffer += completedAssistantText;
      }
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

    const status = generalSubagentTerminalStatus(event);
    if (status) yield* settleWorker(worker, status, generalSubagentTerminalDetail(event));
  });

  const startEventHandling = Stream.runForEach(transport.events, (event) =>
    handleWorkerEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("General subagent event handling failed", {
          eventId: event.eventId,
          cause: Cause.pretty(cause),
        }),
      ),
    ),
  ).pipe(Effect.forkIn(coordinatorScope));

  const disposeWorker = Effect.fn("GeneralSubagentLifecycle.disposeWorker")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    if (worker.finalized) return;
    if (worker.disposing) {
      yield* Deferred.await(worker.disposed);
      return;
    }
    worker.disposing = true;
    yield* transport.cleanup(worker).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          worker.turnActive = false;
          worker.finalizing = false;
          worker.disposing = false;
          state.markSettled(worker);
        }).pipe(
          Effect.andThen(Deferred.succeed(worker.completed, undefined).pipe(Effect.ignore)),
          Effect.andThen(Deferred.succeed(worker.disposed, undefined).pipe(Effect.ignore)),
        ),
      ),
    );
  });

  const finalizeWorker = Effect.fn("GeneralSubagentLifecycle.finalizeWorker")(function* (
    worker: ActiveGeneralSubagent,
    outcome: GeneralSubagentOutcome,
    cleanupAfter: boolean,
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
      const status = generalSubagentOrchestrationStatus(outcome.status);
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
      worker.turnActive = false;
      worker.finalizing = false;
      if (cleanupAfter) {
        yield* disposeWorker(worker);
        return;
      }
      if (worker.followUps.length === 0) {
        yield* Deferred.succeed(worker.completed, undefined).pipe(Effect.ignore);
      }
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          worker.turnActive = false;
          worker.finalizing = false;
        }),
      ),
    );
  });

  const runWorkerLifecycle = Effect.fn("GeneralSubagentLifecycle.runWorkerLifecycle")(function* (
    worker: ActiveGeneralSubagent,
    prompt: string,
  ) {
    if (!worker.sessionStarted) {
      const admitted = yield* transport.awaitAdmission(worker);
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

    if (!worker.sessionStarted) {
      worker.sessionStarted = true;
      const started = yield* Effect.exit(transport.startSession(worker));
      if (Exit.isFailure(started)) {
        worker.sessionStarted = false;
        return {
          status: worker.cancelled ? "interrupted" : "error",
          detail: Cause.pretty(started.cause),
        } satisfies GeneralSubagentOutcome;
      }
      if (started.value.runtimeSessionId !== worker.runtimeSessionId) {
        worker.sessionStarted = false;
        return {
          status: "error",
          detail: "Transient provider session returned a mismatched runtime generation.",
        } satisfies GeneralSubagentOutcome;
      }
    }

    worker.turnActive = true;
    const sent = yield* Effect.exit(transport.sendTurn(worker, prompt));
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

  const runWorker = Effect.fn("GeneralSubagentLifecycle.runWorker")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    const result = yield* runWorkerLifecycle(
      worker,
      buildGeneralSubagentPrompt({
        task: worker.task,
        parentThreadId: worker.parentThreadId,
        agentId: worker.subagentId,
      }),
    ).pipe(Effect.timeoutOption(timeout));
    if (Option.isSome(result)) {
      yield* finalizeWorker(worker, result.value, true);
      return;
    }
    yield* transport.forceStop(worker);
    yield* finalizeWorker(
      worker,
      {
        status: "timed-out",
        detail: "Thirty-minute general subagent lifecycle timeout.",
      },
      true,
    );
  });

  const prepareFollowUpTurn = Effect.fn("GeneralSubagentLifecycle.prepareFollowUpTurn")(function* (
    worker: ActiveGeneralSubagent,
    task: string,
  ) {
    worker.turnSequence += 1;
    worker.task = task;
    worker.turnId = null;
    worker.turnActive = false;
    worker.cancelled = false;
    worker.finalAssistantMessage = null;
    worker.detail = null;
    worker.transcriptBuffer = "";
    worker.assistantProjected = false;
    worker.lastProgressFingerprint = null;
    worker.assistantMessageId = MessageId.make(
      `${worker.subagentId}:assistant:${worker.turnSequence}`,
    );
    worker.terminal = yield* Deferred.make<GeneralSubagentOutcome>();
    const startedAt = yield* nowIso;
    const messages = worker.mailbox.splice(0, worker.mailbox.length);
    const prompt = buildGeneralSubagentFollowUpPrompt({
      task,
      messages,
      agentId: worker.subagentId,
    });
    worker.summary = {
      ...worker.summary,
      task,
      status: "starting",
      statusMessage: null,
      latestProgress: null,
      latestTurn: null,
      updatedAt: startedAt,
      completedAt: null,
    };
    yield* dispatchSummary(worker, worker.summary);
    yield* orchestrationEngine.dispatch({
      type: "thread.message.import",
      commandId: yield* commandId(worker, `follow-up-${worker.turnSequence}`),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      message: {
        id: MessageId.make(`${worker.subagentId}:user:${worker.turnSequence}`),
        role: "user",
        text: prompt,
        turnId: null,
        streaming: false,
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    });
    return prompt;
  });

  const takeFollowUp = Effect.fn("GeneralSubagentLifecycle.takeFollowUp")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    const queued = worker.followUps.shift();
    if (queued) return Option.some(queued);
    const signalled = yield* Deferred.await(worker.wake).pipe(Effect.timeoutOption(timeout));
    worker.wake = yield* Deferred.make<void>();
    if (Option.isNone(signalled)) return Option.none<(typeof worker.followUps)[number]>();
    return Option.fromNullishOr(worker.followUps.shift());
  });

  const runRetainedWorker = Effect.fn("GeneralSubagentLifecycle.runRetainedWorker")(function* (
    worker: ActiveGeneralSubagent,
  ) {
    let prompt = buildGeneralSubagentPrompt({
      task: worker.task,
      parentThreadId: worker.parentThreadId,
      agentId: worker.subagentId,
    });
    while (!worker.disposeRequested) {
      const result = yield* runWorkerLifecycle(worker, prompt).pipe(Effect.timeoutOption(timeout));
      if (Option.isNone(result)) {
        worker.disposeRequested = true;
        yield* transport.forceStop(worker);
        yield* finalizeWorker(
          worker,
          { status: "timed-out", detail: "Thirty-minute general subagent lifecycle timeout." },
          true,
        );
        return;
      }
      yield* finalizeWorker(worker, result.value, worker.disposeRequested);
      if (worker.finalized || worker.disposeRequested) {
        if (!worker.finalized) yield* disposeWorker(worker);
        return;
      }

      const followUp = yield* takeFollowUp(worker);
      if (Option.isNone(followUp)) {
        worker.disposeRequested = true;
        yield* disposeWorker(worker);
        return;
      }
      if (worker.disposeRequested) {
        yield* disposeWorker(worker);
        return;
      }
      prompt = yield* prepareFollowUpTurn(worker, followUp.value.task);
    }
    yield* disposeWorker(worker);
  });

  const cancelWorker = Effect.fn("GeneralSubagentLifecycle.cancelWorker")(function* (
    worker: ActiveGeneralSubagent,
    detail: string,
  ) {
    if (worker.finalized) return false;
    worker.cancelled = true;
    worker.disposeRequested = true;
    yield* transport
      .interrupt(worker)
      .pipe(Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY), Effect.asVoid);
    yield* settleWorker(worker, "interrupted", detail);
    yield* Deferred.succeed(worker.wake, undefined).pipe(Effect.ignore);
    yield* Deferred.await(worker.disposed).pipe(
      Effect.timeoutOption(GENERAL_SUBAGENT_ABORT_FORCE_DELAY),
      Effect.asVoid,
    );
    if (!worker.finalized) {
      yield* transport.forceStop(worker);
      if (!worker.finalizing) {
        yield* finalizeWorker(worker, { status: "interrupted", detail }, true);
      } else {
        yield* disposeWorker(worker);
      }
    }
    return true;
  });

  return {
    cancelWorker,
    disposeWorker,
    finalizeWorker,
    runRetainedWorker,
    runWorker,
    settleWorker,
    startEventHandling,
  };
}

export type GeneralSubagentLifecycle = ReturnType<typeof makeGeneralSubagentLifecycle>;
