// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { FileFinder } from "@ff-labs/fff-node";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import * as WorkspaceContext from "./WorkspaceContext.ts";
import {
  __testing as WorkspaceContextEngineTesting,
  WORKSPACE_CONTEXT_MAX_PATH_ENTRIES,
} from "./WorkspaceContextEngine.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const NoopWorkspaceEntriesLayer = Layer.succeed(
  WorkspaceEntries.WorkspaceEntries,
  WorkspaceEntries.WorkspaceEntries.of({
    browse: () => Effect.die("Workspace entries browse must not be used by workspace context."),
    invalidate: () => Effect.void,
    list: () => Effect.die("Native workspace index list must not be used by workspace context."),
    refresh: () =>
      Effect.die("Native workspace index refresh must not be used by workspace context."),
    search: () =>
      Effect.die("Native workspace index search must not be used by workspace context."),
  }),
);

const WorkspaceFileSystemLayer = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(NoopWorkspaceEntriesLayer),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceContext.layer.pipe(Layer.provide(WorkspaceFileSystemLayer))),
  Layer.provideMerge(WorkspaceFileSystemLayer),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(NoopWorkspaceEntriesLayer),
  Layer.provideMerge(NodeServices.layer),
);

afterEach(() => {
  vi.restoreAllMocks();
});

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-workspace-context-" });
});

