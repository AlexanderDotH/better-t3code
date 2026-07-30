import {
  ProjectSpeechProfileError,
  type AssemblyAiSpeechContext,
  type OrchestrationProjectShell,
  type ProjectEntry,
  type ProjectId,
  type ProjectSpeechProfile,
  type ProjectSpeechProfileSource,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import {
  buildBasicProjectSpeechProfileContent,
  buildIndexedProjectSpeechProfileContent,
  type ProjectSpeechProfileContent,
  type ProjectSpeechProfileTextFile,
} from "./ProjectSpeechProfileIndexer.ts";
import { ProjectSpeechProfileStore } from "./ProjectSpeechProfileStore.ts";
import { isIgnoredProjectSpeechPath } from "./ProjectSpeechPathPolicy.ts";
import { ProjectSpeechWorkspaceScanner } from "./ProjectSpeechWorkspaceScanner.ts";

export const PROJECT_SPEECH_PROFILE_INDEX_FILE_LIMIT = 24;
export const INDEX_FALLBACK_WARNING =
  "Full project indexing was unavailable; using a basic speech profile.";

class ProjectSpeechProfileIndexingFailure extends Schema.TaggedErrorClass<ProjectSpeechProfileIndexingFailure>()(
  "ProjectSpeechProfileIndexingFailure",
  { cause: Schema.Defect() },
) {}

const MANIFEST_NAMES = new Set([
  "build.gradle",
  "build.gradle.kts",
  "cargo.toml",
  "composer.json",
  "deno.json",
  "deno.jsonc",
  "gemfile",
  "go.mod",
  "go.work",
  "mix.exs",
  "package.json",
  "package.swift",
  "pipfile",
  "pom.xml",
  "pubspec.yaml",
  "pyproject.toml",
  "requirements.txt",
  "settings.gradle",
  "settings.gradle.kts",
]);

const MANIFEST_SUFFIXES = [".csproj", ".fsproj", ".sln", ".vbproj"] as const;
const SOURCE_EXTENSIONS = new Set([
  "astro",
  "c",
  "cc",
  "clj",
  "cljs",
  "cpp",
  "cs",
  "css",
  "cxx",
  "dart",
  "erl",
  "ex",
  "exs",
  "fs",
  "go",
  "gql",
  "graphql",
  "h",
  "hpp",
  "hs",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "kts",
  "lua",
  "m",
  "mm",
  "php",
  "proto",
  "py",
  "r",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "svelte",
  "swift",
  "tf",
  "ts",
  "tsx",
  "vue",
  "zig",
]);
interface RankedEntry {
  readonly entry: ProjectEntry;
  readonly normalizedPath: string;
  readonly normalizedLowerPath: string;
  readonly priority: number;
  readonly depth: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function selectionPriority(normalizedPath: string): number | undefined {
  const segments = normalizedPath.split("/").filter(Boolean);
  if (isIgnoredProjectSpeechPath(normalizedPath)) return undefined;
  const filename = segments.at(-1)?.toLowerCase() ?? "";
  if (
    MANIFEST_NAMES.has(filename) ||
    MANIFEST_SUFFIXES.some((suffix) => filename.endsWith(suffix))
  ) {
    return 0;
  }
  if (/^readme(?:\.[^.]*)?$/i.test(filename)) return 1;
  const extension = filename.includes(".") ? filename.split(".").at(-1) : undefined;
  return extension !== undefined && SOURCE_EXTENSIONS.has(extension) ? 2 : undefined;
}

function selectIndexEntries(entries: ReadonlyArray<ProjectEntry>): ReadonlyArray<ProjectEntry> {
  const ranked: Array<RankedEntry> = [];
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const normalizedPath = normalizePath(entry.path);
    const priority = selectionPriority(normalizedPath);
    if (normalizedPath.length === 0 || priority === undefined) continue;
    ranked.push({
      entry,
      normalizedPath,
      normalizedLowerPath: normalizedPath.toLowerCase(),
      priority,
      depth: normalizedPath.split("/").length,
    });
  }

  ranked.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.depth - right.depth ||
      compareText(left.normalizedLowerPath, right.normalizedLowerPath) ||
      compareText(left.normalizedPath, right.normalizedPath),
  );

  const selected: Array<ProjectEntry> = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    if (seen.has(candidate.normalizedLowerPath)) continue;
    seen.add(candidate.normalizedLowerPath);
    selected.push(candidate.entry);
    if (selected.length === PROJECT_SPEECH_PROFILE_INDEX_FILE_LIMIT) break;
  }
  return selected;
}

function indexerInput(
  project: OrchestrationProjectShell,
  workspaceEntries: ReadonlyArray<ProjectEntry>,
  textFiles: ReadonlyArray<ProjectSpeechProfileTextFile>,
) {
  return {
    projectTitle: project.title,
    workspaceRoot: project.workspaceRoot,
    ...(project.repositoryIdentity === null || project.repositoryIdentity === undefined
      ? {}
      : { repositoryIdentity: project.repositoryIdentity }),
    workspaceEntries,
    textFiles,
  };
}

function toSpeechContext(profile: ProjectSpeechProfile): AssemblyAiSpeechContext {
  return {
    source: profile.source,
    prompt: profile.contextPrompt,
    keyterms: profile.keyterms,
  };
}

