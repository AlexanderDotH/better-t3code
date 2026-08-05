import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  GitChangeSelectionRestrictedError,
  GitWorkbenchDriver,
  GitWorkbenchStaleStateError,
  layer,
  makeRegisteredGitWorkspace,
  parsePorcelainV2,
} from "./GitWorkbenchDriver.ts";

const TestLayer = layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);

const TEST_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  LC_ALL: "C",
};

const git = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: TEST_GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });

const write = (cwd: string, path: string, contents: string | Buffer): void => {
  const absolutePath = NodePath.join(cwd, path);
  NodeFS.mkdirSync(NodePath.dirname(absolutePath), { recursive: true });
  NodeFS.writeFileSync(absolutePath, contents);
};

const withRepository = <A, E, R>(
  use: (cwd: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-git-workbench-"));
      git(cwd, ["init", "--initial-branch=main"]);
      git(cwd, ["config", "user.name", "T3 Test"]);
      git(cwd, ["config", "user.email", "t3@example.invalid"]);
      return cwd;
    }),
    use,
    (cwd) => Effect.sync(() => NodeFS.rmSync(cwd, { recursive: true, force: true })),
  );

const commitInitialFile = (cwd: string, contents = "one\ntwo\nthree\n"): void => {
  write(cwd, "example.txt", contents);
  git(cwd, ["add", "--", "example.txt"]);
  git(cwd, ["commit", "-m", "initial"]);
};

describe("parsePorcelainV2", () => {
  it("parses NUL-delimited ordinary, rename, conflict, and odd-path records", () => {
    const oddPath = "src/line\n\tname.ts";
    const renamedPath = "src/new name.ts";
    const oldPath = "src/old name.ts";
    const stdout =
      "# branch.oid abcdef\0" +
      "# branch.head main\0" +
      "# branch.upstream origin/main\0" +
      "# branch.ab +2 -3\0" +
      `1 M. N... 100644 100644 100644 abcdef abcdef ${oddPath}\0` +
      `2 R. N... 100644 100644 100644 abcdef abcdef R100 ${renamedPath}\0${oldPath}\0` +
      "u UU N... 100644 100644 100644 100644 a b c conflict.txt\0" +
      "? --option-like\0";

    const result = parsePorcelainV2(stdout);

    expect(result.branch).toEqual({
      headOid: "abcdef",
      refName: "main",
      upstreamRef: "origin/main",
      aheadCount: 2,
      behindCount: 3,
      detached: false,
      unborn: false,
    });
    expect(result.files.map((file) => [file.path, file.oldPath, file.kind])).toEqual([
      [oddPath, undefined, "modified"],
      [renamedPath, oldPath, "renamed"],
      ["conflict.txt", undefined, "conflicted"],
      ["--option-like", undefined, "untracked"],
    ]);
  });
});

