// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodeUtil from "node:util";

import {
  ProjectMemoryError,
  ProjectMemorySettings,
  ProjectMemoryStableKey,
  ThreadId,
  type ProjectId,
  type ProjectMemoryDeleteRequest,
  type ProjectMemoryDeleteResponse,
  type ProjectMemoryDocumentClearRequest,
  type ProjectMemoryDocumentMutationResponse,
  type ProjectMemoryDocumentReplaceRequest,
  type ProjectMemoryDocumentStatus,
  type ProjectMemoryDocumentViewRequest,
  type ProjectMemoryDocumentViewResponse,
  type ProjectMemoryEntry,
  type ProjectMemoryImportRequest,
  type ProjectMemoryImportResponse,
  type ProjectMemoryOperation,
  type ProjectMemoryReadRequest,
  type ProjectMemoryReadResponse,
  type ProjectMemorySaveRequest,
  type ProjectMemorySaveResponse,
  type ProjectMemorySettingsReadRequest,
  type ProjectMemorySettingsResponse,
  type ProjectMemorySettingsUpdateRequest,
  type ProjectMemoryStorage,
  type ThreadId as ThreadIdType,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import {
  parseProjectMemoryDocument,
  sanitizeProjectMemoryContent,
  selectProjectMemoryEntries,
  serializeProjectMemoryDocument,
  upsertProjectMemoryEntry,
} from "./ProjectMemoryDocument.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const LOCAL_EXCLUDE_RULE = ".t3/MEMORY.md";
const DEFAULT_SETTINGS: ProjectMemorySettings = {
  memoryMode: "project",
  allowAgentWrites: true,
};
const decodeSettingsJson = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectMemorySettings));
const encodeSettingsJson = Schema.encodeEffect(Schema.fromJsonString(ProjectMemorySettings));

export interface ProjectMemoryScope {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly threadId: ThreadIdType;
  readonly checkpointRef?: ProjectMemoryEntry["checkpointRef"];
  readonly actor: "root" | "child";
}

export interface ProjectMemoryStoreOptions {
  readonly t3Home: string;
  readonly codexHome?: string;
  readonly isWorkspaceWritable?: (workspaceRoot: string) => Effect.Effect<boolean>;
}

export interface ProjectMemoryEffectiveState {
  readonly settings: ProjectMemorySettings;
  readonly status: ProjectMemoryDocumentStatus;
  readonly storage: ProjectMemoryStorage | null;
  readonly effectivePath: string | null;
}

export interface ProjectMemoryStoreShape {
  readonly getSettings: (
    scope: ProjectMemoryScope,
    request: ProjectMemorySettingsReadRequest,
  ) => Effect.Effect<ProjectMemorySettingsResponse, ProjectMemoryError>;
  readonly updateSettings: (
    scope: ProjectMemoryScope,
    request: ProjectMemorySettingsUpdateRequest,
  ) => Effect.Effect<ProjectMemorySettingsResponse, ProjectMemoryError>;
  readonly resolveEffectiveState: (
    scope: ProjectMemoryScope,
  ) => Effect.Effect<ProjectMemoryEffectiveState, ProjectMemoryError>;
  readonly view: (
    scope: ProjectMemoryScope,
    request: ProjectMemoryDocumentViewRequest,
  ) => Effect.Effect<ProjectMemoryDocumentViewResponse, ProjectMemoryError>;
  readonly replaceDocument: (
    scope: ProjectMemoryScope,
    request: ProjectMemoryDocumentReplaceRequest,
  ) => Effect.Effect<ProjectMemoryDocumentMutationResponse, ProjectMemoryError>;
  readonly clearDocument: (
    scope: ProjectMemoryScope,
    request: ProjectMemoryDocumentClearRequest,
  ) => Effect.Effect<ProjectMemoryDocumentMutationResponse, ProjectMemoryError>;
  readonly read: (
    scope: ProjectMemoryScope,
    request: ProjectMemoryReadRequest,
  ) => Effect.Effect<ProjectMemoryReadResponse, ProjectMemoryError>;
  readonly save: (
    scope: ProjectMemoryScope,
    request: ProjectMemorySaveRequest,
  ) => Effect.Effect<ProjectMemorySaveResponse, ProjectMemoryError>;
  readonly import: (
    scope: ProjectMemoryScope,
    request: ProjectMemoryImportRequest,
  ) => Effect.Effect<ProjectMemoryImportResponse, ProjectMemoryError>;
  readonly delete: (
    scope: ProjectMemoryScope,
    request: ProjectMemoryDeleteRequest,
  ) => Effect.Effect<ProjectMemoryDeleteResponse, ProjectMemoryError>;
}

