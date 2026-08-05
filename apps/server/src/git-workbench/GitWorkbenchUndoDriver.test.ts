import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  GitWorkbenchOperationsDriver,
  type GitWorkbenchOperationCommandInput,
} from "./GitWorkbenchOperations.ts";
import { GitWorkbenchUndoDriver, layer } from "./GitWorkbenchUndoDriver.ts";

const runRealGit = (input: GitWorkbenchOperationCommandInput) =>
  Effect.sync(() => {
    const result = NodeChildProcess.spawnSync("git", [...input.args], {
      cwd: input.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ...input.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "commit.gpgsign",
        GIT_CONFIG_VALUE_0: "false",
      },
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error?.message ?? "",
    };
  });

const TestLayer = layer.pipe(
  Layer.provide(
    Layer.succeed(
      GitWorkbenchOperationsDriver,
      GitWorkbenchOperationsDriver.of({ run: runRealGit }),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: readonly string[]) =>
  runRealGit({
    operation: "GitWorkbenchUndoDriver.test",
    cwd,
    args,
    allowNonZeroExit: true,
  }).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(result.stdout.trim())
        : Effect.dieMessage(result.stderr || `git ${args.join(" ")} failed`),
    ),
  );

describe("GitWorkbenchUndoDriver", () => {
  it.effect("restores HEAD, branch, index, worktree, and untracked files exactly", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workbench-undo-" });
        const tracked = path.join(cwd, "tracked.txt");
        const untracked = path.join(cwd, "untracked.txt");
        const extra = path.join(cwd, "extra.txt");

        yield* git(cwd, ["init", "-b", "main"]);
        yield* git(cwd, ["config", "user.name", "Test User"]);
        yield* git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(tracked, "base\n");
        yield* git(cwd, ["add", "--", "tracked.txt"]);
        yield* git(cwd, ["commit", "-m", "base"]);
        const originalHead = yield* git(cwd, ["rev-parse", "HEAD"]);

        yield* fs.writeFileString(tracked, "staged\n");
        yield* git(cwd, ["add", "--", "tracked.txt"]);
        yield* fs.writeFileString(tracked, "worktree\n");
        yield* fs.writeFileString(untracked, "untracked\n");

        const driver = yield* GitWorkbenchUndoDriver;
        const snapshot = yield* driver.capture({
          id: "00000000-0000-4000-8000-000000000001",
          cwd,
          reason: "before_hard_reset",
          createdAt: 1,
          expiresAt: 2,
          refNamespace: "refs/t3/workbench-undo/00000000-0000-4000-8000-000000000001",
          capturedStateToken: "before",
        });

        assert.equal(yield* git(cwd, ["show", ":tracked.txt"]), "staged");
        assert.equal(yield* fs.readFileString(tracked), "worktree\n");

        yield* git(cwd, ["reset", "--hard", "HEAD"]);
        yield* fs.writeFileString(tracked, "later\n");
        yield* git(cwd, ["add", "--", "tracked.txt"]);
        yield* git(cwd, ["commit", "-m", "later"]);
        yield* fs.remove(untracked, { force: true });
        yield* fs.writeFileString(extra, "extra\n");

        yield* driver.restore(snapshot);

        assert.equal(yield* git(cwd, ["rev-parse", "HEAD"]), originalHead);
        assert.equal(yield* git(cwd, ["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert.equal(yield* git(cwd, ["show", ":tracked.txt"]), "staged");
        assert.equal(yield* fs.readFileString(tracked), "worktree\n");
        assert.equal(yield* fs.readFileString(untracked), "untracked\n");
        assert.equal(yield* fs.exists(extra), false);
        assert.equal(
          yield* git(cwd, ["status", "--porcelain"]),
          "MM tracked.txt\n?? untracked.txt",
        );

        yield* driver.remove(snapshot);
        const removed = yield* runRealGit({
          operation: "GitWorkbenchUndoDriver.test.removed",
          cwd,
          args: ["rev-parse", "--verify", `${snapshot.refNamespace}/worktree`],
          allowNonZeroExit: true,
        });
        assert.notEqual(removed.exitCode, 0);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("round-trips an unborn branch without manufacturing a HEAD commit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workbench-unborn-" });
        const draft = path.join(cwd, "draft.txt");

        yield* git(cwd, ["init", "-b", "main"]);
        yield* fs.writeFileString(draft, "draft\n");

        const driver = yield* GitWorkbenchUndoDriver;
        const snapshot = yield* driver.capture({
          id: "00000000-0000-4000-8000-000000000002",
          cwd,
          reason: "manual",
          createdAt: 1,
          expiresAt: 2,
          refNamespace: "refs/t3/workbench-undo/00000000-0000-4000-8000-000000000002",
          capturedStateToken: null,
        });

        assert.equal(snapshot.headOid, null);
        assert.equal(snapshot.headRef, "refs/heads/main");
        yield* fs.writeFileString(draft, "changed\n");
        yield* fs.writeFileString(path.join(cwd, "extra.txt"), "extra\n");

        yield* driver.restore(snapshot);

        const head = yield* runRealGit({
          operation: "GitWorkbenchUndoDriver.test.unborn",
          cwd,
          args: ["rev-parse", "--verify", "HEAD"],
          allowNonZeroExit: true,
        });
        assert.notEqual(head.exitCode, 0);
        assert.equal(yield* git(cwd, ["symbolic-ref", "HEAD"]), "refs/heads/main");
        assert.equal(yield* fs.readFileString(draft), "draft\n");
        assert.equal(yield* fs.exists(path.join(cwd, "extra.txt")), false);
        assert.equal(yield* git(cwd, ["status", "--porcelain"]), "?? draft.txt");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("restores a detached HEAD without moving the branch active at restore time", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workbench-detached-" });
        const tracked = path.join(cwd, "tracked.txt");

        yield* git(cwd, ["init", "-b", "main"]);
        yield* git(cwd, ["config", "user.name", "Test User"]);
        yield* git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(tracked, "base\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "base"]);
        const detachedHead = yield* git(cwd, ["rev-parse", "HEAD"]);
        yield* git(cwd, ["switch", "--detach", detachedHead]);
        yield* fs.writeFileString(tracked, "staged\n");
        yield* git(cwd, ["add", "tracked.txt"]);
        yield* fs.writeFileString(tracked, "worktree\n");

        const driver = yield* GitWorkbenchUndoDriver;
        const snapshot = yield* driver.capture({
          id: "00000000-0000-4000-8000-000000000003",
          cwd,
          reason: "manual",
          createdAt: 1,
          expiresAt: 2,
          refNamespace: "refs/t3/workbench-undo/00000000-0000-4000-8000-000000000003",
          capturedStateToken: null,
        });
        assert.equal(snapshot.headRef, null);

        yield* git(cwd, ["reset", "--hard", detachedHead]);
        yield* git(cwd, ["switch", "main"]);
        yield* fs.writeFileString(path.join(cwd, "later.txt"), "later\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "later"]);
        const mainTip = yield* git(cwd, ["rev-parse", "refs/heads/main"]);

        yield* driver.restore(snapshot);

        assert.equal(yield* git(cwd, ["rev-parse", "HEAD"]), detachedHead);
        assert.equal(yield* git(cwd, ["rev-parse", "refs/heads/main"]), mainTip);
        const symbolicHead = yield* runRealGit({
          operation: "GitWorkbenchUndoDriver.test.detached",
          cwd,
          args: ["symbolic-ref", "--quiet", "HEAD"],
          allowNonZeroExit: true,
        });
        assert.notEqual(symbolicHead.exitCode, 0);
        assert.equal(yield* git(cwd, ["show", ":tracked.txt"]), "staged");
        assert.equal(yield* fs.readFileString(tracked), "worktree\n");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects mismatched snapshot refs before changing current files", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workbench-identity-" });
        const tracked = path.join(cwd, "tracked.txt");
        const currentUntracked = path.join(cwd, "keep.txt");

        yield* git(cwd, ["init", "-b", "main"]);
        yield* git(cwd, ["config", "user.name", "Test User"]);
        yield* git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(tracked, "base\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "base"]);

        const driver = yield* GitWorkbenchUndoDriver;
        const snapshot = yield* driver.capture({
          id: "00000000-0000-4000-8000-000000000004",
          cwd,
          reason: "manual",
          createdAt: 1,
          expiresAt: 2,
          refNamespace: "refs/t3/workbench-undo/00000000-0000-4000-8000-000000000004",
          capturedStateToken: null,
        });
        yield* fs.writeFileString(tracked, "current\n");
        yield* fs.writeFileString(currentUntracked, "keep\n");
        yield* git(cwd, ["update-ref", "-d", `${snapshot.refNamespace}/worktree`]);

        const error = yield* driver.restore(snapshot).pipe(Effect.flip);

        assert.match(error.detail, /do not match this repository/i);
        assert.equal(yield* fs.readFileString(tracked), "current\n");
        assert.equal(yield* fs.readFileString(currentUntracked), "keep\n");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