const writeTextFile = Effect.fn("WorkspaceContextTest.writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

const initializeGit = Effect.fn("WorkspaceContextTest.initializeGit")(function* (cwd: string) {
  yield* Effect.tryPromise({
    try: () => execFile("git", ["-C", cwd, "init", "--quiet"]),
    catch: Effect.die,
  });
});

const gitAdd = Effect.fn("WorkspaceContextTest.gitAdd")(function* (
  cwd: string,
  paths: ReadonlyArray<string>,
) {
  yield* Effect.tryPromise({
    try: () => execFile("git", ["-C", cwd, "add", "--", ...paths]),
    catch: Effect.die,
  });
});

it.layer(TestLayer, { excludeTestServices: true })("WorkspaceContextLive", (it) => {
  describe("Git discovery", () => {
    it.effect(
      "finds tracked and untracked files with fuzzy, literal, and token-fallback queries",
      () =>
        Effect.gen(function* () {
          const context = yield* WorkspaceContext.WorkspaceContext;
          const cwd = yield* makeTempDir;
          yield* initializeGit(cwd);
          yield* writeTextFile(cwd, ".gitignore", "ignored/\n");
          yield* writeTextFile(
            cwd,
            "src/WorkspaceSearch.ts",
            [
              "export const heading = 'before WorkspaceSearch';",
              "export const context = 'trusted workspace context uses root';",
              "export const ending = 'after';",
            ].join("\n"),
          );
          yield* writeTextFile(
            cwd,
            "src/untracked.ts",
            "export const marker = 'untracked marker';\n",
          );
          yield* writeTextFile(cwd, ".env.local", "TOKEN=workspaceSecretNeedle\n");
          yield* writeTextFile(cwd, "keys/id_rsa", "workspaceSecretNeedle\n");
          yield* writeTextFile(cwd, "ignored/secret.ts", "untracked marker trusted context root\n");
          yield* gitAdd(cwd, [".gitignore", "src/WorkspaceSearch.ts"]);
          const createSpy = vi.spyOn(FileFinder, "create");

          const result = yield* context.execute({
            workspaceRoot: cwd,
            input: {
              queries: [
                { text: "wssrch", mode: "path" },
                { text: "trusted workspace context", mode: "content" },
                { text: "trusted context root", mode: "content" },
                { text: "untracked marker", mode: "auto" },
                { text: "WorkspaceSearch", mode: "auto" },
                { text: "workspaceSecretNeedle", mode: "content" },
              ],
              contextLines: 1,
              maxResultsPerQuery: 5,
            },
          });

          expect(result.queries[0]?.matches[0]?.path).toBe("src/WorkspaceSearch.ts");
          expect(result.queries[1]?.matches[0]).toMatchObject({
            path: "src/WorkspaceSearch.ts",
            kind: "content",
            matchLine: 2,
            lineStart: 1,
            lineEnd: 3,
          });
          expect(result.queries[1]?.matches[0]?.excerpt).toContain("before");
          expect(result.queries[2]?.matches[0]?.path).toBe("src/WorkspaceSearch.ts");
          expect(result.queries[3]?.matches[0]?.path).toBe("src/untracked.ts");
          expect(result.queries[4]?.matches).toEqual([
            expect.objectContaining({ path: "src/WorkspaceSearch.ts", kind: "content" }),
          ]);
          expect(result.queries[5]?.matches).toEqual([]);
          expect(
            result.queries.flatMap((query) => query.matches.map((match) => match.path)),
          ).not.toContain("ignored/secret.ts");
          expect(createSpy).not.toHaveBeenCalled();
        }),
    );

    it.effect("ranks token coverage before match count and reports capped path results", () =>
      Effect.gen(function* () {
        const context = yield* WorkspaceContext.WorkspaceContext;
        const cwd = yield* makeTempDir;
        yield* initializeGit(cwd);
        yield* writeTextFile(cwd, "src/full-coverage.ts", "alpha here\nbeta here\ngamma here\n");
        yield* writeTextFile(cwd, "src/high-count-partial.ts", "alpha\nalpha\nalpha\nbeta\nbeta\n");
        yield* Effect.forEach(
          Array.from({ length: 4 }, (_, index) => index),
          (index) =>
            writeTextFile(
              cwd,
              `src/limit-file-${index}.ts`,
              `export const value${index} = ${index};\n`,
            ),
        );

        const result = yield* context.execute({
          workspaceRoot: cwd,
          input: {
            queries: [
              { text: "alpha beta gamma missing", mode: "content" },
              { text: "limit-file", mode: "path" },
            ],
            maxResultsPerQuery: 2,
          },
        });

        expect(result.queries[0]?.matches[0]?.path).toBe("src/full-coverage.ts");
        expect(result.queries[1]?.matches).toHaveLength(2);
        expect(result.queries[1]?.truncated).toBe(true);
      }),
    );
  });

  describe("explicit reads", () => {
    it.effect(
      "batches line reads, clamps ranges, and reports missing and binary files partially",
      () =>
        Effect.gen(function* () {
          const context = yield* WorkspaceContext.WorkspaceContext;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* makeTempDir;
          yield* writeTextFile(
            cwd,
            "large.txt",
            Array.from({ length: 500 }, (_, index) => `line-${index + 1}`).join("\n"),
          );
          yield* writeTextFile(cwd, "oversized.txt", "x".repeat(1024 * 1024 + 1));
          yield* writeTextFile(cwd, "directory/child.txt", "child\n");
          yield* fileSystem.writeFile(
            path.join(cwd, "asset.bin"),
            Uint8Array.from([0x61, 0, 0x62]),
          );

          const result = yield* context.execute({
            workspaceRoot: cwd,
            input: {
              reads: [
                { path: "large.txt", startLine: 2, endLine: 3 },
                { path: "large.txt", startLine: 1, endLine: 900 },
                { path: "missing.txt" },
                { path: "asset.bin" },
                { path: "oversized.txt" },
                { path: "directory" },
              ],
            },
          });

          expect(result.reads[0]).toMatchObject({
            status: "ok",
            path: "large.txt",
            lineStart: 2,
            lineEnd: 3,
            text: "line-2\nline-3",
            truncated: false,
            revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          });
          expect(result.reads[1]).toMatchObject({
            status: "ok",
            lineStart: 1,
            lineEnd: 400,
            truncated: true,
          });
          expect(result.reads[2]).toMatchObject({ status: "error", error: "not_found" });
          expect(result.reads[3]).toMatchObject({ status: "error", error: "binary" });
          expect(result.reads[4]).toMatchObject({ status: "ok", truncated: true });
          expect(result.reads[4]).not.toHaveProperty("revision");
          expect(result.reads[5]).toMatchObject({ status: "error", error: "unreadable" });
        }),
    );

    it.effect("fails the call for parent traversal and symlinks escaping the trusted root", () =>
      Effect.gen(function* () {
        const context = yield* WorkspaceContext.WorkspaceContext;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outside = yield* makeTempDir;
        yield* writeTextFile(outside, "secret.txt", "outside\n");
        yield* fileSystem.symlink(
          path.join(outside, "secret.txt"),
          path.join(cwd, "linked-secret.txt"),
        );

        const traversalError = yield* context
          .execute({
            workspaceRoot: cwd,
            input: { reads: [{ path: "../secret.txt" }] },
          })
          .pipe(Effect.flip);
        const symlinkError = yield* context
          .execute({
            workspaceRoot: cwd,
            input: { reads: [{ path: "linked-secret.txt" }] },
          })
          .pipe(Effect.flip);

        expect(traversalError).toBeInstanceOf(WorkspaceContext.WorkspaceContextPathError);
        expect(symlinkError).toBeInstanceOf(WorkspaceContext.WorkspaceContextPathError);
      }),
    );
  });

  describe("filesystem fallback and limits", () => {
    it.effect(
      "searches non-Git workspaces without following symlinks or broad-searching secrets",
      () =>
        Effect.gen(function* () {
          const context = yield* WorkspaceContext.WorkspaceContext;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* makeTempDir;
          const outside = yield* makeTempDir;
          yield* writeTextFile(cwd, "src/main.ts", "export const fallbackNeedle = true;\n");
          yield* writeTextFile(cwd, "node_modules/pkg/index.ts", "fallbackNeedle\n");
          yield* writeTextFile(cwd, ".env.local", "fallbackNeedle=secret\n");
          yield* writeTextFile(cwd, ".github/workflows/ci.yml", "hiddenProjectNeedle\n");
          yield* writeTextFile(cwd, ".agents/skills/review/SKILL.md", "hiddenProjectNeedle\n");
          yield* writeTextFile(cwd, "oversized.ts", `fallbackNeedle${"x".repeat(1024 * 1024)}`);
          yield* fileSystem.writeFile(
            path.join(cwd, "binary.dat"),
            Uint8Array.from([...new TextEncoder().encode("fallbackNeedle"), 0]),
          );
          yield* writeTextFile(outside, "linked.ts", "fallbackNeedle\n");
          yield* fileSystem.symlink(path.join(outside, "linked.ts"), path.join(cwd, "linked.ts"));

          const result = yield* context.execute({
            workspaceRoot: cwd,
            input: {
              queries: [
                { text: "fallbackNeedle", mode: "auto" },
                { text: "hiddenProjectNeedle", mode: "content" },
              ],
            },
          });

          expect(result.queries[0]?.matches.map((match) => match.path)).toEqual(["src/main.ts"]);
          expect(result.queries[1]?.matches.map((match) => match.path)).toEqual([
            ".agents/skills/review/SKILL.md",
            ".github/workflows/ci.yml",
          ]);
          expect(result.warnings).toContain("Git inventory unavailable; used filesystem fallback.");
        }),
    );

    it.effect("enforces the shared 64 KiB text budget without dropping read metadata", () =>
      Effect.gen(function* () {
        const context = yield* WorkspaceContext.WorkspaceContext;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "one.txt", "a".repeat(50_000));
        yield* writeTextFile(cwd, "two.txt", "b".repeat(50_000));

        const result = yield* context.execute({
          workspaceRoot: cwd,
          input: { reads: [{ path: "one.txt" }, { path: "two.txt" }] },
        });
        const returnedTextBytes = result.reads.reduce(
          (total, read) => total + (read.status === "ok" ? Buffer.byteLength(read.text) : 0),
          0,
        );

        expect(result.reads).toHaveLength(2);
        expect(returnedTextBytes).toBeLessThanOrEqual(64 * 1024);
        expect(result.truncated).toBe(true);
        expect(result.reads.every((read) => read.status !== "ok" || read.truncated)).toBe(true);
      }),
    );

    it.effect("returns a typed unavailable error for missing workspace roots", () =>
      Effect.gen(function* () {
        const context = yield* WorkspaceContext.WorkspaceContext;
        const cwd = yield* makeTempDir;

        const error = yield* context
          .execute({
            workspaceRoot: NodePath.join(cwd, "missing"),
            input: { queries: [{ text: "anything" }] },
          })
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceContext.WorkspaceContextUnavailableError);
        expect(error.reason).toBe("workspace_root_not_found");
      }),
    );

    it.effect("marks deterministic fallback results when the search deadline has elapsed", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/index.ts", "deadlineNeedle\n");

        const result = yield* Effect.promise(() =>
          WorkspaceContextEngineTesting.discoverFilesystem(
            cwd,
            [{ text: "deadlineNeedle", mode: "content", maxResults: 10 }],
            performance.now() - 1,
          ),
        );

        expect(result.truncated).toBe(true);
        expect(result.queries[0]?.truncated).toBe(true);
        expect(result.warnings).toContain("Workspace search reached its deadline.");
      }),
    );

    it("caps inventory construction at 25,000 paths", () => {
      const inventory = WorkspaceContextEngineTesting.makeInventory(
        Array.from(
          { length: WORKSPACE_CONTEXT_MAX_PATH_ENTRIES + 1 },
          (_, index) => `file-${index.toString().padStart(5, "0")}.ts`,
        ),
        false,
      );

      expect(inventory.filePaths.size).toBe(WORKSPACE_CONTEXT_MAX_PATH_ENTRIES);
      expect(inventory.truncated).toBe(true);
    });
  });
});