describe("GitWorkbenchDriver", () => {
  it.effect("reports detailed staged, unstaged, untracked, operation, and state-token data", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        write(cwd, "example.txt", "one\nTWO\nthree\n");
        write(cwd, "staged.txt", "staged\n");
        git(cwd, ["add", "--", "staged.txt"]);
        const oddPath = "odd\nname.txt";
        write(cwd, oddPath, "odd\n");
        const headOid = git(cwd, ["rev-parse", "HEAD"]).trim();
        write(cwd, ".git/MERGE_HEAD", `${headOid}\n`);

        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const first = yield* driver.getSnapshot(workspace);

        expect(first.isRepository).toBe(true);
        expect(first.refName).toBe("main");
        expect(first.headOid).toBe(headOid);
        expect(first.operation.kind).toBe("merge");
        expect(first.files.find((file) => file.path === "staged.txt")?.staged).toBe(true);
        expect(first.files.find((file) => file.path === "example.txt")?.unstagedStats).toEqual({
          insertions: 1,
          deletions: 1,
          binary: false,
        });
        expect(first.files.find((file) => file.path === oddPath)?.untracked).toBe(true);
        expect(first.totals).toMatchObject({ staged: 1, unstaged: 1, untracked: 1 });
        expect(first.stateToken).toMatch(/^[a-f0-9]{64}$/);
        expect(first.indexStateToken).toMatch(/^[a-f0-9]{64}$/);
        expect(first.worktreeStateToken).toMatch(/^[a-f0-9]{64}$/);

        write(cwd, "example.txt", "one\nTWO AGAIN\nthree\n");
        const second = yield* driver.getSnapshot(workspace);
        expect(second.stateToken).not.toBe(first.stateToken);
        expect(second.indexStateToken).toBe(first.indexStateToken);
        expect(second.worktreeStateToken).not.toBe(first.worktreeStateToken);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reports rebase identity and includes operation markers in the state token", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        const headOid = git(cwd, ["rev-parse", "HEAD"]).trim();
        const rebaseDir = NodePath.join(cwd, ".git", "rebase-merge");
        NodeFS.mkdirSync(rebaseDir);
        NodeFS.writeFileSync(NodePath.join(rebaseDir, "head-name"), "refs/heads/main\n");
        NodeFS.writeFileSync(NodePath.join(rebaseDir, "onto"), `${headOid}\n`);
        NodeFS.writeFileSync(NodePath.join(rebaseDir, "msgnum"), "2\n");
        NodeFS.writeFileSync(NodePath.join(rebaseDir, "end"), "4\n");

        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const first = yield* driver.getSnapshot(workspace);
        expect(first.operation).toEqual({
          kind: "rebase",
          currentStep: 2,
          totalSteps: 4,
          headName: "refs/heads/main",
          ontoOid: headOid,
        });

        NodeFS.writeFileSync(NodePath.join(rebaseDir, "head-name"), "refs/heads/feature\n");
        const second = yield* driver.getSnapshot(workspace);
        expect(second.operation.headName).toBe("refs/heads/feature");
        expect(second.stateToken).not.toBe(first.stateToken);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("stages, unstages, and discards selected lines using only regenerated patches", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        write(cwd, "example.txt", "one\nTWO\nthree\nfour\n");

        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const initial = yield* driver.getSnapshot(workspace);
        const unstaged = yield* driver.getChangesDiff({
          workspace,
          path: "example.txt",
          source: "unstaged",
          expectedStateToken: initial.stateToken,
        });
        const replacementIds = unstaged.hunks.flatMap((hunk) =>
          hunk.lines
            .filter((line) => line.content === "two" || line.content === "TWO")
            .map((line) => line.id),
        );

        const afterStage = yield* driver.applyChangeSelection({
          workspace,
          path: "example.txt",
          source: "unstaged",
          action: "stage",
          selection: { kind: "lines", ids: replacementIds },
          expectedStateToken: initial.stateToken,
          expectedPatchId: unstaged.patchId,
        });
        expect(git(cwd, ["show", ":example.txt"])).toBe("one\nTWO\nthree\n");
        expect(NodeFS.readFileSync(NodePath.join(cwd, "example.txt"), "utf8")).toBe(
          "one\nTWO\nthree\nfour\n",
        );

        const staged = yield* driver.getChangesDiff({
          workspace,
          path: "example.txt",
          source: "staged",
          expectedStateToken: afterStage.stateToken,
        });
        const afterUnstage = yield* driver.applyChangeSelection({
          workspace,
          path: "example.txt",
          source: "staged",
          action: "unstage",
          selection: { kind: "hunks", ids: staged.hunks.map((hunk) => hunk.id) },
          expectedStateToken: afterStage.stateToken,
          expectedPatchId: staged.patchId,
        });
        expect(git(cwd, ["show", ":example.txt"])).toBe("one\ntwo\nthree\n");

        const discardDiff = yield* driver.getChangesDiff({
          workspace,
          path: "example.txt",
          source: "unstaged",
          expectedStateToken: afterUnstage.stateToken,
        });
        const fourId = discardDiff.hunks
          .flatMap((hunk) => hunk.lines)
          .find((line) => line.type === "addition" && line.content === "four")?.id;
        expect(fourId).toBeDefined();
        yield* driver.applyChangeSelection({
          workspace,
          path: "example.txt",
          source: "unstaged",
          action: "discard",
          selection: { kind: "lines", ids: [fourId ?? ""] },
          expectedStateToken: afterUnstage.stateToken,
          expectedPatchId: discardDiff.patchId,
        });
        expect(NodeFS.readFileSync(NodePath.join(cwd, "example.txt"), "utf8")).toBe(
          "one\nTWO\nthree\n",
        );
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects stale patches and partial binary or rename selections", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        write(cwd, "example.txt", "one\nTWO\nthree\n");
        write(cwd, "binary.dat", Buffer.from([0, 1, 2, 3]));
        git(cwd, ["add", "--", "binary.dat"]);
        git(cwd, ["commit", "-m", "add binary"]);
        write(cwd, "binary.dat", Buffer.from([0, 9, 2, 3]));

        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const snapshot = yield* driver.getSnapshot(workspace);
        const textDiff = yield* driver.getChangesDiff({
          workspace,
          path: "example.txt",
          source: "unstaged",
          expectedStateToken: snapshot.stateToken,
        });

        write(cwd, "another.txt", "new state\n");
        const stale = yield* driver
          .applyChangeSelection({
            workspace,
            path: "example.txt",
            source: "unstaged",
            action: "stage",
            selection: { kind: "file" },
            expectedStateToken: snapshot.stateToken,
            expectedPatchId: textDiff.patchId,
          })
          .pipe(Effect.flip);
        expect(stale).toBeInstanceOf(GitWorkbenchStaleStateError);

        const current = yield* driver.getSnapshot(workspace);
        const binaryDiff = yield* driver.getChangesDiff({
          workspace,
          path: "binary.dat",
          source: "unstaged",
          expectedStateToken: current.stateToken,
        });
        const restricted = yield* driver
          .applyChangeSelection({
            workspace,
            path: "binary.dat",
            source: "unstaged",
            action: "stage",
            selection: { kind: "lines", ids: ["not-applicable"] },
            expectedStateToken: current.stateToken,
            expectedPatchId: binaryDiff.patchId,
          })
          .pipe(Effect.flip);
        expect(restricted).toBeInstanceOf(GitChangeSelectionRestrictedError);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("rejects paths that are not repository-relative literals", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);

        const error = yield* driver
          .getChangesDiff({ workspace, path: "../outside", source: "unstaged" })
          .pipe(Effect.flip);
        expect(error._tag).toBe("GitWorkbenchInvalidPathError");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("distinguishes unborn and detached repositories", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const unborn = yield* driver.getSnapshot(workspace);
        expect(unborn).toMatchObject({
          isRepository: true,
          unborn: true,
          detached: false,
          headOid: null,
          refName: "main",
        });

        commitInitialFile(cwd);
        git(cwd, ["checkout", "--detach", "HEAD"]);
        const detached = yield* driver.getSnapshot(workspace);
        expect(detached).toMatchObject({
          isRepository: true,
          unborn: false,
          detached: true,
          refName: null,
        });
        expect(detached.headOid).toMatch(/^[a-f0-9]{40,64}$/);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("captures the exact upstream OID used by force-with-lease and queue validation", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        const remote = NodePath.join(cwd, ".git", "upstream.git");
        git(cwd, ["init", "--bare", remote]);
        git(cwd, ["remote", "add", "origin", remote]);
        git(cwd, ["push", "-u", "origin", "main"]);

        const driver = yield* GitWorkbenchDriver;
        const snapshot = yield* driver.getSnapshot(makeRegisteredGitWorkspace(cwd));

        expect(snapshot.upstreamRef).toBe("origin/main");
        expect(snapshot.upstreamOid).toBe(snapshot.headOid);
        expect(snapshot.lastCommit).toMatchObject({ subject: "initial", oid: snapshot.headOid });
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "stages, unstages, and discards an option-like untracked path containing a newline",
    () =>
      withRepository((cwd) =>
        Effect.gen(function* () {
          commitInitialFile(cwd);
          const path = "--odd\n name.txt";
          write(cwd, path, "odd path\n");
          const driver = yield* GitWorkbenchDriver;
          const workspace = makeRegisteredGitWorkspace(cwd);

          const initial = yield* driver.getSnapshot(workspace);
          const untracked = yield* driver.getChangesDiff({
            workspace,
            path,
            source: "unstaged",
            expectedStateToken: initial.stateToken,
          });
          const staged = yield* driver.applyChangeSelection({
            workspace,
            path,
            source: "unstaged",
            action: "stage",
            selection: { kind: "file" },
            expectedStateToken: initial.stateToken,
            expectedPatchId: untracked.patchId,
          });
          expect(staged.files.find((file) => file.path === path)?.indexStatus).toBe("added");

          const stagedDiff = yield* driver.getChangesDiff({
            workspace,
            path,
            source: "staged",
            expectedStateToken: staged.stateToken,
          });
          const unstagedAgain = yield* driver.applyChangeSelection({
            workspace,
            path,
            source: "staged",
            action: "unstage",
            selection: { kind: "file" },
            expectedStateToken: staged.stateToken,
            expectedPatchId: stagedDiff.patchId,
          });
          const discardDiff = yield* driver.getChangesDiff({
            workspace,
            path,
            source: "unstaged",
            expectedStateToken: unstagedAgain.stateToken,
          });
          const partialDiscard = yield* driver
            .applyChangeSelection({
              workspace,
              path,
              source: "unstaged",
              action: "discard",
              selection: {
                kind: "lines",
                ids: discardDiff.hunks.flatMap((hunk) =>
                  hunk.lines.filter((line) => line.selectable).map((line) => line.id),
                ),
              },
              expectedStateToken: unstagedAgain.stateToken,
              expectedPatchId: discardDiff.patchId,
              confirmedUntrackedDeletion: true,
            })
            .pipe(Effect.flip);
          expect(partialDiscard).toBeInstanceOf(GitChangeSelectionRestrictedError);
          const unconfirmed = yield* driver
            .applyChangeSelection({
              workspace,
              path,
              source: "unstaged",
              action: "discard",
              selection: { kind: "file" },
              expectedStateToken: unstagedAgain.stateToken,
              expectedPatchId: discardDiff.patchId,
            })
            .pipe(Effect.flip);
          expect(unconfirmed).toBeInstanceOf(GitChangeSelectionRestrictedError);
          yield* driver.applyChangeSelection({
            workspace,
            path,
            source: "unstaged",
            action: "discard",
            selection: { kind: "file" },
            expectedStateToken: unstagedAgain.stateToken,
            expectedPatchId: discardDiff.patchId,
            confirmedUntrackedDeletion: true,
          });
          expect(NodeFS.existsSync(NodePath.join(cwd, path))).toBe(false);
        }),
      ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("preserves CRLF and no-trailing-newline content during line staging", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd, "one\r\ntwo\r\nthree");
        write(cwd, "example.txt", "one\r\nTWO\r\nthree\r\nfour");
        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const snapshot = yield* driver.getSnapshot(workspace);
        const diff = yield* driver.getChangesDiff({
          workspace,
          path: "example.txt",
          source: "unstaged",
          expectedStateToken: snapshot.stateToken,
        });
        const replacementIds = diff.hunks.flatMap((hunk) =>
          hunk.lines
            .filter(
              (line) =>
                line.content.replace(/\r$/, "") === "two" ||
                line.content.replace(/\r$/, "") === "TWO",
            )
            .map((line) => line.id),
        );
        expect(replacementIds).toHaveLength(2);

        yield* driver.applyChangeSelection({
          workspace,
          path: "example.txt",
          source: "unstaged",
          action: "stage",
          selection: { kind: "lines", ids: replacementIds },
          expectedStateToken: snapshot.stateToken,
          expectedPatchId: diff.patchId,
        });
        expect(git(cwd, ["show", ":example.txt"])).toBe("one\r\nTWO\r\nthree");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect(
    "reports conflict versions, stages whole-file resolutions, and blocks partial ones",
    () =>
      withRepository((cwd) =>
        Effect.gen(function* () {
          commitInitialFile(cwd);
          git(cwd, ["checkout", "-b", "other"]);
          write(cwd, "example.txt", "other\n");
          git(cwd, ["commit", "-am", "other change"]);
          git(cwd, ["checkout", "main"]);
          write(cwd, "example.txt", "main\n");
          git(cwd, ["commit", "-am", "main change"]);
          const merge = NodeChildProcess.spawnSync("git", ["-C", cwd, "merge", "other"], {
            encoding: "utf8",
            env: TEST_GIT_ENV,
          });
          expect(merge.status).not.toBe(0);

          const driver = yield* GitWorkbenchDriver;
          const workspace = makeRegisteredGitWorkspace(cwd);
          const snapshot = yield* driver.getSnapshot(workspace);
          expect(snapshot.operation).toMatchObject({
            kind: "merge",
            conflictingPaths: ["example.txt"],
          });
          expect(snapshot.files.find((file) => file.path === "example.txt")).toMatchObject({
            kind: "conflicted",
            indexStatus: "conflicted",
            worktreeStatus: "conflicted",
            conflicted: true,
          });
          const conflictDiff = yield* driver.getChangesDiff({
            workspace,
            path: "example.txt",
            source: "unstaged",
            expectedStateToken: snapshot.stateToken,
          });
          expect(conflictDiff.conflictVersions).toEqual({
            base: "one\ntwo\nthree\n",
            ours: "main\n",
            theirs: "other\n",
          });
          const restricted = yield* driver
            .applyChangeSelection({
              workspace,
              path: "example.txt",
              source: "unstaged",
              action: "stage",
              selection: { kind: "hunks", ids: [conflictDiff.hunks[0]?.id ?? "missing"] },
              expectedStateToken: snapshot.stateToken,
              expectedPatchId: conflictDiff.patchId,
            })
            .pipe(Effect.flip);
          expect(restricted).toBeInstanceOf(GitChangeSelectionRestrictedError);
          write(cwd, "example.txt", "resolved\n");
          const refreshed = yield* driver.getSnapshot(workspace);
          const refreshedDiff = yield* driver.getChangesDiff({
            workspace,
            path: "example.txt",
            source: "unstaged",
            expectedStateToken: refreshed.stateToken,
          });
          const resolved = yield* driver.applyChangeSelection({
            workspace,
            path: "example.txt",
            source: "unstaged",
            action: "stage",
            selection: { kind: "file" },
            expectedStateToken: refreshed.stateToken,
            expectedPatchId: refreshedDiff.patchId,
          });
          expect(resolved.files.find((file) => file.path === "example.txt")?.conflicted).toBe(
            false,
          );
        }),
      ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("allows whole-file binary staging but rejects partial rename staging", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        write(cwd, "binary.dat", Buffer.from([0, 1, 2, 3]));
        git(cwd, ["add", "--", "binary.dat"]);
        git(cwd, ["commit", "-m", "binary"]);
        write(cwd, "binary.dat", Buffer.from([0, 9, 2, 3]));

        const driver = yield* GitWorkbenchDriver;
        const workspace = makeRegisteredGitWorkspace(cwd);
        const binaryState = yield* driver.getSnapshot(workspace);
        const binaryDiff = yield* driver.getChangesDiff({
          workspace,
          path: "binary.dat",
          source: "unstaged",
          expectedStateToken: binaryState.stateToken,
        });
        const afterBinary = yield* driver.applyChangeSelection({
          workspace,
          path: "binary.dat",
          source: "unstaged",
          action: "stage",
          selection: { kind: "file" },
          expectedStateToken: binaryState.stateToken,
          expectedPatchId: binaryDiff.patchId,
        });
        const stagedBinary = NodeChildProcess.execFileSync(
          "git",
          ["-C", cwd, "show", ":binary.dat"],
          { encoding: "buffer" },
        );
        expect([...stagedBinary]).toEqual([0, 9, 2, 3]);

        git(cwd, ["mv", "--", "example.txt", "renamed.txt"]);
        write(cwd, "renamed.txt", "one\nTWO\nthree\n");
        const renameState = yield* driver.getSnapshot(workspace);
        expect(renameState.stateToken).not.toBe(afterBinary.stateToken);
        const renameDiff = yield* driver.getChangesDiff({
          workspace,
          path: "renamed.txt",
          source: "unstaged",
          expectedStateToken: renameState.stateToken,
        });
        const selectable = renameDiff.hunks.flatMap((hunk) =>
          hunk.lines.filter((line) => line.selectable).map((line) => line.id),
        );
        expect(selectable.length).toBeGreaterThan(0);
        const restricted = yield* driver
          .applyChangeSelection({
            workspace,
            path: "renamed.txt",
            source: "unstaged",
            action: "stage",
            selection: { kind: "lines", ids: selectable },
            expectedStateToken: renameState.stateToken,
            expectedPatchId: renameDiff.patchId,
          })
          .pipe(Effect.flip);
        expect(restricted).toBeInstanceOf(GitChangeSelectionRestrictedError);

        const afterDiscard = yield* driver.applyChangeSelection({
          workspace,
          path: "renamed.txt",
          source: "unstaged",
          action: "discard",
          selection: { kind: "file" },
          expectedStateToken: renameState.stateToken,
          expectedPatchId: renameDiff.patchId,
        });
        expect(NodeFS.readFileSync(NodePath.join(cwd, "renamed.txt"), "utf8")).toBe(
          "one\ntwo\nthree\n",
        );
        expect(
          git(cwd, ["diff", "--cached", "--name-status", "--", "example.txt", "renamed.txt"]),
        ).toMatch(/^R\d+\texample\.txt\trenamed\.txt/m);
        expect(afterDiscard.files.find((file) => file.path === "renamed.txt")?.unstaged).toBe(
          false,
        );
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("classifies deletions, executable mode changes, and dirty gitlinks", () =>
    withRepository((cwd) =>
      Effect.gen(function* () {
        commitInitialFile(cwd);
        write(cwd, "delete-me.txt", "delete\n");
        const nested = NodePath.join(cwd, "nested");
        NodeFS.mkdirSync(nested);
        git(nested, ["init", "--initial-branch=main"]);
        git(nested, ["config", "user.name", "Nested Test"]);
        git(nested, ["config", "user.email", "nested@example.invalid"]);
        write(nested, "nested.txt", "nested\n");
        git(nested, ["add", "--", "nested.txt"]);
        git(nested, ["commit", "-m", "nested initial"]);
        git(cwd, ["config", "advice.addEmbeddedRepo", "false"]);
        git(cwd, ["add", "--", "delete-me.txt", "nested"]);
        git(cwd, ["commit", "-m", "classification fixtures"]);

        NodeFS.chmodSync(NodePath.join(cwd, "example.txt"), 0o755);
        git(cwd, ["rm", "--", "delete-me.txt"]);
        write(nested, "nested.txt", "nested dirty\n");

        const driver = yield* GitWorkbenchDriver;
        const snapshot = yield* driver.getSnapshot(makeRegisteredGitWorkspace(cwd));
        expect(snapshot.files.find((file) => file.path === "delete-me.txt")).toMatchObject({
          kind: "deleted",
          staged: true,
        });
        expect(snapshot.files.find((file) => file.path === "example.txt")).toMatchObject({
          kind: "modified",
          modeChanged: true,
        });
        expect(snapshot.files.find((file) => file.path === "nested")).toMatchObject({
          submodule: true,
          unstaged: true,
        });
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
