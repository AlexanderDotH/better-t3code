// @effect-diagnostics nodeBuiltinImport:off - Local T3 databases are opened read-only with node:sqlite.
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodeSqlite from "node:sqlite";

import {
  ChatAttachment,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  IsoDateTime,
  MessageId,
  ModelSelection,
  OrchestrationMessageRole,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  T3ChatImportError,
  type T3ChatImportDiscoverResult,
  type T3ChatImportRunInput,
  type T3ChatImportRunResult,
  type T3ChatImportSource,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { attachmentRelativePath } from "./attachmentStore.ts";
import { ServerConfig } from "./config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";

type SqliteRow = Record<string, unknown>;

const SourceProjectRow = Schema.Struct({
  sourceId: Schema.String,
  title: Schema.String,
  workspaceRoot: Schema.String,
  defaultModelSelectionJson: Schema.NullOr(Schema.String),
  legacyDefaultModel: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
});

const SourceThreadRow = Schema.Struct({
  sourceId: Schema.String,
  projectSourceId: Schema.String,
  title: Schema.String,
  modelSelectionJson: Schema.NullOr(Schema.String),
  legacyModel: Schema.NullOr(Schema.String),
  runtimeMode: Schema.String,
  interactionMode: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
});

const SourceMessageRow = Schema.Struct({
  sourceId: Schema.String,
  threadSourceId: Schema.String,
  role: Schema.String,
  text: Schema.String,
  attachmentsJson: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

const decodeSourceProjectRows = Schema.decodeUnknownEffect(Schema.Array(SourceProjectRow));
const decodeSourceThreadRows = Schema.decodeUnknownEffect(Schema.Array(SourceThreadRow));
const decodeSourceMessageRows = Schema.decodeUnknownEffect(Schema.Array(SourceMessageRow));
const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const decodeRuntimeMode = Schema.decodeUnknownEffect(RuntimeMode);
const decodeInteractionMode = Schema.decodeUnknownEffect(ProviderInteractionMode);
const decodeMessageRole = Schema.decodeUnknownEffect(OrchestrationMessageRole);
const decodeAttachments = Schema.decodeUnknownEffect(Schema.Array(ChatAttachment));
const isIsoDateTime = Schema.is(IsoDateTime);

export interface T3ChatImportMessage {
  readonly sourceId: string;
  readonly role: OrchestrationMessageRole;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface T3ChatImportThread {
  readonly sourceId: string;
  readonly projectSourceId: string;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly messages: ReadonlyArray<T3ChatImportMessage>;
}

export interface T3ChatImportProject {
  readonly sourceId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
  readonly createdAt: string;
}

export interface T3ChatImportSnapshot {
  readonly projects: ReadonlyArray<T3ChatImportProject>;
  readonly threads: ReadonlyArray<T3ChatImportThread>;
}

function importError(message: string, cause?: unknown): T3ChatImportError {
  return new T3ChatImportError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function makeT3ChatImportId(...parts: ReadonlyArray<string>): string {
  const digest = NodeCrypto.createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 32);
  return `t3-chat-import-${digest}`;
}

function withReadOnlyDatabase<A>(
  databasePath: string,
  use: (database: NodeSqlite.DatabaseSync) => A,
): Effect.Effect<A, T3ChatImportError> {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => new NodeSqlite.DatabaseSync(databasePath, { readOnly: true }),
      catch: (cause) => importError(`Could not open T3 database at ${databasePath}.`, cause),
    }),
    (database) =>
      Effect.try({
        try: () => use(database),
        catch: (cause) => importError(`Could not read T3 database at ${databasePath}.`, cause),
      }),
    (database) => Effect.sync(() => database.close()).pipe(Effect.ignore),
  );
}

function tableColumns(database: NodeSqlite.DatabaseSync, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as SqliteRow[];
  return new Set(rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])));
}

