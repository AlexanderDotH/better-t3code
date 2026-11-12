import { CheckpointId, CheckpointScopeId, MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { resolveTimelineRewindTarget } from "./timelineRewind";

const threadId = ThreadId.make("thread");
const scopeId = CheckpointScopeId.make("root");
const checkpoint = (id: string, ordinal: number | null, parent: string | null) => ({
  id: CheckpointId.make(id),
  scopeId,
  appRunOrdinal: ordinal,
  ordinalWithinScope: ordinal ?? 0,
  parentCheckpointId: parent === null ? null : CheckpointId.make(parent),
  status: "ready" as const,
});
const message = {
  id: MessageId.make("question"),
  role: "user" as const,
  runId: RunId.make("run-5"),
  inputIntent: "turn_start" as const,
  sourceThreadId: threadId,
  visibility: "local" as const,
};
const run = (ordinal: number, checkpointId: string | null) => ({
  id: RunId.make(`run-${ordinal}`),
  ordinal,
  status: "completed" as const,
  checkpointId: checkpointId === null ? null : CheckpointId.make(checkpointId),
});

describe("resolveTimelineRewindTarget", () => {
  it("uses the checkpoint parent across ordinal gaps and a bounded history window", () => {
    const projection = {
      runs: [run(5, "after")],
      checkpoints: [checkpoint("before", 2, "start"), checkpoint("after", 5, "before")],
    };
    expect(resolveTimelineRewindTarget(message, threadId, projection)).toEqual({
      checkpointId: "before",
      scopeId,
      turnCount: 2,
    });
    expect(
      resolveTimelineRewindTarget({ ...message, visibility: "inherited" }, threadId, projection),
    ).toBeNull();
    expect(
      resolveTimelineRewindTarget({ ...message, inputIntent: "steer" }, threadId, projection),
    ).toBeNull();
    expect(
      resolveTimelineRewindTarget(message, threadId, {
        ...projection,
        checkpoints: [checkpoint("after", 5, "before")],
      }),
    ).toBeNull();
  });

  it("resolves thread start and refuses busy or unavailable checkpoints", () => {
    const first = { ...message, runId: RunId.make("run-1") };
    const projection = { runs: [run(1, null)], checkpoints: [checkpoint("start", null, null)] };
    expect(resolveTimelineRewindTarget(first, threadId, projection)?.turnCount).toBe(0);
    expect(
      resolveTimelineRewindTarget(first, threadId, {
        ...projection,
        runs: [{ ...run(1, null), status: "running" }],
      }),
    ).toBeNull();
    expect(
      resolveTimelineRewindTarget(first, threadId, {
        ...projection,
        checkpoints: [{ ...checkpoint("start", null, null), status: "missing" }],
      }),
    ).toBeNull();
    expect(
      resolveTimelineRewindTarget(message, threadId, {
        runs: [run(5, null)],
        checkpoints: projection.checkpoints,
      }),
    ).toBeNull();
  });
});
