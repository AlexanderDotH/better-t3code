// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, it } from "@effect/vitest";
import * as ServerConfig from "../../config.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../../workspace/WorkspacePaths.ts";
import { sourceHash } from "../extraction/source.ts";
import { makeProjectIndexDiffReader } from "../integration/ProjectIndexDiff.ts";
import {
  createSyntheticGitRepository as createRepository,
  syntheticGit as git,
} from "./SyntheticGitFixture.ts";
const unused = () =>
  Effect.die("A read-only diff unexpectedly changed or searched workspace files");
function readDiff(root: string, selection: "workingtree" | "staged") {
  return Effect.scoped(
    Effect.gen(function* () {
      const driver = yield* GitVcsDriver.make;
      const workspacePaths = yield* WorkspacePaths.make;
      const workspaceFiles = yield* WorkspaceFileSystem.make.pipe(
        Effect.provideService(WorkspacePaths.WorkspacePaths, workspacePaths),
        Effect.provideService(WorkspaceEntries.WorkspaceEntries, {
          browse: unused,
          list: unused,
          search: unused,
          invalidate: unused,
          searchContents: unused,
          refresh: unused,
        }),
      );
      const reader = yield* makeProjectIndexDiffReader.pipe(
        Effect.provideService(GitVcsDriver.GitVcsDriver, driver),
        Effect.provideService(WorkspaceFileSystem.WorkspaceFileSystem, workspaceFiles),
      );
      return yield* reader({
        resolvedScope: {
          workspaceRoot: root,
          scope: {
            scopeId: "diff-scope",
            projectId: ProjectId.make("diff-project"),
            workspaceFingerprint: "diff-fingerprint",
          },
        },
        selection,
      });
    }),
  ).pipe(
    Effect.provide(
      ServerConfig.ServerConfig.layerTest(root, { prefix: "t3-index-diff-config-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
}
it.live(
  "reviews staged content independently from later working-tree edits and rereads changed source",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => createRepository());
      try {
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, "source.ts"), "export const value = 1;\n"),
        );
        yield* Effect.promise(() => git(root, ["add", "--", "source.ts"]));
        yield* Effect.promise(() => git(root, ["commit", "--quiet", "-m", "Synthetic baseline"]));
        const stagedSource = "export const value = 2;\n";
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, "source.ts"), stagedSource),
        );
        yield* Effect.promise(() => git(root, ["add", "--", "source.ts"]));
        const workingSource = "export const value = 3;\n";
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, "source.ts"), workingSource),
        );
        const staged = yield* readDiff(root, "staged");
        const working = yield* readDiff(root, "workingtree");
        expect(staged.diff).toContain("+export const value = 2;");
        expect(staged.diff).not.toContain("value = 3");
        expect(staged.files[0]?.sourceHash).toBe(sourceHash(stagedSource));
        expect(working.diff).toContain("+export const value = 3;");
        expect(working.files[0]?.sourceHash).toBe(sourceHash(workingSource));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(root, "source.ts"), "export const value = 4;\n"),
        );
        const reread = yield* readDiff(root, "workingtree");
        expect(reread.files[0]?.sourceHash).not.toBe(working.files[0]?.sourceHash);
        expect(reread.diff).not.toBe(working.diff);
        expect(reread.revision).toBe(working.revision);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
it.live("covers initial and untracked source while keeping private index and credentials out", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => createRepository());
    try {
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "staged.ts"), "export const staged = 1;\n"),
      );
      yield* Effect.promise(() => git(root, ["add", "--", "staged.ts"]));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "staged.ts"), "export const staged = 2;\n"),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "untracked.ts"), "export const fresh = 3;\n"),
      );
      yield* Effect.promise(() => NodeFSP.mkdir(NodePath.join(root, ".t3")));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, ".t3", "private.ts"), "SYNTHETIC_PRIVATE_INDEX"),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, ".env"), "SYNTHETIC_CREDENTIAL"),
      );
      const result = yield* readDiff(root, "workingtree");
      expect(result.revision).toBeUndefined();
      expect(result.files.map((file) => file.filePath)).toEqual(["staged.ts", "untracked.ts"]);
      expect(result.diff).toContain("+export const staged = 2;");
      expect(result.diff).toContain("+export const fresh = 3;");
      expect(result.diff).not.toContain("SYNTHETIC_PRIVATE_INDEX");
      expect(result.diff).not.toContain("SYNTHETIC_CREDENTIAL");
      expect((yield* readDiff(root, "staged")).diff).toContain("+export const staged = 1;");
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  }),
);
it.live("retains deleted-file evidence and refuses an oversized source review", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => createRepository());
    try {
      const source = "export function removed() { return 1; }\n";
      yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(root, "removed.ts"), source));
      yield* Effect.promise(() => git(root, ["add", "--", "removed.ts"]));
      yield* Effect.promise(() =>
        git(root, ["commit", "--quiet", "-m", "Synthetic deletion baseline"]),
      );
      yield* Effect.promise(() => git(root, ["rm", "--quiet", "--", "removed.ts"]));
      for (const selection of ["workingtree", "staged"] as const) {
        const result = yield* readDiff(root, selection);
        expect(result.diff).toContain("-export function removed()");
        expect(result.files[0]?.sourceHash).toBe(sourceHash(source));
        expect(result.files[0]?.patch).toContain("-export function removed()");
        expect(result.files[0]?.sourceSide).toBe("before");
        expect(result.files[0]?.changedRanges).toEqual([
          { startLine: 1, startColumn: 1, endLine: 1, endColumn: source.trimEnd().length + 1 },
        ]);
        expect(result.files[0]?.rangePatches?.[0]).toContain("-export function removed()");
      }
      yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(root, "removed.ts"), ""));
      const emptied = yield* readDiff(root, "workingtree");
      expect(emptied.files[0]?.sourceSide).toBe("before");
      expect(emptied.files[0]?.sourceHash).toBe(sourceHash(source));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(root, "large.ts"), "x".repeat(1024 * 1024 + 1)),
      );
      const failure = yield* readDiff(root, "workingtree").pipe(Effect.flip);
      expect(failure.message).toContain("capacity");
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  }),
);
