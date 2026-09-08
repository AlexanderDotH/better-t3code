import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveProjectCheckpointSetting,
  runExclusiveProjectGroupUpdate,
  updateProjectGroupMembers,
} from "./projectCheckpointSettings";

describe("resolveProjectCheckpointSetting", () => {
  it("fails closed for an empty group", () => {
    expect(resolveProjectCheckpointSetting([])).toEqual({
      state: "disabled",
      effectiveEnabled: false,
    });
  });

  it("reports an enabled group only when every checkout is enabled", () => {
    expect(
      resolveProjectCheckpointSetting([{ checkpointsEnabled: true }, { checkpointsEnabled: true }]),
    ).toEqual({ state: "enabled", effectiveEnabled: true });
  });

  it("reports a disabled group when every checkout is disabled", () => {
    expect(
      resolveProjectCheckpointSetting([
        { checkpointsEnabled: false },
        { checkpointsEnabled: false },
      ]),
    ).toEqual({ state: "disabled", effectiveEnabled: false });
  });

  it("reports mixed groups and treats them as disabled until normalized", () => {
    expect(
      resolveProjectCheckpointSetting([
        { checkpointsEnabled: true },
        { checkpointsEnabled: false },
      ]),
    ).toEqual({ state: "mixed", effectiveEnabled: false });
  });

  it("attempts every grouped checkout and reports all failed members", async () => {
    const members = [{ id: "first" }, { id: "second" }, { id: "third" }] as const;
    const attempts: string[] = [];
    let activeUpdates = 0;
    let maxActiveUpdates = 0;

    const outcome = await updateProjectGroupMembers(members, async (member) => {
      attempts.push(member.id);
      activeUpdates += 1;
      maxActiveUpdates = Math.max(maxActiveUpdates, activeUpdates);
      await Promise.resolve();
      activeUpdates -= 1;
      return member.id === "first"
        ? AsyncResult.success(undefined)
        : AsyncResult.failure(Cause.fail(new Error(`${member.id} failed`)));
    });

    expect(attempts).toEqual(["first", "second", "third"]);
    expect(maxActiveUpdates).toBe(1);
    expect(outcome.failures.map(({ member }) => member.id)).toEqual(["second", "third"]);
    expect(outcome.failures.map(({ result }) => String(Cause.squash(result.cause)))).toEqual([
      "Error: second failed",
      "Error: third failed",
    ]);
  });

  it("fences overlapping grouped updates and releases the fence after failure", async () => {
    const fence = { current: false };
    let releaseFirst!: () => void;
    const firstUpdate = new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first complete");
    });
    let overlappingUpdateRan = false;

    const first = runExclusiveProjectGroupUpdate(fence, () => firstUpdate);
    const overlapping = runExclusiveProjectGroupUpdate(fence, async () => {
      overlappingUpdateRan = true;
      return "overlap complete";
    });

    expect(await overlapping).toBeUndefined();
    expect(overlappingUpdateRan).toBe(false);
    releaseFirst();
    expect(await first).toBe("first complete");
    expect(fence.current).toBe(false);

    await expect(
      runExclusiveProjectGroupUpdate(fence, () => Promise.reject(new Error("save failed"))),
    ).rejects.toThrow("save failed");
    expect(fence.current).toBe(false);
  });
});
