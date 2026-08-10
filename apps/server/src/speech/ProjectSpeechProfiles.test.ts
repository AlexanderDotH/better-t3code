import { assert, it } from "@effect/vitest";
import { ProjectId, type OrchestrationProjectShell, type ProjectEntry } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectSpeechProfileStore from "./ProjectSpeechProfileStore.ts";
import * as ProjectSpeechProfiles from "./ProjectSpeechProfiles.ts";
import * as ProjectSpeechWorkspaceScanner from "./ProjectSpeechWorkspaceScanner.ts";

const projectId = ProjectId.make("project-speech");
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "T3 Speech",
  workspaceRoot: "/workspace/t3-speech",
  repositoryIdentity: {
    canonicalKey: "github.com/acme/t3-speech",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "git@github.com:acme/t3-speech.git",
    },
    displayName: "acme/t3-speech",
    owner: "acme",
    name: "t3-speech",
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
};

function projectionLayer(
  resolveProject: (projectId: ProjectId) => Option.Option<OrchestrationProjectShell>,
) {
  return Layer.succeed(
    ProjectionSnapshotQuery,
    ProjectionSnapshotQuery.of({
      getCommandReadModel: () => Effect.die("unused"),
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getArchivedShellSnapshot: () => Effect.die("unused"),
      getSnapshotSequence: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
      getProjectShellById: (requestedProjectId) =>
        Effect.succeed(resolveProject(requestedProjectId)),
      getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
      hasActiveProjectAgentPeer: () => Effect.die("unused"),
      getThreadCheckpointContext: () => Effect.die("unused"),
      getFullThreadDiffContext: () => Effect.die("unused"),
      getThreadShellById: () => Effect.die("unused"),
      getThreadDetailById: () => Effect.die("unused"),
      getThreadDetailSnapshot: () => Effect.die("unused"),
    }),
  );
}

function workspaceLayer(options: {
  readonly list: WorkspaceEntries.WorkspaceEntries["Service"]["list"];
  readonly readFile: WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"];
  readonly scan?: ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner["Service"]["scan"];
}) {
  return Layer.mergeAll(
    Layer.succeed(
      WorkspaceEntries.WorkspaceEntries,
      WorkspaceEntries.WorkspaceEntries.of({
        browse: () => Effect.die("unused"),
        list: options.list,
        refresh: () => Effect.void,
        search: () => Effect.die("unused"),
      }),
    ),
    Layer.succeed(
      WorkspaceFileSystem.WorkspaceFileSystem,
      WorkspaceFileSystem.WorkspaceFileSystem.of({
        readFile: options.readFile,
        writeFile: () => Effect.die("unused"),
      }),
    ),
    Layer.succeed(
      ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner,
      ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner.of({
        scan:
          options.scan ??
          ((workspaceRoot) =>
            options.list({ cwd: workspaceRoot }).pipe(
              Effect.map(({ entries, truncated }) => ({
                entries,
                truncated,
              })),
            )),
      }),
    ),
  );
}

function serviceLayer(options: {
  readonly project?: Option.Option<OrchestrationProjectShell>;
  readonly resolveProject?: (projectId: ProjectId) => Option.Option<OrchestrationProjectShell>;
  readonly list: WorkspaceEntries.WorkspaceEntries["Service"]["list"];
  readonly readFile: WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"];
}) {
  const migratedSqlite = Layer.effectDiscard(runMigrations()).pipe(
    Layer.provideMerge(NodeSqliteClient.layerMemory()),
  );
  const storeLayer = ProjectSpeechProfileStore.layer.pipe(Layer.provideMerge(migratedSqlite));
  const dependencies = Layer.mergeAll(
    storeLayer,
    projectionLayer(options.resolveProject ?? (() => options.project ?? Option.some(project))),
    workspaceLayer(options),
  );
  return ProjectSpeechProfiles.layer.pipe(Layer.provideMerge(dependencies));
}

function successfulReadFile(
  contentsByPath: Readonly<Record<string, string>>,
): WorkspaceFileSystem.WorkspaceFileSystem["Service"]["readFile"] {
  return ({ relativePath }) => {
    const contents = contentsByPath[relativePath] ?? `export const ${relativePath.length} = true;`;
    return Effect.succeed({
      relativePath,
      contents,
      byteLength: contents.length,
      truncated: false,
    });
  };
}

