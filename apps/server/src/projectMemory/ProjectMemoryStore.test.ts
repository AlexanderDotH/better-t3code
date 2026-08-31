// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProjectMemoryError,
  ThreadId,
  type ProjectMemoryMode,
  type ProjectMemorySaveRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { parseProjectMemoryDocument } from "./ProjectMemoryDocument.ts";
import {
  make,
  type ProjectMemoryScope,
  type ProjectMemoryStoreOptions,
} from "./ProjectMemoryStore.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const testScope = (
  projectId: string,
  workspaceRoot: string,
  overrides: Partial<Pick<ProjectMemoryScope, "actor">> = {},
): ProjectMemoryScope => ({
  projectId: ProjectId.make(projectId),
  workspaceRoot,
  threadId: ThreadId.make(`thread-${projectId}`),
  actor: overrides.actor ?? "root",
});

const saveRequest = (
  scope: ProjectMemoryScope,
  key: string,
  content: string,
): ProjectMemorySaveRequest => ({
  projectId: scope.projectId,
  section: "verified-workflows",
  key,
  content,
  verified: true,
  sourceThreadId: scope.threadId,
});

const readRequest = (scope: ProjectMemoryScope, query = "") => ({
  projectId: scope.projectId,
  query,
  contextWindowTokens: 128_000,
});

const tempDirectory = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-memory-" });
});

const makeHarness = Effect.fn("ProjectMemoryStoreTest.makeHarness")(function* (options?: {
  readonly isWorkspaceWritable: NonNullable<ProjectMemoryStoreOptions["isWorkspaceWritable"]>;
}) {
  const path = yield* Path.Path;
  const root = yield* tempDirectory;
  const t3Home = path.join(root, "t3-home");
  const codexHome = path.join(root, "codex-home");
  const store = yield* make({
    t3Home,
    codexHome,
    ...(options === undefined ? {} : options),
  });
  return { root, t3Home, codexHome, store };
});

const provideNode = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  effect.pipe(Effect.provide(NodeServices.layer));

it.effect("isolates projects and rejects a request for a different bound project", () =>
  provideNode(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const harness = yield* makeHarness();
      const firstRoot = path.join(harness.root, "first");
      const secondRoot = path.join(harness.root, "second");
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(firstRoot, { recursive: true });
      yield* fileSystem.makeDirectory(secondRoot, { recursive: true });
      const first = testScope("project-first", firstRoot);
      const second = testScope("project-second", secondRoot);

      yield* harness.store.save(first, saveRequest(first, "only.first", "First project memory."));
      yield* harness.store.save(
        second,
        saveRequest(second, "only.second", "Second project memory."),
      );

      expect((yield* harness.store.read(first, readRequest(first, "only.first"))).entries).toEqual([
        expect.objectContaining({ key: "only.first" }),
      ]);
      expect(
        (yield* harness.store.read(second, readRequest(second, "only.second"))).entries,
      ).toEqual([expect.objectContaining({ key: "only.second" })]);
      expect((yield* harness.store.read(first, readRequest(first))).entries).toEqual([]);

      const denied = yield* harness.store
        .read(first, { ...readRequest(second), projectId: second.projectId })
        .pipe(Effect.flip);
      expect(denied).toBeInstanceOf(ProjectMemoryError);
      expect(denied.reason).toBe("project_mismatch");
    }),
  ),
);

it.effect(
  "imports only the exact canonical Codex cwd on first run and leaves global memory untouched",
  () =>
    provideNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const harness = yield* makeHarness();
        const workspaceRoot = path.join(harness.root, "workspace");
        yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
        yield* fileSystem.makeDirectory(path.join(harness.codexHome, "memories"), {
          recursive: true,
        });
        const globalPath = path.join(harness.codexHome, "memories", "MEMORY.md");
        const globalMemory = `# Task Group: exact project

scope: Exact project profile.
applies_to: cwd=${workspaceRoot}; reuse_rule=exact only

## Task 1: Exact import, outcome success

### rollout_summary_files

- rollout.md (thread_id=thread-native-exact, source complete)

## User preferences

- Keep the exact decision.

## Reusable knowledge

- Run the exact verified workflow.

## Failures and how to do differently

- Avoid the exact pitfall.

# Task Group: sibling project

scope: Must not import.
applies_to: cwd=${workspaceRoot}-sibling; reuse_rule=not this project

## Reusable knowledge

- Sibling-only secret knowledge.
`;
        yield* fileSystem.writeFileString(globalPath, globalMemory);
        const scope = testScope("project-import", workspaceRoot);

        const imported = yield* harness.store.import(scope, { projectId: scope.projectId });
        const result = parseProjectMemoryDocument(
          (yield* harness.store.view(scope, { projectId: scope.projectId })).rawMarkdown,
        );

        expect(imported).toMatchObject({ applied: true, imported: 5 });
        expect(result.map((entry) => entry.content)).toEqual(
          expect.arrayContaining([
            "Exact project profile.",
            "Keep the exact decision.",
            "Run the exact verified workflow.",
            "Avoid the exact pitfall.",
          ]),
        );
        expect(result.map((entry) => entry.content).join("\n")).not.toContain("Sibling-only");
        expect(result.every((entry) => entry.sourceThreadId === "thread-native-exact")).toBe(true);
        expect(yield* fileSystem.readFileString(globalPath)).toBe(globalMemory);

        yield* fileSystem.writeFileString(
          globalPath,
          globalMemory.replace("Run the exact verified workflow.", "A later global edit."),
        );
        const second = parseProjectMemoryDocument(
          (yield* harness.store.view(scope, { projectId: scope.projectId })).rawMarkdown,
        );
        expect(second.map((entry) => entry.content)).not.toContain("A later global edit.");
      }),
    ),
);

