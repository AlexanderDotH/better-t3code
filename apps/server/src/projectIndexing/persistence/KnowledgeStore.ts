// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  ProjectIndexCoverageV1,
  ProjectIndexSettings,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import {
  assertNoSymlinkPath,
  isWorkspaceRelativePath,
  prepareKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type KnowledgeWorkspace,
} from "../privacy/WorkspacePrivacy.ts";
import { makeKnowledgeJobs, type GuardWrite } from "./KnowledgeJobs.ts";
import { makeKnowledgeReads } from "./KnowledgeReads.ts";
import { makeKnowledgeSearch } from "./KnowledgeSearch.ts";
import { makeKnowledgePlanningReads } from "./KnowledgePlanningReads.ts";
import { makeKnowledgeCompilerReads } from "./KnowledgeCompilerReads.ts";
import { refreshKnowledgeModuleDependencies } from "./KnowledgeModuleDependencies.ts";
import { collectKnowledgeHistory } from "./KnowledgeRetention.ts";
import { putKnowledgeBatch, removeKnowledgeFiles } from "./KnowledgeRecords.ts";
import { resetKnowledgeFileStructure } from "./KnowledgeStructureReset.ts";
import {
  asStoreError,
  initializeStoreSchema,
  ensureKnowledgeQueryIndexes,
  ensureKnowledgeSearchIndex,
  KNOWLEDGE_STORE_OWNER,
  KNOWLEDGE_STORE_VERSION,
  KnowledgeStoreError,
  validateStoreSchema,
} from "./KnowledgeStoreSchema.ts";
import type { KnowledgeBatch, KnowledgeWriteGuard, WriterLease } from "./KnowledgeStoreTypes.ts";
import {
  clearGeneratedKnowledgeViews,
  generateKnowledgeViews,
  readKnowledgeManifest,
  writeKnowledgeFile,
  writeKnowledgeManifest,
  type KnowledgeManifest,
} from "./KnowledgeViews.ts";

export { KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";
export type * from "./KnowledgeStoreTypes.ts";

const DEFAULT_LEASE_TTL_MS = 30_000;
const leaseTtl = (value?: number) =>
  Math.max(100, Math.min(10 * 60_000, Math.floor(value ?? DEFAULT_LEASE_TTL_MS)));
const decodeCoverage = Schema.decodeEffect(ProjectIndexCoverageV1);
const encodeCoverage = Schema.encodeEffect(Schema.fromJsonString(ProjectIndexCoverageV1));
const decodeSettings = Schema.decodeEffect(ProjectIndexSettings);
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(ProjectIndexSettings));

type SqlLoader = {
  readonly layer: (options: {
    readonly filename: string;
    readonly readonly?: boolean;
  }) => Layer.Layer<SqlClient.SqlClient, SqlError>;
};

const openSql = Effect.fn("KnowledgeStore.openSql")(function* (
  filename: string,
  readonly: boolean,
) {
  const driver = yield* Effect.tryPromise({
    try: (): Promise<SqlLoader> =>
      process.versions.bun !== undefined
        ? import("@effect/sql-sqlite-bun/SqliteClient")
        : import("@t3tools/shared/nodeSqliteClient"),
    catch: asStoreError("load SQLite"),
  });
  const context = yield* Layer.build(driver.layer({ filename, readonly }));
  return Context.get(context, SqlClient.SqlClient);
});

const assertStoragePaths = (workspace: KnowledgeWorkspace) =>
  Effect.tryPromise({
    try: async () => {
      if ((await NodeFSP.realpath(workspace.workspaceRoot)) !== workspace.workspaceRoot)
        throw new KnowledgeStoreError({
          code: "workspace-moved",
          detail: "The effective workspace changed while indexing.",
        });
      for (const target of [
        workspace.databasePath,
        `${workspace.databasePath}-wal`,
        `${workspace.databasePath}-shm`,
        `${workspace.databasePath}-journal`,
      ])
        await assertNoSymlinkPath(workspace.workspaceRoot, target);
    },
    catch: asStoreError("validate private storage paths"),
  });

