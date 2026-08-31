import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { FileFinder } from "@ff-labs/fff-node";
import { afterEach, it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

let renameFile: typeof NodeFSP.rename = NodeFSP.rename;

const ProjectLayer = Layer.effect(
  WorkspaceFileSystem.WorkspaceFileSystem,
  WorkspaceFileSystem.makeWithFileRename((oldPath, newPath) => renameFile(oldPath, newPath)),
).pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-workspace-files-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer, { excludeTestServices: true })("WorkspaceFileSystemLive", (it) => {
  afterEach(() => {
    renameFile = NodeFSP.rename;
    vi.restoreAllMocks();
  });

  describe("readFile", () => {
    it.effect("reads UTF-8 files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/index.ts", "export const answer = 42;\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/index.ts",
        });

        expect(result).toEqual({
          relativePath: "src/index.ts",
          contents: "export const answer = 42;\n",
          byteLength: 26,
          truncated: false,
          revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
      }),
    );

    it.effect("rejects reads outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "../escape.md" })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );
      }),
    );

    it.effect("rejects symlinks that resolve outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* writeTextFile(outsideDir, "secret.txt", "outside\n");
        yield* fileSystem.symlink(
          path.join(outsideDir, "secret.txt"),
          path.join(cwd, "linked-secret.txt"),
        );

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "linked-secret.txt" })
          .pipe(Effect.flip);
        const resolvedWorkspaceRoot = yield* fileSystem.realPath(cwd);
        const resolvedPath = yield* fileSystem.realPath(path.join(outsideDir, "secret.txt"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "linked-secret.txt",
          resolvedWorkspaceRoot,
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects directories without manufacturing an I/O cause", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "src" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(path.join(cwd, "src"));

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspacePathNotFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "src",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
      }),
    );

    it.effect("rejects binary files without leaking their contents into the error", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const absolutePath = path.join(cwd, "asset.bin");
        yield* fileSystem.writeFile(absolutePath, Uint8Array.from([0x61, 0, 0x62]));

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "asset.bin" })
          .pipe(Effect.flip);
        const resolvedPath = yield* fileSystem.realPath(absolutePath);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceBinaryFileError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "asset.bin",
          resolvedPath,
        });
        expect("cause" in error).toBe(false);
        expect("contents" in error).toBe(false);
      }),
    );

    it.effect("preserves the real cause and path for I/O failures", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const resolvedPath = path.join(cwd, "missing.txt");

        const error = yield* workspaceFileSystem
          .readFile({ cwd, relativePath: "missing.txt" })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFileSystemOperationError);
        expect(error).toMatchObject({
          workspaceRoot: cwd,
          relativePath: "missing.txt",
          resolvedPath,
          operationPath: resolvedPath,
          operation: "realpath-target",
        });
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.list({ cwd });
        expect(beforeWrite.entries.some((entry) => entry.path === "plans/effect-rpc.md")).toBe(
          false,
        );

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.list({ cwd });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("writes without starting an eager workspace index scan", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");
        yield* workspaceEntries.list({ cwd });

        const scanSpy = vi.spyOn(FileFinder.prototype, "scanFiles");
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "src/added.ts",
          contents: "export {};\n",
        });

        expect(result).toEqual({ relativePath: "src/added.ts" });
        expect(scanSpy).not.toHaveBeenCalled();
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.orElseSucceed(() => null));
        expect(escapedStat).toBeNull();
      }),
    );

    it.effect("uses compare-and-swap revisions for atomic writes", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/file.ts", "base\n");
        const read = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/file.ts",
        });

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "src/file.ts",
          contents: "mine\n",
          expectedRevision: read.revision,
        });
        const conflict = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "src/file.ts",
            contents: "stale\n",
            expectedRevision: read.revision,
          })
          .pipe(Effect.flip);

        expect(conflict).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFileRevisionConflictError);
        expect(conflict).toMatchObject({
          expectedRevision: read.revision,
          relativePath: "src/file.ts",
        });
      }),
    );

    it.effect("rejects writes through a symlink target", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outside = yield* makeTempDir;
        yield* writeTextFile(outside, "outside.txt", "outside\n");
        yield* fileSystem.symlink(path.join(outside, "outside.txt"), path.join(cwd, "linked.txt"));

        const error = yield* workspaceFileSystem
          .writeFile({ cwd, relativePath: "linked.txt", contents: "replaced\n" })
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspacePathNotFileError);
        expect(yield* fileSystem.readFileString(path.join(outside, "outside.txt"))).toBe(
          "outside\n",
        );
      }),
    );
  });

  describe("editFiles", () => {
    it.effect("creates, edits, and deletes files in one ordered batch", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/lines.ts", "one\ntwo\nthree\n");
        yield* writeTextFile(cwd, "src/unicode.ts", "a😀c");
        yield* writeTextFile(cwd, "src/obsolete.ts", "obsolete\n");

        const result = yield* workspaceFileSystem.editFiles({
          workspaceRoot: cwd,
          input: {
            changes: [
              {
                path: "src/lines.ts",
                edits: [
                  { type: "replace", old_text: "one", new_text: "ONE" },
                  {
                    type: "splice",
                    range: { type: "lines", start: 2, end: 2 },
                    content: "TWO\n",
                  },
                  { type: "splice", range: { type: "start" }, content: "// header\n" },
                ],
              },
              {
                path: "src/unicode.ts",
                edits: [
                  {
                    type: "splice",
                    range: { type: "code_points", start: 1, end: 2 },
                    content: "B",
                  },
                  { type: "splice", range: { type: "end" }, content: "!" },
                ],
              },
              {
                path: "src/created.ts",
                edits: [{ type: "write", mode: "create", content: "export {};\n" }],
              },
              {
                path: "src/obsolete.ts",
                edits: [{ type: "delete", if_missing: "error" }],
              },
            ],
          },
        });

        expect(yield* fileSystem.readFileString(path.join(cwd, "src/lines.ts"))).toBe(
          "// header\nONE\nTWO\nthree\n",
        );
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/unicode.ts"))).toBe("aBc!");
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/created.ts"))).toBe(
          "export {};\n",
        );
        expect(yield* fileSystem.exists(path.join(cwd, "src/obsolete.ts"))).toBe(false);
        expect(result).toEqual({
          changes: [
            {
              path: "src/lines.ts",
              action: "updated",
              edit_count: 3,
              revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            },
            {
              path: "src/unicode.ts",
              action: "updated",
              edit_count: 2,
              revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            },
            {
              path: "src/created.ts",
              action: "created",
              edit_count: 1,
              revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            },
            { path: "src/obsolete.ts", action: "deleted", edit_count: 1 },
          ],
        });
        expect(JSON.stringify(result)).not.toContain("header");
      }),
    );

    it.effect("validates every change before writing any file", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/first.ts", "first\n");
        yield* writeTextFile(cwd, "src/second.ts", "second\n");

        const error = yield* workspaceFileSystem
          .editFiles({
            workspaceRoot: cwd,
            input: {
              changes: [
                {
                  path: "src/first.ts",
                  edits: [{ type: "write", mode: "overwrite", content: "changed\n" }],
                },
                {
                  path: "src/second.ts",
                  edits: [
                    {
                      type: "splice",
                      range: { type: "lines", start: 4, end: 4 },
                      content: "invalid\n",
                    },
                  ],
                },
              ],
            },
          })
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          reason: "invalid_range",
          path: "src/second.ts",
          change_index: 1,
          edit_index: 0,
        });
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/first.ts"))).toBe("first\n");
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/second.ts"))).toBe("second\n");
      }),
    );

    it.effect("rejects a stale revision without changing another file", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/first.ts", "first\n");
        yield* writeTextFile(cwd, "src/stale.ts", "base\n");
        const staleRead = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/stale.ts",
        });
        yield* writeTextFile(cwd, "src/stale.ts", "external\n");

        const error = yield* workspaceFileSystem
          .editFiles({
            workspaceRoot: cwd,
            input: {
              changes: [
                {
                  path: "src/first.ts",
                  edits: [{ type: "write", mode: "overwrite", content: "changed\n" }],
                },
                {
                  path: "src/stale.ts",
                  expected_revision: staleRead.revision,
                  edits: [{ type: "write", mode: "overwrite", content: "mine\n" }],
                },
              ],
            },
          })
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          reason: "revision_conflict",
          path: "src/stale.ts",
          change_index: 1,
          expected_revision: staleRead.revision,
          actual_revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        });
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/first.ts"))).toBe("first\n");
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/stale.ts"))).toBe("external\n");
      }),
    );

    it.effect(
      "creates parents, preserves modes, and supports empty-file insertion and removal",
      () =>
        Effect.gen(function* () {
          const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const platform = yield* HostProcessPlatform;
          const cwd = yield* makeTempDir;
          yield* writeTextFile(cwd, "src/empty.ts", "");
          if (platform !== "win32") {
            yield* Effect.promise(() => NodeFSP.chmod(path.join(cwd, "src/empty.ts"), 0o640));
          }

          const result = yield* workspaceFileSystem.editFiles({
            workspaceRoot: cwd,
            input: {
              changes: [
                {
                  path: "src/empty.ts",
                  edits: [
                    {
                      type: "splice",
                      range: { type: "code_points", start: 0, end: 0 },
                      content: "abc",
                    },
                    {
                      type: "splice",
                      range: { type: "code_points", start: 1, end: 2 },
                      content: "",
                    },
                  ],
                },
                {
                  path: "nested/deep/created.ts",
                  edits: [{ type: "write", mode: "upsert", content: "created\n" }],
                },
                {
                  path: "missing.ts",
                  edits: [{ type: "delete", if_missing: "ignore" }],
                },
              ],
            },
          });

          expect(yield* fileSystem.readFileString(path.join(cwd, "src/empty.ts"))).toBe("ac");
          expect(yield* fileSystem.readFileString(path.join(cwd, "nested/deep/created.ts"))).toBe(
            "created\n",
          );
          if (platform !== "win32") {
            const stat = yield* Effect.promise(() => NodeFSP.stat(path.join(cwd, "src/empty.ts")));
            expect(stat.mode & 0o777).toBe(0o640);
          }
          expect(result.changes[2]).toEqual({
            path: "missing.ts",
            action: "unchanged",
            edit_count: 1,
          });
        }),
    );

    it.effect(
      "rejects escapes, symlinks, directories, binary, invalid UTF-8, and large files",
      () =>
        Effect.gen(function* () {
          const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* makeTempDir;
          yield* writeTextFile(cwd, "src/target.ts", "target\n");
          yield* fileSystem.symlink(
            path.join(cwd, "src/target.ts"),
            path.join(cwd, "src/linked.ts"),
          );
          yield* fileSystem.makeDirectory(path.join(cwd, "src/directory"));
          yield* fileSystem.writeFile(
            path.join(cwd, "src/binary.bin"),
            Uint8Array.from([0x61, 0, 0x62]),
          );
          yield* fileSystem.writeFile(
            path.join(cwd, "src/invalid.txt"),
            Uint8Array.from([0xc3, 0x28]),
          );
          yield* fileSystem.writeFileString(
            path.join(cwd, "src/large.txt"),
            "x".repeat(1024 * 1024 + 1),
          );

          const reasonFor = (relativePath: string) =>
            workspaceFileSystem
              .editFiles({
                workspaceRoot: cwd,
                input: {
                  changes: [
                    {
                      path: relativePath,
                      edits: [{ type: "delete", if_missing: "error" }],
                    },
                  ],
                },
              })
              .pipe(
                Effect.flip,
                Effect.map((error) => error.reason),
              );

          expect(yield* reasonFor("../escape.ts")).toBe("path_outside_root");
          expect(yield* reasonFor("src/linked.ts")).toBe("symlink");
          expect(yield* reasonFor("src/directory")).toBe("not_file");
          expect(yield* reasonFor("src/binary.bin")).toBe("binary");
          expect(yield* reasonFor("src/invalid.txt")).toBe("invalid_utf8");
          expect(yield* reasonFor("src/large.txt")).toBe("file_too_large");
          expect(yield* fileSystem.readFileString(path.join(cwd, "src/target.ts"))).toBe(
            "target\n",
          );
        }),
    );

    it.effect("rejects oversized results and aggregate batches before creating files", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "original\n");

        const oversized = yield* workspaceFileSystem
          .editFiles({
            workspaceRoot: cwd,
            input: {
              changes: [
                {
                  path: "src/existing.ts",
                  edits: [
                    {
                      type: "write",
                      mode: "overwrite",
                      content: "x".repeat(1024 * 1024 + 1),
                    },
                  ],
                },
              ],
            },
          })
          .pipe(Effect.flip);
        const batch = yield* workspaceFileSystem
          .editFiles({
            workspaceRoot: cwd,
            input: {
              changes: Array.from({ length: 9 }, (_, index) => ({
                path: `generated-${index}.txt`,
                edits: [
                  {
                    type: "write" as const,
                    mode: "create" as const,
                    content: "x".repeat(1024 * 1024),
                  },
                ],
              })),
            },
          })
          .pipe(Effect.flip);

        expect(oversized.reason).toBe("file_too_large");
        expect(batch).toMatchObject({ reason: "batch_too_large", path: "generated-8.txt" });
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/existing.ts"))).toBe(
          "original\n",
        );
        expect(yield* fileSystem.exists(path.join(cwd, "generated-0.txt"))).toBe(false);
      }),
    );

    it.effect("invalidates the workspace picker once for a multi-file batch", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/first.ts", "first\n");
        const invalidateSpy = vi.spyOn(workspaceEntries, "invalidate");

        yield* workspaceFileSystem.editFiles({
          workspaceRoot: cwd,
          input: {
            changes: [
              {
                path: "src/first.ts",
                edits: [{ type: "write", mode: "overwrite", content: "FIRST\n" }],
              },
              {
                path: "src/second.ts",
                edits: [{ type: "write", mode: "create", content: "SECOND\n" }],
              },
            ],
          },
        });

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expect(invalidateSpy).toHaveBeenCalledWith(cwd);
      }),
    );

    it.effect("rolls back prior commits when a later atomic rename fails", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/first.ts", "first\n");
        yield* writeTextFile(cwd, "src/second.ts", "second\n");
        let editRenames = 0;
        renameFile = async (from, to) => {
          if (String(from).includes(".t3-edit-") && ++editRenames === 2) {
            throw Object.assign(new Error("forced rename failure"), { code: "EIO" });
          }
          return NodeFSP.rename(from, to);
        };

        const error = yield* workspaceFileSystem
          .editFiles({
            workspaceRoot: cwd,
            input: {
              changes: [
                {
                  path: "src/first.ts",
                  edits: [{ type: "write", mode: "overwrite", content: "FIRST\n" }],
                },
                {
                  path: "src/second.ts",
                  edits: [{ type: "write", mode: "overwrite", content: "SECOND\n" }],
                },
              ],
            },
          })
          .pipe(Effect.flip);

        expect(error).toMatchObject({ reason: "commit_failed", path: "src/second.ts" });
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/first.ts"))).toBe("first\n");
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/second.ts"))).toBe("second\n");
      }),
    );

    it.effect("reports the exact path when an external edit makes rollback uncertain", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const firstPath = path.join(cwd, "src/first.ts");
        yield* writeTextFile(cwd, "src/first.ts", "first\n");
        yield* writeTextFile(cwd, "src/second.ts", "second\n");
        let editRenames = 0;
        renameFile = async (from, to) => {
          if (String(from).includes(".t3-edit-") && ++editRenames === 2) {
            await NodeFSP.writeFile(firstPath, "external\n");
            throw Object.assign(new Error("forced rename failure"), { code: "EIO" });
          }
          return NodeFSP.rename(from, to);
        };

        const error = yield* workspaceFileSystem
          .editFiles({
            workspaceRoot: cwd,
            input: {
              changes: [
                {
                  path: "src/first.ts",
                  edits: [{ type: "write", mode: "overwrite", content: "FIRST\n" }],
                },
                {
                  path: "src/second.ts",
                  edits: [{ type: "write", mode: "overwrite", content: "SECOND\n" }],
                },
              ],
            },
          })
          .pipe(Effect.flip);

        expect(error).toMatchObject({
          reason: "rollback_incomplete",
          path: "src/second.ts",
          uncertain_paths: ["src/first.ts"],
        });
        expect(yield* fileSystem.readFileString(firstPath)).toBe("external\n");
        expect(yield* fileSystem.readFileString(path.join(cwd, "src/second.ts"))).toBe("second\n");
      }),
    );
  });
});
