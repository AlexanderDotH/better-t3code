import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ControlledEditor from "./GitRebaseControlledEditor.ts";
import {
  GitWorkbenchOperations,
  GitWorkbenchOperationsDriver,
  GitWorkbenchOperationStateReader,
} from "./GitWorkbenchOperations.ts";
import * as Operations from "./GitWorkbenchOperations.ts";
import { GitWorkbenchUndoService } from "./GitWorkbenchUndoService.ts";

function realGit(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv) {
  const result = NodeChildProcess.spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
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
}

function git(cwd: string, args: readonly string[]) {
  const result = realGit(cwd, args);
  if (result.exitCode === 0) return result.stdout.trim();
  throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

function integrationLayer(cwd: string) {
  const runner = Layer.succeed(
    GitWorkbenchOperationsDriver,
    GitWorkbenchOperationsDriver.of({
      run: (input) => Effect.sync(() => realGit(input.cwd, input.args, input.env)),
    }),
  );
  const state = Layer.succeed(
    GitWorkbenchOperationStateReader,
    GitWorkbenchOperationStateReader.of({
      read: () =>
        Effect.sync(() => {
          const gitPath = (name: string) => {
            const resolved = git(cwd, ["rev-parse", "--git-path", name]);
            return NodePath.isAbsolute(resolved) ? resolved : NodePath.join(cwd, resolved);
          };
          const rebaseMerge = gitPath("rebase-merge");
          const rebaseApply = gitPath("rebase-apply");
          const conflicts = realGit(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"])
            .stdout.split("\0")
            .filter(Boolean);
          const operationKind =
            NodeFS.existsSync(rebaseMerge) || NodeFS.existsSync(rebaseApply)
              ? ("rebase" as const)
              : NodeFS.existsSync(gitPath("CHERRY_PICK_HEAD"))
                ? ("cherry-pick" as const)
                : NodeFS.existsSync(gitPath("REVERT_HEAD"))
                  ? ("revert" as const)
                  : NodeFS.existsSync(gitPath("MERGE_HEAD"))
                    ? ("merge" as const)
                    : ("none" as const);
          return {
            stateToken: "state-1",
            headOid: git(cwd, ["rev-parse", "HEAD"]),
            refName: git(cwd, ["branch", "--show-current"]) || null,
            operation:
              operationKind === "none"
                ? { kind: "none" as const }
                : {
                    kind: operationKind,
                    ...(conflicts.length > 0 ? { conflictingPaths: conflicts } : {}),
                  },
            hasWorkingTreeChanges: git(cwd, ["status", "--porcelain"]).length > 0,
          };
        }),
    }),
  );
  const undo = Layer.succeed(
    GitWorkbenchUndoService,
    GitWorkbenchUndoService.of({
      capture: (input) =>
        Effect.succeed({
          id: "undo-integration",
          cwd: input.cwd,
          worktreeRoot: input.cwd,
          reason: input.reason,
          createdAt: 0,
          expiresAt: 1,
          headRef: "refs/heads/main",
          headOid: git(cwd, ["rev-parse", "HEAD"]),
          indexTreeOid: git(cwd, ["write-tree"]),
          worktreeCommitOid: git(cwd, ["rev-parse", "HEAD"]),
          refNamespace: "refs/t3/workbench-undo/undo-integration",
          capturedStateToken: input.capturedStateToken ?? null,
        }),
      list: () => Effect.succeed([]),
      restore: () => Effect.void,
    }),
  );
  const editor = ControlledEditor.layer.pipe(Layer.provideMerge(NodeServices.layer));

  return Operations.layer.pipe(
    Layer.provide(runner),
    Layer.provide(state),
    Layer.provide(undo),
    Layer.provide(editor),
    Layer.provideMerge(NodeServices.layer),
  );
}

function prepareCherryPickConflict(cwd: string): string {
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.name", "Test User"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  NodeFS.writeFileSync(NodePath.join(cwd, "conflict.txt"), "base\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "base"]);
  git(cwd, ["switch", "-c", "side"]);
  NodeFS.writeFileSync(NodePath.join(cwd, "conflict.txt"), "side\n");
  git(cwd, ["commit", "-am", "side"]);
  const sideOid = git(cwd, ["rev-parse", "HEAD"]);
  git(cwd, ["switch", "main"]);
  NodeFS.writeFileSync(NodePath.join(cwd, "conflict.txt"), "main\n");
  git(cwd, ["commit", "-am", "main"]);
  return sideOid;
}

