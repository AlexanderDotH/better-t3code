import {
  CommandId,
  EventId,
  MessageId,
  RuntimeSessionId,
  type OrchestrationSession,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import type * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { runtimeEventToActivities } from "../orchestration/Layers/ProviderRuntimeIngestion.ts";
import type { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import type {
  ActiveFetchRun,
  ActiveFetchWorker,
  FetchInterruptInput,
  FetchWorkerOutcome,
} from "./FetchWorkerState.ts";
import { FETCH_ABORT_FORCE_DELAY } from "./FetchWorkerTransport.ts";

export const FETCH_TRANSCRIPT_FLUSH_CHARS = 2_048;

export interface FetchWorkerProjectionDependencies {
  readonly crypto: Crypto.Crypto;
  readonly orchestrationEngine: OrchestrationEngineService["Service"];
  readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
  readonly threadBackgroundLiveness: ThreadBackgroundLivenessService["Service"];
}

export function makeFetchWorkerProjection(dependencies: FetchWorkerProjectionDependencies) {
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const commandId = Effect.fn("FetchWorkerProjection.commandId")(function* (
    runId: string,
    tag: string,
  ) {
    return CommandId.make(
      `server:fetch:${runId}:${tag}:${yield* dependencies.crypto.randomUUIDv4}`,
    );
  });

  const dispatchSummary = Effect.fn("FetchWorkerProjection.dispatchSummary")(function* (
    worker: ActiveFetchWorker,
    summary: OrchestrationSubagentSummary,
  ) {
    worker.summary = summary;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.subagent.upsert",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-summary`),
      threadId: worker.run.input.threadId,
      subagent: summary,
      createdAt: summary.updatedAt,
    });
  });

  const dispatchWorkerState = Effect.fn("FetchWorkerProjection.dispatchWorkerState")(function* (
    worker: ActiveFetchWorker,
    status: OrchestrationSubagentStatus,
    statusMessage: string | null,
    updatedAt: string,
  ) {
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.subagent.state.set",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-state-${status}`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      status,
      statusMessage,
      updatedAt,
    });
  });

  const dispatchProgress = Effect.fn("FetchWorkerProjection.dispatchProgress")(function* (
    worker: ActiveFetchWorker,
    input: { readonly kind: string; readonly summary: string; readonly detail: string | null },
    updatedAt: string,
  ) {
    const fingerprint = `${input.kind}\u0000${input.summary}\u0000${input.detail ?? ""}`;
    if (worker.lastProgressFingerprint === fingerprint) return;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.subagent.progress.set",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-progress`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      progress: { ...input, createdAt: updatedAt },
      updatedAt,
    });
    worker.lastProgressFingerprint = fingerprint;
  });

  const flushTranscript = Effect.fn("FetchWorkerProjection.flushTranscript")(function* (
    worker: ActiveFetchWorker,
    createdAt: string,
  ) {
    if (worker.transcriptBuffer.length === 0) return;
    const delta = worker.transcriptBuffer;
    yield* dependencies.orchestrationEngine.dispatch({
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

  const completeTranscript = Effect.fn("FetchWorkerProjection.completeTranscript")(function* (
    worker: ActiveFetchWorker,
    createdAt: string,
  ) {
    yield* flushTranscript(worker, createdAt);
    if (!worker.assistantProjected) return;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-assistant-complete`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      messageId: worker.assistantMessageId,
      ...(worker.turnId !== null ? { turnId: worker.turnId } : {}),
      createdAt,
    });
  });

  const appendActivity = Effect.fn("FetchWorkerProjection.appendActivity")(function* (
    worker: ActiveFetchWorker,
    event: ProviderRuntimeEvent,
  ) {
    const activities = runtimeEventToActivities(event);
    yield* Effect.forEach(
      activities,
      (activity) =>
        commandId(worker.run.runId, `worker-${worker.index}-activity`).pipe(
          Effect.flatMap((activityCommandId) =>
            dependencies.orchestrationEngine.dispatch({
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
    if (first === undefined) return;
    yield* dispatchProgress(
      worker,
      { kind: first.kind, summary: first.summary, detail: null },
      event.createdAt,
    );
  });

  const projectWorkerStart = Effect.fn("FetchWorkerProjection.projectWorkerStart")(function* (
    worker: ActiveFetchWorker,
    prompt: string,
  ) {
    dependencies.threadBackgroundLiveness.recordTaskLiveness({
      threadId: worker.run.input.threadId,
      taskId: worker.subagentId,
      taskType: "subagent",
      status: "starting",
      kind: "started",
    });
    yield* dispatchSummary(worker, worker.summary);
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.message.import",
      commandId: yield* commandId(worker.run.runId, `worker-${worker.index}-user-message`),
      threadId: worker.run.input.threadId,
      subagentId: worker.subagentId,
      message: {
        id: MessageId.make(`${worker.syntheticThreadId}:user`),
        role: "user",
        text: prompt,
        turnId: null,
        streaming: false,
        createdAt: worker.summary.startedAt,
        updatedAt: worker.summary.startedAt,
      },
    });
  });

  const projectWorkerFinal = Effect.fn("FetchWorkerProjection.projectWorkerFinal")(function* (
    worker: ActiveFetchWorker,
    outcome: FetchWorkerOutcome,
  ) {
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
    dependencies.threadBackgroundLiveness.recordTaskLiveness({
      threadId: worker.run.input.threadId,
      taskId: worker.subagentId,
      taskType: "subagent",
      status: orchestrationStatus,
      kind: "completed",
    });
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
  });

  const restoreMainSessionReady = Effect.fn("FetchWorkerProjection.restoreMainSessionReady")(
    function* (run: ActiveFetchRun) {
      const thread = Option.getOrUndefined(
        yield* dependencies.projectionSnapshotQuery.getThreadDetailById(run.input.threadId),
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
      yield* dependencies.orchestrationEngine.dispatch({
        type: "thread.session.set",
        commandId: yield* commandId(run.runId, "restore-main-ready"),
        threadId: run.input.threadId,
        session: ready,
        createdAt: updatedAt,
      });
    },
  );

  const projectAbortPhase = Effect.fn("FetchWorkerProjection.projectAbortPhase")(function* (
    run: ActiveFetchRun,
    input: FetchInterruptInput,
    phase: "interrupting" | "force-stopping",
  ) {
    const thread = Option.getOrUndefined(
      yield* dependencies.projectionSnapshotQuery.getThreadDetailById(run.input.threadId),
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
    yield* dependencies.orchestrationEngine.dispatch({
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
    run: ActiveFetchRun,
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

  return {
    nowIso,
    dispatchSummary,
    dispatchWorkerState,
    dispatchProgress,
    flushTranscript,
    appendActivity,
    projectWorkerStart,
    projectWorkerFinal,
    restoreMainSessionReady,
    projectAbortPhaseBestEffort,
  };
}

export type FetchWorkerProjection = ReturnType<typeof makeFetchWorkerProjection>;