export class ProjectSpeechProfiles extends Context.Service<
  ProjectSpeechProfiles,
  {
    readonly get: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<ProjectSpeechProfile>, ProjectSpeechProfileError>;
    readonly list: () => Effect.Effect<
      ReadonlyArray<ProjectSpeechProfile>,
      ProjectSpeechProfileError
    >;
    readonly index: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectSpeechProfile, ProjectSpeechProfileError>;
    readonly createBasic: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectSpeechProfile, ProjectSpeechProfileError>;
    readonly contextForProject: (
      projectId: ProjectId,
    ) => Effect.Effect<AssemblyAiSpeechContext, ProjectSpeechProfileError>;
  }
>()("t3/speech/ProjectSpeechProfiles") {}

export const make = Effect.gen(function* () {
  const store = yield* ProjectSpeechProfileStore;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const workspaceScanner = yield* ProjectSpeechWorkspaceScanner;

  const resolveProject = Effect.fn("ProjectSpeechProfiles.resolveProject")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSpeechProfileError({
            operation: "resolve-project",
            projectId,
            reason: "The project could not be resolved.",
            cause,
          }),
      ),
    );
    if (Option.isNone(project)) {
      return yield* new ProjectSpeechProfileError({
        operation: "resolve-project",
        projectId,
        reason: "The project was not found.",
      });
    }
    return project.value;
  });

  const persist = Effect.fn("ProjectSpeechProfiles.persist")(function* (
    project: OrchestrationProjectShell,
    source: ProjectSpeechProfileSource,
    content: ProjectSpeechProfileContent,
    warning: string | null,
  ) {
    const now = DateTime.formatIso(yield* DateTime.now);
    return yield* store.upsert({
      projectId: project.id,
      projectTitle: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryKey: project.repositoryIdentity?.canonicalKey ?? null,
      source,
      contextPrompt: content.contextPrompt,
      keyterms: content.keyterms,
      technologies: content.technologies,
      createdAt: now,
      updatedAt: now,
      warning,
    });
  });

  const buildIndexedContent = Effect.fn("ProjectSpeechProfiles.buildIndexedContent")(function* (
    project: OrchestrationProjectShell,
  ) {
    const listed = yield* workspaceScanner.scan(project.workspaceRoot);
    const selected = selectIndexEntries(listed.entries);
    const readResults = yield* Effect.forEach(selected, (entry) =>
      workspaceFileSystem
        .readFile({ cwd: project.workspaceRoot, relativePath: entry.path })
        .pipe(Effect.option),
    );
    const textFiles = readResults.flatMap((result) =>
      Option.isNone(result)
        ? []
        : [{ path: result.value.relativePath, contents: result.value.contents }],
    );
    return yield* Effect.try({
      try: () =>
        buildIndexedProjectSpeechProfileContent(indexerInput(project, listed.entries, textFiles)),
      catch: (cause) => new ProjectSpeechProfileIndexingFailure({ cause }),
    });
  });

  const buildBasicContent = Effect.fn("ProjectSpeechProfiles.buildBasicContent")(function* (
    project: OrchestrationProjectShell,
  ) {
    const entries = yield* workspaceScanner.scan(project.workspaceRoot).pipe(
      Effect.map((result) => result.entries),
      Effect.orElseSucceed(() => []),
    );
    return buildBasicProjectSpeechProfileContent(indexerInput(project, entries, []));
  });

  const get: ProjectSpeechProfiles["Service"]["get"] = Effect.fn("ProjectSpeechProfiles.get")(
    function* (projectId) {
      return yield* store.get(projectId);
    },
  );

  const list: ProjectSpeechProfiles["Service"]["list"] = Effect.fn("ProjectSpeechProfiles.list")(
    function* () {
      return yield* store.list();
    },
  );

  const createBasic: ProjectSpeechProfiles["Service"]["createBasic"] = Effect.fn(
    "ProjectSpeechProfiles.createBasic",
  )(function* (projectId) {
    const project = yield* resolveProject(projectId);
    const content = yield* buildBasicContent(project);
    return yield* persist(project, "basic", content, null);
  });

  const index: ProjectSpeechProfiles["Service"]["index"] = Effect.fn("ProjectSpeechProfiles.index")(
    function* (projectId) {
      const project = yield* resolveProject(projectId);
      const indexed = yield* buildIndexedContent(project).pipe(
        Effect.map((content) => ({ source: "indexed" as const, content, warning: null })),
        Effect.catch(() =>
          buildBasicContent(project).pipe(
            Effect.map((content) => ({
              source: "basic" as const,
              content,
              warning: INDEX_FALLBACK_WARNING,
            })),
          ),
        ),
      );
      return yield* persist(project, indexed.source, indexed.content, indexed.warning);
    },
  );

  const contextForProject: ProjectSpeechProfiles["Service"]["contextForProject"] = Effect.fn(
    "ProjectSpeechProfiles.contextForProject",
  )(function* (projectId) {
    const existing = yield* store.get(projectId);
    if (Option.isSome(existing)) return toSpeechContext(existing.value);
    return toSpeechContext(yield* createBasic(projectId));
  });

  return ProjectSpeechProfiles.of({ get, list, index, createBasic, contextForProject });
});

export const layer = Layer.effect(ProjectSpeechProfiles, make);
