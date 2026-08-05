import * as NodeCrypto from "node:crypto";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { GitUndoSnapshotReason } from "@t3tools/contracts";

import { GitWorkbenchUndoDriver } from "./GitWorkbenchUndoDriver.ts";
import {
  GitWorkbenchUndoStorage,
  GitWorkbenchUndoStorageError,
} from "./GitWorkbenchUndoStorage.ts";

export type GitWorkbenchUndoReason = GitUndoSnapshotReason;

export interface GitWorkbenchUndoSnapshot {
  readonly id: string;
  readonly cwd: string;
  readonly worktreeRoot: string;
  readonly reason: GitWorkbenchUndoReason;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly headRef: string | null;
  readonly headOid: string | null;
  readonly indexTreeOid: string;
  readonly worktreeCommitOid: string;
  readonly refNamespace: string;
  readonly capturedStateToken: string | null;
}

export class GitWorkbenchUndoError extends Data.TaggedError("GitWorkbenchUndoError")<{
  readonly operation: "capture" | "delete" | "list" | "restore";
  readonly cwd: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export class GitWorkbenchUndoStateReader extends Context.Service<
  GitWorkbenchUndoStateReader,
  {
    readonly readStateToken: (cwd: string) => Effect.Effect<string, GitWorkbenchUndoError>;
  }
>()("t3/git-workbench/GitWorkbenchUndoService/GitWorkbenchUndoStateReader") {}

export class GitWorkbenchUndoService extends Context.Service<
  GitWorkbenchUndoService,
  {
    readonly capture: (input: {
      readonly cwd: string;
      readonly reason: GitWorkbenchUndoReason;
      readonly capturedStateToken?: string | null;
    }) => Effect.Effect<GitWorkbenchUndoSnapshot, GitWorkbenchUndoError>;
    readonly list: (
      cwd: string,
    ) => Effect.Effect<readonly GitWorkbenchUndoSnapshot[], GitWorkbenchUndoError>;
    readonly restore: (input: {
      readonly cwd: string;
      readonly snapshotId: string;
      readonly expectedStateToken: string;
    }) => Effect.Effect<void, GitWorkbenchUndoError>;
  }
>()("t3/git-workbench/GitWorkbenchUndoService") {}

const RETENTION_COUNT = 20;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function storageError(
  operation: GitWorkbenchUndoError["operation"],
  cwd: string,
  cause: GitWorkbenchUndoStorageError,
) {
  return new GitWorkbenchUndoError({
    operation,
    cwd,
    detail: "Undo snapshot metadata could not be persisted.",
    cause,
  });
}

export const make = Effect.gen(function* () {
  const driver = yield* GitWorkbenchUndoDriver;
  const storage = yield* GitWorkbenchUndoStorage;
  const stateReader = yield* GitWorkbenchUndoStateReader;

  const removeSnapshot = Effect.fn("GitWorkbenchUndoService.removeSnapshot")(function* (
    snapshot: GitWorkbenchUndoSnapshot,
  ) {
    yield* driver.remove(snapshot);
    yield* storage
      .remove(snapshot.cwd, snapshot.id)
      .pipe(Effect.mapError((cause) => storageError("delete", snapshot.cwd, cause)));
  });

  const enforceRetention = Effect.fn("GitWorkbenchUndoService.enforceRetention")(function* (
    cwd: string,
    now: number,
  ) {
    const snapshots = yield* storage
      .list(cwd)
      .pipe(Effect.mapError((cause) => storageError("list", cwd, cause)));
    const current = snapshots
      .filter((snapshot) => snapshot.expiresAt > now)
      .sort((left, right) => right.createdAt - left.createdAt);
    const expired = snapshots.filter((snapshot) => snapshot.expiresAt <= now);
    const excess = current.slice(RETENTION_COUNT);
    yield* Effect.forEach([...expired, ...excess], removeSnapshot, { discard: true });
  });

  const captureInternal = Effect.fn("GitWorkbenchUndoService.captureInternal")(function* (
    input: {
      readonly cwd: string;
      readonly reason: GitWorkbenchUndoReason;
      readonly capturedStateToken?: string | null;
    },
    cleanup: boolean,
  ) {
    const createdAt = yield* Clock.currentTimeMillis;
    const id = NodeCrypto.randomUUID();
    const refNamespace = `refs/t3/workbench-undo/${id}`;
    const snapshot = yield* driver.capture({
      id,
      cwd: input.cwd,
      reason: input.reason,
      createdAt,
      expiresAt: createdAt + RETENTION_MS,
      refNamespace,
      capturedStateToken: input.capturedStateToken ?? null,
    });

    yield* storage.insert(snapshot).pipe(
      Effect.mapError((cause) => storageError("capture", input.cwd, cause)),
      Effect.onError(() => driver.remove(snapshot).pipe(Effect.ignore)),
    );
    if (cleanup) yield* enforceRetention(input.cwd, createdAt);
    return snapshot;
  });

  return GitWorkbenchUndoService.of({
    capture: (input) => captureInternal(input, true),
    list: (cwd) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* enforceRetention(cwd, now);
        return yield* storage
          .list(cwd)
          .pipe(Effect.mapError((cause) => storageError("list", cwd, cause)));
      }),
    restore: (input) =>
      Effect.gen(function* () {
        const actualStateToken = yield* stateReader.readStateToken(input.cwd);
        if (actualStateToken !== input.expectedStateToken) {
          return yield* new GitWorkbenchUndoError({
            operation: "restore",
            cwd: input.cwd,
            detail: "Repository state changed before the undo restore could run.",
          });
        }

        const target = yield* storage
          .get(input.cwd, input.snapshotId)
          .pipe(Effect.mapError((cause) => storageError("restore", input.cwd, cause)));
        if (!target) {
          return yield* new GitWorkbenchUndoError({
            operation: "restore",
            cwd: input.cwd,
            detail: "Undo snapshot no longer exists.",
          });
        }

        const now = yield* Clock.currentTimeMillis;
        if (target.expiresAt <= now) {
          yield* removeSnapshot(target);
          return yield* new GitWorkbenchUndoError({
            operation: "restore",
            cwd: input.cwd,
            detail: "Undo snapshot has expired.",
          });
        }

        yield* captureInternal(
          { cwd: input.cwd, reason: "before_restore", capturedStateToken: actualStateToken },
          false,
        );
        yield* driver.restore(target);
        yield* enforceRetention(input.cwd, now);
      }),
  });
});

export const layer = Layer.effect(GitWorkbenchUndoService, make);
