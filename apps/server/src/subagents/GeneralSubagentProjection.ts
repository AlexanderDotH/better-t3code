import {
  CommandId,
  EventId,
  type IsoDateTime,
  type OrchestrationSubagentStatus,
  type OrchestrationSubagentSummary,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { runtimeEventToActivities } from "../orchestration/Layers/ProviderRuntimeIngestion.ts";
import type { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import type { ActiveGeneralSubagent } from "./GeneralSubagentState.ts";

export const GENERAL_SUBAGENT_TRANSCRIPT_FLUSH_CHARS = 2_048;

export interface GeneralSubagentProjectionDependencies {
  readonly randomUUIDv4: Effect.Effect<string, PlatformError.PlatformError>;
  readonly orchestrationEngine: OrchestrationEngineService["Service"];
  readonly threadBackgroundLiveness: ThreadBackgroundLivenessService["Service"];
}

export function makeGeneralSubagentProjection(dependencies: GeneralSubagentProjectionDependencies) {
  const commandId = Effect.fn("GeneralSubagentProjection.commandId")(function* (
    worker: ActiveGeneralSubagent,
    tag: string,
  ) {
    return CommandId.make(
      `server:general-subagent:${worker.subagentId}:${tag}:${yield* dependencies.randomUUIDv4}`,
    );
  });

  const dispatchSummary = Effect.fn("GeneralSubagentProjection.dispatchSummary")(function* (
    worker: ActiveGeneralSubagent,
    summary: OrchestrationSubagentSummary,
  ) {
    worker.summary = summary;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.subagent.upsert",
      commandId: yield* commandId(worker, "summary"),
      threadId: worker.parentThreadId,
      subagent: summary,
      createdAt: summary.updatedAt,
    });
  });

  const dispatchState = Effect.fn("GeneralSubagentProjection.dispatchState")(function* (
    worker: ActiveGeneralSubagent,
    status: OrchestrationSubagentStatus,
    statusMessage: string | null,
    updatedAt: IsoDateTime,
  ) {
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.subagent.state.set",
      commandId: yield* commandId(worker, `state-${status}`),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      status,
      statusMessage,
      updatedAt,
    });
  });

  const dispatchProgress = Effect.fn("GeneralSubagentProjection.dispatchProgress")(function* (
    worker: ActiveGeneralSubagent,
    progress: { readonly kind: string; readonly summary: string; readonly detail: string | null },
    updatedAt: IsoDateTime,
  ) {
    const fingerprint = `${progress.kind}\u0000${progress.summary}\u0000${progress.detail ?? ""}`;
    if (worker.lastProgressFingerprint === fingerprint) return;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.subagent.progress.set",
      commandId: yield* commandId(worker, "progress"),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      progress: { ...progress, createdAt: updatedAt },
      updatedAt,
    });
    worker.lastProgressFingerprint = fingerprint;
  });

  const flushTranscript = Effect.fn("GeneralSubagentProjection.flushTranscript")(function* (
    worker: ActiveGeneralSubagent,
    createdAt: IsoDateTime,
  ) {
    if (worker.transcriptBuffer.length === 0) return;
    const delta = worker.transcriptBuffer;
    yield* dependencies.orchestrationEngine.dispatch({
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

  const completeTranscript = Effect.fn("GeneralSubagentProjection.completeTranscript")(function* (
    worker: ActiveGeneralSubagent,
    createdAt: IsoDateTime,
  ) {
    yield* flushTranscript(worker, createdAt);
    if (!worker.assistantProjected) return;
    yield* dependencies.orchestrationEngine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: yield* commandId(worker, "assistant-complete"),
      threadId: worker.parentThreadId,
      subagentId: worker.subagentId,
      messageId: worker.assistantMessageId,
      ...(worker.turnId !== null ? { turnId: worker.turnId } : {}),
      createdAt,
    });
  });

  const appendActivity = Effect.fn("GeneralSubagentProjection.appendActivity")(function* (
    worker: ActiveGeneralSubagent,
    event: ProviderRuntimeEvent,
  ) {
    const activities = runtimeEventToActivities(event);
    yield* Effect.forEach(
      activities,
      (activity) =>
        commandId(worker, "activity").pipe(
          Effect.flatMap((activityCommandId) =>
            dependencies.orchestrationEngine.dispatch({
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
    if (!first) return;
    yield* dispatchProgress(
      worker,
      { kind: first.kind, summary: first.summary, detail: null },
      event.createdAt,
    );
  });

  return {
    commandId,
    dispatchSummary,
    dispatchState,
    dispatchProgress,
    flushTranscript,
    completeTranscript,
    appendActivity,
  };
}

export type GeneralSubagentProjection = ReturnType<typeof makeGeneralSubagentProjection>;