export class ProjectMemoryStore extends Context.Service<
  ProjectMemoryStore,
  ProjectMemoryStoreShape
>()("t3/projectMemory/ProjectMemoryStore") {}

type ResolvedMemoryPath = {
  readonly filePath: string;
  readonly storage: ProjectMemoryStorage;
  readonly workspaceRoot: string;
};

type NativeMemoryGroup = {
  readonly appliesTo: string;
  readonly scope?: string;
  readonly sourceThreadId?: string;
  readonly sections: ReadonlyArray<{
    readonly section: ProjectMemoryEntry["section"];
    readonly content: string;
  }>;
};

type InitializedDocument = {
  readonly entries: ReadonlyArray<ProjectMemoryEntry>;
  readonly markdown: string;
  readonly created: boolean;
};

const failure = (
  operation: ProjectMemoryOperation,
  reason: ProjectMemoryError["reason"],
  cause?: unknown,
) => new ProjectMemoryError({ operation, reason, ...(cause === undefined ? {} : { cause }) });

function inactiveRead(
  settings: ProjectMemorySettings,
  request: ProjectMemoryReadRequest,
): ProjectMemoryReadResponse {
  return {
    mode: settings.memoryMode,
    storage: null,
    entries: [],
    markdown: "",
    tokenBudget: Math.min(4_000, Math.max(1_000, Math.floor(request.contextWindowTokens * 0.02))),
    estimatedTokens: 0,
    truncated: false,
  };
}

function inactiveState(settings: ProjectMemorySettings): ProjectMemoryEffectiveState {
  return {
    settings,
    status: settings.memoryMode === "provider" ? "provider" : "off",
    storage: null,
    effectivePath: null,
  };
}

function inactiveView(
  projectId: ProjectId,
  settings: ProjectMemorySettings,
): ProjectMemoryDocumentViewResponse {
  return { projectId, ...inactiveState(settings), rawMarkdown: "" };
}

function activeView(
  projectId: ProjectId,
  settings: ProjectMemorySettings,
  resolved: ResolvedMemoryPath,
  markdown: string,
): ProjectMemoryDocumentViewResponse {
  return {
    projectId,
    settings,
    status: "active",
    storage: resolved.storage,
    effectivePath: resolved.filePath,
    rawMarkdown: markdown,
  };
}

function exitCode(cause: unknown): number | undefined {
  return typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "number"
    ? cause.code
    : undefined;
}

function sectionBody(group: string, heading: string): string {
  const start = group.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const bodyStart = group.indexOf("\n", start);
  if (bodyStart < 0) return "";
  const next = group.slice(bodyStart + 1).search(/^## /m);
  return next < 0 ? group.slice(bodyStart + 1) : group.slice(bodyStart + 1, bodyStart + 1 + next);
}

function bullets(markdown: string): ReadonlyArray<string> {
  const values: string[] = [];
  let current: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      if (current !== undefined) values.push(current.trim());
      current = bullet[1] ?? "";
      continue;
    }
    if (current !== undefined && /^\s{2,}\S/.test(line)) current += ` ${line.trim()}`;
  }
  if (current !== undefined) values.push(current.trim());
  return values.filter(Boolean);
}