describe("GitWorkbenchOperations integration", () => {
  it.effect("executes a topology-preserving interactive rebase with a merge node", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-rebase-merges-" });

        git(cwd, ["init", "-b", "main"]);
        git(cwd, ["config", "user.name", "Test User"]);
        git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(cwd, "base.txt"), "base\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "base"]);
        const baseOid = git(cwd, ["rev-parse", "HEAD"]);

        git(cwd, ["switch", "-c", "side"]);
        yield* fs.writeFileString(path.join(cwd, "side.txt"), "side\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "side"]);
        const sideOid = git(cwd, ["rev-parse", "HEAD"]);

        git(cwd, ["switch", "main"]);
        yield* fs.writeFileString(path.join(cwd, "main.txt"), "main\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "main"]);
        const mainOid = git(cwd, ["rev-parse", "HEAD"]);
        git(cwd, ["merge", "--no-ff", "side", "-m", "merge side"]);
        const mergeOid = git(cwd, ["rev-parse", "HEAD"]);
        yield* fs.writeFileString(path.join(cwd, "tip.txt"), "tip\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "tip"]);
        const tipOid = git(cwd, ["rev-parse", "HEAD"]);

        const operation = Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          return yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: {
              kind: "interactive_rebase",
              upstreamRef: baseOid,
              plan: [
                { kind: "label", name: "onto" },
                { kind: "reset", label: "onto" },
                { kind: "pick", oid: mainOid },
                { kind: "label", name: "mainline" },
                { kind: "reset", label: "onto" },
                { kind: "pick", oid: sideOid },
                { kind: "label", name: "side-tip" },
                { kind: "reset", label: "mainline" },
                {
                  kind: "merge",
                  label: "side-tip",
                  originalOid: mergeOid,
                  messageMode: "reuse",
                },
                { kind: "pick", oid: tipOid },
              ],
            },
          });
        }).pipe(Effect.provide(integrationLayer(cwd)));

        const result = yield* operation;
        assert.equal(result.status, "succeeded");
        assert.equal(git(cwd, ["rev-list", "--merges", "--count", `${baseOid}..HEAD`]), "1");
        const mergeLine = git(cwd, ["rev-list", "--parents", `${baseOid}..HEAD`])
          .split("\n")
          .find((line) => line.trim().split(/\s+/).length === 3);
        assert(mergeLine, "expected a commit with two parents after the rebase");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("applies a controlled multiline reword message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-rebase-reword-" });

        git(cwd, ["init", "-b", "main"]);
        git(cwd, ["config", "user.name", "Test User"]);
        git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(cwd, "base.txt"), "base\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "base"]);
        const baseOid = git(cwd, ["rev-parse", "HEAD"]);
        yield* fs.writeFileString(path.join(cwd, "change.txt"), "change\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "old subject"]);
        const changeOid = git(cwd, ["rev-parse", "HEAD"]);
        const message = "new subject\n\nnew body with $(literal text)";

        const result = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          return yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: {
              kind: "interactive_rebase",
              upstreamRef: baseOid,
              plan: [
                { kind: "label", name: "onto" },
                { kind: "reset", label: "onto" },
                { kind: "reword", oid: changeOid, message },
              ],
            },
          });
        }).pipe(Effect.provide(integrationLayer(cwd)));

        assert.equal(result.status, "succeeded");
        assert.equal(git(cwd, ["log", "-1", "--format=%B"]), message);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("applies soft, mixed, and hard reset semantics in a real repository", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-reset-modes-" });

        git(cwd, ["init", "-b", "main"]);
        git(cwd, ["config", "user.name", "Test User"]);
        git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(cwd, "file.txt"), "base\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "base"]);
        const baseOid = git(cwd, ["rev-parse", "HEAD"]);
        yield* fs.writeFileString(path.join(cwd, "file.txt"), "tip\n");
        git(cwd, ["commit", "-am", "tip"]);
        const tipOid = git(cwd, ["rev-parse", "HEAD"]);

        const results = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          const soft = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "reset", mode: "soft", targetOid: baseOid },
          });
          assert.equal(git(cwd, ["rev-parse", "HEAD"]), baseOid);
          assert.equal(git(cwd, ["diff", "--cached", "--name-only"]), "file.txt");
          assert.equal(git(cwd, ["diff", "--name-only"]), "");

          const hard = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "reset", mode: "hard", targetOid: tipOid },
          });
          assert.equal(git(cwd, ["status", "--porcelain"]), "");

          const mixed = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "reset", mode: "mixed", targetOid: baseOid },
          });
          assert.equal(git(cwd, ["rev-parse", "HEAD"]), baseOid);
          assert.equal(git(cwd, ["diff", "--cached", "--name-only"]), "");
          assert.equal(git(cwd, ["diff", "--name-only"]), "file.txt");

          return [soft, hard, mixed] as const;
        }).pipe(Effect.provide(integrationLayer(cwd)));

        for (const result of results) assert.equal(result.status, "succeeded");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rebases, reverts, and cherry-picks real commits through typed operations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-guided-operations-" });

        git(cwd, ["init", "-b", "main"]);
        git(cwd, ["config", "user.name", "Test User"]);
        git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(cwd, "base.txt"), "base\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "base"]);

        git(cwd, ["switch", "-c", "feature"]);
        yield* fs.writeFileString(path.join(cwd, "feature.txt"), "feature\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "feature"]);
        const originalFeatureOid = git(cwd, ["rev-parse", "HEAD"]);

        git(cwd, ["switch", "main"]);
        yield* fs.writeFileString(path.join(cwd, "main.txt"), "main\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "main"]);
        git(cwd, ["switch", "feature"]);

        const results = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          const rebase = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "guided_rebase", ontoRef: "main" },
          });
          assert.equal(realGit(cwd, ["merge-base", "--is-ancestor", "main", "HEAD"]).exitCode, 0);
          const rebasedFeatureOid = git(cwd, ["rev-parse", "HEAD"]);

          const revert = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "revert", commitOid: rebasedFeatureOid },
          });
          assert.equal(NodeFS.existsSync(path.join(cwd, "feature.txt")), false);

          const cherryPick = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "cherry_pick", commitOid: originalFeatureOid },
          });
          assert.equal(NodeFS.existsSync(path.join(cwd, "feature.txt")), true);

          return [rebase, revert, cherryPick] as const;
        }).pipe(Effect.provide(integrationLayer(cwd)));

        for (const result of results) assert.equal(result.status, "succeeded");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("continues a resolved cherry-pick conflict", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cherry-continue-" });
        const sideOid = prepareCherryPickConflict(cwd);

        const results = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          const conflicted = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "cherry_pick", commitOid: sideOid },
          });
          assert.equal(conflicted.status, "conflicts");
          assert.equal(conflicted.operation.kind, "cherry-pick");

          yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "resolved\n");
          git(cwd, ["add", "--", "conflict.txt"]);
          const continued = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "continue", operation: "cherry-pick" },
          });
          return continued;
        }).pipe(Effect.provide(integrationLayer(cwd)));

        assert.equal(results.status, "succeeded");
        assert.equal(yield* fs.readFileString(path.join(cwd, "conflict.txt")), "resolved\n");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("aborts a cherry-pick conflict back to the original worktree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cherry-abort-" });
        const sideOid = prepareCherryPickConflict(cwd);

        const result = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "cherry_pick", commitOid: sideOid },
          });
          return yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "abort", operation: "cherry-pick" },
          });
        }).pipe(Effect.provide(integrationLayer(cwd)));

        assert.equal(result.status, "succeeded");
        assert.equal(yield* fs.readFileString(path.join(cwd, "conflict.txt")), "main\n");
        assert.equal(git(cwd, ["status", "--porcelain"]), "");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("skips a conflicting commit during a guided rebase", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-rebase-skip-" });

        git(cwd, ["init", "-b", "main"]);
        git(cwd, ["config", "user.name", "Test User"]);
        git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "base\n");
        git(cwd, ["add", "."]);
        git(cwd, ["commit", "-m", "base"]);
        git(cwd, ["switch", "-c", "feature"]);
        yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "feature\n");
        git(cwd, ["commit", "-am", "feature"]);
        git(cwd, ["switch", "main"]);
        yield* fs.writeFileString(path.join(cwd, "conflict.txt"), "main\n");
        git(cwd, ["commit", "-am", "main"]);
        const mainOid = git(cwd, ["rev-parse", "HEAD"]);
        git(cwd, ["switch", "feature"]);

        const result = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          const conflicted = yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "guided_rebase", ontoRef: "main" },
          });
          assert.equal(conflicted.status, "conflicts");
          assert.equal(conflicted.operation.kind, "rebase");
          return yield* operations.run({
            cwd,
            expectedStateToken: "state-1",
            action: { kind: "skip", operation: "rebase" },
          });
        }).pipe(Effect.provide(integrationLayer(cwd)));

        assert.equal(result.status, "succeeded");
        assert.equal(git(cwd, ["rev-parse", "HEAD"]), mainOid);
        assert.equal(yield* fs.readFileString(path.join(cwd, "conflict.txt")), "main\n");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects force-with-lease when the remote moved", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-force-with-lease-" });
        const remote = path.join(root, "remote.git");
        const local = path.join(root, "local");
        const competitor = path.join(root, "competitor");

        git(root, ["init", "--bare", remote]);
        git(root, ["init", "-b", "main", local]);
        git(local, ["config", "user.name", "Local User"]);
        git(local, ["config", "user.email", "local@example.com"]);
        yield* fs.writeFileString(path.join(local, "file.txt"), "initial\n");
        git(local, ["add", "."]);
        git(local, ["commit", "-m", "initial"]);
        git(local, ["remote", "add", "origin", remote]);
        git(local, ["push", "-u", "origin", "main"]);
        git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        const expectedRemoteOid = git(local, ["rev-parse", "HEAD"]);

        git(root, ["clone", remote, competitor]);
        git(competitor, ["config", "user.name", "Competing User"]);
        git(competitor, ["config", "user.email", "competitor@example.com"]);
        yield* fs.writeFileString(path.join(competitor, "file.txt"), "remote moved\n");
        git(competitor, ["commit", "-am", "move remote"]);
        git(competitor, ["push", "origin", "main"]);
        const movedRemoteOid = git(competitor, ["rev-parse", "HEAD"]);

        const error = yield* Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          return yield* operations
            .run({
              cwd: local,
              expectedStateToken: "state-1",
              action: {
                kind: "force_with_lease",
                remote: "origin",
                branch: "main",
                expectedRemoteOid,
              },
            })
            .pipe(Effect.flip);
        }).pipe(Effect.provide(integrationLayer(local)));

        assert.equal(error._tag, "GitWorkbenchOperationCommandError");
        assert.equal(git(remote, ["rev-parse", "refs/heads/main"]), movedRemoteOid);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