it.effect("redacts persisted content and serializes concurrent exact-key upserts", () =>
  provideNode(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const harness = yield* makeHarness();
      const workspaceRoot = path.join(harness.root, "concurrent");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      const scope = testScope("project-concurrent", workspaceRoot);
      const operations = [
        ...Array.from({ length: 24 }, (_, index) =>
          harness.store.save(scope, saveRequest(scope, `unique.${index}`, `value ${index}`)),
        ),
        ...Array.from({ length: 12 }, (_, index) =>
          harness.store.save(
            scope,
            saveRequest(
              scope,
              "shared.key",
              `password=secret-${index} https://host/pair#token=pairing-${index}`,
            ),
          ),
        ),
      ];

      yield* Effect.all(operations, { concurrency: "unbounded" });

      const memoryPath = path.join(workspaceRoot, ".t3", "MEMORY.md");
      const persisted = yield* fileSystem.readFileString(memoryPath);
      const entries = parseProjectMemoryDocument(persisted);
      expect(entries.filter((entry) => entry.key.startsWith("unique."))).toHaveLength(24);
      expect(entries.filter((entry) => entry.key === "shared.key")).toHaveLength(1);
      expect(persisted).not.toMatch(/secret-\d+|pairing-\d+/);
      expect(persisted).toContain("[REDACTED]");
      expect((yield* fileSystem.readDirectory(path.dirname(memoryPath))).sort()).toEqual([
        "MEMORY.md",
      ]);
    }),
  ),
);

it.effect("honors provider/off modes and root-only agent writes", () =>
  provideNode(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const harness = yield* makeHarness();
      const workspaceRoot = path.join(harness.root, "modes");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });

      for (const memoryMode of ["provider", "off"] satisfies ReadonlyArray<ProjectMemoryMode>) {
        const scope = testScope(`project-${memoryMode}`, workspaceRoot);
        yield* harness.store.updateSettings(scope, {
          projectId: scope.projectId,
          memoryMode,
          allowAgentWrites: true,
        });
        const saved = yield* harness.store.save(
          scope,
          saveRequest(scope, `mode.${memoryMode}`, "Must not persist."),
        );
        const read = yield* harness.store.read(scope, readRequest(scope));
        expect(saved).toMatchObject({ mode: memoryMode, applied: false, storage: null });
        expect(read).toMatchObject({ mode: memoryMode, entries: [], storage: null });
      }
      expect(yield* fileSystem.exists(path.join(workspaceRoot, ".t3", "MEMORY.md"))).toBe(false);

      const child = testScope("project-child", workspaceRoot, { actor: "child" });
      const disabled = testScope("project-disabled", workspaceRoot);
      yield* harness.store.updateSettings(disabled, {
        projectId: disabled.projectId,
        memoryMode: "project",
        allowAgentWrites: false,
      });
      expect(
        (yield* harness.store
          .save(child, saveRequest(child, "child.write", "Denied."))
          .pipe(Effect.flip)).reason,
      ).toBe("write_forbidden");
      expect(
        (yield* harness.store
          .save(disabled, saveRequest(disabled, "disabled.write", "Denied."))
          .pipe(Effect.flip)).reason,
      ).toBe("write_forbidden");
      expect((yield* harness.store.read(child, readRequest(child))).entries).toEqual([]);
    }),
  ),
);