function parseNativeMemoryGroups(markdown: string): ReadonlyArray<NativeMemoryGroup> {
  const starts = [...markdown.matchAll(/^# Task Group:.*$/gm)].map((match) => match.index);
  return starts.flatMap((start, index): ReadonlyArray<NativeMemoryGroup> => {
    const group = markdown.slice(start, starts[index + 1] ?? markdown.length);
    const appliesTo = /^applies_to:\s*cwd=(.+?)(?:;\s*reuse_rule=|\s*$)/m.exec(group)?.[1]?.trim();
    if (!appliesTo) return [];
    const scope = /^scope:\s*(.+)$/m.exec(group)?.[1]?.trim();
    const sourceThreadId = /\bthread_id=([^,\s)]+)/.exec(group)?.[1];
    const sections: NativeMemoryGroup["sections"] = [
      ...(scope ? [{ section: "project-profile" as const, content: scope }] : []),
      ...bullets(sectionBody(group, "User preferences")).map((content) => ({
        section: "active-decisions" as const,
        content,
      })),
      ...bullets(sectionBody(group, "Reusable knowledge")).map((content) => ({
        section: "verified-workflows" as const,
        content,
      })),
      ...bullets(sectionBody(group, "Failures and how to do differently")).map((content) => ({
        section: "known-pitfalls" as const,
        content,
      })),
      ...[...group.matchAll(/^## Task \d+:\s*(.+)$/gm)].map((match) => ({
        section: "recent-outcomes" as const,
        content: match[1]?.trim() ?? "",
      })),
    ].filter((entry) => entry.content.length > 0);
    return [
      {
        appliesTo,
        ...(scope === undefined ? {} : { scope }),
        ...(sourceThreadId === undefined ? {} : { sourceThreadId }),
        sections,
      },
    ];
  });
}

function importedKey(section: ProjectMemoryEntry["section"], content: string) {
  const digest = NodeCrypto.createHash("sha256").update(`${section}\0${content}`).digest("hex");
  return ProjectMemoryStableKey.make(`codex.${section}.${digest.slice(0, 16)}`);
}

function sanitizeEntries(
  entries: ReadonlyArray<ProjectMemoryEntry>,
): ReadonlyArray<ProjectMemoryEntry> {
  return [
    ...new Map(
      entries.map((entry) => [
        entry.key,
        { ...entry, content: sanitizeProjectMemoryContent(entry.content) },
      ]),
    ).values(),
  ];
}