it.effect("returns a typed error when the project does not exist", () =>
  Effect.gen(function* () {
    const profiles = yield* ProjectSpeechProfiles.ProjectSpeechProfiles;

    const error = yield* profiles.index(projectId).pipe(Effect.flip);

    assert.strictEqual(error._tag, "ProjectSpeechProfileError");
    assert.strictEqual(error.operation, "resolve-project");
    assert.strictEqual(error.projectId, projectId);
  }).pipe(
    Effect.provide(
      serviceLayer({
        resolveProject: () => Option.none(),
        list: () => Effect.die("must not scan"),
        readFile: () => Effect.die("must not read"),
      }),
    ),
  ),
);

it.effect("indexes readable high-signal files, skips read errors, and persists the profile", () => {
  const entries: ReadonlyArray<ProjectEntry> = [
    { path: "package.json", kind: "file" },
    { path: "README.md", kind: "file" },
    { path: "src/ProjectSpeechProfiles.ts", kind: "file" },
  ];
  const readPaths: Array<string> = [];

  return Effect.gen(function* () {
    const profiles = yield* ProjectSpeechProfiles.ProjectSpeechProfiles;
    const store = yield* ProjectSpeechProfileStore.ProjectSpeechProfileStore;

    const indexed = yield* profiles.index(projectId);

    assert.strictEqual(indexed.source, "indexed");
    assert.strictEqual(indexed.repositoryKey, "github.com/acme/t3-speech");
    assert.strictEqual(indexed.warning, null);
    assert.include(indexed.technologies, "TypeScript");
    assert.include(indexed.technologies, "React");
    assert.include(indexed.technologies, "Effect");
    assert.deepStrictEqual(readPaths, [
      "package.json",
      "README.md",
      "src/ProjectSpeechProfiles.ts",
    ]);

    const persisted = yield* store.get(projectId);
    assert.deepStrictEqual(Option.getOrThrow(persisted), indexed);
  }).pipe(
    Effect.provide(
      serviceLayer({
        list: () => Effect.succeed({ entries: [...entries], truncated: false }),
        readFile: ({ cwd, relativePath }) => {
          readPaths.push(relativePath);
          if (relativePath === "README.md") {
            return Effect.fail(
              new WorkspaceFileSystem.WorkspacePathNotFileError({
                workspaceRoot: cwd,
                relativePath,
                resolvedPath: `${cwd}/${relativePath}`,
              }),
            );
          }
          const contents =
            relativePath === "package.json"
              ? '{"name":"t3-speech","dependencies":{"effect":"latest","react":"latest"}}'
              : 'import * as Effect from "effect/Effect"; export class ProjectSpeechProfiles {}';
          return Effect.succeed({
            relativePath,
            contents,
            byteLength: contents.length,
            truncated: false,
          });
        },
      }),
    ),
  );
});

it.effect("does not create the native workspace search index while building speech context", () => {
  const entries: ReadonlyArray<ProjectEntry> = [
    { path: "package.json", kind: "file" },
    { path: "src/ProjectSpeechProfiles.ts", kind: "file" },
  ];

  return Effect.gen(function* () {
    const profiles = yield* ProjectSpeechProfiles.ProjectSpeechProfiles;

    const indexed = yield* profiles.index(projectId);

    assert.strictEqual(indexed.source, "indexed");
    assert.include(indexed.keyterms, "ProjectSpeechProfiles");
  }).pipe(
    Effect.provide(
      serviceLayer({
        list: () => Effect.die("native workspace search index must not run"),
        scan: () => Effect.succeed({ entries: [...entries], truncated: false }),
        readFile: successfulReadFile({
          "package.json": '{"name":"t3-speech","dependencies":{"effect":"latest"}}',
          "src/ProjectSpeechProfiles.ts": "export class ProjectSpeechProfiles {}",
        }),
      }),
    ),
  );
});

