import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { validateGitRebasePlan } from "./GitRebasePlan.ts";
import * as GitRepositoryQueryService from "./GitRepositoryQueryService.ts";

const GitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-git-repository-query-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = GitRepositoryQueryService.layer.pipe(Layer.provideMerge(GitLayer));

const git = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    return yield* driver.execute({
      operation: "GitRepositoryQueryService.test.git",
      cwd,
      args,
      env: {
        ...env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "commit.gpgsign",
        GIT_CONFIG_VALUE_0: "false",
      },
      timeoutMs: 10_000,
    });
  });

const writeFile = (cwd: string, relativePath: string, contents: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fileSystem.writeFileString(filePath, contents);
  });

const createRepository = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3-git-repository-query-repo-",
  });
  yield* git(cwd, ["init"]);
  yield* git(cwd, ["config", "user.name", "T3 Test"]);
  yield* git(cwd, ["config", "user.email", "t3@example.test"]);
  return cwd;
});

const commitFile = (cwd: string, index: number) =>
  Effect.gen(function* () {
    yield* writeFile(cwd, `src/file-${index}.ts`, `export const value${index} = ${index};\n`);
    yield* git(cwd, ["add", "--", `src/file-${index}.ts`]);
    yield* git(cwd, ["commit", "-m", `commit ${index}`]);
  });

const commitAs = (input: {
  readonly cwd: string;
  readonly path: string;
  readonly contents: string;
  readonly message: string;
  readonly name: string;
  readonly email: string;
  readonly timestamp: string;
}) =>
  Effect.gen(function* () {
    yield* writeFile(input.cwd, input.path, input.contents);
    yield* git(input.cwd, ["add", "--", input.path]);
    yield* git(input.cwd, ["commit", "-m", input.message], {
      GIT_AUTHOR_NAME: input.name,
      GIT_AUTHOR_EMAIL: input.email,
      GIT_AUTHOR_DATE: input.timestamp,
      GIT_COMMITTER_NAME: input.name,
      GIT_COMMITTER_EMAIL: input.email,
      GIT_COMMITTER_DATE: input.timestamp,
    });
  });

const headOid = (cwd: string) =>
  git(cwd, ["rev-parse", "HEAD"]).pipe(Effect.map((result) => result.stdout.trim()));

