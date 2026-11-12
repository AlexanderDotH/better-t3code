import type {
  OrchestrationV2Checkpoint,
  OrchestrationV2Run,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadFeedMessage } from "./threadActivity";

type RewindRun = Pick<OrchestrationV2Run, "id" | "ordinal" | "status" | "checkpointId">;
type RewindCheckpoint = Pick<
  OrchestrationV2Checkpoint,
  "id" | "scopeId" | "status" | "parentCheckpointId" | "appRunOrdinal" | "ordinalWithinScope"
>;
type RewindMessage = Pick<
  ThreadFeedMessage,
  "role" | "runId" | "inputIntent" | "sourceThreadId" | "visibility"
>;
type RewindProjection = {
  readonly runs: ReadonlyArray<RewindRun>;
  readonly checkpoints: ReadonlyArray<RewindCheckpoint>;
};
type RewindTarget = {
  readonly checkpointId: RewindCheckpoint["id"];
  readonly scopeId: RewindCheckpoint["scopeId"];
  readonly turnCount: number;
};

export function createTimelineRewindResolver(threadId: ThreadId, projection: RewindProjection) {
  const checkpoints = new Map(
    projection.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const targets = new Map<RunId, RewindTarget>();
  const initial = projection.checkpoints.findLast(
    (candidate) => candidate.appRunOrdinal === null && candidate.ordinalWithinScope === 0,
  );
  let previousRun: RewindRun | undefined;
  for (const run of [...projection.runs].sort((left, right) => left.ordinal - right.ordinal)) {
    if (run.status === "rolled_back") continue;
    const after = run.checkpointId === null ? undefined : checkpoints.get(run.checkpointId);
    const parent = after?.parentCheckpointId
      ? checkpoints.get(after.parentCheckpointId)
      : undefined;
    const target = after?.parentCheckpointId
      ? parent?.scopeId === after.scopeId
        ? parent
        : undefined
      : previousRun?.checkpointId
        ? checkpoints.get(previousRun.checkpointId)
        : run.ordinal === 1
          ? initial
          : undefined;
    if (
      ["completed", "interrupted", "failed", "cancelled"].includes(run.status) &&
      target?.status === "ready"
    )
      targets.set(run.id, {
        checkpointId: target.id,
        scopeId: target.scopeId,
        turnCount: target.appRunOrdinal ?? 0,
      });
    previousRun = run;
  }
  return (message: RewindMessage): RewindTarget | null => {
    if (
      message.role !== "user" ||
      message.visibility === "inherited" ||
      message.sourceThreadId !== threadId ||
      (message.inputIntent !== "turn_start" && message.inputIntent !== "queued_turn") ||
      message.runId === null
    )
      return null;
    return targets.get(message.runId) ?? null;
  };
}

export function resolveTimelineRewindTarget(
  message: RewindMessage,
  threadId: ThreadId,
  projection: RewindProjection,
) {
  return createTimelineRewindResolver(threadId, projection)(message);
}