it.effect("persists per-project settings and exposes the effective document state", () =>
  provideNode(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const harness = yield* makeHarness();
      const workspaceRoot = path.join(harness.root, "durable-settings");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      const scope = testScope("project-settings", workspaceRoot);

      expect(yield* harness.store.getSettings(scope, { projectId: scope.projectId })).toEqual({
        projectId: scope.projectId,
        settings: { memoryMode: "project", allowAgentWrites: true },
      });
      yield* harness.store.updateSettings(scope, {
        projectId: scope.projectId,
        memoryMode: "provider",
        allowAgentWrites: false,
      });

      const restarted = yield* make({ t3Home: harness.t3Home, codexHome: harness.codexHome });
      expect(yield* restarted.getSettings(scope, { projectId: scope.projectId })).toEqual({
        projectId: scope.projectId,
        settings: { memoryMode: "provider", allowAgentWrites: false },
      });
      expect(yield* restarted.resolveEffectiveState(scope)).toEqual({
        settings: { memoryMode: "provider", allowAgentWrites: false },
        status: "provider",
        storage: null,
        effectivePath: null,
      });
      expect(yield* restarted.view(scope, { projectId: scope.projectId })).toEqual({
        projectId: scope.projectId,
        settings: { memoryMode: "provider", allowAgentWrites: false },
        status: "provider",
        storage: null,
        effectivePath: null,
        rawMarkdown: "",
      });

      const settingsPath = path.join(
        harness.t3Home,
        "userdata",
        "project-memories",
        "project-settings",
        "settings.json",
      );
      expect(JSON.parse(yield* fileSystem.readFileString(settingsPath))).toEqual({
        memoryMode: "provider",
        allowAgentWrites: false,
      });
    }),
  ),
);

it.effect("atomically replaces and clears the canonical document through root-only UI hooks", () =>
  provideNode(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const harness = yield* makeHarness();
      const workspaceRoot = path.join(harness.root, "document-hooks");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      const scope = testScope("project-document-hooks", workspaceRoot);
      yield* harness.store.updateSettings(scope, {
        projectId: scope.projectId,
        memoryMode: "project",
        allowAgentWrites: false,
      });

      const replacement = yield* harness.store.replaceDocument(scope, {
        projectId: scope.projectId,
        markdown: `# Project memory

## Project profile

### \`profile.secure\`

- Verified: yes
- Source thread: \`thread-ui\`

> password=do-not-persist
`,
      });
      expect(replacement.applied).toBe(true);
      expect(replacement.view).toMatchObject({
        status: "active",
        storage: "workspace",
        effectivePath: path.join(workspaceRoot, ".t3", "MEMORY.md"),
      });
      expect(replacement.view.rawMarkdown).toContain("[REDACTED]");
      expect(replacement.view.rawMarkdown).not.toContain("do-not-persist");

      const child = testScope("project-document-hooks", workspaceRoot, { actor: "child" });
      expect(
        (yield* harness.store
          .replaceDocument(child, {
            projectId: child.projectId,
            markdown: "# Project memory\n",
          })
          .pipe(Effect.flip)).reason,
      ).toBe("write_forbidden");

      const cleared = yield* harness.store.clearDocument(scope, { projectId: scope.projectId });
      expect(cleared.applied).toBe(true);
      expect(parseProjectMemoryDocument(cleared.view.rawMarkdown)).toEqual([]);
      expect((yield* fileSystem.readDirectory(path.join(workspaceRoot, ".t3"))).sort()).toEqual([
        "MEMORY.md",
      ]);
    }),
  ),
);

it.effect("falls back under T3 home when the workspace is unwritable", () =>
  provideNode(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const harness = yield* makeHarness({
        isWorkspaceWritable: () => Effect.succeed(false),
      });
      const workspaceRoot = path.join(harness.root, "read-only-workspace");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      const scope = testScope("project-fallback", workspaceRoot);

      const result = yield* harness.store.save(
        scope,
        saveRequest(scope, "fallback.path", "Stored outside the workspace."),
      );

      const fallbackPath = path.join(
        harness.t3Home,
        "userdata",
        "project-memories",
        "project-fallback",
        "MEMORY.md",
      );
      expect(result.storage).toBe("fallback");
      expect(yield* fileSystem.exists(fallbackPath)).toBe(true);
      expect(yield* fileSystem.exists(path.join(workspaceRoot, ".t3", "MEMORY.md"))).toBe(false);
    }),
  ),
);

it.effect("locally excludes only .t3/MEMORY.md when Git needs an ignore rule", () =>
  provideNode(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const harness = yield* makeHarness();
      const workspaceRoot = path.join(harness.root, "git-workspace");
      yield* fileSystem.makeDirectory(workspaceRoot, { recursive: true });
      yield* Effect.tryPromise({
        try: () => execFile("git", ["-C", workspaceRoot, "init", "--quiet"]),
        catch: Effect.die,
      });
      const scope = testScope("project-git-exclude", workspaceRoot);

      yield* harness.store.save(scope, saveRequest(scope, "git.exclude", "Keep it local."));

      const exclude = yield* fileSystem.readFileString(
        path.join(workspaceRoot, ".git", "info", "exclude"),
      );
      const activeRules = exclude
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
      expect(activeRules).toEqual([".t3/MEMORY.md"]);
    }),
  ),
);
