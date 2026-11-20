import {
  CommandId,
  type DeepPlanAdvanceTransition,
  type DeepPlanReviewDiff,
  type DeepPlanRun,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
  type ThreadDeepPlanAdvanceCommand,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { CheckpointDiffQuery } from "../checkpointing/CheckpointDiffQuery.ts";
import { checkpointCaptureCommandId } from "../orchestration-v2/CheckpointCaptureService.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import {
  OrchestratorCommandRejectedError,
  OrchestratorDispatchError,
  OrchestratorV2,
} from "../orchestration-v2/Orchestrator.ts";
import { isRuntimeReconcileCommandId } from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import { forkParked } from "../serverActivation.ts";
import { DeepPlanDecisionError } from "./deepPlanDecision.ts";
import {
  decideNext,
  deepPlanTurnMessageId,
  isRunningDeepPlan,
  type DeepPlanNextAction,
  type DeepPlanObservation,
} from "./deepPlanNextAction.ts";
import { deepPlanTurnPrompt } from "./deepPlanPrompts.ts";

export class DeepPlanConductor extends Context.Service<
  DeepPlanConductor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drainThrough: (sequence: number) => Effect.Effect<void>;
  }
>()("t3/deepPlanning/DeepPlanConductor") {}

type Observations = ReadonlyMap<ThreadId, DeepPlanObservation>;
type StartTurn = Extract<DeepPlanNextAction, { type: "start-turn" }>;

const isWrappedRejection = Schema.is(
  Schema.Union([OrchestratorDispatchError, OrchestratorCommandRejectedError]),
);
const isDeepPlanDecisionError = Schema.is(DeepPlanDecisionError);

function decisionErrorCode(error: unknown): string | undefined {
  while (isWrappedRejection(error)) error = error.cause;
  return isDeepPlanDecisionError(error) ? error.context.deepPlanCode : undefined;
}

function relatedThreads(run: DeepPlanRun): ReadonlyArray<ThreadId> {
  return [
    run.threadId,
    ...(run.approval?.lanes.map((lane) => lane.threadId) ?? []),
    ...run.activeTurns.map((turn) => turn.threadId),
  ];
}

function threadAvailability(
  shell: OrchestrationV2ThreadShell,
): DeepPlanObservation["availability"] {
  if (shell.archivedAt !== null || shell.deletedAt !== null) return "unavailable";
  return shell.activeRunId !== null || shell.pendingRuntimeRequest !== null ? "busy" : "idle";
}

function advanceCommandId(run: DeepPlanRun, transition: DeepPlanAdvanceTransition): CommandId {
  const prefix = `deep-plan:${run.id}:r${run.revision}`;
  if (transition.type === "settle-turn") {
    return CommandId.make(`${prefix}:settle:${transition.turnCommandId}`);
  }
  if (transition.type === "pause") {
    return CommandId.make(
      `${prefix}:pause:${transition.pause.kind}:${transition.pause.stepId ?? "final"}`,
    );
  }
  const { kind, stepId, laneId, round, attempt } = transition.turn;
  return CommandId.make(
    `${prefix}:${kind}:${stepId ?? "final"}:${laneId ?? "none"}:${round}:${attempt}:${transition.latestRunId ?? "none"}`,
  );
}