function requireImportTables(database: NodeSqlite.DatabaseSync): void {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (
        'projection_projects',
        'projection_threads',
        'projection_thread_messages'
      )`,
    )
    .all() as SqliteRow[];
  if (tables.length !== 3) {
    throw new Error("This database does not contain a supported T3 chat schema.");
  }
}

function selectColumn(
  columns: ReadonlySet<string>,
  column: string,
  alias: string,
  fallback: string,
): string {
  return columns.has(column) ? `${column} AS ${alias}` : `${fallback} AS ${alias}`;
}

const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

function parseJson(raw: string, description: string): Effect.Effect<unknown, T3ChatImportError> {
  return decodeUnknownJson(raw).pipe(
    Effect.mapError((cause) => importError(`Could not parse ${description}.`, cause)),
  );
}

function inferLegacyModelSelection(model: string): unknown {
  return {
    provider: model.toLowerCase().includes("claude") ? "claudeAgent" : "codex",
    model,
  };
}

const readModelSelection = Effect.fn("readModelSelection")(function* (
  json: string | null,
  legacyModel: string | null,
): Effect.fn.Return<ModelSelection, T3ChatImportError> {
  const candidate =
    json !== null
      ? yield* parseJson(json, "model selection")
      : inferLegacyModelSelection(legacyModel ?? "gpt-5.4");
  return yield* decodeModelSelection(candidate).pipe(
    Effect.mapError((cause) =>
      importError("The source chat has an invalid model selection.", cause),
    ),
  );
});

const readOptionalModelSelection = Effect.fn("readOptionalModelSelection")(function* (
  json: string | null,
  legacyModel: string | null,
): Effect.fn.Return<ModelSelection | null, T3ChatImportError> {
  if (json === null && legacyModel === null) return null;
  return yield* readModelSelection(json, legacyModel);
});

const readAttachments = Effect.fn("readAttachments")(function* (
  json: string | null,
): Effect.fn.Return<ReadonlyArray<ChatAttachment>, never> {
  if (json === null) return [];
  const parsed = yield* parseJson(json, "chat attachments").pipe(Effect.option);
  if (parsed._tag === "None") return [];
  return yield* decodeAttachments(parsed.value).pipe(Effect.orElseSucceed(() => []));
});

export const readT3ChatImportSnapshot = Effect.fn("readT3ChatImportSnapshot")(function* (
  databasePath: string,
): Effect.fn.Return<T3ChatImportSnapshot, T3ChatImportError> {
  const rows = yield* withReadOnlyDatabase(databasePath, (database) => {
    requireImportTables(database);
    const projectColumns = tableColumns(database, "projection_projects");
    const threadColumns = tableColumns(database, "projection_threads");
    const messageColumns = tableColumns(database, "projection_thread_messages");
    const activeThreadFilter = threadColumns.has("deleted_at") ? "WHERE deleted_at IS NULL" : "";
    const completedMessageFilter = messageColumns.has("is_streaming")
      ? "WHERE is_streaming = 0"
      : "";

    const projects = database
      .prepare(`
        SELECT
          project_id AS sourceId,
          title,
          workspace_root AS workspaceRoot,
          ${selectColumn(projectColumns, "default_model_selection_json", "defaultModelSelectionJson", "NULL")},
          ${selectColumn(projectColumns, "default_model", "legacyDefaultModel", "NULL")},
          created_at AS createdAt
        FROM projection_projects
        ${projectColumns.has("deleted_at") ? "WHERE deleted_at IS NULL" : ""}
        ORDER BY created_at ASC, project_id ASC
      `)
      .all();
    const threads = database
      .prepare(`
        SELECT
          thread_id AS sourceId,
          project_id AS projectSourceId,
          title,
          ${selectColumn(threadColumns, "model_selection_json", "modelSelectionJson", "NULL")},
          ${selectColumn(threadColumns, "model", "legacyModel", "NULL")},
          ${selectColumn(threadColumns, "runtime_mode", "runtimeMode", `'${DEFAULT_RUNTIME_MODE}'`)},
          ${selectColumn(
            threadColumns,
            "interaction_mode",
            "interactionMode",
            `'${DEFAULT_PROVIDER_INTERACTION_MODE}'`,
          )},
          branch,
          worktree_path AS worktreePath,
          created_at AS createdAt,
          updated_at AS updatedAt,
          ${selectColumn(threadColumns, "archived_at", "archivedAt", "NULL")}
        FROM projection_threads
        ${activeThreadFilter}
        ORDER BY created_at ASC, thread_id ASC
      `)
      .all();
    const messages = database
      .prepare(`
        SELECT
          message_id AS sourceId,
          thread_id AS threadSourceId,
          role,
          text,
          ${selectColumn(messageColumns, "attachments_json", "attachmentsJson", "NULL")},
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM projection_thread_messages
        ${completedMessageFilter}
        ORDER BY created_at ASC, message_id ASC
      `)
      .all();
    return { projects, threads, messages };
  });

  const projectRows = yield* decodeSourceProjectRows(rows.projects).pipe(
    Effect.mapError((cause) =>
      importError("Could not decode projects from the source database.", cause),
    ),
  );
  const threadRows = yield* decodeSourceThreadRows(rows.threads).pipe(
    Effect.mapError((cause) =>
      importError("Could not decode chats from the source database.", cause),
    ),
  );
  const messageRows = yield* decodeSourceMessageRows(rows.messages).pipe(
    Effect.mapError((cause) =>
      importError("Could not decode messages from the source database.", cause),
    ),
  );

  const projects = yield* Effect.forEach(projectRows, (row) =>
    readOptionalModelSelection(row.defaultModelSelectionJson, row.legacyDefaultModel).pipe(
      Effect.map((defaultModelSelection) => ({
        sourceId: row.sourceId,
        title: row.title,
        workspaceRoot: row.workspaceRoot,
        defaultModelSelection,
        createdAt: row.createdAt,
      })),
    ),
  );
  const messages = yield* Effect.forEach(messageRows, (row) =>
    Effect.all({
      role: decodeMessageRole(row.role).pipe(
        Effect.mapError((cause) =>
          importError("The source chat has an invalid message role.", cause),
        ),
      ),
      attachments: readAttachments(row.attachmentsJson),
    }).pipe(
      Effect.map(({ role, attachments }) => ({
        sourceId: row.sourceId,
        threadSourceId: row.threadSourceId,
        role,
        text: row.text,
        attachments,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    ),
  );
  const messagesByThread = Map.groupBy(messages, (message) => message.threadSourceId);
  const threads = yield* Effect.forEach(threadRows, (row) =>
    Effect.all({
      modelSelection: readModelSelection(row.modelSelectionJson, row.legacyModel),
      runtimeMode: decodeRuntimeMode(row.runtimeMode).pipe(
        Effect.orElseSucceed(() => DEFAULT_RUNTIME_MODE),
      ),
      interactionMode: decodeInteractionMode(row.interactionMode).pipe(
        Effect.orElseSucceed(() => DEFAULT_PROVIDER_INTERACTION_MODE),
      ),
    }).pipe(
      Effect.map(({ modelSelection, runtimeMode, interactionMode }) => ({
        sourceId: row.sourceId,
        projectSourceId: row.projectSourceId,
        title: row.title,
        modelSelection,
        runtimeMode,
        interactionMode,
        branch: row.branch,
        worktreePath: row.worktreePath,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
        messages: (messagesByThread.get(row.sourceId) ?? []).map(
          ({ threadSourceId: _threadSourceId, ...message }) => message,
        ),
      })),
    ),
  );
  const activeProjectIds = new Set(threads.map((thread) => thread.projectSourceId));

  return {
    projects: projects.filter((project) => activeProjectIds.has(project.sourceId)),
    threads,
  };
});

function sourceLabel(databasePath: string, path: Path.Path): string {
  const stateName = path.basename(path.dirname(databasePath));
  const homeName = path.basename(path.dirname(path.dirname(databasePath)));
  const homeLabel =
    homeName === ".t3"
      ? "T3 Code"
      : homeName === ".t3-local"
        ? "T3 Code Local"
        : homeName.replace(/^\./, "") || "T3 Code";
  return `${homeLabel} (${stateName === "dev" ? "Dev" : "Installed"})`;
}

function readSourceSummary(
  databasePath: string,
  path: Path.Path,
): Effect.Effect<T3ChatImportSource, T3ChatImportError> {
  return withReadOnlyDatabase(databasePath, (database) => {
    requireImportTables(database);
    const threadColumns = tableColumns(database, "projection_threads");
    const filter = threadColumns.has("deleted_at") ? "WHERE deleted_at IS NULL" : "";
    const row = database
      .prepare(`
        SELECT COUNT(*) AS threadCount, MAX(updated_at) AS latestUpdatedAt
        FROM projection_threads
        ${filter}
      `)
      .get() as SqliteRow;
    const threadCount = typeof row.threadCount === "number" ? row.threadCount : 0;
    const latestUpdatedAt =
      typeof row.latestUpdatedAt === "string" && isIsoDateTime(row.latestUpdatedAt)
        ? row.latestUpdatedAt
        : null;
    return {
      id: makeT3ChatImportId(databasePath),
      label: sourceLabel(databasePath, path),
      databasePath,
      threadCount,
      latestUpdatedAt,
    };
  });
}

export const discoverT3ChatImportSources = Effect.fn("discoverT3ChatImportSources")(
  function* (input: {
    readonly homeDir: string;
    readonly currentDbPath: string;
  }): Effect.fn.Return<T3ChatImportDiscoverResult, never, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const currentDbPath = path.resolve(input.currentDbPath);
    const currentBaseDir = path.dirname(path.dirname(currentDbPath));
    const homeEntries = yield* fileSystem
      .readDirectory(input.homeDir)
      .pipe(Effect.orElseSucceed(() => []));
    const baseDirs = new Set([
      currentBaseDir,
      ...homeEntries
        .filter((entry) => entry === ".t3" || entry.startsWith(".t3-"))
        .map((entry) => path.join(input.homeDir, entry)),
    ]);
    const candidates = Array.from(baseDirs).flatMap((baseDir) => [
      path.join(baseDir, "userdata", "state.sqlite"),
      path.join(baseDir, "dev", "state.sqlite"),
    ]);
    const sources = yield* Effect.forEach(candidates, (candidate) =>
      Effect.gen(function* () {
        const resolved = path.resolve(candidate);
        const exists = yield* fileSystem.exists(resolved).pipe(Effect.orElseSucceed(() => false));
        if (resolved === currentDbPath || !exists) return null;
        return yield* readSourceSummary(resolved, path).pipe(Effect.orElseSucceed(() => null));
      }),
    );

    return {
      sources: sources
        .filter((source): source is T3ChatImportSource => source !== null && source.threadCount > 0)
        .sort((left, right) => {
          const byLatest = (right.latestUpdatedAt ?? "").localeCompare(left.latestUpdatedAt ?? "");
          return byLatest !== 0 ? byLatest : left.label.localeCompare(right.label);
        }),
    };
  },
);

export interface T3ChatImportShape {
  readonly discover: Effect.Effect<T3ChatImportDiscoverResult, never>;
  readonly importSource: (
    input: T3ChatImportRunInput,
  ) => Effect.Effect<T3ChatImportRunResult, T3ChatImportError>;
}

function targetId(kind: string, databasePath: string, sourceId: string): string {
  return `${kind}-${makeT3ChatImportId(databasePath, sourceId).slice("t3-chat-import-".length)}`;
}

export const makeT3ChatImport = Effect.fn("makeT3ChatImport")(function* (options?: {
  readonly homeDir?: string;
}) {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const orchestration = yield* OrchestrationEngineService;
  const discover = discoverT3ChatImportSources({
    homeDir: options?.homeDir ?? NodeOS.homedir(),
    currentDbPath: config.dbPath,
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );

  const dispatch = (command: Parameters<typeof orchestration.dispatch>[0]) =>
    orchestration
      .dispatch(command)
      .pipe(Effect.mapError((cause) => importError("Could not save the imported chat.", cause)));

  const copyAttachments = Effect.fn("T3ChatImport.copyAttachments")(function* (
    databasePath: string,
    attachments: ReadonlyArray<ChatAttachment>,
  ) {
    const sourceDirectory = path.join(path.dirname(databasePath), "attachments");
    let copied = 0;
    let skipped = 0;
    const available: ChatAttachment[] = [];
    for (const attachment of attachments) {
      const relativePath = attachmentRelativePath(attachment);
      if (relativePath === null) {
        skipped += 1;
        continue;
      }
      const sourcePath = path.join(sourceDirectory, relativePath);
      const targetPath = path.join(config.attachmentsDir, relativePath);
      const exists = yield* fileSystem.exists(sourcePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        skipped += 1;
        continue;
      }
      const copiedFile = yield* fileSystem.copyFile(sourcePath, targetPath).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!copiedFile) {
        skipped += 1;
        continue;
      }
      copied += 1;
      available.push(attachment);
    }
    return { available, copied, skipped };
  });

  const importSource = Effect.fn("T3ChatImport.importSource")(function* (
    input: T3ChatImportRunInput,
  ): Effect.fn.Return<T3ChatImportRunResult, T3ChatImportError> {
    const sources = yield* discover;
    const source = sources.sources.find((candidate) => candidate.id === input.sourceId);
    if (!source) {
      return yield* importError("That T3 Code instance is no longer available.");
    }
    const snapshot = yield* readT3ChatImportSnapshot(source.databasePath);
    const projectsBySourceId = new Map(
      snapshot.projects.map((project) => [project.sourceId, project]),
    );

    for (const project of snapshot.projects) {
      const projectId = ProjectId.make(
        targetId("import-project", source.databasePath, project.sourceId),
      );
      yield* dispatch({
        type: "project.create",
        commandId: CommandId.make(
          targetId("server:t3-import-project", source.databasePath, project.sourceId),
        ),
        projectId,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        defaultModelSelection: project.defaultModelSelection,
        createdAt: project.createdAt,
      });
    }

    let messagesImported = 0;
    let attachmentsCopied = 0;
    let attachmentsSkipped = 0;
    for (const thread of snapshot.threads) {
      const project = projectsBySourceId.get(thread.projectSourceId);
      if (!project) continue;
      const projectId = ProjectId.make(
        targetId("import-project", source.databasePath, project.sourceId),
      );
      const threadId = ThreadId.make(
        targetId("import-thread", source.databasePath, thread.sourceId),
      );
      yield* dispatch({
        type: "thread.create",
        commandId: CommandId.make(
          targetId("server:t3-import-thread", source.databasePath, thread.sourceId),
        ),
        threadId,
        projectId,
        title: thread.title,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        createdAt: thread.createdAt,
      });

      for (const message of thread.messages) {
        const copied = yield* copyAttachments(source.databasePath, message.attachments);
        attachmentsCopied += copied.copied;
        attachmentsSkipped += copied.skipped;
        const messageId = MessageId.make(
          targetId("import-message", source.databasePath, message.sourceId),
        );
        yield* dispatch({
          type: "thread.message.import",
          commandId: CommandId.make(
            targetId("server:t3-import-message", source.databasePath, message.sourceId),
          ),
          threadId,
          message: {
            id: messageId,
            role: message.role,
            text: message.text,
            ...(copied.available.length > 0 ? { attachments: copied.available } : {}),
            turnId: null,
            streaming: false,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
          },
        });
        messagesImported += 1;
      }

      if (thread.archivedAt !== null) {
        yield* dispatch({
          type: "thread.archive",
          commandId: CommandId.make(
            targetId("server:t3-import-archive", source.databasePath, thread.sourceId),
          ),
          threadId,
        });
      }
    }

    return {
      projectsImported: snapshot.projects.length,
      threadsImported: snapshot.threads.length,
      messagesImported,
      attachmentsCopied,
      attachmentsSkipped,
    };
  });

  return { discover, importSource } satisfies T3ChatImportShape;
});