function makeKnowledgeStore(
  sql: SqlClient.SqlClient,
  workspace: KnowledgeWorkspace,
  readonly: boolean,
) {
  const reads = {
    ...makeKnowledgeReads(sql),
    ...makeKnowledgeSearch(sql),
    ...makeKnowledgePlanningReads(sql),
    ...makeKnowledgeCompilerReads(sql),
  };

  const writable = () =>
    readonly
      ? Effect.fail(
          new KnowledgeStoreError({
            code: "read-only",
            detail: "This knowledge handle is read-only.",
          }),
        )
      : assertStoragePaths(workspace);

  const checkLease = Effect.fn("KnowledgeStore.checkLease")(
    function* (lease: WriterLease, revision?: number, running = false) {
      const now = yield* Clock.currentTimeMillis;
      const rows = yield* sql<{
        revision: number;
        active_revision: number | null;
        status: string;
      }>`SELECT revision, active_revision, status FROM knowledge_state WHERE singleton = 1 AND lease_owner = ${lease.owner} AND lease_token = ${lease.token} AND lease_expires_at > ${now}`;
      const row = rows[0];
      if (!row)
        return yield* new KnowledgeStoreError({
          code: "lease-conflict",
          detail: "Another worker owns this workspace, or the indexing lease expired.",
        });
      if (revision !== undefined && row.revision !== revision)
        return yield* new KnowledgeStoreError({
          code: "revision-conflict",
          detail: "A newer indexing revision superseded this worker.",
        });
      if (running && (row.status !== "running" || row.active_revision !== revision))
        return yield* new KnowledgeStoreError({
          code: "generation-stopped",
          detail: "This indexing generation has been paused, cancelled, or completed.",
        });
    },
    Effect.mapError(asStoreError("check writer lease")),
  );

  const guardedTransaction = <A, E>(
    lease: WriterLease,
    revision: number | undefined,
    running: boolean,
    effect: Effect.Effect<A, E>,
  ) =>
    writable().pipe(
      Effect.andThen(
        sql.withTransaction(
          Effect.gen(function* () {
            // Take SQLite's writer lock before checking the lease, avoiding a read-to-write race.
            yield* sql`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1`;
            yield* checkLease(lease, revision, running);
            return yield* effect;
          }),
        ),
      ),
      Effect.mapError(asStoreError("write transaction")),
    );

  const guardWrite: GuardWrite = (input, effect) =>
    guardedTransaction(input.lease, input.revision, true, effect);
  const jobs = makeKnowledgeJobs(sql, workspace.workspaceRoot, guardWrite);

  const acquireLease = Effect.fn("KnowledgeStore.acquireLease")(function* (
    owner: string,
    ttlMs?: number,
  ): Effect.fn.Return<WriterLease, KnowledgeStoreError> {
    yield* writable();
    const now = yield* Clock.currentTimeMillis;
    const token = NodeCrypto.randomBytes(16).toString("hex");
    const expiresAt = now + leaseTtl(ttlMs);
    const rows = yield* sql<{
      lease_token: string;
    }>`UPDATE knowledge_state SET lease_owner = ${owner}, lease_token = ${token}, lease_expires_at = ${expiresAt} WHERE singleton = 1 AND (lease_token IS NULL OR lease_expires_at <= ${now}) RETURNING lease_token`.pipe(
      Effect.mapError(asStoreError("acquire writer lease")),
    );
    if (!rows[0])
      return yield* new KnowledgeStoreError({
        code: "lease-conflict",
        detail: "Another indexing worker currently owns this workspace.",
      });
    return { owner, token, expiresAt };
  });

  const renewLease = Effect.fn("KnowledgeStore.renewLease")(function* (
    lease: WriterLease,
    ttlMs?: number,
  ) {
    return yield* guardedTransaction(
      lease,
      undefined,
      false,
      Effect.gen(function* () {
        const expiresAt = (yield* Clock.currentTimeMillis) + leaseTtl(ttlMs);
        yield* sql`UPDATE knowledge_state SET lease_expires_at = ${expiresAt} WHERE singleton = 1`;
        return { ...lease, expiresAt };
      }),
    );
  });

  const releaseLease = Effect.fn("KnowledgeStore.releaseLease")(
    function* (lease: WriterLease) {
      yield* writable();
      yield* sql`UPDATE knowledge_state SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE singleton = 1 AND lease_owner = ${lease.owner} AND lease_token = ${lease.token}`;
    },
    Effect.mapError(asStoreError("release writer lease")),
  );

  const beginGeneration = Effect.fn("KnowledgeStore.beginGeneration")(function* (input: {
    readonly lease: WriterLease;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly copyPublished?: boolean;
  }) {
    return yield* guardedTransaction(
      input.lease,
      undefined,
      false,
      Effect.gen(function* () {
        const previous = yield* sql<{
          revision: number;
          status: string;
        }>`SELECT revision, status FROM knowledge_generations WHERE idempotency_key = ${input.idempotencyKey}`;
        if (previous[0]) return previous[0];
        const state = yield* reads.getState();
        if (state.revision !== input.expectedRevision)
          return yield* new KnowledgeStoreError({
            code: "revision-conflict",
            detail: "A newer indexing revision already exists.",
          });
        const revision = state.revision + 1;
        const now = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE knowledge_generations SET status = 'cancelled', updated_at = ${now} WHERE revision = ${state.activeRevision} AND status IN ('running', 'paused')`;
        yield* sql`UPDATE knowledge_jobs SET state = 'cancelled', claim_token = NULL, claim_lease_token = NULL, updated_at = ${now} WHERE revision = ${state.activeRevision} AND state IN ('pending', 'running')`;
        yield* sql`INSERT INTO knowledge_generations(revision, idempotency_key, status, created_at, updated_at) VALUES (${revision}, ${input.idempotencyKey}, 'running', ${now}, ${now})`;
        yield* sql`UPDATE knowledge_state SET revision = ${revision}, active_revision = ${revision}, status = 'running', updated_at = ${now} WHERE singleton = 1`;
        if (input.copyPublished !== false && state.publishedRevision !== null) {
          yield* sql`INSERT INTO knowledge_records SELECT ${revision}, kind, id, file_path, name, search_text, payload FROM knowledge_records WHERE revision = ${state.publishedRevision}`;
          yield* sql`INSERT INTO knowledge_calls SELECT ${revision}, callsite_id, caller_id, callee_id FROM knowledge_calls WHERE revision = ${state.publishedRevision}`;
          yield* sql`INSERT INTO knowledge_record_dependencies SELECT ${revision}, kind, id, file_path, entity_id FROM knowledge_record_dependencies WHERE revision = ${state.publishedRevision}`;
        }
        return { revision, status: "running" };
      }),
    );
  });

  const applyBatch = Effect.fn("KnowledgeStore.applyBatch")(function* (
    input: KnowledgeWriteGuard & {
      readonly batch: KnowledgeBatch;
      readonly removeFilePaths?: ReadonlyArray<string>;
      readonly resetStructuralFilePaths?: ReadonlyArray<string>;
    },
  ) {
    return yield* guardWrite(
      input,
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (input.removeFilePaths)
          yield* removeKnowledgeFiles(sql, input.revision, input.removeFilePaths, now);
        if (input.resetStructuralFilePaths)
          yield* resetKnowledgeFileStructure(sql, input.revision, input.resetStructuralFilePaths);
        yield* putKnowledgeBatch(sql, input.revision, input.batch);
        yield* sql`UPDATE knowledge_state SET updated_at = ${now} WHERE singleton = 1`;
        yield* sql`UPDATE knowledge_generations SET updated_at = ${now} WHERE revision = ${input.revision}`;
      }),
    );
  });

  const setGenerationMetadata = Effect.fn("KnowledgeStore.setGenerationMetadata")(function* (
    input: KnowledgeWriteGuard & {
      readonly coverage?: ProjectIndexCoverageV1;
      readonly metadataJson?: string;
    },
  ) {
    return yield* guardWrite(
      input,
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (input.coverage !== undefined) {
          const coverage = yield* decodeCoverage(input.coverage);
          const coverageJson = yield* encodeCoverage(coverage);
          yield* sql`UPDATE knowledge_generations SET coverage_json = ${coverageJson}, updated_at = ${now} WHERE revision = ${input.revision}`;
          yield* sql`UPDATE knowledge_state SET coverage_json = ${coverageJson}, updated_at = ${now} WHERE singleton = 1`;
        }
        if (input.metadataJson !== undefined) {
          if (input.metadataJson.length > 1_048_576)
            return yield* new KnowledgeStoreError({
              code: "metadata-limit",
              detail: "Generation metadata exceeds its size limit.",
            });
          yield* sql`UPDATE knowledge_generations SET metadata_json = ${input.metadataJson}, updated_at = ${now} WHERE revision = ${input.revision}`;
        }
      }),
    );
  });

  const refreshModuleDependencies = Effect.fn("KnowledgeStore.refreshModuleDependencies")(
    (input: KnowledgeWriteGuard) =>
      guardWrite(input, refreshKnowledgeModuleDependencies(sql, input.revision)),
  );

  const getGenerationMetadata = Effect.fn("KnowledgeStore.getGenerationMetadata")(
    (revision: number) =>
      sql<{
        metadata_json: string | null;
      }>`SELECT metadata_json FROM knowledge_generations WHERE revision = ${revision}`.pipe(
        Effect.map((rows) => rows[0]?.metadata_json ?? null),
        Effect.mapError(asStoreError("read generation metadata")),
      ),
  );

  const invalidateFiles = Effect.fn("KnowledgeStore.invalidateFiles")(function* (
    input: KnowledgeWriteGuard & { readonly filePaths: ReadonlyArray<string> },
  ) {
    return yield* guardWrite(
      input,
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        for (const filePath of new Set(input.filePaths)) {
          if (!isWorkspaceRelativePath(filePath))
            return yield* new KnowledgeStoreError({
              code: "private-source",
              detail: "Cannot invalidate private source paths.",
            });
          yield* sql`UPDATE knowledge_records SET payload = CASE WHEN kind = 'files' THEN json_set(payload, '$.status', 'stale') WHEN kind IN ('entities','callsites','imports','modules','behaviors','flows','rules') THEN json_set(payload, '$.freshness', 'stale') ELSE payload END WHERE revision = ${input.revision} AND EXISTS (SELECT 1 FROM knowledge_record_dependencies dependency WHERE dependency.revision = knowledge_records.revision AND dependency.kind = knowledge_records.kind AND dependency.id = knowledge_records.id AND dependency.file_path = ${filePath})`;
          yield* sql`UPDATE knowledge_jobs SET state = 'cancelled', claim_token = NULL, claim_lease_token = NULL, detail = 'Source changed', updated_at = ${now} WHERE revision = ${input.revision} AND file_path = ${filePath} AND state IN ('pending', 'running')`;
        }
        yield* sql`UPDATE knowledge_state SET updated_at = ${now} WHERE singleton = 1`;
      }),
    );
  });

  const writePublication = Effect.fn("KnowledgeStore.writePublication")(function* (
    manifest: KnowledgeManifest,
  ) {
    yield* writable();
    yield* writeKnowledgeFile(
      workspace,
      "INDEX.md",
      manifest.generationPath === null
        ? "# Project knowledge\n\nNo published knowledge is available.\n"
        : `# Project knowledge\n\n[Open revision ${manifest.publishedRevision}](./${manifest.generationPath}/INDEX.md).\n\nCanonical data is in \`knowledge.sqlite\`; generated views are advisory and may be stale.\n`,
    );
    yield* writeKnowledgeManifest(workspace, manifest);
  });

  const publishGeneration = Effect.fn("KnowledgeStore.publishGeneration")(function* (
    input: KnowledgeWriteGuard,
  ) {
    yield* writable();
    yield* checkLease(input.lease, input.revision, true);
    const manifest = yield* generateKnowledgeViews(
      sql,
      workspace,
      input.revision,
      input.lease.token,
      checkLease(input.lease, input.revision, true),
    );
    yield* guardWrite(
      input,
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE knowledge_generations SET status = 'completed', views_path = ${manifest.generationPath}, updated_at = ${now} WHERE revision = ${input.revision}`;
        yield* sql`UPDATE knowledge_state SET published_revision = ${input.revision}, active_revision = NULL, status = 'completed', updated_at = ${now} WHERE singleton = 1`;
        yield* writePublication(manifest);
      }),
    );
    yield* collectKnowledgeHistory(sql, workspace);
  });

  const stopGeneration = Effect.fn("KnowledgeStore.stopGeneration")(
    function* (revision: number, status: "paused" | "cancelled") {
      yield* writable();
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const rows = yield* sql<{
            revision: number;
          }>`UPDATE knowledge_state SET status = ${status}, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ${now} WHERE singleton = 1 AND revision = ${revision} AND active_revision = ${revision} RETURNING revision`;
          if (!rows[0])
            return yield* new KnowledgeStoreError({
              code: "revision-conflict",
              detail: "This generation is no longer active.",
            });
          yield* sql`UPDATE knowledge_generations SET status = ${status}, updated_at = ${now} WHERE revision = ${revision}`;
          yield* sql`UPDATE knowledge_jobs SET state = CASE WHEN ${status} = 'cancelled' THEN 'cancelled' WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, claim_token = NULL, claim_lease_token = NULL, updated_at = ${now} WHERE revision = ${revision} AND state IN ('pending', 'running')`;
        }),
      );
    },
    Effect.mapError(asStoreError("stop generation")),
  );

  const pauseGeneration = (revision: number) => stopGeneration(revision, "paused");
  const cancelGeneration = (revision: number) => stopGeneration(revision, "cancelled");

  const resumeGeneration = Effect.fn("KnowledgeStore.resumeGeneration")(function* (
    input: KnowledgeWriteGuard,
  ) {
    return yield* guardedTransaction(
      input.lease,
      input.revision,
      false,
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const rows = yield* sql<{
          revision: number;
        }>`UPDATE knowledge_generations SET status = 'running', updated_at = ${now} WHERE revision = ${input.revision} AND status IN ('paused', 'running') RETURNING revision`;
        if (!rows[0])
          return yield* new KnowledgeStoreError({
            code: "generation-stopped",
            detail: "This generation cannot be resumed; start a new generation.",
          });
        yield* sql`UPDATE knowledge_state SET active_revision = ${input.revision}, status = 'running', updated_at = ${now} WHERE singleton = 1`;
        yield* sql`UPDATE knowledge_jobs SET state = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, claim_token = NULL, claim_lease_token = NULL, updated_at = ${now} WHERE revision = ${input.revision} AND state = 'running'`;
      }),
    );
  });

  const setSettings = Effect.fn("KnowledgeStore.setSettings")(function* (
    settings: ProjectIndexSettings,
  ) {
    yield* writable();
    const checked = yield* decodeSettings(settings).pipe(
      Effect.mapError(asStoreError("validate settings")),
    );
    const settingsJson = yield* encodeSettings(checked).pipe(
      Effect.mapError(asStoreError("encode settings")),
    );
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* sql`UPDATE knowledge_state SET settings_json = ${settingsJson}, updated_at = ${now} WHERE singleton = 1`;
          if (!checked.enabled) {
            yield* sql`UPDATE knowledge_generations SET status = 'paused', updated_at = ${now} WHERE revision = (SELECT active_revision FROM knowledge_state WHERE singleton = 1) AND status = 'running'`;
            yield* sql`UPDATE knowledge_jobs SET state = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, claim_token = NULL, claim_lease_token = NULL, updated_at = ${now} WHERE revision = (SELECT active_revision FROM knowledge_state WHERE singleton = 1) AND state = 'running'`;
            yield* sql`UPDATE knowledge_state SET status = CASE WHEN status = 'running' THEN 'paused' ELSE status END, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL WHERE singleton = 1`;
          }
          return checked;
        }),
      )
      .pipe(Effect.mapError(asStoreError("save settings")));
  });
  const getSettings = () => reads.getState().pipe(Effect.map((state) => state.settings));

  const clear = Effect.fn("KnowledgeStore.clear")(function* () {
    yield* writable();
    const manifest = yield* readKnowledgeManifest(workspace);
    if (!manifest)
      return yield* new KnowledgeStoreError({
        code: "unowned-store",
        detail: "Cannot clear knowledge without a valid ownership manifest.",
      });
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const state = yield* sql<{
            lease_expires_at: number | null;
          }>`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1 RETURNING lease_expires_at`;
          if ((state[0]?.lease_expires_at ?? 0) > now)
            return yield* new KnowledgeStoreError({
              code: "lease-conflict",
              detail: "Pause the active indexing worker before clearing its knowledge.",
            });
          yield* clearGeneratedKnowledgeViews(sql, workspace);
          yield* sql`DELETE FROM knowledge_calls`;
          yield* sql`DELETE FROM knowledge_record_dependencies`;
          yield* sql`DELETE FROM knowledge_generations`;
          yield* sql`UPDATE knowledge_state SET revision = revision + 1, published_revision = NULL, active_revision = NULL, status = 'cleared', settings_json = json_set(settings_json, '$.enabled', json('false')), coverage_json = NULL, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ${now} WHERE singleton = 1`;
          yield* writePublication({
            owner: KNOWLEDGE_STORE_OWNER,
            schemaVersion: KNOWLEDGE_STORE_VERSION,
            workspaceId: workspace.workspaceId,
            publishedRevision: null,
            generationPath: null,
          });
        }),
      )
      .pipe(Effect.mapError(asStoreError("clear knowledge")));
  });

  return {
    ...reads,
    ...jobs,
    workspace,
    acquireLease,
    renewLease,
    releaseLease,
    beginGeneration,
    applyBatch,
    setGenerationMetadata,
    refreshModuleDependencies,
    getGenerationMetadata,
    invalidateFiles,
    publishGeneration,
    pauseGeneration,
    cancelGeneration,
    resumeGeneration,
    getSettings,
    setSettings,
    clear,
    writePublication,
  };
}

export type KnowledgeStore = ReturnType<typeof makeKnowledgeStore>;

const openStore = Effect.fn("KnowledgeStore.open")(
  function* (input: { readonly workspaceRoot: string; readonly readonly: boolean }) {
    const workspace = yield* (
      input.readonly
        ? resolveKnowledgeWorkspace(input.workspaceRoot)
        : prepareKnowledgeWorkspace(input.workspaceRoot)
    ).pipe(Effect.mapError(asStoreError("prepare workspace")));
    yield* assertStoragePaths(workspace);
    const exists = yield* Effect.tryPromise({
      try: () =>
        NodeFSP.stat(workspace.databasePath)
          .then(() => true)
          .catch((cause: unknown) => {
            if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
            throw cause;
          }),
      catch: asStoreError("locate database"),
    });
    const manifest = yield* readKnowledgeManifest(workspace);
    if (input.readonly && !exists) {
      if (manifest?.publishedRevision != null)
        return yield* new KnowledgeStoreError({
          code: "corrupt-store",
          detail:
            "The owned knowledge store is missing its database. Existing generated files were preserved.",
        });
      return null;
    }
    if (!exists) {
      if (manifest?.publishedRevision != null)
        return yield* new KnowledgeStoreError({
          code: "corrupt-store",
          detail:
            "The owned knowledge store is missing its database. Existing generated files were preserved.",
        });
      const hasIndex = yield* Effect.tryPromise({
        try: () =>
          NodeFSP.lstat(`${workspace.knowledgeRoot}/INDEX.md`)
            .then(() => true)
            .catch((cause: unknown) => {
              if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
                return false;
              throw cause;
            }),
        catch: asStoreError("check generated view ownership"),
      });
      if (hasIndex && manifest === null)
        return yield* new KnowledgeStoreError({
          code: "unowned-store",
          detail:
            "An existing INDEX.md has no ownership manifest. Project indexing preserved the file.",
        });
      // Establish ownership before SQLite creates its file, so an interrupted first
      // initialization can recover without accepting an unrelated empty database.
      if (manifest === null)
        yield* writeKnowledgeManifest(workspace, {
          owner: KNOWLEDGE_STORE_OWNER,
          schemaVersion: KNOWLEDGE_STORE_VERSION,
          workspaceId: workspace.workspaceId,
          publishedRevision: null,
          generationPath: null,
        });
    }
    const sql = yield* openSql(workspace.databasePath, input.readonly).pipe(
      Effect.mapError(asStoreError("open database")),
    );
    yield* sql`PRAGMA busy_timeout = 5000`.pipe(
      Effect.mapError(asStoreError("configure database")),
    );
    // A full SQLite integrity scan blocks the server event loop on large indexes.
    // Validate ownership here; normal reads and writes surface storage errors.
    const initialized = yield* validateStoreSchema(
      sql,
      !input.readonly && (!exists || manifest?.publishedRevision === null),
    ).pipe(Effect.mapError(asStoreError("validate database")));
    if (!input.readonly) {
      yield* sql`PRAGMA foreign_keys = ON`;
      yield* sql`PRAGMA journal_mode = WAL`;
      if (!initialized)
        yield* initializeStoreSchema(
          sql,
          workspace.workspaceId,
          yield* encodeSettings(DEFAULT_PROJECT_INDEX_SETTINGS),
          yield* Clock.currentTimeMillis,
        );
    }
    const store = makeKnowledgeStore(sql, workspace, input.readonly);
    const state = yield* store.getState();
    if (state.workspaceId !== workspace.workspaceId)
      return yield* new KnowledgeStoreError({
        code: "workspace-mismatch",
        detail: "The knowledge database belongs to a different effective workspace.",
      });
    if (!input.readonly) {
      yield* ensureKnowledgeQueryIndexes(sql);
      yield* ensureKnowledgeSearchIndex(sql);
    }
    if (
      !input.readonly &&
      (manifest === null || manifest.publishedRevision !== state.publishedRevision)
    ) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE knowledge_state SET updated_at = updated_at WHERE singleton = 1`;
          const current = yield* store.getState();
          const rows =
            current.publishedRevision === null
              ? []
              : yield* sql<{
                  views_path: string | null;
                }>`SELECT views_path FROM knowledge_generations WHERE revision = ${current.publishedRevision}`;
          yield* store.writePublication({
            owner: KNOWLEDGE_STORE_OWNER,
            schemaVersion: KNOWLEDGE_STORE_VERSION,
            workspaceId: workspace.workspaceId,
            publishedRevision: current.publishedRevision,
            generationPath: rows[0]?.views_path ?? null,
          });
        }),
      );
    }
    if (!input.readonly) yield* collectKnowledgeHistory(sql, workspace);
    return store;
  },
  Effect.mapError(asStoreError("open knowledge store")),
);

export const openKnowledgeStore = Effect.fn("openKnowledgeStore")(function* (input: {
  readonly workspaceRoot: string;
}): Effect.fn.Return<KnowledgeStore, KnowledgeStoreError, Scope.Scope> {
  const store = yield* openStore({ ...input, readonly: false });
  if (store === null)
    return yield* new KnowledgeStoreError({
      code: "storage-failed",
      detail: "The knowledge store could not be created.",
    });
  return store;
});

export const openExistingKnowledgeStore = (input: { readonly workspaceRoot: string }) =>
  openStore({ ...input, readonly: true });