function implementationFor(
  threadId: ThreadId,
  submission: DeepPlanRun["finalReview"]["submission"],
  observations: Observations,
) {
  return submission === null
    ? undefined
    : observations
        .get(threadId)
        ?.runs.find(
          (run) =>
            run.userMessageId === deepPlanTurnMessageId(submission.turnCommandId) &&
            run.status === "completed",
        );
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestratorV2;
  const eventSink = yield* EventSinkV2;
  const checkpointDiff = yield* CheckpointDiffQuery;
  const seenSequence = yield* SubscriptionRef.make(0);
  const tracked = new Map<ThreadId, DeepPlanRun>();
  const queued = new Set<ThreadId>();
  let started = false;

  const getObservations = Effect.fn("DeepPlanConductor.getObservations")(function* (
    run: DeepPlanRun,
    owner: OrchestrationV2ThreadShell,
  ) {
    const observations = new Map<ThreadId, DeepPlanObservation>();
    for (const threadId of new Set(relatedThreads(run))) {
      const shell = threadId === owner.id ? owner : yield* engine.getThreadShell(threadId);
      if (shell === null) continue;
      const availability = threadAvailability(shell);
      const runs =
        availability === "unavailable"
          ? []
          : (yield* engine.getThreadRecords(threadId, ["runs"])).runs;
      observations.set(threadId, { availability, runs, latestRunId: shell.latestRunId });
    }
    return observations;
  });

  const getReviewRange = Effect.fn("DeepPlanConductor.getReviewRange")(function* (
    run: DeepPlanRun,
    action: StartTurn,
    observations: Observations,
  ) {
    const { turn } = action;
    const step = run.steps.find((candidate) => candidate.stepId === turn.stepId);
    const target = step ?? run.finalReview;
    if (action.replaces !== undefined) return target.reviews.at(-1)?.diff ?? null;
    const approval = run.approval;
    const primary = approval?.lanes[0];
    if (approval === null || primary === undefined) return null;
    let range: DeepPlanReviewDiff;
    if (step !== undefined) {
      const lane = approval.lanes.find((candidate) => candidate.laneId === step.laneId);
      if (lane === undefined || step.baseTurnCount === null) return null;
      const implemented = implementationFor(lane.threadId, step.submission, observations);
      if (implemented === undefined) return null;
      range = {
        threadId: lane.threadId,
        fromTurnCount: step.baseTurnCount,
        toTurnCount: implemented.ordinal,
      };
    } else {
      const latestImplementations = approval.lanes.flatMap((lane) => {
        const submissions = run.steps
          .filter((candidate) => candidate.laneId === lane.laneId)
          .map((candidate) => candidate.submission);
        if (lane === primary) submissions.push(run.finalReview.submission);
        const latest = submissions.reduce<ReturnType<typeof implementationFor>>(
          (current, submission) => {
            const candidate = implementationFor(lane.threadId, submission, observations);
            return candidate !== undefined &&
              (current === undefined || candidate.ordinal > current.ordinal)
              ? candidate
              : current;
          },
          undefined,
        );
        return latest === undefined ? [] : [{ threadId: lane.threadId, run: latest }];
      });
      const completions = yield* Effect.forEach(latestImplementations, (entry) =>
        eventSink.readByCommandId({ commandId: checkpointCaptureCommandId(entry.run.id) }).pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "run.updated" && stored.event.payload.status === "completed",
          ),
          Stream.runHead,
          Effect.map((stored) => ({
            ...entry,
            sequence: Option.getOrUndefined(stored)?.sequence ?? 0,
          })),
        ),
      );
      const last = completions.reduce<(typeof completions)[number] | undefined>(
        (current, entry) =>
          current === undefined || entry.sequence >= current.sequence ? entry : current,
        undefined,
      );
      if (last === undefined) return null;
      // Lane ordinals are local. The last captured lane covers the shared worktree.
      range = {
        threadId: primary.threadId,
        fromTurnCount: approval.baseTurnCount,
        toTurnCount: last.run.ordinal,
        ...(last.threadId === primary.threadId ? {} : { toThreadId: last.threadId }),
      };
    }
    return (yield* checkpointDiff.hasReviewDiff(range)) ? range : null;
  });

  const advance = Effect.fn("DeepPlanConductor.advance")(function* (
    run: DeepPlanRun,
    transition: DeepPlanAdvanceTransition,
  ) {
    const command = {
      type: "thread.deep-plan.advance",
      commandId: advanceCommandId(run, transition),
      threadId: run.threadId,
      runId: run.id,
      expectedRevision: run.revision,
      createdAt: DateTime.formatIso(yield* DateTime.now),
      transition,
    } satisfies ThreadDeepPlanAdvanceCommand;
    return yield* engine.dispatch(command);
  });

  const processOnce = Effect.fn("DeepPlanConductor.processOnce")(function* (ownerId: ThreadId) {
    const owner = yield* engine.getThreadShell(ownerId);
    if (
      owner === null ||
      owner.deletedAt !== null ||
      !isRunningDeepPlan(owner.deepPlan) ||
      owner.deepPlan.threadId !== ownerId
    )
      return;
    const run = owner.deepPlan;
    const observations = yield* getObservations(run, owner);
    const action = decideNext(run, observations);
    if (action === null) return;
    let transition: DeepPlanAdvanceTransition;
    if (action.type === "start-turn") {
      const targetShell = yield* engine.getThreadShell(action.turn.threadId);
      const availability = targetShell === null ? undefined : threadAvailability(targetShell);
      const prior = observations.get(action.turn.threadId);
      if (
        availability === "busy" ||
        (prior !== undefined &&
          targetShell !== null &&
          targetShell.latestRunId !== prior.latestRunId)
      )
        return;
      if (availability === "unavailable" || (targetShell === null && prior !== undefined)) {
        transition = {
          type: "pause",
          pause: {
            kind: "unavailable",
            reason: "A thread assigned to this Deep Plan is unavailable.",
            ...(action.turn.stepId === null ? {} : { stepId: action.turn.stepId }),
          },
        };
      } else {
        const review = action.turn.kind === "review" || action.turn.kind === "finalReview";
        transition = {
          ...action,
          latestRunId: targetShell?.latestRunId ?? null,
          prompt: deepPlanTurnPrompt(run, action.turn, action.retryReason),
          ...(review ? { diff: yield* getReviewRange(run, action, observations) } : {}),
        };
      }
    } else {
      transition = action;
    }

    const result = yield* advance(run, transition).pipe(Effect.result);
    if (Result.isSuccess(result)) return true;
    const code = decisionErrorCode(result.failure);
    if (code === "stale-revision" || code === "target-busy" || code === "run-not-found") return;
    yield* Effect.logWarning("Deep Plan could not advance", {
      threadId: ownerId,
      runId: run.id,
      transition: transition.type,
      error: result.failure._tag,
    });
    if (transition.type === "pause") return;
    yield* advance(run, {
      type: "pause",
      pause: {
        kind: "unavailable",
        reason:
          "T3 Code could not start or settle a turn for this Deep Plan. Check the thread and provider before resuming.",
        ...(transition.type === "start-turn" && transition.turn.stepId !== null
          ? { stepId: transition.turn.stepId }
          : {}),
      },
    }).pipe(
      Effect.catchIf(
        (error) => decisionErrorCode(error) === "stale-revision",
        () => Effect.void,
      ),
    );
  });

  const worker = yield* makeDrainableWorker((ownerId: ThreadId) =>
    Effect.gen(function* () {
      queued.delete(ownerId);
      while (yield* processOnce(ownerId)) {
        // Each committed transition may make more work ready for this owner.
      }
    }),
  );
  const enqueue = (ownerId: ThreadId) =>
    Effect.suspend(() => {
      if (queued.has(ownerId)) return Effect.void;
      queued.add(ownerId);
      return worker.enqueue(ownerId);
    });

  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  const consume = Effect.fn("DeepPlanConductor.consume")(function* (
    stored: OrchestrationV2StoredEvent,
  ) {
    const { event } = stored;
    if (!isRuntimeReconcileCommandId(stored.commandId)) {
      if (event.type === "thread.deep-plan-updated") {
        const run = event.payload.deepPlan;
        if (isRunningDeepPlan(run) && run.threadId === event.threadId) {
          tracked.set(event.threadId, run);
          yield* enqueue(event.threadId);
        } else {
          tracked.delete(event.threadId);
        }
      } else if (
        event.type === "run.updated" ||
        event.type === "thread.deleted" ||
        event.type === "thread.archived"
      ) {
        if (event.type === "thread.deleted") tracked.delete(event.threadId);
        for (const [ownerId, run] of tracked) {
          if (relatedThreads(run).includes(event.threadId)) yield* enqueue(ownerId);
        }
      }
    }
    yield* noteSeen(stored.sequence);
  });

  return DeepPlanConductor.of({
    start: Effect.fn("DeepPlanConductor.start")(function* () {
      if (started) return;
      started = true;
      yield* forkParked(
        Effect.gen(function* () {
          const snapshot = yield* engine.getShellSnapshot().pipe(Effect.orDie);
          for (const thread of snapshot.threads) {
            const run = thread.deepPlan;
            if (!isRunningDeepPlan(run) || run.threadId !== thread.id) continue;
            tracked.set(thread.id, run);
            yield* enqueue(thread.id);
          }
          yield* noteSeen(snapshot.snapshotSequence);
          yield* Stream.runForEach(
            eventSink.stream({ afterSequence: snapshot.snapshotSequence }),
            consume,
          );
        }),
      );
    }),
    drainThrough: Effect.fn("DeepPlanConductor.drainThrough")(function* (sequence) {
      yield* SubscriptionRef.changes(seenSequence).pipe(
        Stream.filter((seen) => seen >= sequence),
        Stream.runHead,
      );
      yield* worker.drain;
    }),
  });
});

export const DeepPlanConductorLive = Layer.effect(DeepPlanConductor, make);
