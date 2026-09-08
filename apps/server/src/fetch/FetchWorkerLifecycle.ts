import {
  MessageId,
  RuntimeSessionId,
  SubagentId,
  ThreadId,
  type OrchestrationSubagentSummary,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { getCodexServiceTierOptionValue } from "../codexModelOptions.ts";
import {
  buildFetchWorkerPrompt,
  fetchApprovalAction,
  fetchWorkerTerminalDetail,
  fetchWorkerTerminalStatus,
  isFetchMutationEvent,
  isNestedFetchAgentEvent,
} from "./FetchWorkerPolicy.ts";
import type { FetchWorkerProjection } from "./FetchWorkerProjection.ts";
import { FETCH_TRANSCRIPT_FLUSH_CHARS } from "./FetchWorkerProjection.ts";
import {
  appendFetchWorkerFindings,
  syntheticFetchWorkerId,
  type ActiveFetchRun,
  type ActiveFetchWorker,
  type FetchWorkerAssignment,
  type FetchWorkerOutcome,
  type FetchWorkerOutcomeStatus,
} from "./FetchWorkerState.ts";
import type { FetchWorkerTransport } from "./FetchWorkerTransport.ts";
import { FETCH_ABORT_FORCE_DELAY } from "./FetchWorkerTransport.ts";

export const FETCH_WORKER_TIMEOUT = Duration.minutes(5);

export interface FetchWorkerLifecycleDependencies {
  readonly coordinatorScope: Scope.Scope;
  readonly workersByThread: Map<ThreadId, ActiveFetchWorker>;
  readonly projection: FetchWorkerProjection;
  readonly transport: FetchWorkerTransport;
}

export const makeFetchWorkerLifecycle = Effect.fn("FetchWorkerLifecycle.make")(function* (
  dependencies: FetchWorkerLifecycleDependencies,
) {
  const settleWorker = (
    worker: ActiveFetchWorker,
    status: FetchWorkerOutcomeStatus,
    detail?: string,
  ) =>
    Deferred.succeed(worker.terminal, {
      index: worker.index,
      scope: worker.assignment.scope,
      status,
      findings: worker.findings,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    }).pipe(Effect.ignore);

  const failForPolicyViolation = Effect.fn("FetchWorkerLifecycle.failForPolicyViolation")(
    function* (worker: ActiveFetchWorker, detail: string) {
      yield* dependencies.transport
        .interrupt(worker)
        .pipe(Effect.timeoutOption(FETCH_ABORT_FORCE_DELAY), Effect.asVoid);
      yield* settleWorker(worker, "error", detail);
    },
  );

  const handleApproval = Effect.fn("FetchWorkerLifecycle.handleApproval")(function* (
    worker: ActiveFetchWorker,
    event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
  ) {
    const action = fetchApprovalAction(event.payload.requestType);
    if (action === "fail-worker") {
      yield* failForPolicyViolation(worker, "Fetch workers cannot request hidden user input.");
      return;
    }
    if (!event.requestId) {
      yield* failForPolicyViolation(worker, "Fetch worker emitted an approval without an id.");
      return;
    }
    const response = yield* Effect.exit(
      dependencies.transport.respondToRequest(worker, event.requestId, action),
    );
    if (Exit.isSuccess(response)) return;
    yield* failForPolicyViolation(
      worker,
      `Fetch approval handling failed: ${Cause.pretty(response.cause)}`,
    );
  });

  const projectPolicyEvent = (worker: ActiveFetchWorker, event: ProviderRuntimeEvent) =>
    dependencies.projection.appendActivity(worker, event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to project a Fetch policy event", {
          eventId: event.eventId,
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const handleWorkerEvent = Effect.fn("FetchWorkerLifecycle.handleWorkerEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const worker = dependencies.workersByThread.get(event.threadId);
    if (worker === undefined || event.runtimeSessionId !== worker.runtimeSessionId) return;
    if (
      event.providerInstanceId !== undefined &&
      event.providerInstanceId !== worker.run.selection.instanceId
    ) {
      return;
    }
    if (worker.run.cancelled) return;

    if (isNestedFetchAgentEvent(event)) {
      yield* failForPolicyViolation(worker, "Nested agents are prohibited in Fetch workers.");
      yield* projectPolicyEvent(worker, event);
      return;
    }
    if (isFetchMutationEvent(event)) {
      yield* failForPolicyViolation(worker, "A mutation-capable Fetch tool was blocked.");
      yield* projectPolicyEvent(worker, event);
      return;
    }
    if (event.type === "user-input.requested") {
      yield* failForPolicyViolation(worker, "Fetch workers cannot request hidden user input.");
      yield* projectPolicyEvent(worker, event);
      return;
    }
    if (event.type === "request.opened") yield* handleApproval(worker, event);

    if (event.type === "turn.started" && event.turnId) worker.turnId = event.turnId;
    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      appendFetchWorkerFindings(worker, event.payload.delta);
      worker.transcriptBuffer += event.payload.delta;
    }
    if (
      event.type === "item.completed" &&
      event.payload.itemType === "assistant_message" &&
      worker.findings.length === 0 &&
      event.payload.detail
    ) {
      appendFetchWorkerFindings(worker, event.payload.detail);
      worker.transcriptBuffer += event.payload.detail;
    }
    const status = fetchWorkerTerminalStatus(event);
    if (status !== null) {
      yield* settleWorker(worker, status, fetchWorkerTerminalDetail(event));
    }

    yield* Effect.gen(function* () {
      yield* dependencies.projection.appendActivity(worker, event);
      if (event.type === "thread.started" && event.payload.providerThreadId) {
        yield* dependencies.projection.dispatchSummary(worker, {
          ...worker.summary,
          providerThreadId: event.payload.providerThreadId,
          updatedAt: event.createdAt,
        });
      }
      if (event.type === "turn.started") {
        yield* dependencies.projection.dispatchWorkerState(
          worker,
          "running",
          null,
          event.createdAt,
        );
      }
      if (event.type !== "content.delta" || event.payload.streamKind !== "assistant_text") return;
      if (worker.transcriptBuffer.length >= FETCH_TRANSCRIPT_FLUSH_CHARS) {
        yield* dependencies.projection.flushTranscript(worker, event.createdAt);
      }
      yield* dependencies.projection.dispatchProgress(
        worker,
        { kind: "fetch.findings", summary: "Writing Fetch findings", detail: null },
        event.createdAt,
      );
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

  yield* Stream.runForEach(dependencies.transport.events, (event) =>
    handleWorkerEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Fetch worker event projection failed", {
          eventId: event.eventId,
          threadId: event.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    ),
  ).pipe(Effect.forkIn(dependencies.coordinatorScope));

  const makeWorker = Effect.fn("FetchWorkerLifecycle.makeWorker")(function* (
    run: ActiveFetchRun,
    assignment: FetchWorkerAssignment,
    index: number,
  ) {
    const id = syntheticFetchWorkerId(run.input.threadId, run.runId, index);
    const syntheticThreadId = ThreadId.make(id);
    const runtimeSessionId = RuntimeSessionId.make(`runtime:${id}`);
    const subagentId = SubagentId.make(id);
    const assistantMessageId = MessageId.make(`${id}:assistant`);
    const terminal = yield* Deferred.make<FetchWorkerOutcome>();
    const finalizationLock = yield* Semaphore.make(1);
    const startedAt = yield* dependencies.projection.nowIso;
    const reasoningEffort =
      getModelSelectionStringOptionValue(run.selection, "reasoningEffort") ??
      getModelSelectionStringOptionValue(run.selection, "effort");
    const serviceTier =
      run.providerDriver === "codex" ? getCodexServiceTierOptionValue(run.selection) : undefined;
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
      ...(serviceTier ? { serviceTier } : {}),
      depth: 1,
      status: "starting",
      statusMessage: null,
      latestProgress: null,
      latestTurn: null,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
    };
    const worker: ActiveFetchWorker = {
      run,
      index,
      assignment,
      syntheticThreadId,
      runtimeSessionId,
      subagentId,
      assistantMessageId,
      terminal,
      finalizationLock,
      summary,
      turnId: null,
      sessionStarted: false,
      cleanedUp: false,
      finalizedOutcome: null,
      findings: "",
      findingsTruncated: false,
      transcriptBuffer: "",
      assistantProjected: false,
      lastProgressFingerprint: null,
    };
    dependencies.workersByThread.set(syntheticThreadId, worker);
    const prompt = buildFetchWorkerPrompt({
      userRequest: run.input.userRequest,
      scope: assignment.scope,
      questions: assignment.questions,
    });
    yield* dependencies.projection.projectWorkerStart(worker, prompt);
    return worker;
  });

  const finalizeWorker = Effect.fn("FetchWorkerLifecycle.finalizeWorker")(function* (
    worker: ActiveFetchWorker,
    outcome: FetchWorkerOutcome,
  ) {
    return yield* worker.finalizationLock.withPermits(1)(
      worker.finalizedOutcome !== null
        ? Effect.succeed(worker.finalizedOutcome)
        : dependencies.projection.projectWorkerFinal(worker, outcome).pipe(
            Effect.tap((finalized) =>
              Effect.sync(() => {
                worker.finalizedOutcome = finalized;
              }),
            ),
            Effect.ensuring(
              dependencies.transport
                .cleanup(worker)
                .pipe(
                  Effect.ensuring(
                    Effect.sync(() =>
                      dependencies.workersByThread.delete(worker.syntheticThreadId),
                    ),
                  ),
                ),
            ),
          ),
    );
  });

  const interruptedOutcome = (worker: ActiveFetchWorker, detail: string): FetchWorkerOutcome => ({
    index: worker.index,
    scope: worker.assignment.scope,
    status: "interrupted",
    findings: worker.findings,
    detail,
  });

  const runWorkerLifecycle = Effect.fn("FetchWorkerLifecycle.runWorkerLifecycle")(function* (
    worker: ActiveFetchWorker,
  ) {
    if (worker.run.cancelled) {
      return interruptedOutcome(worker, "Fetch was cancelled before this worker started.");
    }
    const prompt = buildFetchWorkerPrompt({
      userRequest: worker.run.input.userRequest,
      scope: worker.assignment.scope,
      questions: worker.assignment.questions,
    });
    const admitted = yield* dependencies.transport.awaitAdmission(worker);
    if (!admitted || worker.run.cancelled) {
      return interruptedOutcome(worker, "Fetch was cancelled while waiting for free memory.");
    }
    worker.sessionStarted = true;
    const started = yield* Effect.exit(dependencies.transport.startSession(worker));
    if (Exit.isFailure(started)) {
      return {
        index: worker.index,
        scope: worker.assignment.scope,
        status: worker.run.cancelled ? "interrupted" : "error",
        findings: worker.findings,
        detail: Cause.pretty(started.cause),
      } satisfies FetchWorkerOutcome;
    }
    if (started.value.runtimeSessionId !== worker.runtimeSessionId) {
      return {
        index: worker.index,
        scope: worker.assignment.scope,
        status: "error",
        findings: worker.findings,
        detail: "Transient provider session returned a mismatched runtime generation.",
      } satisfies FetchWorkerOutcome;
    }
    if (worker.run.cancelled) {
      yield* settleWorker(worker, "interrupted", "Fetch was cancelled.");
    }

    const sent = worker.run.cancelled
      ? null
      : yield* Effect.exit(dependencies.transport.sendTurn(worker, prompt));
    if (sent !== null && Exit.isFailure(sent)) {
      yield* settleWorker(worker, "error", Cause.pretty(sent.cause));
    }
    if (sent !== null && Exit.isSuccess(sent)) {
      worker.turnId = sent.value.turnId;
      const updatedAt = yield* dependencies.projection.nowIso;
      yield* dependencies.projection.dispatchSummary(worker, {
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

  const runWorker = Effect.fn("FetchWorkerLifecycle.runWorker")(function* (
    worker: ActiveFetchWorker,
  ) {
    const result = yield* runWorkerLifecycle(worker).pipe(
      Effect.flatMap((outcome) => finalizeWorker(worker, outcome)),
      Effect.timeoutOption(FETCH_WORKER_TIMEOUT),
    );
    if (Option.isSome(result)) return result.value;
    yield* dependencies.transport.forceStop(worker);
    return yield* finalizeWorker(worker, {
      index: worker.index,
      scope: worker.assignment.scope,
      status: "timed-out",
      findings: worker.findings,
      detail: "Five-minute Fetch worker lifecycle timeout.",
    });
  });

  const drain = Effect.fn("FetchWorkerLifecycle.drain")(function* (
    detail = "Fetch coordination ownership ended.",
  ) {
    const workers = [...dependencies.workersByThread.values()];
    for (const worker of workers) worker.run.cancelled = true;
    yield* Effect.forEach(
      workers,
      (worker) => {
        const outcome = interruptedOutcome(worker, detail);
        return dependencies.transport
          .forceStop(worker)
          .pipe(
            Effect.andThen(settleWorker(worker, "interrupted", detail)),
            Effect.andThen(finalizeWorker(worker, outcome)),
          );
      },
      { concurrency: "unbounded", discard: true },
    );
  });

  return {
    makeWorker,
    runWorker,
    settleWorker,
    interruptWorker: dependencies.transport.interrupt,
    forceStopWorker: dependencies.transport.forceStop,
    finalizeWorker,
    drain,
  };
});
