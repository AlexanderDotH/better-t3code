import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  GitWorkbenchUndoStorage,
  type GitWorkbenchUndoSnapshot,
} from "../../git-workbench/GitWorkbenchUndoStorage.ts";
import Migration0042 from "../Migrations/042_GitWorkbenchState.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { GitWorkbenchUndoStorageLive } from "./GitWorkbenchUndoStorage.ts";

const migratedSqlite = Layer.effectDiscard(Migration0042).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(GitWorkbenchUndoStorageLive.pipe(Layer.provideMerge(migratedSqlite)));

function snapshot(
  id: string,
  overrides: Partial<GitWorkbenchUndoSnapshot> = {},
): GitWorkbenchUndoSnapshot {
  return {
    id,
    cwd: "/workspace/project",
    worktreeRoot: "/workspace/project",
    reason: "before_hard_reset",
    createdAt: 1_754_128_800_000,
    expiresAt: 1_754_733_600_000,
    headRef: "refs/heads/main",
    headOid: "a".repeat(40),
    indexTreeOid: "b".repeat(40),
    worktreeCommitOid: "c".repeat(40),
    refNamespace: `refs/t3/workbench-undo/${id}`,
    capturedStateToken: "state-1",
    ...overrides,
  };
}

layer("GitWorkbenchUndoStorageLive", (it) => {
  it.effect("round-trips nullable unborn metadata and lists newest first", () =>
    Effect.gen(function* () {
      const storage = yield* GitWorkbenchUndoStorage;
      const older = snapshot("undo-older", { headRef: null, headOid: null });
      const newer = snapshot("undo-newer", {
        createdAt: older.createdAt + 1,
        capturedStateToken: null,
      });

      yield* storage.insert(older);
      yield* storage.insert(newer);

      expect(yield* storage.get(older.cwd, older.id)).toEqual(older);
      expect((yield* storage.list(older.cwd)).map(({ id }) => id)).toEqual([
        "undo-newer",
        "undo-older",
      ]);
    }),
  );

  it.effect("deletes one snapshot without touching another worktree", () =>
    Effect.gen(function* () {
      const storage = yield* GitWorkbenchUndoStorage;
      const first = snapshot("undo-first", { cwd: "/workspace/first" });
      const second = snapshot("undo-second", { cwd: "/workspace/second" });
      yield* storage.insert(first);
      yield* storage.insert(second);

      yield* storage.remove(first.cwd, first.id);

      expect(yield* storage.get(first.cwd, first.id)).toBeNull();
      expect(yield* storage.get(second.cwd, second.id)).toEqual(second);
    }),
  );
});