it.effect("persists a basic profile with a non-secret warning when scanning fails", () =>
  Effect.gen(function* () {
    const profiles = yield* ProjectSpeechProfiles.ProjectSpeechProfiles;
    const store = yield* ProjectSpeechProfileStore.ProjectSpeechProfileStore;

    const fallback = yield* profiles.index(projectId);

    assert.strictEqual(fallback.source, "basic");
    assert.strictEqual(fallback.warning, ProjectSpeechProfiles.INDEX_FALLBACK_WARNING);
    assert.notInclude(fallback.warning ?? "", project.workspaceRoot);
    const persisted = yield* store.get(projectId);
    assert.deepStrictEqual(Option.getOrThrow(persisted), fallback);
  }).pipe(
    Effect.provide(
      serviceLayer({
        list: () =>
          Effect.fail(
            new WorkspacePaths.WorkspaceRootNotExistsError({
              workspaceRoot: project.workspaceRoot,
              normalizedWorkspaceRoot: project.workspaceRoot,
            }),
          ),
        readFile: () => Effect.die("must not read"),
      }),
    ),
  ),
);

it.effect(
  "reuses persisted context and creates a basic context without reading source files when absent",
  () => {
    let listCalls = 0;
    const entries: ReadonlyArray<ProjectEntry> = [{ path: "package.json", kind: "file" }];

    return Effect.gen(function* () {
      const profiles = yield* ProjectSpeechProfiles.ProjectSpeechProfiles;
      const store = yield* ProjectSpeechProfileStore.ProjectSpeechProfileStore;

      const indexed = yield* profiles.index(projectId);
      const indexedContext = yield* profiles.contextForProject(projectId);

      assert.deepStrictEqual(indexedContext, {
        source: indexed.source,
        prompt: indexed.contextPrompt,
        keyterms: indexed.keyterms,
      });
      assert.strictEqual(listCalls, 1);

      const otherProjectId = ProjectId.make("project-context-basic");
      const basicContext = yield* profiles.contextForProject(otherProjectId);
      assert.strictEqual(basicContext.source, "basic");
      assert.strictEqual(listCalls, 2);
      const persistedBasic = yield* store.get(otherProjectId);
      assert.strictEqual(Option.getOrThrow(persistedBasic).source, "basic");
    }).pipe(
      Effect.provide(
        serviceLayer({
          resolveProject: (requestedProjectId) =>
            Option.some(
              requestedProjectId === projectId
                ? project
                : {
                    ...project,
                    id: requestedProjectId,
                    title: "Context Basic",
                    workspaceRoot: "/workspace/context-basic",
                    repositoryIdentity: null,
                  },
            ),
          list: () => {
            listCalls += 1;
            return Effect.succeed({ entries: [...entries], truncated: false });
          },
          readFile: successfulReadFile({
            "package.json": '{"name":"t3-speech","dependencies":{"effect":"latest"}}',
          }),
        }),
      ),
    );
  },
);

it.effect("reads a deterministic bounded set of manifests, README files, and source files", () => {
  const sourceEntries: ReadonlyArray<ProjectEntry> = Array.from(
    { length: ProjectSpeechProfiles.PROJECT_SPEECH_PROFILE_INDEX_FILE_LIMIT + 20 },
    (_, index) => ({
      path: `src/file-${String(index).padStart(3, "0")}.ts`,
      kind: "file" as const,
    }),
  ).toReversed();
  const entries: ReadonlyArray<ProjectEntry> = [
    ...sourceEntries,
    { path: "notes/internal.txt", kind: "file" },
    { path: "README.md", kind: "file" },
    { path: "package.json", kind: "file" },
    { path: "assets", kind: "directory" },
  ];
  const readPaths: Array<string> = [];

  return Effect.gen(function* () {
    const profiles = yield* ProjectSpeechProfiles.ProjectSpeechProfiles;

    yield* profiles.index(projectId);
    const firstScan = [...readPaths];
    readPaths.length = 0;
    yield* profiles.index(projectId);

    assert.strictEqual(
      firstScan.length,
      ProjectSpeechProfiles.PROJECT_SPEECH_PROFILE_INDEX_FILE_LIMIT,
    );
    assert.deepStrictEqual(readPaths, firstScan);
    assert.deepStrictEqual(firstScan.slice(0, 2), ["package.json", "README.md"]);
    assert.notInclude(firstScan, "notes/internal.txt");
  }).pipe(
    Effect.provide(
      serviceLayer({
        list: () => Effect.succeed({ entries: [...entries], truncated: false }),
        readFile: (input) => {
          readPaths.push(input.relativePath);
          return successfulReadFile({})(input);
        },
      }),
    ),
  );
});
