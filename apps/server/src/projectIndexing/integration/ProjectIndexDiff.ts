// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { parseUnifiedChangePatch } from "../../git-workbench/GitChangeDiff.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { WorkspaceFileSystem } from "../../workspace/WorkspaceFileSystem.ts";
import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import type {
  ProjectIndexReviewDiff,
  ResolvedProjectIndexScope,
} from "../runtime/ProjectIndexingBridge.ts";

const MAX_REVIEW_BYTES = 8 * 1024 * 1024;

class ProjectIndexDiffError extends Schema.TaggedError<ProjectIndexDiffError>()(
  "ProjectIndexDiffError",
  { message: Schema.String },
) {}

function newFilePatch(filePath: string, content: string): string {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export const makeProjectIndexDiffReader = Effect.gen(function* () {
  const git = yield* GitVcsDriver;
  const workspaceFiles = yield* WorkspaceFileSystem;
  const fileSystem = yield* FileSystem.FileSystem;

  return Effect.fn("ProjectIndexDiff.read")(function* (input: {
    readonly resolvedScope: ResolvedProjectIndexScope;
    readonly selection: "workingtree" | "staged";
  }): Effect.fn.Return<ProjectIndexReviewDiff, Error> {
    const cwd = input.resolvedScope.workspaceRoot;
    const execute = (args: ReadonlyArray<string>, allowNonZeroExit = false) =>
      git
        .execute({
          operation: "ProjectIndexDiff.read",
          cwd,
          args,
          allowNonZeroExit,
          maxOutputBytes: MAX_REVIEW_BYTES,
          appendTruncationMarker: false,
        })
        .pipe(
          Effect.flatMap((result) =>
            result.stdoutTruncated
              ? Effect.fail(
                  new ProjectIndexDiffError({
                    message:
                      "The selected diff exceeds the review capacity; review smaller changes.",
                  }),
                )
              : Effect.succeed(result),
          ),
        );
    const restoredFilePatch = (filePath: string, before: string, after: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "t3-index-review-diff-",
          });
          const beforePath = NodePath.join(temporary, "before");
          const afterPath = NodePath.join(temporary, "after");
          yield* fileSystem.writeFileString(beforePath, before);
          yield* fileSystem.writeFileString(afterPath, after);
          const comparison = yield* execute(
            [
              "diff",
              "--no-index",
              "--no-ext-diff",
              "--no-textconv",
              "--unified=3",
              "--",
              beforePath,
              afterPath,
            ],
            true,
          );
          if (comparison.exitCode > 1)
            return yield* new ProjectIndexDiffError({
              message: "The restored source diff could not be read.",
            });
          return comparison.stdout
            .split("\n")
            .map((line) => {
              if (line.startsWith("diff --git "))
                return `diff --git ${JSON.stringify(`a/${filePath}`)} ${JSON.stringify(`b/${filePath}`)}`;
              if (line.startsWith("--- ")) return `--- ${JSON.stringify(`a/${filePath}`)}`;
              if (line.startsWith("+++ ")) return `+++ ${JSON.stringify(`b/${filePath}`)}`;
              return line;
            })
            .join("\n");
        }),
      );
    const head = yield* execute(["rev-parse", "--verify", "HEAD"], true);
    const hasHead = head.exitCode === 0;
    const diffSelection =
      input.selection === "staged" ? ["--cached"] : hasHead ? ["HEAD"] : ["--cached"];
    const named = yield* execute([
      "diff",
      "--relative",
      "--name-only",
      "--no-renames",
      "-z",
      ...diffSelection,
    ]);
    const untracked =
      input.selection === "workingtree"
        ? yield* execute(["ls-files", "--others", "--exclude-standard", "-z"])
        : null;
    const newPaths = new Set(untracked?.stdout.split("\0").filter(Boolean) ?? []);
    const paths = [...new Set([...named.stdout.split("\0"), ...newPaths])]
      .filter(isSafeProjectSourcePath)
      .sort();
    const files: Array<ProjectIndexReviewDiff["files"][number]> = [];
    const patches: string[] = [];
    let bytes = 0;

    for (const filePath of paths) {
      let content: string;
      if (input.selection === "staged") {
        const indexed = yield* execute(["show", `:./${filePath}`], true);
        content =
          indexed.exitCode === 0
            ? indexed.stdout
            : (yield* execute(["show", `HEAD:./${filePath}`])).stdout;
      } else {
        const read = yield* workspaceFiles
          .readFile({ cwd, relativePath: filePath })
          .pipe(Effect.option);
        if (read._tag === "Some") {
          if (read.value.truncated)
            return yield* new ProjectIndexDiffError({
              message: "A changed file exceeds the source verification capacity.",
            });
          content = read.value.contents;
        } else {
          if (yield* fileSystem.exists(NodePath.join(cwd, filePath)))
            return yield* new ProjectIndexDiffError({
              message: "A changed source could not be read safely for review.",
            });
          content = (yield* execute(["show", `HEAD:./${filePath}`])).stdout;
        }
      }
      if (content.includes("\0")) continue;
      const restoredBase =
        hasHead && newPaths.has(filePath)
          ? yield* execute(["show", `HEAD:./${filePath}`], true)
          : null;
      const patch =
        restoredBase?.exitCode === 0
          ? yield* restoredFilePatch(filePath, restoredBase.stdout, content)
          : newPaths.has(filePath) || (!hasHead && input.selection === "workingtree")
            ? newFilePatch(filePath, content)
            : (yield* execute([
                "--literal-pathspecs",
                "diff",
                "--relative",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                "--unified=3",
                ...diffSelection,
                "--",
                filePath,
              ])).stdout;
      if (patch.length === 0) continue;
      bytes += Buffer.byteLength(patch);
      if (bytes > MAX_REVIEW_BYTES)
        return yield* new ProjectIndexDiffError({
          message: "The selected diff exceeds the review capacity; review smaller changes.",
        });
      const parsed = parseUnifiedChangePatch({
        path: filePath,
        source: input.selection === "staged" ? "staged" : "unstaged",
        rawPatch: patch,
        truncated: false,
      });
      if (parsed.binary) continue;
      const sourceSide =
        parsed.hunks.some((hunk) => hunk.oldLines > 0) &&
        parsed.hunks.every((hunk) => hunk.newLines === 0)
          ? "before"
          : "after";
      if (sourceSide === "before")
        content = (yield* execute(["show", `HEAD:./${filePath}`])).stdout;
      const lineLengths = content.split("\n").map((line) => line.length);
      const changedHunks = parsed.hunks.filter((hunk) =>
        sourceSide === "before" ? hunk.oldLines > 0 : hunk.newLines > 0,
      );
      files.push({
        filePath,
        sourceSide,
        patch,
        rangePatches: changedHunks.map((hunk) => hunk.rawLines.join("\n")),
        sourceHash: NodeCrypto.createHash("sha256").update(content).digest("hex"),
        changedRanges: changedHunks.map((hunk) => {
          const startLine = Math.max(1, sourceSide === "before" ? hunk.oldStart : hunk.newStart);
          const lines = sourceSide === "before" ? hunk.oldLines : hunk.newLines;
          const endLine = Math.max(startLine, startLine + lines - 1);
          return {
            startLine,
            startColumn: 1,
            endLine,
            endColumn: (lineLengths[endLine - 1] ?? 0) + 1,
          };
        }),
      });
      patches.push(patch);
    }
    return {
      diff: patches.join("\n"),
      files,
      ...(hasHead ? { revision: head.stdout.trim() } : {}),
    };
  });
});