it.effect("keeps later history pages anchored after HEAD advances", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    yield* Effect.forEach([1, 2, 3, 4], (index) => commitFile(cwd, index), {
      discard: true,
    });
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const first = yield* service.listHistory({ cwd, limit: 2 });
    yield* commitFile(cwd, 5);
    const second = yield* service.listHistory({
      cwd,
      snapshotOid: first.snapshotOid,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });

    assert.deepStrictEqual(
      first.items.map((item) => item.subject),
      ["commit 4", "commit 3"],
    );
    assert.deepStrictEqual(
      second.items.map((item) => item.subject),
      ["commit 2", "commit 1"],
    );
    assert.match(first.snapshotOid, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
    assert.strictEqual(second.snapshotOid, first.snapshotOid);
    assert.strictEqual(second.nextCursor, null);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("rejects non-literal history paths and malformed object IDs before invoking log", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    yield* commitFile(cwd, 1);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const pathError = yield* Effect.flip(
      service.listHistory({ cwd, path: "../outside.ts", limit: 50 }),
    );
    const oidError = yield* Effect.flip(
      service.listHistory({ cwd, snapshotOid: "main", limit: 50 }),
    );

    assert.match(pathError.detail, /repository-relative literal paths/i);
    assert.match(oidError.detail, /object ID/i);
    assert.strictEqual(GitRepositoryQueryService.isGitObjectId("a".repeat(40)), true);
    assert.strictEqual(GitRepositoryQueryService.isGitObjectId("b".repeat(64)), true);
    assert.strictEqual(GitRepositoryQueryService.isGitObjectId("c".repeat(39)), false);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("filters history by a literal repository path", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    yield* commitFile(cwd, 1);
    yield* commitFile(cwd, 2);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const history = yield* service.listHistory({
      cwd,
      limit: 50,
      path: "src/file-1.ts",
    });

    assert.deepStrictEqual(
      history.items.map((item) => item.subject),
      ["commit 1"],
    );
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("anchors history to a validated branch filter", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    yield* commitFile(cwd, 1);
    yield* git(cwd, ["branch", "feature/history"]);
    yield* commitFile(cwd, 2);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const history = yield* service.listHistory({
      cwd,
      limit: 50,
      refName: "feature/history",
    });
    const featureOid = yield* git(cwd, ["rev-parse", "feature/history"]);
    const invalid = yield* service
      .listHistory({ cwd, limit: 50, refName: "--all" })
      .pipe(Effect.flip);

    assert.deepStrictEqual(
      history.items.map((item) => item.subject),
      ["commit 1"],
    );
    assert.strictEqual(history.snapshotOid, featureOid.stdout.trim());
    assert.match(invalid.detail, /literal branch or remote-ref names/i);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("reads commit metadata, rename details, and a bounded per-file patch", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    const original = Array.from(
      { length: 200 },
      (_, index) => `export const line${index} = ${index};`,
    ).join("\n");
    yield* writeFile(cwd, "src/original.ts", `${original}\n`);
    yield* git(cwd, ["add", "--", "src/original.ts"]);
    yield* git(cwd, ["commit", "-m", "add original"]);
    yield* git(cwd, ["mv", "src/original.ts", "src/renamed.ts"]);
    yield* git(cwd, ["commit", "-m", "rename source", "-m", "Keep its history visible."]);
    const renameOid = yield* headOid(cwd);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const detail = yield* service.getCommitDetail({ cwd, oid: renameOid });
    const patch = yield* service.getCommitFileDiff({
      cwd,
      oid: renameOid,
      path: "src/renamed.ts",
      oldPath: "src/original.ts",
    });

    assert.strictEqual(detail.subject, "rename source");
    assert.strictEqual(detail.body, "Keep its history visible.\n");
    assert.deepStrictEqual(detail.files, [
      {
        path: "src/renamed.ts",
        oldPath: "src/original.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        binary: false,
      },
    ]);
    assert.match(patch.patch, /rename from src\/original\.ts/);
    assert.match(patch.patch, /rename to src\/renamed\.ts/);
    assert.strictEqual(patch.binary, false);
    assert.strictEqual(patch.truncated, false);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("describes merge commits relative to their first parent", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    yield* writeFile(cwd, "base.txt", "base\n");
    yield* git(cwd, ["add", "--", "base.txt"]);
    yield* git(cwd, ["commit", "-m", "base"]);
    const branch = (yield* git(cwd, ["branch", "--show-current"])).stdout.trim();
    yield* git(cwd, ["checkout", "-b", "feature"]);
    yield* writeFile(cwd, "feature.ts", "export const feature = true;\n");
    yield* git(cwd, ["add", "--", "feature.ts"]);
    yield* git(cwd, ["commit", "-m", "feature work"]);
    yield* git(cwd, ["checkout", branch]);
    yield* writeFile(cwd, "main.ts", "export const main = true;\n");
    yield* git(cwd, ["add", "--", "main.ts"]);
    yield* git(cwd, ["commit", "-m", "main work"]);
    yield* git(cwd, ["merge", "--no-ff", "feature", "-m", "merge feature"]);
    const mergeOid = yield* headOid(cwd);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const detail = yield* service.getCommitDetail({ cwd, oid: mergeOid });
    const patch = yield* service.getCommitFileDiff({ cwd, oid: mergeOid, path: "feature.ts" });

    assert.strictEqual(detail.parents.length, 2);
    assert.deepStrictEqual(
      detail.files.map(({ path, status }) => ({ path, status })),
      [{ path: "feature.ts", status: "added" }],
    );
    assert.match(patch.patch, /new file mode/);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("builds a topology-preserving interactive rebase plan from a validated ref", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    yield* writeFile(cwd, "base.txt", "base\n");
    yield* git(cwd, ["add", "--", "base.txt"]);
    yield* git(cwd, ["commit", "-m", "base"]);
    const baseOid = yield* headOid(cwd);
    const mainBranch = (yield* git(cwd, ["branch", "--show-current"])).stdout.trim();
    yield* git(cwd, ["checkout", "-b", "feature"]);
    yield* writeFile(cwd, "feature.txt", "feature\n");
    yield* git(cwd, ["add", "--", "feature.txt"]);
    yield* git(cwd, ["commit", "-m", "feature"]);
    yield* git(cwd, ["checkout", mainBranch]);
    yield* writeFile(cwd, "main.txt", "main\n");
    yield* git(cwd, ["add", "--", "main.txt"]);
    yield* git(cwd, ["commit", "-m", "main"]);
    yield* git(cwd, ["merge", "--no-ff", "feature", "-m", "merge feature"]);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const prepared = yield* service.getInteractiveRebasePlan({
      cwd,
      upstreamRef: baseOid,
    });
    const nodes = prepared.items.map((item) => item.node);

    assert.strictEqual(prepared.upstreamOid, baseOid);
    assert.strictEqual(validateGitRebasePlan(nodes).valid, true);
    assert.strictEqual(
      nodes.some((node) => node.kind === "merge"),
      true,
    );
    assert.strictEqual(nodes.filter((node) => node.kind === "pick").length, 2);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("marks binary changes and truncates oversized file patches", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.makeDirectory(path.join(cwd, "assets"), { recursive: true });
    yield* fileSystem.writeFile(path.join(cwd, "assets", "sample.bin"), new Uint8Array([0, 1, 2]));
    yield* git(cwd, ["add", "--", "assets/sample.bin"]);
    yield* git(cwd, ["commit", "-m", "add binary"]);
    const binaryOid = yield* headOid(cwd);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const binaryDetail = yield* service.getCommitDetail({ cwd, oid: binaryOid });
    const binaryPatch = yield* service.getCommitFileDiff({
      cwd,
      oid: binaryOid,
      path: "assets/sample.bin",
    });
    assert.strictEqual(binaryDetail.files[0]?.binary, true);
    assert.strictEqual(binaryDetail.files[0]?.additions, undefined);
    assert.strictEqual(binaryPatch.binary, true);

    yield* writeFile(cwd, "large.txt", `${"old line\n".repeat(20_000)}`);
    yield* git(cwd, ["add", "--", "large.txt"]);
    yield* git(cwd, ["commit", "-m", "add large file"]);
    const largeOid = yield* headOid(cwd);
    const largePatch = yield* service.getCommitFileDiff({
      cwd,
      oid: largeOid,
      path: "large.txt",
    });

    assert.strictEqual(largePatch.truncated, true);
    assert.ok(Buffer.byteLength(largePatch.patch, "utf8") <= 120_020);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("aggregates mailmap-aware contributors, daily activity, and tracked Code mix", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.now());
    const cwd = yield* createRepository;
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    const earlier = new Date(Date.now() - 4 * 24 * 60 * 60 * 1_000);
    yield* writeFile(
      cwd,
      ".mailmap",
      "Alice Canonical <alice@example.test> Alias Alice <alias@example.test>\n",
    );
    yield* writeFile(cwd, "src/app.ts", "export const app = true;\n");
    yield* writeFile(cwd, "src/tool.py", "print('tool')\n");
    yield* writeFile(cwd, "README.md", "# Repository\n");
    yield* writeFile(cwd, "vendor/generated.js", "window.generated = true;\n");
    yield* writeFile(cwd, "pnpm-lock.yaml", "lockfileVersion: 9\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "seed repository"], {
      GIT_AUTHOR_NAME: "Alias Alice",
      GIT_AUTHOR_EMAIL: "alias@example.test",
      GIT_AUTHOR_DATE: earlier.toISOString(),
      GIT_COMMITTER_NAME: "Alias Alice",
      GIT_COMMITTER_EMAIL: "alias@example.test",
      GIT_COMMITTER_DATE: earlier.toISOString(),
    });
    yield* commitAs({
      cwd,
      path: "src/app.ts",
      contents: "export const app = 'updated';\n",
      message: "update app",
      name: "Alice Canonical",
      email: "alice@example.test",
      timestamp: recent.toISOString(),
    });
    yield* commitAs({
      cwd,
      path: "src/tool.py",
      contents: "print('updated')\n",
      message: "update tool",
      name: "Bob Builder",
      email: "bob@example.test",
      timestamp: recent.toISOString(),
    });
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const insights = yield* service.getRepositoryInsights({ cwd });

    assert.strictEqual(insights.scannedCommits, 3);
    assert.deepStrictEqual(
      insights.contributors.map(({ displayName, commitCount }) => ({ displayName, commitCount })),
      [
        { displayName: "Alice Canonical", commitCount: 2 },
        { displayName: "Bob Builder", commitCount: 1 },
      ],
    );
    assert.ok(insights.contributors.every(({ identityKey }) => /^[0-9a-f]{64}$/.test(identityKey)));
    assert.strictEqual(/@example\.test/.test(JSON.stringify(insights)), false);
    assert.strictEqual(
      insights.activity.find(({ date }) => date === recent.toISOString().slice(0, 10))?.commitCount,
      2,
    );
    assert.deepStrictEqual(
      insights.codeMix.entries.map(({ language, fileCount }) => ({ language, fileCount })),
      [
        { language: "Markdown", fileCount: 1 },
        { language: "Python", fileCount: 1 },
        { language: "TypeScript", fileCount: 1 },
      ],
    );
    assert.strictEqual(insights.codeMix.trackedFileCount, 6);
    assert.strictEqual(insights.codeMix.classifiedFileCount, 3);
    assert.strictEqual(insights.codeMix.excludedFileCount, 2);
    assert.strictEqual(insights.codeMix.truncated, false);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect(
  "coalesces insight scans by Git common directory and HEAD and caps them at 5000 commits",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.now());
      const cwd = yield* createRepository;
      yield* commitFile(cwd, 1);
      const driver = yield* GitVcsDriver.GitVcsDriver;
      const operationCounts = new Map<string, number>();
      const timestamp = new Date().toISOString();
      const oversizedHistory = `${`Alice\0alice@example.test\0${timestamp}\0`.repeat(5_001)}`;
      const countingDriver = GitVcsDriver.GitVcsDriver.of({
        ...driver,
        execute: (input) => {
          operationCounts.set(input.operation, (operationCounts.get(input.operation) ?? 0) + 1);
          if (input.operation === "GitRepositoryQueryService.getRepositoryInsights.history") {
            return driver.execute(input).pipe(
              Effect.map((result) => ({
                ...result,
                stdout: oversizedHistory,
                stdoutTruncated: false,
              })),
            );
          }
          if (input.operation === "GitRepositoryQueryService.getRepositoryInsights.codeMix") {
            return driver.execute(input).pipe(
              Effect.map((result) => ({
                ...result,
                stdout: "src/complete.ts\0src/incomplete",
                stdoutTruncated: true,
              })),
            );
          }
          return driver.execute(input);
        },
      });
      const service = yield* GitRepositoryQueryService.make.pipe(
        Effect.provideService(GitVcsDriver.GitVcsDriver, countingDriver),
      );

      const results = yield* Effect.all(
        Array.from({ length: 12 }, () => service.getRepositoryInsights({ cwd })),
        { concurrency: "unbounded" },
      );

      assert.ok(results.every((result) => result.scannedCommits === 5_000 && result.truncated));
      assert.ok(
        results.every(
          (result) =>
            result.codeMix.truncated &&
            result.codeMix.scannedFileCount === 1 &&
            result.codeMix.entries[0]?.language === "TypeScript",
        ),
      );
      assert.strictEqual(
        operationCounts.get("GitRepositoryQueryService.getRepositoryInsights.history"),
        1,
      );
      assert.strictEqual(
        operationCounts.get("GitRepositoryQueryService.getRepositoryInsights.codeMix"),
        1,
      );

      yield* commitFile(cwd, 2);
      yield* service.getRepositoryInsights({ cwd });
      assert.strictEqual(
        operationCounts.get("GitRepositoryQueryService.getRepositoryInsights.history"),
        2,
      );
    }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("keeps the five largest Code mix categories and folds the remainder into Other", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.now());
    const cwd = yield* createRepository;
    for (const [path, contents] of [
      ["src/a.cs", "class A {}\n"],
      ["src/b.go", "package main\n"],
      ["src/c.java", "class C {}\n"],
      ["src/d.py", "print('d')\n"],
      ["src/e.rb", "puts 'e'\n"],
      ["src/f.rs", "fn main() {}\n"],
      ["src/g.swift", 'print("g")\n'],
    ] as const) {
      yield* writeFile(cwd, path, contents);
    }
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "add language samples"]);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const insights = yield* service.getRepositoryInsights({ cwd });

    assert.strictEqual(insights.codeMix.entries.length, 6);
    assert.deepStrictEqual(insights.codeMix.entries.at(-1), {
      language: "Other",
      fileCount: 2,
      percentage: 28.6,
    });
    assert.strictEqual(insights.codeMix.classifiedFileCount, 7);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("returns empty history and insights for an unborn Git repository", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.now());
    const cwd = yield* createRepository;
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const history = yield* service.listHistory({ cwd, limit: 50 });
    const insights = yield* service.getRepositoryInsights({ cwd });

    assert.deepStrictEqual(history, {
      snapshotOid: null,
      items: [],
      nextCursor: null,
      truncated: false,
    });
    assert.strictEqual(insights.snapshotOid, null);
    assert.strictEqual(insights.scannedCommits, 0);
    assert.deepStrictEqual(insights.contributors, []);
    assert.strictEqual(insights.codeMix.scannedFileCount, 0);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("reads SHA-256 repositories with full 64-character object IDs", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-git-repository-query-sha256-",
    });
    yield* git(cwd, ["init", "--object-format=sha256"]);
    yield* git(cwd, ["config", "user.name", "T3 Test"]);
    yield* git(cwd, ["config", "user.email", "t3@example.test"]);
    yield* writeFile(cwd, "sha256.ts", "export const hash = 256;\n");
    yield* git(cwd, ["add", "--", "sha256.ts"]);
    yield* git(cwd, ["commit", "-m", "sha256 commit"]);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const history = yield* service.listHistory({ cwd, limit: 50 });
    const oid = history.items[0]?.oid ?? "";
    const detail = yield* service.getCommitDetail({ cwd, oid });

    assert.match(oid, /^[0-9a-f]{64}$/);
    assert.strictEqual(detail.oid, oid);
    assert.strictEqual(detail.files[0]?.path, "sha256.ts");
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);

it.effect("preserves tabs, newlines, Unicode, and option-like names in commit file details", () =>
  Effect.gen(function* () {
    const cwd = yield* createRepository;
    const unusualPath = "src/-odd-ü\tname\nfile.ts";
    yield* writeFile(cwd, unusualPath, "export const unusual = true;\n");
    yield* git(cwd, ["add", "--", unusualPath]);
    yield* git(cwd, ["commit", "-m", "add unusual path"]);
    const oid = yield* headOid(cwd);
    const service = yield* GitRepositoryQueryService.GitRepositoryQueryService;

    const detail = yield* service.getCommitDetail({ cwd, oid });
    const patch = yield* service.getCommitFileDiff({ cwd, oid, path: unusualPath });

    assert.strictEqual(detail.files[0]?.path, unusualPath);
    assert.strictEqual(detail.files[0]?.additions, 1);
    assert.match(patch.patch, /unusual/);
  }).pipe(Effect.provide(TestLayer), Effect.scoped),
);
