import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import {
  GitWorkbenchUndoService,
  GitWorkbenchUndoStateReader,
  layer,
  type GitWorkbenchUndoSnapshot,
} from "./GitWorkbenchUndoService.ts";
import { GitWorkbenchUndoDriver } from "./GitWorkbenchUndoDriver.ts";
import { GitWorkbenchUndoStorage } from "./GitWorkbenchUndoStorage.ts";

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const WORKTREE = "c".repeat(40);

function snapshot(
  id: string,
  createdAt: number,
  input: Partial<GitWorkbenchUndoSnapshot> = {},
): GitWorkbenchUndoSnapshot {
  return {
    id,
    cwd: "/repo",
    worktreeRoot: "/repo",
    reason: "before_revert",
    createdAt,
    expiresAt: createdAt + 7 * 24 * 60 * 60 * 1_000,
    headRef: "refs/heads/main",
    headOid: HEAD,
    indexTreeOid: TREE,
    worktreeCommitOid: WORKTREE,
    refNamespace: `refs/t3/workbench-undo/${id}`,
    capturedStateToken: "state-1",
    ...input,
  };
}

function makeTestLayer(input?: {
  readonly initial?: readonly GitWorkbenchUndoSnapshot[];
  readonly capture?: GitWorkbenchUndoDriver["Service"]["capture"];
  readonly restore?: GitWorkbenchUndoDriver["Service"]["restore"];
  readonly remove?: GitWorkbenchUndoDriver["Service"]["remove"];
  readonly readStateToken?: GitWorkbenchUndoStateReader["Service"]["readStateToken"];
}) {
  const records = [...(input?.initial ?? [])];
  const storage = GitWorkbenchUndoStorage.of({
    insert: (value) => Effect.sync(() => void records.push(value)),
    get: (cwd, id) =>
      Effect.sync(() => records.find((item) => item.cwd === cwd && item.id === id) ?? null),
    list: (cwd) =>
      Effect.sync(() =>
        records
          .filter((item) => item.cwd === cwd)
          .sort((left, right) => right.createdAt - left.createdAt),
      ),
    remove: (cwd, id) =>
      Effect.sync(() => {
        const index = records.findIndex((item) => item.cwd === cwd && item.id === id);
        if (index >= 0) records.splice(index, 1);
      }),
  });

  const capture =
    input?.capture ??
    ((captureInput) =>
      Effect.succeed(
        snapshot(captureInput.id, captureInput.createdAt, {
          cwd: captureInput.cwd,
          reason: captureInput.reason,
          expiresAt: captureInput.expiresAt,
          refNamespace: captureInput.refNamespace,
          capturedStateToken: captureInput.capturedStateToken,
        }),
      ));

  return {
    records,
    layer: layer.pipe(
      Layer.provide(
        Layer.succeed(
          GitWorkbenchUndoDriver,
          GitWorkbenchUndoDriver.of({
            capture,
            restore: input?.restore ?? (() => Effect.void),
            remove: input?.remove ?? (() => Effect.void),
          }),
        ),
      ),
      Layer.provide(Layer.succeed(GitWorkbenchUndoStorage, storage)),
      Layer.provide(
        Layer.succeed(
          GitWorkbenchUndoStateReader,
          GitWorkbenchUndoStateReader.of({
            readStateToken: input?.readStateToken ?? (() => Effect.succeed("state-1")),
          }),
        ),
      ),
    ),
  };
}

describe("GitWorkbenchUndoService", () => {
  it.effect("captures a snapshot and records seven-day expiry metadata", () => {
    const test = makeTestLayer();
    return Effect.gen(function* () {
      yield* TestClock.setTime(1_000);
      const undo = yield* GitWorkbenchUndoService;
      const result = yield* undo.capture({
        cwd: "/repo",
        reason: "before_revert",
        capturedStateToken: "state-1",
      });

      assert.equal(result.createdAt, 1_000);
      assert.equal(result.expiresAt, 1_000 + 7 * 24 * 60 * 60 * 1_000);
      assert.equal(test.records.length, 1);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("retains only the twenty newest snapshots and removes their hidden refs", () => {
    const initial = Array.from({ length: 21 }, (_, index) => snapshot(`old-${index}`, index));
    const remove = vi.fn(() => Effect.void);
    const test = makeTestLayer({ initial, remove });

    return Effect.gen(function* () {
      yield* TestClock.setTime(1_000);
      const undo = yield* GitWorkbenchUndoService;
      yield* undo.capture({ cwd: "/repo", reason: "before_revert" });

      assert.equal(test.records.length, 20);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(test.records.map((item) => item.id)).not.toContain("old-0");
      expect(test.records.map((item) => item.id)).not.toContain("old-1");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("drops expired snapshots before listing", () => {
    const remove = vi.fn(() => Effect.void);
    const test = makeTestLayer({
      initial: [
        snapshot("expired", 0, { expiresAt: 99 }),
        snapshot("current", 50, { expiresAt: 1_000 }),
      ],
      remove,
    });

    return Effect.gen(function* () {
      yield* TestClock.setTime(100);
      const undo = yield* GitWorkbenchUndoService;
      const values = yield* undo.list("/repo");

      assert.deepStrictEqual(
        values.map((value) => value.id),
        ["current"],
      );
      expect(remove).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("captures the current state before restoring a previous snapshot", () => {
    const calls: string[] = [];
    const target = snapshot("target", 10);
    const capture = vi.fn((input) =>
      Effect.sync(() => calls.push("capture")).pipe(
        Effect.as(
          snapshot(input.id, input.createdAt, {
            reason: input.reason,
            refNamespace: input.refNamespace,
          }),
        ),
      ),
    );
    const restore = vi.fn((value) => Effect.sync(() => calls.push(`restore:${value.id}`)));
    const test = makeTestLayer({ initial: [target], capture, restore });

    return Effect.gen(function* () {
      yield* TestClock.setTime(100);
      const undo = yield* GitWorkbenchUndoService;
      yield* undo.restore({
        cwd: "/repo",
        snapshotId: "target",
        expectedStateToken: "state-1",
      });

      assert.deepStrictEqual(calls, ["capture", "restore:target"]);
      expect(capture.mock.calls[0]?.[0].reason).toBe("before_restore");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("refuses to restore when repository state changed", () => {
    const restore = vi.fn();
    const test = makeTestLayer({
      initial: [snapshot("target", 10)],
      restore,
      readStateToken: () => Effect.succeed("new-state"),
    });

    return Effect.gen(function* () {
      const undo = yield* GitWorkbenchUndoService;
      const error = yield* undo
        .restore({
          cwd: "/repo",
          snapshotId: "target",
          expectedStateToken: "state-1",
        })
        .pipe(Effect.flip);

      assert.equal(error.detail, "Repository state changed before the undo restore could run.");
      expect(restore).not.toHaveBeenCalled();
    }).pipe(Effect.provide(test.layer));
  });
});