export const make = (options: ProjectMemoryStoreOptions) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const locks = new Map<string, Semaphore.Semaphore>();
    const codexHome =
      options.codexHome ??
      (process.env.CODEX_HOME?.trim() || path.join(NodeOS.homedir(), ".codex"));

    const atomicWrite = (input: { readonly filePath: string; readonly contents: string }) =>
      writeFileStringAtomically(input).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

    const lockFor = (projectId: ProjectId) => {
      const existing = locks.get(projectId);
      if (existing) return existing;
      const created = Semaphore.makeUnsafe(1);
      locks.set(projectId, created);
      return created;
    };

    const settingsPath = (projectId: ProjectId) =>
      path.join(
        options.t3Home,
        "userdata",
        "project-memories",
        encodeURIComponent(projectId),
        "settings.json",
      );

    const exists = (
      filePath: string,
      operation: ProjectMemoryOperation,
    ): Effect.Effect<boolean, ProjectMemoryError> =>
      fileSystem
        .exists(filePath)
        .pipe(Effect.mapError((cause) => failure(operation, "operation_failed", cause)));

    const existsBestEffort = (filePath: string): Effect.Effect<boolean> =>
      fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));

    const ensureProject = (
      scope: ProjectMemoryScope,
      requestProjectId: ProjectId,
      operation: ProjectMemoryOperation,
    ): Effect.Effect<void, ProjectMemoryError> =>
      scope.projectId === requestProjectId
        ? Effect.void
        : Effect.fail(failure(operation, "project_mismatch"));

    const ensureRootActor = (
      scope: ProjectMemoryScope,
      operation: ProjectMemoryOperation,
    ): Effect.Effect<void, ProjectMemoryError> =>
      scope.actor === "root" ? Effect.void : Effect.fail(failure(operation, "write_forbidden"));

    const ensureAgentWritable = (
      scope: ProjectMemoryScope,
      settings: ProjectMemorySettings,
      operation: "save" | "delete",
    ): Effect.Effect<void, ProjectMemoryError> =>
      scope.actor === "root" && settings.allowAgentWrites
        ? Effect.void
        : Effect.fail(failure(operation, "write_forbidden"));

    const readSettingsUnlocked = Effect.fn("ProjectMemory.readSettingsUnlocked")(function* (
      projectId: ProjectId,
      operation: ProjectMemoryOperation,
    ): Effect.fn.Return<ProjectMemorySettings, ProjectMemoryError> {
      const filePath = settingsPath(projectId);
      if (!(yield* exists(filePath, operation))) return DEFAULT_SETTINGS;
      const contents = yield* fileSystem
        .readFileString(filePath)
        .pipe(Effect.mapError((cause) => failure(operation, "operation_failed", cause)));
      return yield* decodeSettingsJson(contents).pipe(
        Effect.mapError((cause) => failure(operation, "operation_failed", cause)),
      );
    });

    const writeSettingsUnlocked = Effect.fn("ProjectMemory.writeSettingsUnlocked")(
      function* (projectId: ProjectId, settings: ProjectMemorySettings) {
        const contents = yield* encodeSettingsJson(settings);
        yield* atomicWrite({
          filePath: settingsPath(projectId),
          contents: `${contents}\n`,
        });
      },
      Effect.mapError((cause) => failure("settings-update", "operation_failed", cause)),
    );

    const defaultWorkspaceWritable = Effect.fn("ProjectMemory.workspaceWritable")(function* (
      workspaceRoot: string,
    ): Effect.fn.Return<boolean> {
      const memoryDirectory = path.join(workspaceRoot, ".t3");
      const target = (yield* existsBestEffort(memoryDirectory)) ? memoryDirectory : workspaceRoot;
      return yield* fileSystem.access(target, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    });
    const isWorkspaceWritable = options.isWorkspaceWritable ?? defaultWorkspaceWritable;

    const resolvePath = Effect.fn("ProjectMemory.resolvePath")(function* (
      scope: ProjectMemoryScope,
      operation: ProjectMemoryOperation,
    ): Effect.fn.Return<ResolvedMemoryPath, ProjectMemoryError> {
      const workspaceRoot = yield* fileSystem
        .realPath(scope.workspaceRoot)
        .pipe(Effect.mapError((cause) => failure(operation, "workspace_unavailable", cause)));
      const stat = yield* fileSystem
        .stat(workspaceRoot)
        .pipe(Effect.mapError((cause) => failure(operation, "workspace_unavailable", cause)));
      if (stat.type !== "Directory") {
        return yield* failure(operation, "workspace_unavailable");
      }
      if (yield* isWorkspaceWritable(workspaceRoot)) {
        return {
          filePath: path.join(workspaceRoot, ".t3", "MEMORY.md"),
          storage: "workspace",
          workspaceRoot,
        };
      }
      return {
        filePath: path.join(
          options.t3Home,
          "userdata",
          "project-memories",
          encodeURIComponent(scope.projectId),
          "MEMORY.md",
        ),
        storage: "fallback",
        workspaceRoot,
      };
    });

    const ensureLocalExclude = Effect.fn("ProjectMemory.ensureLocalExclude")(function* (
      resolved: ResolvedMemoryPath,
    ): Effect.fn.Return<void> {
      if (resolved.storage !== "workspace") return;
      const ignored = yield* Effect.tryPromise({
        try: () =>
          execFile("git", [
            "-C",
            resolved.workspaceRoot,
            "check-ignore",
            "--quiet",
            "--",
            LOCAL_EXCLUDE_RULE,
          ]),
        catch: (cause) => failure("document-view", "operation_failed", cause),
      }).pipe(
        Effect.match({
          onFailure: (error) => exitCode(error.cause) !== 1,
          onSuccess: () => true,
        }),
      );
      if (ignored) return;
      const excludePath = yield* Effect.tryPromise({
        try: () =>
          execFile("git", [
            "-C",
            resolved.workspaceRoot,
            "rev-parse",
            "--git-path",
            "info/exclude",
          ]).then(({ stdout }) => {
            const value = stdout.trim();
            return path.isAbsolute(value) ? value : path.resolve(resolved.workspaceRoot, value);
          }),
        catch: (cause) => failure("document-view", "operation_failed", cause),
      }).pipe(
        Effect.match({
          onFailure: () => undefined,
          onSuccess: (value) => value,
        }),
      );
      if (!excludePath) return;
      const current = (yield* existsBestEffort(excludePath))
        ? yield* fileSystem.readFileString(excludePath).pipe(Effect.orElseSucceed(() => ""))
        : "";
      if (current.split(/\r?\n/).includes(LOCAL_EXCLUDE_RULE)) return;
      const contents = `${current.trimEnd()}${current.trimEnd().length === 0 ? "" : "\n"}${LOCAL_EXCLUDE_RULE}\n`;
      yield* atomicWrite({ filePath: excludePath, contents }).pipe(Effect.ignore);
    });

    const readEntries = Effect.fn("ProjectMemory.readEntries")(function* (
      filePath: string,
      operation: ProjectMemoryOperation,
    ): Effect.fn.Return<ReadonlyArray<ProjectMemoryEntry>, ProjectMemoryError> {
      if (!(yield* exists(filePath, operation))) return [];
      const markdown = yield* fileSystem
        .readFileString(filePath)
        .pipe(Effect.mapError((cause) => failure(operation, "operation_failed", cause)));
      return sanitizeEntries(parseProjectMemoryDocument(markdown));
    });

    const nativeEntries = Effect.fn("ProjectMemory.nativeEntries")(function* (
      resolved: ResolvedMemoryPath,
      fallbackThreadId: ThreadIdType,
    ): Effect.fn.Return<ReadonlyArray<ProjectMemoryEntry>> {
      const nativePath = path.join(codexHome, "memories", "MEMORY.md");
      if (!(yield* existsBestEffort(nativePath))) return [];
      const markdown = yield* fileSystem
        .readFileString(nativePath)
        .pipe(Effect.orElseSucceed(() => ""));
      const imported: ProjectMemoryEntry[] = [];
      for (const group of parseNativeMemoryGroups(markdown)) {
        const appliesTo = yield* fileSystem
          .realPath(group.appliesTo)
          .pipe(Effect.orElseSucceed(() => undefined));
        if (appliesTo !== resolved.workspaceRoot) continue;
        const sourceThreadId = ThreadId.make(group.sourceThreadId ?? `${fallbackThreadId}`);
        for (const candidate of group.sections) {
          const content = sanitizeProjectMemoryContent(candidate.content);
          if (content.length === 0) continue;
          imported.push({
            section: candidate.section,
            key: importedKey(candidate.section, content),
            content,
            verified: true,
            sourceThreadId,
          });
        }
      }
      return sanitizeEntries(imported);
    });

    const initialize = Effect.fn("ProjectMemory.initialize")(function* (
      resolved: ResolvedMemoryPath,
      threadId: ThreadIdType,
      operation: ProjectMemoryOperation,
    ): Effect.fn.Return<InitializedDocument, ProjectMemoryError> {
      if (yield* exists(resolved.filePath, operation)) {
        const entries = yield* readEntries(resolved.filePath, operation);
        return { entries, markdown: serializeProjectMemoryDocument(entries), created: false };
      }
      const entries = yield* nativeEntries(resolved, threadId);
      const markdown = serializeProjectMemoryDocument(entries);
      yield* ensureLocalExclude(resolved);
      yield* atomicWrite({ filePath: resolved.filePath, contents: markdown }).pipe(
        Effect.mapError((cause) => failure(operation, "operation_failed", cause)),
      );
      return { entries, markdown, created: true };
    });

    const writeEntries = Effect.fn("ProjectMemory.writeEntries")(function* (
      resolved: ResolvedMemoryPath,
      entries: ReadonlyArray<ProjectMemoryEntry>,
      operation: ProjectMemoryOperation,
    ): Effect.fn.Return<string, ProjectMemoryError> {
      const markdown = serializeProjectMemoryDocument(sanitizeEntries(entries));
      yield* ensureLocalExclude(resolved);
      yield* atomicWrite({ filePath: resolved.filePath, contents: markdown }).pipe(
        Effect.mapError((cause) => failure(operation, "operation_failed", cause)),
      );
      return markdown;
    });

    const resolveEffectiveStateUnlocked = Effect.fn("ProjectMemory.resolveEffectiveStateUnlocked")(
      function* (
        scope: ProjectMemoryScope,
        settings: ProjectMemorySettings,
        operation: ProjectMemoryOperation,
      ): Effect.fn.Return<ProjectMemoryEffectiveState, ProjectMemoryError> {
        if (settings.memoryMode !== "project") return inactiveState(settings);
        const resolved = yield* resolvePath(scope, operation);
        return {
          settings,
          status: "active",
          storage: resolved.storage,
          effectivePath: resolved.filePath,
        };
      },
    );

    const viewUnlocked = Effect.fn("ProjectMemory.viewUnlocked")(function* (
      scope: ProjectMemoryScope,
      settings: ProjectMemorySettings,
      operation: ProjectMemoryOperation,
    ): Effect.fn.Return<ProjectMemoryDocumentViewResponse, ProjectMemoryError> {
      if (settings.memoryMode !== "project") return inactiveView(scope.projectId, settings);
      const resolved = yield* resolvePath(scope, operation);
      const initialized = yield* initialize(resolved, scope.threadId, operation);
      return activeView(scope.projectId, settings, resolved, initialized.markdown);
    });

    const getSettings: ProjectMemoryStoreShape["getSettings"] = Effect.fn(
      "ProjectMemoryStore.getSettings",
    )(function* (scope, request) {
      yield* ensureProject(scope, request.projectId, "settings-read");
      return yield* lockFor(scope.projectId).withPermit(
        Effect.map(readSettingsUnlocked(scope.projectId, "settings-read"), (settings) => ({
          projectId: scope.projectId,
          settings,
        })),
      );
    });

    const updateSettings: ProjectMemoryStoreShape["updateSettings"] = Effect.fn(
      "ProjectMemoryStore.updateSettings",
    )(function* (scope, request) {
      yield* ensureProject(scope, request.projectId, "settings-update");
      yield* ensureRootActor(scope, "settings-update");
      return yield* lockFor(scope.projectId).withPermit(
        Effect.gen(function* () {
          const settings: ProjectMemorySettings = {
            memoryMode: request.memoryMode,
            allowAgentWrites: request.allowAgentWrites,
          };
          yield* writeSettingsUnlocked(scope.projectId, settings);
          return { projectId: scope.projectId, settings };
        }),
      );
    });

    const resolveEffectiveState: ProjectMemoryStoreShape["resolveEffectiveState"] = Effect.fn(
      "ProjectMemoryStore.resolveEffectiveState",
    )(function* (scope) {
      return yield* lockFor(scope.projectId).withPermit(
        Effect.gen(function* () {
          const settings = yield* readSettingsUnlocked(scope.projectId, "settings-read");
          return yield* resolveEffectiveStateUnlocked(scope, settings, "settings-read");
        }),
      );
    });

    const view: ProjectMemoryStoreShape["view"] = Effect.fn("ProjectMemoryStore.view")(
      function* (scope, request) {
        yield* ensureProject(scope, request.projectId, "document-view");
        return yield* lockFor(scope.projectId).withPermit(
          Effect.gen(function* () {
            const settings = yield* readSettingsUnlocked(scope.projectId, "document-view");
            return yield* viewUnlocked(scope, settings, "document-view");
          }),
        );
      },
    );

    const replaceDocument: ProjectMemoryStoreShape["replaceDocument"] = Effect.fn(
      "ProjectMemoryStore.replaceDocument",
    )(function* (scope, request) {
      yield* ensureProject(scope, request.projectId, "document-replace");
      yield* ensureRootActor(scope, "document-replace");
      return yield* lockFor(scope.projectId).withPermit(
        Effect.gen(function* () {
          const settings = yield* readSettingsUnlocked(scope.projectId, "document-replace");
          if (settings.memoryMode !== "project") {
            return { applied: false, view: inactiveView(scope.projectId, settings) };
          }
          const resolved = yield* resolvePath(scope, "document-replace");
          const markdown = yield* writeEntries(
            resolved,
            parseProjectMemoryDocument(request.markdown),
            "document-replace",
          );
          return {
            applied: true,
            view: activeView(scope.projectId, settings, resolved, markdown),
          };
        }),
      );
    });

    const clearDocument: ProjectMemoryStoreShape["clearDocument"] = Effect.fn(
      "ProjectMemoryStore.clearDocument",
    )(function* (scope, request) {
      yield* ensureProject(scope, request.projectId, "document-clear");
      yield* ensureRootActor(scope, "document-clear");
      return yield* lockFor(scope.projectId).withPermit(
        Effect.gen(function* () {
          const settings = yield* readSettingsUnlocked(scope.projectId, "document-clear");
          if (settings.memoryMode !== "project") {
            return { applied: false, view: inactiveView(scope.projectId, settings) };
          }
          const resolved = yield* resolvePath(scope, "document-clear");
          const markdown = yield* writeEntries(resolved, [], "document-clear");
          return {
            applied: true,
            view: activeView(scope.projectId, settings, resolved, markdown),
          };
        }),
      );
    });

    const read: ProjectMemoryStoreShape["read"] = Effect.fn("ProjectMemoryStore.read")(
      function* (scope, request) {
        yield* ensureProject(scope, request.projectId, "read");
        return yield* lockFor(scope.projectId).withPermit(
          Effect.gen(function* () {
            const settings = yield* readSettingsUnlocked(scope.projectId, "read");
            if (settings.memoryMode !== "project") return inactiveRead(settings, request);
            const resolved = yield* resolvePath(scope, "read");
            const initialized = yield* initialize(resolved, scope.threadId, "read");
            return {
              mode: settings.memoryMode,
              storage: resolved.storage,
              ...selectProjectMemoryEntries(
                initialized.entries,
                request.query,
                request.contextWindowTokens,
              ),
            };
          }),
        );
      },
    );

    const save: ProjectMemoryStoreShape["save"] = Effect.fn("ProjectMemoryStore.save")(
      function* (scope, request) {
        yield* ensureProject(scope, request.projectId, "save");
        return yield* lockFor(scope.projectId).withPermit(
          Effect.gen(function* () {
            const settings = yield* readSettingsUnlocked(scope.projectId, "save");
            yield* ensureAgentWritable(scope, settings, "save");
            if (settings.memoryMode !== "project") {
              return {
                mode: settings.memoryMode,
                storage: null,
                applied: false,
                replaced: false,
                entry: null,
              };
            }
            const resolved = yield* resolvePath(scope, "save");
            const initialized = yield* initialize(resolved, scope.threadId, "save");
            const checkpointRef = request.checkpointRef ?? scope.checkpointRef;
            const entry: ProjectMemoryEntry = {
              section: request.section,
              key: request.key,
              content: sanitizeProjectMemoryContent(request.content),
              verified: request.verified,
              sourceThreadId: scope.threadId,
              ...(checkpointRef === undefined ? {} : { checkpointRef }),
            };
            const updated = upsertProjectMemoryEntry(initialized.entries, entry);
            yield* writeEntries(resolved, updated.entries, "save");
            return {
              mode: settings.memoryMode,
              storage: resolved.storage,
              applied: true,
              replaced: updated.replaced,
              entry,
            };
          }),
        );
      },
    );

    const importMemory: ProjectMemoryStoreShape["import"] = Effect.fn("ProjectMemoryStore.import")(
      function* (scope, request) {
        yield* ensureProject(scope, request.projectId, "import");
        yield* ensureRootActor(scope, "import");
        return yield* lockFor(scope.projectId).withPermit(
          Effect.gen(function* () {
            const settings = yield* readSettingsUnlocked(scope.projectId, "import");
            if (settings.memoryMode !== "project") {
              return { mode: settings.memoryMode, storage: null, applied: false, imported: 0 };
            }
            const resolved = yield* resolvePath(scope, "import");
            const initialized = yield* initialize(resolved, scope.threadId, "import");
            return {
              mode: settings.memoryMode,
              storage: resolved.storage,
              applied: initialized.created,
              imported: initialized.created ? initialized.entries.length : 0,
            };
          }),
        );
      },
    );

    const deleteEntry: ProjectMemoryStoreShape["delete"] = Effect.fn("ProjectMemoryStore.delete")(
      function* (scope, request) {
        yield* ensureProject(scope, request.projectId, "delete");
        return yield* lockFor(scope.projectId).withPermit(
          Effect.gen(function* () {
            const settings = yield* readSettingsUnlocked(scope.projectId, "delete");
            yield* ensureAgentWritable(scope, settings, "delete");
            if (settings.memoryMode !== "project") {
              return { mode: settings.memoryMode, storage: null, applied: false, deleted: false };
            }
            const resolved = yield* resolvePath(scope, "delete");
            const initialized = yield* initialize(resolved, scope.threadId, "delete");
            const entries = initialized.entries.filter((entry) => entry.key !== request.key);
            const deleted = entries.length !== initialized.entries.length;
            if (deleted) yield* writeEntries(resolved, entries, "delete");
            return {
              mode: settings.memoryMode,
              storage: resolved.storage,
              applied: true,
              deleted,
            };
          }),
        );
      },
    );

    return ProjectMemoryStore.of({
      getSettings,
      updateSettings,
      resolveEffectiveState,
      view,
      replaceDocument,
      clearDocument,
      read,
      save,
      import: importMemory,
      delete: deleteEntry,
    });
  });

export const layer = (options: ProjectMemoryStoreOptions) =>
  Layer.effect(ProjectMemoryStore, make(options));
