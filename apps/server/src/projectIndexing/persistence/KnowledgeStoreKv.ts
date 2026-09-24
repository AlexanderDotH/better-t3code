// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { RocksDatabase, Transaction } from "@harperfast/rocksdb-js";
import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  ProjectIndexCoverageV1,
  ProjectIndexSettings,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import {
  kvKey,
  kvKeyText,
  kvStringPrefix,
  openKnowledgeKvDatabase,
  scanKvPrefix,
} from "../../knowledge/KvKeys.ts";
import {
  assertNoSymlinkPath,
  isSafeProjectSourcePath,
  isWorkspaceRelativePath,
  prepareKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type KnowledgeWorkspace,
} from "../privacy/WorkspacePrivacy.ts";
import {
  countKvRecords,
  getKvCounter,
  getKvRecord,
  indexedRecordIds,
  putKvRecord,
  removeKvRecord,
  recordsForDependencyPath,
  recordsForDependencyPrefix,
  recordsForSourcePath,
  scanKvRecords,
  searchKvRecordIds,
  type StoredRecord,
} from "./KnowledgeKvData.ts";
import { boundedPageSize } from "./KnowledgeReads.ts";
import {
  clearKnowledgeJobs,
  ensureKnowledgeJobIndexes,
  knowledgeJobKey as jobKey,
  putKnowledgeJob,
  scanKnowledgeJobs,
  summarizeKnowledgeJobs,
  type StoredKnowledgeJob as StoredJob,
} from "./KnowledgeJobIndexes.ts";
import { validateKnowledgeJobSource } from "./KnowledgeJobSource.ts";
import { searchTerms } from "./KnowledgeSearch.ts";
import { retireLegacyKnowledgeSqlite } from "./KnowledgeLegacyRetirement.ts";
import {
  decodeRecord,
  recordCodec,
  recordEntityIds,
  recordFilePath,
  recordId,
  recordName,
} from "./KnowledgeRecords.ts";
import {
  KNOWLEDGE_STORE_OWNER,
  KNOWLEDGE_STORE_VERSION,
  KnowledgeStoreError,
} from "./KnowledgeStoreSchema.ts";
import {
  readKnowledgeManifest,
  removeOwnedKnowledgeArtifact,
  writeKnowledgeFile,
  writeKnowledgeManifest,
  type KnowledgeManifest,
} from "./KnowledgeViews.ts";
import type {
  KnowledgeBatch,
  KnowledgeCallQuery,
  KnowledgeGenerationStatus,
  KnowledgeJob,
  KnowledgeJobInput,
  KnowledgeJobKind,
  KnowledgeJobState,
  KnowledgePage,
  KnowledgeRecordKind,
  KnowledgeRecordMap,
  KnowledgeRecordQuery,
  KnowledgeSearchHit,
  KnowledgeSearchKind,
  KnowledgeSearchPage,
  KnowledgeSearchQuery,
  KnowledgeStoreState,
  KnowledgeWriteGuard,
  WriterLease,
} from "./KnowledgeStoreTypes.ts";
import { KNOWLEDGE_RECORD_KINDS, KNOWLEDGE_SEARCH_KINDS } from "./KnowledgeStoreTypes.ts";

const KV_SCHEMA_VERSION = 1;
const decodeCoverage = Schema.decodeSync(ProjectIndexCoverageV1);
const decodeSettings = Schema.decodeSync(ProjectIndexSettings);
const META_KEY = kvKey("meta", "state");
const generationKey = (revision: number) => kvKey("generation", String(revision).padStart(12, "0"));
const idempotencyKey = (key: string) => kvKey("idempotency", key);
const jobIdempotencyKey = (key: string) => kvKey("job-idempotency", key);
const DEFAULT_LEASE_TTL_MS = 30_000;
const RETAINED_GENERATIONS = 3;

interface KvState extends KnowledgeStoreState {
  readonly schemaVersion: number;
  readonly lease: WriterLease | null;
}

interface KvGeneration {
  readonly revision: number;
  readonly idempotencyKey: string;
  readonly status: KnowledgeGenerationStatus;
  readonly metadataJson: string | null;
  readonly coverage: ProjectIndexCoverageV1 | null;
  readonly viewsPath: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const isStoreError = Schema.is(KnowledgeStoreError);
function storeError(operation: string, cause: unknown): KnowledgeStoreError {
  return isStoreError(cause)
    ? cause
    : new KnowledgeStoreError({ code: "storage-failed", detail: `${operation} failed.`, cause });
}
function fail(code: string, detail: string): never {
  throw new KnowledgeStoreError({ code, detail });
}
function run<A>(operation: string, task: () => Promise<A>) {
  return Effect.tryPromise({ try: task, catch: (cause) => storeError(operation, cause) });
}
function leaseTtl(value?: number) {
  return Math.max(100, Math.min(10 * 60_000, Math.floor(value ?? DEFAULT_LEASE_TTL_MS)));
}
function publicState(state: KvState): KnowledgeStoreState {
  const { schemaVersion: _, lease: __, ...publicFields } = state;
  return publicFields;
}
function metadataPath(workspace: KnowledgeWorkspace) {
  return NodePath.join(workspace.knowledgeRoot, "knowledge.rocksdb");
}
function revisionPath(workspace: KnowledgeWorkspace, revision: number) {
  return NodePath.join(workspace.knowledgeRoot, "kv-generations", String(revision));
}
async function getState(meta: RocksDatabase | Transaction): Promise<KvState> {
  const state = (await meta.get(META_KEY)) as KvState | undefined;
  if (!state || state.schemaVersion !== KV_SCHEMA_VERSION)
    fail("corrupt-store", "The project knowledge KV store has an unsupported state.");
  return state;
}
async function getGeneration(meta: RocksDatabase | Transaction, revision: number) {
  return (await meta.get(generationKey(revision))) as KvGeneration | undefined;
}
function makeKnowledgeKvStore(
  meta: RocksDatabase,
  workspace: KnowledgeWorkspace,
  readonly: boolean,
  databases: Map<number, RocksDatabase>,
  clock: Clock.Clock,
) {
  const nowMillis = () => Effect.runPromise(clock.currentTimeMillis);
  // Checkpoints, lease heartbeats, and settings share metadata but run independently.
  const writeMetadata = <A>(write: (transaction: Transaction) => Promise<A>) =>
    meta.transaction(write, { retryOnBusy: true });
  const checkLease = async (
    state: KvState,
    lease: WriterLease,
    revision?: number,
    running = false,
  ) => {
    if (
      state.lease?.owner !== lease.owner ||
      state.lease.token !== lease.token ||
      state.lease.expiresAt <= (await nowMillis())
    )
      fail("lease-conflict", "Another worker owns this workspace, or the indexing lease expired.");
    if (revision !== undefined && state.revision !== revision)
      fail("revision-conflict", "A newer indexing revision superseded this worker.");
    if (running && (state.status !== "running" || state.activeRevision !== revision))
      fail(
        "generation-stopped",
        "This indexing generation has been paused, cancelled, or completed.",
      );
  };
  const writable = () => {
    if (readonly) fail("read-only", "This knowledge handle is read-only.");
  };
  const revisionDatabase = async (revision: number) => {
    const existing = databases.get(revision);
    if (existing) {
      if (!readonly) await ensureKnowledgeJobIndexes(existing);
      return existing;
    }
    const path = revisionPath(workspace, revision);
    await assertNoSymlinkPath(workspace.workspaceRoot, path);
    const stat = await NodeFSP.stat(path).catch((cause: unknown) => {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
      throw cause;
    });
    if (!stat?.isDirectory()) fail("corrupt-store", "The selected knowledge revision is missing.");
    const database = openKnowledgeKvDatabase(path, { readOnly: readonly });
    databases.set(revision, database);
    if (!readonly) await ensureKnowledgeJobIndexes(database);
    return database;
  };
  const readRevision = async (requested?: number) => {
    const state = await getState(meta);
    const revision = requested ?? state.publishedRevision ?? 0;
    if (revision === 0) return 0;
    const generation = await getGeneration(meta, revision);
    if (
      !generation ||
      !(
        generation.viewsPath !== null ||
        state.activeRevision === revision ||
        (state.revision === revision && state.lease !== null)
      )
    )
      fail(
        "revision-conflict",
        "This knowledge revision is no longer available. Restart the query.",
      );
    return revision;
  };
  const guardedWrite = async <A>(
    input: KnowledgeWriteGuard,
    task: (db: RocksDatabase) => Promise<A>,
  ) => {
    writable();
    const state = await getState(meta);
    await checkLease(state, input.lease, input.revision, true);
    const db = await revisionDatabase(input.revision);
    return task(db);
  };
  const getStateEffect = () => run("read state", async () => publicState(await getState(meta)));
  const getCoverage = (revision: number) =>
    run(
      "read coverage",
      async () => (await getGeneration(meta, await readRevision(revision)))?.coverage ?? null,
    );
  const isStaticRevision = (revision: number) =>
    run("read knowledge format", async () => {
      const generation = await getGeneration(meta, await readRevision(revision));
      if (!generation?.metadataJson) return false;
      return (
        (JSON.parse(generation.metadataJson) as { knowledgeFormat?: string }).knowledgeFormat ===
        "static-v1"
      );
    });

  const acquireLease = (owner: string, ttlMs?: number) =>
    run("acquire writer lease", async () => {
      writable();
      const now = await nowMillis();
      const lease: WriterLease = {
        owner,
        token: NodeCrypto.randomBytes(16).toString("hex"),
        expiresAt: now + leaseTtl(ttlMs),
      };
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        if (state.lease && state.lease.expiresAt > now)
          fail("lease-conflict", "Another indexing worker currently owns this workspace.");
        await transaction.put(META_KEY, { ...state, lease, updatedAt: now });
      });
      return lease;
    });
  const renewLease = (lease: WriterLease, ttlMs?: number) =>
    run("renew writer lease", async () => {
      writable();
      const expiresAt = (await nowMillis()) + leaseTtl(ttlMs);
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        await checkLease(state, lease);
        await transaction.put(META_KEY, { ...state, lease: { ...lease, expiresAt } });
      });
      return { ...lease, expiresAt };
    });
  const releaseLease = (lease: WriterLease) =>
    run("release writer lease", async () => {
      writable();
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        if (state.lease?.owner === lease.owner && state.lease.token === lease.token)
          await transaction.put(META_KEY, { ...state, lease: null });
      });
      return undefined;
    });

  const beginGeneration = (input: {
    readonly lease: WriterLease;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly copyPublished?: boolean;
  }) =>
    run("begin generation", async () => {
      writable();
      const existingRevision = (await meta.get(idempotencyKey(input.idempotencyKey))) as
        | number
        | undefined;
      if (existingRevision !== undefined) {
        const generation = await getGeneration(meta, existingRevision);
        if (generation) return { revision: generation.revision, status: generation.status };
      }
      const current = await getState(meta);
      await checkLease(current, input.lease);
      if (current.revision !== input.expectedRevision)
        fail("revision-conflict", "A newer indexing revision already exists.");
      const revision = current.revision + 1;
      const path = revisionPath(workspace, revision);
      await assertNoSymlinkPath(workspace.workspaceRoot, path);
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
      if (current.publishedRevision !== null && input.copyPublished !== false) {
        const source = await revisionDatabase(current.publishedRevision);
        await source.createCheckpoint(path);
      } else {
        await NodeFSP.mkdir(path, { recursive: false, mode: 0o700 });
      }
      const database = openKnowledgeKvDatabase(path);
      databases.set(revision, database);
      // Jobs are generation-specific; a checkpoint carries only facts and indexes.
      await clearKnowledgeJobs(database);
      const now = await nowMillis();
      const generation: KvGeneration = {
        revision,
        idempotencyKey: input.idempotencyKey,
        status: "running",
        metadataJson: null,
        coverage: null,
        viewsPath: null,
        createdAt: now,
        updatedAt: now,
      };
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        await checkLease(state, input.lease);
        if (state.revision !== input.expectedRevision)
          fail("revision-conflict", "A newer indexing revision already exists.");
        if (state.activeRevision !== null) {
          const old = await getGeneration(transaction, state.activeRevision);
          if (old)
            await transaction.put(generationKey(old.revision), {
              ...old,
              status: "cancelled",
              updatedAt: now,
            });
        }
        await transaction.put(generationKey(revision), generation);
        await transaction.put(idempotencyKey(input.idempotencyKey), revision);
        await transaction.put(META_KEY, {
          ...state,
          revision,
          activeRevision: revision,
          status: "running",
          coverage: null,
          updatedAt: now,
        });
      });
      return { revision, status: "running" as const };
    });

  const prepareStoredRecord = async <Kind extends KnowledgeRecordKind>(
    kind: Kind,
    candidate: KnowledgeRecordMap[Kind],
    db: RocksDatabase | Transaction,
    revision: number,
  ): Promise<StoredRecord> => {
    const record = await Effect.runPromise(recordCodec(kind).decode(candidate));
    if (
      (kind === "modules" || kind === "behaviors" || kind === "flows" || kind === "rules") &&
      "provenance" in record &&
      record.provenance === "llm"
    ) {
      if (
        !("analysis" in record) ||
        record.analysis === undefined ||
        record.analysis.sourceRevision !== revision ||
        record.evidenceIds.length === 0
      )
        fail(
          "invalid-analysis",
          "Model-generated knowledge requires current revision metadata and source evidence.",
        );
    }
    const id = recordId(record);
    const filePath = recordFilePath(record);
    const filePaths = new Set([
      ...(filePath ? [filePath] : []),
      ...("filePaths" in record ? record.filePaths : []),
      ...("configDependencies" in record ? record.configDependencies : []),
      ...("targetPath" in record && record.targetPath ? [record.targetPath] : []),
    ]);
    const exclusionMetadata =
      (kind === "files" &&
        "path" in record &&
        record.contentHash === "unread" &&
        record.bytes === 0 &&
        record.configDependencies.length === 0 &&
        (record.status === "skipped" ||
          record.status === "stale" ||
          record.status === "deleted")) ||
      (kind === "gaps" && "kind" in record && record.kind === "excluded");
    if (
      [...filePaths].some(
        (path) =>
          !(exclusionMetadata ? isWorkspaceRelativePath(path) : isSafeProjectSourcePath(path)),
      )
    )
      fail(
        "private-source",
        "Private or out-of-workspace source paths cannot enter project knowledge.",
      );
    if ("sourceHash" in record) {
      const source = await getKvRecord(db, "files", record.filePath);
      if (kind === "imports" && !source)
        fail("stale-source", "An import has no indexed source file for its source hash.");
      if (
        source &&
        (JSON.parse(source.payload) as { contentHash: string }).contentHash !== record.sourceHash
      )
        fail("stale-source", "An indexing result refers to an outdated source hash.");
    }
    const entityIds = [...new Set(recordEntityIds(record))];
    const evidenceIds = "evidenceIds" in record ? [...new Set(record.evidenceIds)] : [];
    for (const entityId of entityIds) {
      const entity = await getKvRecord(db, "entities", entityId);
      filePaths.add(entity?.filePath ?? filePath ?? "");
    }
    if ("evidenceIds" in record) {
      const evidenceIds = new Set([
        ...record.evidenceIds,
        ...("steps" in record ? record.steps.flatMap((step) => step.evidenceIds) : []),
      ]);
      for (const evidenceId of evidenceIds) {
        const evidence = await getKvRecord(db, "evidence", evidenceId);
        if (evidence?.filePath) filePaths.add(evidence.filePath);
      }
    }
    const name = recordName(record);
    const searchText = [
      name,
      filePath ?? "",
      "qualifiedName" in record ? record.qualifiedName : "",
      "signature" in record ? (record.signature ?? "") : "",
      "packageName" in record ? (record.packageName ?? "") : "",
      "summary" in record ? record.summary : "",
      "description" in record ? record.description : "",
      ...("inputs" in record ? record.inputs : []),
      ...("outputs" in record ? record.outputs : []),
      ...("errorPaths" in record ? record.errorPaths : []),
      ...("invariants" in record ? record.invariants : []),
      ...("sideEffects" in record ? record.sideEffects : []),
    ]
      .join("\n")
      .toLowerCase();
    return {
      kind,
      id,
      filePath,
      name,
      searchText,
      payload: await Effect.runPromise(recordCodec(kind).encodeJson(record)),
      dependencyPaths: [...filePaths],
      entityIds,
      evidenceIds,
      calls:
        kind === "callsites" && "targetEntityIds" in record
          ? record.targetEntityIds.length > 0
            ? record.targetEntityIds.map((calleeId) => ({
                callerId: record.callerEntityId ?? "",
                calleeId,
              }))
            : record.callerEntityId
              ? [{ callerId: record.callerEntityId, calleeId: "" }]
              : []
          : [],
    };
  };

  const writeBatch = async (transaction: Transaction, revision: number, batch: KnowledgeBatch) => {
    for (const kind of KNOWLEDGE_RECORD_KINDS) {
      for (const candidate of batch[kind] ?? []) {
        const record = await prepareStoredRecord(kind, candidate, transaction, revision);
        await putKvRecord(transaction, record);
      }
    }
    for (const callsite of batch.callsites ?? []) {
      if (callsite.provenance !== "compiler" || callsite.resolution === "unresolved") continue;
      const gap = await getKvRecord(transaction, "gaps", `gap:${callsite.id}`);
      if (
        gap?.filePath === callsite.filePath &&
        (JSON.parse(gap.payload) as { kind: string }).kind === "unresolved-call"
      )
        await removeKvRecord(transaction, "gaps", `gap:${callsite.id}`);
    }
  };

  const removeFiles = async (transaction: Transaction, filePaths: ReadonlyArray<string>) => {
    for (const path of new Set(filePaths)) {
      if (!isWorkspaceRelativePath(path))
        fail("private-source", "Cannot remove knowledge for an out-of-workspace path.");
      const records = new Map<string, StoredRecord>();
      for (const record of await recordsForSourcePath(transaction, path))
        records.set(kvKey(record.kind, record.id), record);
      for (const record of await recordsForDependencyPath(transaction, path))
        records.set(kvKey(record.kind, record.id), record);
      for (const record of records.values())
        await removeKvRecord(transaction, record.kind, record.id);
    }
  };

  const applyBatch = (
    input: KnowledgeWriteGuard & {
      readonly batch: KnowledgeBatch;
      readonly removeFilePaths?: ReadonlyArray<string>;
      readonly resetStructuralFilePaths?: ReadonlyArray<string>;
    },
  ) =>
    run("write knowledge batch", async () =>
      guardedWrite(input, async (db) => {
        await db.transaction(async (transaction) => {
          if (input.removeFilePaths) await removeFiles(transaction, input.removeFilePaths);
          if (input.resetStructuralFilePaths)
            await resetFileStructure(transaction, input.resetStructuralFilePaths);
          await writeBatch(transaction, input.revision, input.batch);
        });
        await touchGeneration(input.revision);
        return undefined;
      }),
    );

  const touchGeneration = async (revision: number) => {
    const generation = await getGeneration(meta, revision);
    if (generation)
      await meta.put(generationKey(revision), { ...generation, updatedAt: await nowMillis() });
  };

  const resetFileStructure = async (transaction: Transaction, paths: ReadonlyArray<string>) => {
    if (paths.length > 128 || paths.some((path) => !isSafeProjectSourcePath(path)))
      fail("invalid-reset", "Structural reset accepts at most 128 readable source paths.");
    const selected = new Map<string, StoredRecord>();
    for (const path of paths) {
      const file = await getKvRecord(transaction, "files", path);
      if (file) {
        const value = JSON.parse(file.payload) as { status: string; contentHash: string };
        if (["skipped", "deleted"].includes(value.status) || value.contentHash === "unread")
          fail(
            "invalid-reset",
            "Remove knowledge for deleted or excluded files instead of retaining their descriptions.",
          );
        await putKvRecord(transaction, {
          ...file,
          payload: JSON.stringify({ ...value, status: "pending" }),
        });
      }
      for (const record of await recordsForSourcePath(transaction, path)) {
        if (["entities", "callsites", "imports", "evidence", "gaps"].includes(record.kind))
          selected.set(kvKey(record.kind, record.id), record);
      }
      for (const record of await recordsForDependencyPath(transaction, path)) {
        const payload = JSON.parse(record.payload) as { provenance?: string; source?: string };
        if (
          ["imports", "callsites"].includes(record.kind) ||
          (record.kind === "modules" && payload.provenance === "parser")
        )
          selected.set(kvKey(record.kind, record.id), record);
      }
      for (const evidence of (await recordsForSourcePath(transaction, path)).filter(
        (record) => record.kind === "evidence",
      )) {
        for (const ruleId of await indexedRecordIds(transaction, "rule-evidence", evidence.id)) {
          const rule = await getKvRecord(transaction, "rules", ruleId);
          if (!rule) continue;
          const payload = JSON.parse(rule.payload) as { provenance?: string; source?: string };
          if (payload.provenance === "parser" && payload.source === "explicit")
            selected.set(kvKey(rule.kind, rule.id), rule);
        }
      }
    }
    for (const record of selected.values()) {
      await removeKvRecord(transaction, record.kind, record.id);
      if (record.kind === "callsites")
        await removeKvRecord(transaction, "gaps", `gap:${record.id}`);
    }
  };

  const listRecords = <Kind extends KnowledgeRecordKind>(input: KnowledgeRecordQuery<Kind>) =>
    run("query records", async (): Promise<KnowledgePage<KnowledgeRecordMap[Kind]>> => {
      const revision = await readRevision(input.revision);
      if (revision === 0) return { revision, items: [], nextCursor: null };
      const db = await revisionDatabase(revision);
      const limit = boundedPageSize(input.limit);
      if (
        input.ids?.length === 0 ||
        input.entityIds?.length === 0 ||
        input.filePathPrefixes?.length === 0
      )
        return { revision, items: [], nextCursor: null };
      if (
        (input.ids?.length ?? 0) > 200 ||
        (input.entityIds?.length ?? 0) > 200 ||
        (input.filePathPrefixes?.length ?? 0) > 32 ||
        (input.fileStatuses?.length ?? 0) > 16 ||
        (input.fileClassifications?.length ?? 0) > 16
      )
        fail("query-limit", "The record query has too many filter values.");
      const matches = (record: StoredRecord) => {
        if (
          record.id <= (input.afterId ?? "") ||
          (input.query && !record.searchText.includes(input.query.slice(0, 2048).toLowerCase())) ||
          (input.sourceFilePath !== undefined && record.filePath !== input.sourceFilePath) ||
          (input.filePath &&
            !record.dependencyPaths.includes(input.filePath) &&
            input.kind !== "callsites") ||
          (input.entityIds && !input.entityIds.some((id) => record.entityIds.includes(id))) ||
          (input.filePathPrefixes &&
            !input.filePathPrefixes.some((prefix) =>
              record.dependencyPaths.some(
                (path) =>
                  path === prefix.replace(/\/+$/u, "") ||
                  path.startsWith(`${prefix.replace(/\/+$/u, "")}/`),
              ),
            ))
        )
          return false;
        const payload = JSON.parse(record.payload) as { status?: string; classification?: string };
        return (
          (!input.fileStatuses || input.fileStatuses.includes(payload.status as never)) &&
          (!input.fileClassifications ||
            input.fileClassifications.includes(payload.classification as never))
        );
      };
      if (
        !input.ids &&
        input.sourceFilePath === undefined &&
        !input.filePath &&
        !input.entityIds &&
        !input.filePathPrefixes
      ) {
        const page: StoredRecord[] = [];
        for await (const record of scanKvRecords(db, input.kind, input.afterId)) {
          if (!matches(record)) continue;
          page.push(record);
          if (page.length > limit) break;
        }
        const items = await Promise.all(
          page
            .slice(0, limit)
            .map((record) => Effect.runPromise(decodeRecord(input.kind, record.payload))),
        );
        return { revision, items, nextCursor: page.length > limit ? page[limit - 1]!.id : null };
      }
      const candidates: StoredRecord[] = [];
      if (input.ids) {
        for (const id of input.ids) {
          const record = await getKvRecord(db, input.kind, id);
          if (record) candidates.push(record);
        }
      } else if (input.sourceFilePath !== undefined) {
        for (const record of await recordsForSourcePath(db, input.sourceFilePath))
          if (record.kind === input.kind) candidates.push(record);
      } else if (input.filePath) {
        for (const record of await recordsForDependencyPath(db, input.filePath))
          if (record.kind === input.kind) candidates.push(record);
        if (input.kind === "callsites") {
          const targets = await recordsForSourcePath(db, input.filePath);
          for (const target of targets.filter((record) => record.kind === "entities")) {
            for (const id of await indexedRecordIds(db, "c", "callee", target.id)) {
              const record = await getKvRecord(db, "callsites", id);
              if (record) candidates.push(record);
            }
          }
        }
      } else if (input.entityIds) {
        for (const entityId of input.entityIds) {
          for (const id of await indexedRecordIds(db, "e", entityId, input.kind)) {
            const record = await getKvRecord(db, input.kind, id);
            if (record) candidates.push(record);
          }
        }
      } else if (input.filePathPrefixes) {
        for (const prefix of input.filePathPrefixes)
          candidates.push(...(await recordsForDependencyPrefix(db, prefix, input.kind)));
      }
      const filtered = [...new Map(candidates.map((record) => [record.id, record])).values()]
        .filter(matches)
        .sort((left, right) => left.id.localeCompare(right.id));
      const page = filtered.slice(0, limit);
      const items = await Promise.all(
        page.map((record) => Effect.runPromise(decodeRecord(input.kind, record.payload))),
      );
      return { revision, items, nextCursor: filtered.length > limit ? page.at(-1)!.id : null };
    });

  const getRecord = <Kind extends KnowledgeRecordKind>(kind: Kind, id: string, revision?: number) =>
    listRecords({
      kind,
      ids: [id],
      limit: 1,
      ...(revision === undefined ? {} : { revision }),
    }).pipe(Effect.map((page) => page.items[0] ?? null));

  const getRecordDependencyPaths = (input: {
    readonly kind: KnowledgeRecordKind;
    readonly id: string;
    readonly revision: number;
    readonly limit?: number;
    readonly afterPath?: string;
  }) =>
    run("read record dependencies", async () => {
      const revision = await readRevision(input.revision);
      const record =
        revision === 0
          ? null
          : await getKvRecord(await revisionDatabase(revision), input.kind, input.id);
      const limit = boundedPageSize(input.limit);
      const paths = [...new Set(record?.dependencyPaths ?? [])]
        .filter((path) => path > (input.afterPath ?? ""))
        .sort();
      const items = paths.slice(0, limit);
      return { revision, items, nextCursor: paths.length > limit ? items.at(-1)! : null };
    });

  const recordCounts = (revision: number) =>
    run("count records", async () => {
      await readRevision(revision);
      if (revision === 0) return [] as Array<{ kind: KnowledgeRecordKind; count: number }>;
      const db = await revisionDatabase(revision);
      const kinds: KnowledgeRecordKind[] = [
        "files",
        "entities",
        "callsites",
        "imports",
        "modules",
        "behaviors",
        "flows",
        "rules",
        "evidence",
        "gaps",
      ];
      const rows: Array<{ kind: KnowledgeRecordKind; count: number }> = [];
      for (const kind of kinds) {
        const count = await countKvRecords(db, kind);
        if (count > 0) rows.push({ kind, count });
      }
      return rows;
    });

  const countFiles = (revision: number) =>
    run("count files", async () => {
      await readRevision(revision);
      return revision === 0 ? 0 : countKvRecords(await revisionDatabase(revision), "files");
    });

  const aggregateCoverage = (revision: number) =>
    run("aggregate coverage", async () => {
      await readRevision(revision);
      const db = revision === 0 ? null : await revisionDatabase(revision);
      const count = (key: string) => (db ? getKvCounter(db, key) : Promise.resolve(0));
      const [
        discoveredFiles,
        skippedFiles,
        indexedFiles,
        failedFiles,
        totalEntities,
        totalImports,
        resolvedImports,
        totalCallsites,
        resolvedCallsites,
        candidateCallsites,
        unresolvedCallsites,
      ] = await Promise.all([
        count("kind:files"),
        count("file-status:skipped"),
        count("file-status:indexed"),
        count("file-status:failed"),
        count("kind:entities"),
        count("kind:imports"),
        count("import-resolution:workspace"),
        count("kind:callsites"),
        count("call-resolution:resolved"),
        count("call-resolution:candidate"),
        count("call-resolution:unresolved"),
      ]);
      return decodeCoverage({
        discoveredFiles,
        eligibleFiles: discoveredFiles - skippedFiles,
        indexedFiles,
        skippedFiles,
        failedFiles,
        totalEntities,
        analyzedEntities: 0,
        totalImports,
        resolvedImports,
        totalCallsites,
        resolvedCallsites,
        candidateCallsites,
        unresolvedCallsites,
      });
    });

  const getChangedFilePaths = (input: {
    readonly revision: number;
    readonly currentRevision: number;
    readonly limit?: number;
    readonly afterPath?: string;
  }) =>
    run("find changed files", async () => {
      await readRevision(input.revision);
      const revision = await readRevision(input.currentRevision);
      const limit = boundedPageSize(input.limit);
      const previous = input.revision === 0 ? null : await revisionDatabase(input.revision);
      const current = revision === 0 ? null : await revisionDatabase(revision);
      const oldRange = previous?.getRange({
        start: kvKey("r", "files", input.afterPath ?? ""),
        end: kvKey("r", "files") + "\u0001",
      });
      const newRange = current?.getRange({
        start: kvKey("r", "files", input.afterPath ?? ""),
        end: kvKey("r", "files") + "\u0001",
      });
      const oldIterator = oldRange?.[Symbol.asyncIterator]();
      const newIterator = newRange?.[Symbol.asyncIterator]();
      let old = await oldIterator?.next();
      let latest = await newIterator?.next();
      const paths: string[] = [];
      while ((!old?.done && old !== undefined) || (!latest?.done && latest !== undefined)) {
        const oldRecord = old?.done ? undefined : (old?.value.value as StoredRecord | undefined);
        const newRecord = latest?.done
          ? undefined
          : (latest?.value.value as StoredRecord | undefined);
        const path =
          oldRecord && newRecord
            ? oldRecord.id < newRecord.id
              ? oldRecord.id
              : newRecord.id
            : (oldRecord?.id ?? newRecord!.id);
        const before = oldRecord?.id === path ? oldRecord : undefined;
        const after = newRecord?.id === path ? newRecord : undefined;
        if (before) old = await oldIterator!.next();
        if (after) latest = await newIterator!.next();
        if (path <= (input.afterPath ?? "")) continue;
        const beforeValue = before ? (JSON.parse(before.payload) as Record<string, unknown>) : null;
        const afterValue = after ? (JSON.parse(after.payload) as Record<string, unknown>) : null;
        if (
          !afterValue ||
          ["pending", "failed", "stale", "deleted"].includes(String(afterValue.status)) ||
          (!beforeValue && afterValue.status !== "skipped") ||
          (beforeValue &&
            (beforeValue.contentHash !== afterValue.contentHash ||
              beforeValue.classification !== afterValue.classification ||
              JSON.stringify(beforeValue.configDependencies) !==
                JSON.stringify(afterValue.configDependencies)))
        )
          paths.push(path);
        if (paths.length > limit) break;
      }
      if (oldIterator?.return) await oldIterator.return();
      if (newIterator?.return) await newIterator.return();
      const items = paths.slice(0, limit);
      return { revision, items, nextCursor: paths.length > limit ? items.at(-1)! : null };
    });

  const getAffectedFilePaths = (input: {
    readonly revision: number;
    readonly changedPaths: ReadonlyArray<string>;
    readonly currentRevision?: number;
    readonly limit?: number;
    readonly afterPath?: string;
  }) =>
    run("traverse affected files", async () => {
      const revision = await readRevision(input.revision);
      const currentRevision =
        input.currentRevision === undefined ? revision : await readRevision(input.currentRevision);
      if (input.changedPaths.length === 0) return { revision, items: [], nextCursor: null };
      if (
        input.changedPaths.length > 200 ||
        input.changedPaths.some((path) => !isWorkspaceRelativePath(path))
      )
        fail(
          "query-limit",
          "Dependency traversal accepts at most 200 workspace-relative changed paths.",
        );
      const db = revision === 0 ? null : await revisionDatabase(revision);
      const currentDb = currentRevision === 0 ? null : await revisionDatabase(currentRevision);
      const affected = new Set(input.changedPaths);
      const frontier = [...input.changedPaths];
      let globalChange = false;
      for (const path of input.changedPaths) {
        for (const candidateDb of [db, currentDb]) {
          if (!candidateDb) continue;
          const file = await getKvRecord(candidateDb, "files", path);
          if (
            file &&
            ["rule", "configuration", "manifest"].includes(
              String((JSON.parse(file.payload) as { classification?: string }).classification),
            )
          )
            globalChange = true;
        }
      }
      if (globalChange) {
        for (const candidateDb of [db, currentDb]) {
          if (!candidateDb) continue;
          for await (const record of scanKvRecords(candidateDb, "files")) affected.add(record.id);
        }
      } else {
        for (let index = 0; index < frontier.length; index++) {
          const changed = frontier[index]!;
          const add = (path: string | null) => {
            if (path && !affected.has(path)) {
              affected.add(path);
              frontier.push(path);
            }
          };
          if (db) {
            for (const record of await recordsForDependencyPath(db, changed))
              if (record.kind === "files") add(record.filePath);
            for (const target of (await recordsForSourcePath(db, changed)).filter(
              (record) => record.kind === "entities",
            )) {
              for (const id of await indexedRecordIds(db, "c", "callee", target.id))
                add((await getKvRecord(db, "callsites", id))?.filePath ?? null);
            }
          }
          for (const candidateDb of [db, currentDb]) {
            if (!candidateDb) continue;
            for (const record of await recordsForDependencyPath(candidateDb, changed))
              if (record.kind === "imports" && record.filePath !== changed) add(record.filePath);
          }
        }
      }
      const limit = boundedPageSize(input.limit);
      const paths = [...affected].filter((path) => path > (input.afterPath ?? "")).sort();
      const items = paths.slice(0, limit);
      return { revision, items, nextCursor: paths.length > limit ? items.at(-1)! : null };
    });

  const getCallsitesAt = (input: {
    readonly revision: number;
    readonly locations: ReadonlyArray<{
      readonly filePath: string;
      readonly startOffset: number;
      readonly endOffset: number;
    }>;
  }) =>
    run("find compiler callsites", async () => {
      await readRevision(input.revision);
      if (input.locations.length === 0) return [] as KnowledgeRecordMap["callsites"][];
      if (
        input.locations.length > 128 ||
        input.locations.some(
          (location) =>
            !Number.isSafeInteger(location.startOffset) ||
            !Number.isSafeInteger(location.endOffset) ||
            location.startOffset < 0 ||
            location.endOffset < location.startOffset,
        )
      )
        fail("query-limit", "Compiler callsite lookup accepts at most 128 valid source locations.");
      const db = await revisionDatabase(input.revision);
      const found = new Map<string, StoredRecord>();
      for (const location of input.locations) {
        for (const record of await recordsForSourcePath(db, location.filePath)) {
          if (record.kind !== "callsites") continue;
          const callsite = JSON.parse(record.payload) as {
            range: { startOffset: number; endOffset: number };
          };
          if (
            callsite.range.startOffset === location.startOffset &&
            callsite.range.endOffset === location.endOffset
          )
            found.set(record.id, record);
        }
      }
      if (found.size > 600)
        fail(
          "query-limit",
          "The compiler location batch matched too many callsites. Use a smaller batch.",
        );
      return Promise.all(
        [...found.values()]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((record) => Effect.runPromise(decodeRecord("callsites", record.payload))),
      );
    });

  const getDeclarationTarget = (input: {
    readonly revision: number;
    readonly filePath: string;
    readonly startOffset: number;
    readonly endOffset: number;
    readonly name?: string;
  }) =>
    run("find compiler declaration", async () => {
      await readRevision(input.revision);
      if (
        !Number.isSafeInteger(input.startOffset) ||
        !Number.isSafeInteger(input.endOffset) ||
        input.startOffset < 0 ||
        input.endOffset < input.startOffset
      )
        fail("query-limit", "Compiler declaration lookup requires a valid source range.");
      const records = (
        await recordsForSourcePath(await revisionDatabase(input.revision), input.filePath)
      ).filter((record) => record.kind === "entities");
      const entities = await Promise.all(
        records.map((record) => Effect.runPromise(decodeRecord("entities", record.payload))),
      );
      const selected = entities
        .flatMap((entity) => {
          const start = entity.range?.startOffset;
          const end = entity.range?.endOffset;
          return entity.kind === "file" || start === undefined || end === undefined
            ? []
            : [{ entity, start, end }];
        })
        .filter(({ entity, start, end }) => {
          return input.name === undefined
            ? start >= input.startOffset &&
                start <= input.endOffset &&
                end >= input.endOffset - 1 &&
                end <= input.endOffset + 1
            : entity.name === input.name &&
                entity.nameRange?.startOffset === input.startOffset &&
                entity.nameRange.endOffset === input.endOffset;
        })
        .sort(
          (left, right) =>
            Number(right.start === input.startOffset) - Number(left.start === input.startOffset) ||
            right.end - right.start - (left.end - left.start) ||
            left.entity.id.localeCompare(right.entity.id),
        )[0]?.entity;
      if (!selected) return null;
      if (selected.kind === "variable" || selected.kind === "property")
        return (
          entities
            .filter(
              (entity) =>
                entity.containerId === selected.id && ["lambda", "function"].includes(entity.kind),
            )
            .sort(
              (left, right) =>
                (left.range?.startOffset ?? 0) - (right.range?.startOffset ?? 0) ||
                left.id.localeCompare(right.id),
            )[0] ?? null
        );
      return ["class", "constructor", "method", "function", "lambda", "initializer"].includes(
        selected.kind,
      )
        ? selected
        : null;
    });

  const searchRecords = <Kind extends KnowledgeSearchKind>(input: KnowledgeSearchQuery<Kind>) =>
    run("search static knowledge", async (): Promise<KnowledgeSearchPage<Kind>> => {
      const revision = await readRevision(input.revision);
      if (
        input.kinds.length === 0 ||
        input.kinds.length > KNOWLEDGE_SEARCH_KINDS.length ||
        input.kinds.some((kind) => !KNOWLEDGE_SEARCH_KINDS.includes(kind))
      )
        fail("query-limit", "Search requires one to five static record kinds.");
      if (
        input.filePathPrefixes &&
        (input.filePathPrefixes.length > 32 ||
          input.filePathPrefixes.some((prefix) => !isWorkspaceRelativePath(prefix)))
      )
        fail("query-limit", "Search accepts at most 32 workspace-relative file scopes.");
      if (
        input.after &&
        (!Number.isFinite(input.after.rank) ||
          !KNOWLEDGE_SEARCH_KINDS.some((kind) => kind === input.after?.kind) ||
          input.after.id.length === 0)
      )
        fail("invalid-cursor", "The search cursor is invalid. Restart the query.");
      const terms = searchTerms(input.query);
      const generation = await getGeneration(meta, revision);
      if (
        !terms ||
        input.filePathPrefixes?.length === 0 ||
        !generation?.metadataJson ||
        (JSON.parse(generation.metadataJson) as { knowledgeFormat?: string }).knowledgeFormat !==
          "static-v1"
      )
        return { revision, items: [], nextCursor: null };
      const db = await revisionDatabase(revision);
      const kinds = new Set<KnowledgeRecordKind>(input.kinds);
      const matched = new Map<string, StoredRecord>();
      const scopeMatches = (record: StoredRecord) =>
        !input.filePathPrefixes ||
        input.filePathPrefixes.some((prefix) => {
          const path = prefix.replace(/\/+$/u, "");
          return record.dependencyPaths.some(
            (dependency) => dependency === path || dependency.startsWith(`${path}/`),
          );
        });
      if (input.filePathPrefixes) {
        const seen = new Set<string>();
        for (const prefix of input.filePathPrefixes) {
          const path = prefix.replace(/\/+$/u, "");
          const start = kvKey("d", path);
          for await (const { key } of db.getRange(kvStringPrefix(start))) {
            const parts = kvKeyText(key).split("\0");
            const dependency = parts[1]!;
            const kind = parts[2] as KnowledgeRecordKind;
            const id = parts[3]!;
            if (!(dependency === path || dependency.startsWith(`${path}/`)) || !kinds.has(kind))
              continue;
            const recordKey = kvKey(kind, id);
            if (seen.has(recordKey)) continue;
            seen.add(recordKey);
            const record = await getKvRecord(db, kind, id);
            if (record && terms.terms.some((term) => record.searchText.includes(term)))
              matched.set(recordKey, record);
          }
        }
      } else {
        for (const term of terms.terms) {
          const ids = await searchKvRecordIds(db, term, kinds, 2_048);
          for (const key of ids) {
            if (matched.has(key)) continue;
            const [kind, id] = key.split("\0") as [KnowledgeRecordKind, string];
            const record = await getKvRecord(db, kind, id);
            if (record && scopeMatches(record)) matched.set(key, record);
            if (matched.size >= 2_048) break;
          }
          if (matched.size >= 2_048) break;
        }
      }
      const normalized = input.query.slice(0, 2_048).trim().toLowerCase();
      const ranked = [...matched.values()]
        .flatMap((record) => {
          const payload = JSON.parse(record.payload) as { status?: string; freshness?: string };
          if (
            !input.includeStale &&
            (record.kind === "files"
              ? payload.status !== "indexed"
              : payload.freshness !== "current")
          )
            return [];
          const name = record.name.toLowerCase();
          const path = record.filePath?.toLowerCase() ?? "";
          const rank =
            path === normalized
              ? 0
              : terms.exactNames.includes(name)
                ? 1
                : name.includes(terms.primary) || path.includes(terms.primary)
                  ? 2
                  : 3 +
                    1 / (1 + terms.terms.filter((term) => record.searchText.includes(term)).length);
          return [{ record, rank }];
        })
        .sort(
          (left, right) =>
            left.rank - right.rank ||
            left.record.kind.localeCompare(right.record.kind) ||
            left.record.id.localeCompare(right.record.id),
        );
      const after = input.after;
      const sorted = after
        ? ranked.filter(
            ({ record, rank }) =>
              rank > after.rank ||
              (rank === after.rank &&
                (record.kind > after.kind || (record.kind === after.kind && record.id > after.id))),
          )
        : ranked;
      const limit = boundedPageSize(input.limit);
      const page = sorted.slice(0, limit);
      const items = await Promise.all(
        page.map(
          async ({ record, rank }) =>
            ({
              kind: record.kind as Kind,
              record: await Effect.runPromise(decodeRecord(record.kind, record.payload)),
              rank,
            }) as KnowledgeSearchHit<Kind>,
        ),
      );
      const last = sorted.length > limit ? page.at(-1) : undefined;
      return {
        revision,
        items,
        nextCursor: last
          ? {
              rank: last.rank,
              kind: last.record.kind,
              id: last.record.id,
            }
          : null,
      };
    });

  const listCalls = (input: KnowledgeCallQuery) =>
    run("query calls", async () => {
      const revision = await readRevision(input.revision);
      if (input.entityIds.length > 200)
        fail("query-limit", "A call query accepts at most 200 entity IDs.");
      if (input.entityIds.length === 0 || revision === 0)
        return { revision, items: [], nextCursor: null } as KnowledgePage<
          KnowledgeRecordMap["callsites"]
        >;
      const db = await revisionDatabase(revision);
      const ids = new Set<string>();
      for (const entityId of input.entityIds) {
        for (const direction of input.direction === "both"
          ? ["caller", "callee"]
          : [input.direction === "callers" ? "callee" : "caller"]) {
          for (const id of await indexedRecordIds(db, "c", direction, entityId)) ids.add(id);
        }
      }
      const limit = boundedPageSize(input.limit, 600);
      const sorted = [...ids].filter((id) => id > (input.afterId ?? "")).sort();
      const page = sorted.slice(0, limit);
      const items = await Promise.all(
        page.map(async (id) => {
          const record = await getKvRecord(db, "callsites", id);
          return record ? Effect.runPromise(decodeRecord("callsites", record.payload)) : null;
        }),
      );
      return {
        revision,
        items: items.filter((item) => item !== null),
        nextCursor: sorted.length > limit ? page.at(-1)! : null,
      };
    });

  const traverseCalls = (input: KnowledgeCallQuery & { readonly maxDepth?: number }) =>
    run("traverse calls", async () => {
      const revision = await readRevision(input.revision);
      const limit = boundedPageSize(input.limit, 600);
      const maximumDepth = Math.max(1, Math.min(8, Math.floor(input.maxDepth ?? 2)));
      const visited = new Set(input.entityIds.slice(0, 200));
      const callsites = new Map<string, KnowledgeRecordMap["callsites"]>();
      let frontier = [...visited];
      let truncated = input.entityIds.length > 200;
      for (
        let depth = 0;
        depth < maximumDepth && frontier.length > 0 && callsites.size < limit;
        depth++
      ) {
        const page = await Effect.runPromise(
          listCalls({
            ...input,
            entityIds: frontier.slice(0, 200),
            revision,
            limit: limit - callsites.size,
          }),
        );
        truncated ||= page.nextCursor !== null || frontier.length > 200;
        const next: string[] = [];
        for (const call of page.items) {
          callsites.set(call.id, call);
          const neighbors =
            input.direction === "callers"
              ? call.callerEntityId
                ? [call.callerEntityId]
                : []
              : input.direction === "callees"
                ? call.targetEntityIds
                : [...call.targetEntityIds, ...(call.callerEntityId ? [call.callerEntityId] : [])];
          for (const entityId of neighbors)
            if (!visited.has(entityId)) {
              if (visited.size >= 200) {
                truncated = true;
                continue;
              }
              visited.add(entityId);
              next.push(entityId);
            }
        }
        frontier = next;
        if (depth === maximumDepth - 1 && frontier.length > 0) truncated = true;
      }
      return { revision, callsites: [...callsites.values()], entityIds: [...visited], truncated };
    });

  const enqueueJobs = (
    input: KnowledgeWriteGuard & {
      readonly jobs: ReadonlyArray<KnowledgeJobInput>;
    },
  ) =>
    run("enqueue jobs", async () =>
      guardedWrite(input, async (db) => {
        const now = await nowMillis();
        await db.transaction(async (transaction) => {
          for (const candidate of input.jobs) {
            if (
              (candidate.filePath !== "" && !isSafeProjectSourcePath(candidate.filePath)) ||
              candidate.inputJson.length > 1_048_576
            )
              fail(
                "invalid-job",
                "Indexing job input is outside the supported source or size limits.",
              );
            const existingId = await transaction.get(jobIdempotencyKey(candidate.idempotencyKey));
            if (existingId !== undefined) {
              const existing = (await transaction.get(jobKey(String(existingId)))) as
                | StoredJob
                | undefined;
              if (existing?.state === "cancelled" && existing.contentHash === candidate.contentHash)
                await putKnowledgeJob(transaction, {
                  ...existing,
                  state: existing.attempts >= 3 ? "failed" : "pending",
                  detail: null,
                  claimToken: null,
                  claimLeaseToken: null,
                  updatedAt: now,
                });
              continue;
            }
            const job: StoredJob = {
              ...candidate,
              revision: input.revision,
              state: "pending",
              attempts: 0,
              detail: null,
              claimToken: null,
              claimLeaseToken: null,
              updatedAt: now,
            };
            await putKnowledgeJob(transaction, job);
            await transaction.put(jobIdempotencyKey(candidate.idempotencyKey), candidate.id);
          }
        });
        return undefined;
      }),
    );

  const listJobs = (input: {
    readonly revision: number;
    readonly state?: KnowledgeJobState;
    readonly kind?: KnowledgeJobKind;
    readonly kinds?: ReadonlyArray<KnowledgeJobKind>;
    readonly limit?: number;
    readonly afterId?: string;
  }) =>
    run("list jobs", async () => {
      const revision = await readRevision(input.revision);
      if (input.kinds?.length === 0 || revision === 0)
        return { revision, items: [] as KnowledgeJob[], nextCursor: null as string | null };
      if ((input.kinds?.length ?? 0) > 8)
        fail("query-limit", "A job query accepts at most eight kinds.");
      const db = await revisionDatabase(revision);
      const limit = boundedPageSize(input.limit);
      const jobs: KnowledgeJob[] = [];
      for await (const job of scanKnowledgeJobs(db, input)) {
        if (input.kinds && !input.kinds.includes(job.kind)) continue;
        const { claimLeaseToken: _, ...publicJob } = job;
        jobs.push(publicJob);
        if (jobs.length > limit) break;
      }
      const items = jobs.slice(0, limit);
      return { revision, items, nextCursor: jobs.length > limit ? items.at(-1)!.id : null };
    });

  const claimJobs = (
    input: KnowledgeWriteGuard & {
      readonly kind?: KnowledgeJobKind;
      readonly kinds?: ReadonlyArray<KnowledgeJobKind>;
      readonly limit?: number;
    },
  ) =>
    run("claim jobs", async () =>
      guardedWrite(input, async (db) => {
        const now = await nowMillis();
        const jobs: Array<KnowledgeJob & { readonly claimToken: string }> = [];
        await db.transaction(async (transaction) => {
          for await (const job of scanKnowledgeJobs(transaction, {
            state: "pending",
            ...(input.kind === undefined ? {} : { kind: input.kind }),
          })) {
            if (input.kinds && !input.kinds.includes(job.kind)) continue;
            if (job.attempts >= 3) {
              await putKnowledgeJob(transaction, {
                ...job,
                state: "failed",
                detail: "Maximum indexing attempts reached",
                updatedAt: now,
              });
              continue;
            }
            const claimToken = NodeCrypto.randomBytes(16).toString("hex");
            const claimed: StoredJob = {
              ...job,
              state: "running",
              attempts: job.attempts + 1,
              claimToken,
              claimLeaseToken: input.lease.token,
              updatedAt: now,
            };
            await putKnowledgeJob(transaction, claimed);
            const { claimLeaseToken: _, ...publicJob } = claimed;
            jobs.push({ ...publicJob, claimToken });
            if (jobs.length >= boundedPageSize(input.limit, 32)) break;
          }
        });
        return jobs;
      }),
    );

  const completeJob = (
    input: KnowledgeWriteGuard & {
      readonly jobId: string;
      readonly claimToken: string;
      readonly batch?: KnowledgeBatch;
    },
  ) =>
    run("complete job", async () =>
      guardedWrite(input, async (db) => {
        const job = (await db.get(jobKey(input.jobId))) as StoredJob | undefined;
        if (job?.state === "completed" && job.claimToken === input.claimToken) return undefined;
        if (
          !job ||
          job.state !== "running" ||
          job.claimToken !== input.claimToken ||
          job.claimLeaseToken !== input.lease.token
        )
          fail("job-conflict", "This indexing job is no longer owned by the worker.");
        await Effect.runPromise(validateKnowledgeJobSource(workspace.workspaceRoot, job));
        const now = await nowMillis();
        await db.transaction(async (transaction) => {
          const current = (await transaction.get(jobKey(input.jobId))) as StoredJob | undefined;
          if (
            current?.state !== "running" ||
            current.claimToken !== input.claimToken ||
            current.claimLeaseToken !== input.lease.token
          )
            fail("job-conflict", "This indexing job is no longer owned by the worker.");
          await writeBatch(transaction, input.revision, input.batch ?? {});
          await putKnowledgeJob(transaction, {
            ...current,
            state: "completed",
            claimLeaseToken: null,
            detail: null,
            updatedAt: now,
          });
        });
        return undefined;
      }),
    );

  const failJob = (
    input: KnowledgeWriteGuard & {
      readonly jobId: string;
      readonly claimToken: string;
      readonly retryable: boolean;
      readonly detail: string;
      readonly maxAttempts?: number;
    },
  ) =>
    run("fail job", async () =>
      guardedWrite(input, async (db) => {
        const now = await nowMillis();
        const bound = Math.max(1, Math.min(3, input.maxAttempts ?? 3));
        let state: KnowledgeJobState | undefined;
        await db.transaction(async (transaction) => {
          const job = (await transaction.get(jobKey(input.jobId))) as StoredJob | undefined;
          if (
            !job ||
            job.state !== "running" ||
            job.claimToken !== input.claimToken ||
            job.claimLeaseToken !== input.lease.token
          )
            fail("job-conflict", "This indexing job is no longer owned by the worker.");
          state = input.retryable && job.attempts < bound ? "pending" : "failed";
          await putKnowledgeJob(transaction, {
            ...job,
            state,
            detail: input.detail.slice(0, 16000),
            claimToken: null,
            claimLeaseToken: null,
            updatedAt: now,
          });
        });
        return state!;
      }),
    );

  const recoverJobs = (input: KnowledgeWriteGuard) =>
    run("recover jobs", async () =>
      guardedWrite(input, async (db) => {
        const now = await nowMillis();
        await db.transaction(async (transaction) => {
          for await (const job of scanKnowledgeJobs(transaction, { state: "running" })) {
            if (job.claimLeaseToken !== input.lease.token)
              await putKnowledgeJob(transaction, {
                ...job,
                state: job.attempts >= 3 ? "failed" : "pending",
                claimToken: null,
                claimLeaseToken: null,
                detail: "Worker interrupted before completing this unit",
                updatedAt: now,
              });
          }
        });
      }),
    );

  const getJobsSummary = (revision: number) =>
    run("count jobs", async () => {
      await readRevision(revision);
      if (revision === 0)
        return [] as Array<{
          kind: KnowledgeJobKind;
          state: KnowledgeJobState;
          count: number;
          attempts: number;
        }>;
      return summarizeKnowledgeJobs(await revisionDatabase(revision));
    });

  const setGenerationMetadata = (
    input: KnowledgeWriteGuard & {
      readonly coverage?: ProjectIndexCoverageV1;
      readonly metadataJson?: string;
    },
  ) =>
    run("set generation metadata", async () =>
      guardedWrite(input, async () => {
        if (input.metadataJson !== undefined && input.metadataJson.length > 1_048_576)
          fail("metadata-limit", "Generation metadata exceeds its size limit.");
        const coverage = input.coverage === undefined ? undefined : decodeCoverage(input.coverage);
        const now = await nowMillis();
        await writeMetadata(async (transaction) => {
          const state = await getState(transaction);
          await checkLease(state, input.lease, input.revision, true);
          const generation = await getGeneration(transaction, input.revision);
          if (!generation) fail("revision-conflict", "This indexing revision no longer exists.");
          await transaction.put(generationKey(input.revision), {
            ...generation,
            ...(coverage === undefined ? {} : { coverage }),
            ...(input.metadataJson === undefined ? {} : { metadataJson: input.metadataJson }),
            updatedAt: now,
          });
          if (coverage !== undefined)
            await transaction.put(META_KEY, { ...state, coverage, updatedAt: now });
        });
        return undefined;
      }),
    );

  const getGenerationMetadata = (revision: number) =>
    run(
      "read generation metadata",
      async () => (await getGeneration(meta, revision))?.metadataJson ?? null,
    );

  const invalidateFiles = (
    input: KnowledgeWriteGuard & {
      readonly filePaths: ReadonlyArray<string>;
    },
  ) =>
    run("invalidate files", async () =>
      guardedWrite(input, async (db) => {
        await db.transaction(async (transaction) => {
          for (const path of new Set(input.filePaths)) {
            if (!isWorkspaceRelativePath(path))
              fail("private-source", "Cannot invalidate private source paths.");
            for (const record of await recordsForDependencyPath(transaction, path)) {
              const payload = JSON.parse(record.payload) as Record<string, unknown>;
              if (record.kind === "files") payload.status = "stale";
              else if (
                [
                  "entities",
                  "callsites",
                  "imports",
                  "modules",
                  "behaviors",
                  "flows",
                  "rules",
                ].includes(record.kind)
              )
                payload.freshness = "stale";
              else continue;
              await putKvRecord(transaction, { ...record, payload: JSON.stringify(payload) });
            }
            for await (const job of scanKnowledgeJobs(transaction, { filePath: path })) {
              if (["pending", "running"].includes(job.state))
                await putKnowledgeJob(transaction, {
                  ...job,
                  state: "cancelled",
                  claimToken: null,
                  claimLeaseToken: null,
                  detail: "Source changed",
                  updatedAt: await nowMillis(),
                });
            }
          }
        });
        return undefined;
      }),
    );

  const refreshModuleDependencies = (input: KnowledgeWriteGuard) =>
    run("refresh module dependencies", async () =>
      guardedWrite(input, async (db) => {
        const scopes: Array<{ id: string; path: string }> = [];
        for await (const record of scanKvRecords(db, "modules")) {
          const module = JSON.parse(record.payload) as {
            provenance?: string;
            filePaths?: string[];
          };
          if (module.provenance !== "parser" || module.filePaths?.length !== 1) continue;
          const manifest = module.filePaths[0]!;
          const slash = manifest.lastIndexOf("/");
          scopes.push({ id: record.id, path: slash < 0 ? "" : manifest.slice(0, slash) });
        }
        const scopeCounts = new Map<string, number>();
        for (const scope of scopes)
          scopeCounts.set(scope.path, (scopeCounts.get(scope.path) ?? 0) + 1);
        const matchScope = (path: string) =>
          scopes
            .filter(
              (scope) =>
                (scope.path === "" || path.startsWith(`${scope.path}/`)) &&
                scopeCounts.get(scope.path) === 1,
            )
            .sort(
              (left, right) =>
                right.path.length - left.path.length || left.id.localeCompare(right.id),
            )[0];
        const dependencies = new Map<string, Set<string>>();
        for await (const record of scanKvRecords(db, "imports")) {
          const item = JSON.parse(record.payload) as {
            resolution?: string;
            freshness?: string;
            sourceHash?: string;
            targetPath?: string;
          };
          if (
            item.resolution !== "workspace" ||
            item.freshness !== "current" ||
            !record.filePath ||
            !item.targetPath
          )
            continue;
          const source = await getKvRecord(db, "files", record.filePath);
          const target = await getKvRecord(db, "files", item.targetPath);
          if (!source || !target) continue;
          const sourceFile = JSON.parse(source.payload) as {
            status?: string;
            contentHash?: string;
          };
          const targetFile = JSON.parse(target.payload) as { status?: string };
          if (
            sourceFile.status !== "indexed" ||
            targetFile.status !== "indexed" ||
            sourceFile.contentHash !== item.sourceHash
          )
            continue;
          const sourceScope = matchScope(record.filePath);
          const targetScope = matchScope(item.targetPath);
          if (!sourceScope || !targetScope || sourceScope.id === targetScope.id) continue;
          const edges = dependencies.get(sourceScope.id) ?? new Set<string>();
          edges.add(targetScope.id);
          dependencies.set(sourceScope.id, edges);
        }
        await db.transaction(async (transaction) => {
          for (const scope of scopes) {
            const record = await getKvRecord(transaction, "modules", scope.id);
            if (!record) continue;
            const payload = JSON.parse(record.payload) as Record<string, unknown>;
            payload.dependsOnModuleIds = [...(dependencies.get(scope.id) ?? [])].sort();
            await putKvRecord(transaction, { ...record, payload: JSON.stringify(payload) });
          }
        });
        return {
          moduleCount: scopes.length,
          dependencyCount: [...dependencies.values()].reduce(
            (count, edges) => count + edges.size,
            0,
          ),
        };
      }),
    );

  const writePublication = (manifest: KnowledgeManifest) =>
    run("write publication", async () => {
      writable();
      await Effect.runPromise(
        writeKnowledgeFile(
          workspace,
          "INDEX.md",
          manifest.generationPath === null
            ? "# Project knowledge\n\nNo published knowledge is available.\n"
            : `# Project knowledge\n\n[Open revision ${manifest.publishedRevision}](./${manifest.generationPath}/INDEX.md).\n\nCanonical data is in the local knowledge KV store; generated views are advisory and may be stale.\n`,
        ),
      );
      await Effect.runPromise(writeKnowledgeManifest(workspace, manifest));
      return undefined;
    });

  const publishGeneration = (input: KnowledgeWriteGuard) =>
    run("publish generation", async () => {
      writable();
      const state = await getState(meta);
      await checkLease(state, input.lease, input.revision, true);
      const generation = await getGeneration(meta, input.revision);
      if (!generation) fail("revision-conflict", "This indexing revision no longer exists.");
      const generationPath = `generations/${input.revision}-${input.lease.token}`;
      const staticRevision =
        generation.metadataJson !== null &&
        (JSON.parse(generation.metadataJson) as { knowledgeFormat?: string }).knowledgeFormat ===
          "static-v1";
      const counts: string[] = [];
      const writeArtifact = async (relativePath: string, content: string) => {
        const hash = NodeCrypto.createHash("sha256").update(content).digest("hex");
        await meta.put(kvKey("artifact", relativePath), { path: relativePath, content_hash: hash });
        await Effect.runPromise(writeKnowledgeFile(workspace, relativePath, content));
      };
      if (staticRevision) {
        const rows = await Effect.runPromise(recordCounts(input.revision));
        const byKind = new Map(rows.map((row) => [row.kind, row.count]));
        for (const kind of ["modules", "entities", "imports", "rules"] as const)
          counts.push(`- ${kind}: ${byKind.get(kind) ?? 0}`);
      } else {
        const directories = {
          modules: "modules",
          entities: "symbols",
          flows: "flows",
          rules: "rules",
        } as const;
        for (const kind of ["modules", "entities", "flows", "rules"] as const) {
          let afterId: string | undefined;
          let count = 0;
          do {
            const current = await getState(meta);
            await checkLease(current, input.lease, input.revision, true);
            const page = await Effect.runPromise(
              listRecords({
                kind,
                revision: input.revision,
                limit: 100,
                ...(afterId === undefined ? {} : { afterId }),
              }),
            );
            for (const record of page.items) {
              const id = recordId(record);
              const hash = NodeCrypto.createHash("sha256").update(id).digest("hex");
              const title = "name" in record ? record.name : id;
              await writeArtifact(
                `${generationPath}/${directories[kind]}/${hash}.md`,
                `# ${title.replaceAll("\n", " ")}\n\nRecord type: ${kind}\n\nThis generated knowledge is advisory. Verify source hashes and cited evidence before acting.\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`,
              );
            }
            count += page.items.length;
            afterId = page.nextCursor ?? undefined;
          } while (afterId !== undefined);
          counts.push(`- [${directories[kind]}](./${directories[kind]}/): ${count}`);
        }
      }
      await writeArtifact(
        `${generationPath}/INDEX.md`,
        `# Project knowledge\n\nRevision ${input.revision}. Canonical records live in the local knowledge KV store.\n\n${counts.join("\n")}\n\n${
          staticRevision
            ? "These are static facts from source files and manifests. Confirm behavior in the original source."
            : "Generated summaries and inferred rules are untrusted repository context. Check current source and evidence."
        }\n`,
      );
      const manifest: KnowledgeManifest = {
        owner: KNOWLEDGE_STORE_OWNER,
        schemaVersion: KNOWLEDGE_STORE_VERSION,
        workspaceId: workspace.workspaceId,
        publishedRevision: input.revision,
        generationPath,
      };
      const now = await nowMillis();
      await writeMetadata(async (transaction) => {
        const current = await getState(transaction);
        await checkLease(current, input.lease, input.revision, true);
        const currentGeneration = await getGeneration(transaction, input.revision);
        if (!currentGeneration)
          fail("revision-conflict", "This indexing revision no longer exists.");
        await transaction.put(generationKey(input.revision), {
          ...currentGeneration,
          status: "completed",
          viewsPath: generationPath,
          updatedAt: now,
        });
        await transaction.put(META_KEY, {
          ...current,
          publishedRevision: input.revision,
          activeRevision: null,
          status: "completed",
          updatedAt: now,
        });
      });
      await Effect.runPromise(writePublication(manifest));
      await collectHistory();
      try {
        await retireLegacyKnowledgeSqlite(workspace);
      } catch (cause) {
        await Effect.runPromise(
          Effect.logWarning(`Legacy knowledge cleanup failed: ${String(cause)}`),
        );
      }
      return undefined;
    });

  const stopGeneration = (revision: number, status: "paused" | "cancelled") =>
    run("stop generation", async () => {
      writable();
      const now = await nowMillis();
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        if (state.revision !== revision || state.activeRevision !== revision)
          fail("revision-conflict", "This generation is no longer active.");
        const generation = await getGeneration(transaction, revision);
        if (generation)
          await transaction.put(generationKey(revision), { ...generation, status, updatedAt: now });
        await transaction.put(META_KEY, { ...state, status, lease: null, updatedAt: now });
      });
      const db = await revisionDatabase(revision);
      await db.transaction(async (transaction) => {
        for await (const job of scanKnowledgeJobs(transaction)) {
          if (["pending", "running"].includes(job.state))
            await putKnowledgeJob(transaction, {
              ...job,
              state:
                status === "cancelled" ? "cancelled" : job.attempts >= 3 ? "failed" : "pending",
              claimToken: null,
              claimLeaseToken: null,
              updatedAt: now,
            });
        }
      });
      return undefined;
    });
  const pauseGeneration = (revision: number) => stopGeneration(revision, "paused");
  const cancelGeneration = (revision: number) => stopGeneration(revision, "cancelled");
  const resumeGeneration = (input: KnowledgeWriteGuard) =>
    run("resume generation", async () => {
      writable();
      const now = await nowMillis();
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        await checkLease(state, input.lease, input.revision);
        const generation = await getGeneration(transaction, input.revision);
        if (!generation || !["paused", "running"].includes(generation.status))
          fail("generation-stopped", "This generation cannot be resumed; start a new generation.");
        await transaction.put(generationKey(input.revision), {
          ...generation,
          status: "running",
          updatedAt: now,
        });
        await transaction.put(META_KEY, {
          ...state,
          activeRevision: input.revision,
          status: "running",
          updatedAt: now,
        });
      });
      const db = await revisionDatabase(input.revision);
      await db.transaction(async (transaction) => {
        for await (const job of scanKnowledgeJobs(transaction, { state: "running" })) {
          await putKnowledgeJob(transaction, {
            ...job,
            state: job.attempts >= 3 ? "failed" : "pending",
            claimToken: null,
            claimLeaseToken: null,
            updatedAt: now,
          });
        }
      });
      return undefined;
    });

  const setSettings = (settings: ProjectIndexSettings) =>
    run("save settings", async () => {
      writable();
      const checked = decodeSettings(settings);
      const now = await nowMillis();
      await writeMetadata(async (transaction) => {
        const state = await getState(transaction);
        if (!checked.enabled && state.activeRevision !== null) {
          const generation = await getGeneration(transaction, state.activeRevision);
          if (generation?.status === "running")
            await transaction.put(generationKey(generation.revision), {
              ...generation,
              status: "paused",
              updatedAt: now,
            });
        }
        await transaction.put(META_KEY, {
          ...state,
          settings: checked,
          updatedAt: now,
          ...(checked.enabled
            ? {}
            : { status: state.status === "running" ? "paused" : state.status, lease: null }),
        });
      });
      return checked;
    });
  const getSettings = () => getStateEffect().pipe(Effect.map((state) => state.settings));

  const collectHistory = async () => {
    const state = await getState(meta);
    const generations: KvGeneration[] = [];
    for await (const { value } of scanKvPrefix(meta, "generation"))
      generations.push(value as KvGeneration);
    const retained = new Set<number>([
      ...(state.publishedRevision === null ? [] : [state.publishedRevision]),
      ...(state.activeRevision === null ? [] : [state.activeRevision]),
      ...generations
        .filter((item) => item.viewsPath !== null)
        .sort((left, right) => right.revision - left.revision)
        .slice(0, RETAINED_GENERATIONS)
        .map((item) => item.revision),
    ]);
    for (const generation of generations) {
      if (retained.has(generation.revision)) continue;
      if (generation.status === "completed" && generation.viewsPath === null) continue;
      if (generation.viewsPath !== null) {
        for await (const { key, value } of scanKvPrefix(meta, "artifact")) {
          if (!String((value as { path: string }).path).startsWith(`${generation.viewsPath}/`))
            continue;
          await Effect.runPromise(
            removeOwnedKnowledgeArtifact(
              workspace,
              value as { path: string; content_hash: string },
            ),
          );
          await meta.remove(key);
        }
      }
      const handle = databases.get(generation.revision);
      if (handle) {
        handle.close();
        databases.delete(generation.revision);
      }
      if (generation.viewsPath !== null)
        await meta.put(generationKey(generation.revision), { ...generation, viewsPath: null });
      await NodeFSP.rm(revisionPath(workspace, generation.revision), {
        recursive: true,
        force: true,
      });
    }
  };

  const clear = () =>
    run("clear knowledge", async () => {
      writable();
      const manifest = await Effect.runPromise(readKnowledgeManifest(workspace));
      if (!manifest)
        fail("unowned-store", "Cannot clear knowledge without a valid ownership manifest.");
      const state = await getState(meta);
      if (state.lease && state.lease.expiresAt > (await nowMillis()))
        fail("lease-conflict", "Pause the active indexing worker before clearing its knowledge.");
      for await (const { key, value } of scanKvPrefix(meta, "artifact")) {
        await Effect.runPromise(
          removeOwnedKnowledgeArtifact(workspace, value as { path: string; content_hash: string }),
        );
        await meta.remove(key);
      }
      const generations: KvGeneration[] = [];
      for await (const { value } of scanKvPrefix(meta, "generation"))
        generations.push(value as KvGeneration);
      const now = await nowMillis();
      await writeMetadata(async (transaction) => {
        for (const generation of generations) {
          await transaction.remove(generationKey(generation.revision));
          await transaction.remove(idempotencyKey(generation.idempotencyKey));
        }
        await transaction.put(META_KEY, {
          ...state,
          revision: state.revision + 1,
          publishedRevision: null,
          activeRevision: null,
          status: "cleared",
          settings: { ...state.settings, enabled: false },
          coverage: null,
          lease: null,
          updatedAt: now,
        });
      });
      for (const generation of generations) {
        const handle = databases.get(generation.revision);
        if (handle) {
          handle.close();
          databases.delete(generation.revision);
        }
        await NodeFSP.rm(revisionPath(workspace, generation.revision), {
          recursive: true,
          force: true,
        });
      }
      await Effect.runPromise(
        writePublication({
          owner: KNOWLEDGE_STORE_OWNER,
          schemaVersion: KNOWLEDGE_STORE_VERSION,
          workspaceId: workspace.workspaceId,
          publishedRevision: null,
          generationPath: null,
        }),
      );
      return undefined;
    });

  return {
    workspace,
    revisionDatabase,
    readRevision,
    guardedWrite,
    getState: getStateEffect,
    getCoverage,
    isStaticRevision,
    acquireLease,
    renewLease,
    releaseLease,
    beginGeneration,
    applyBatch,
    listRecords,
    getRecord,
    getRecordDependencyPaths,
    recordCounts,
    countFiles,
    aggregateCoverage,
    getChangedFilePaths,
    getAffectedFilePaths,
    getCallsitesAt,
    getDeclarationTarget,
    searchRecords,
    listCalls,
    traverseCalls,
    enqueueJobs,
    listJobs,
    claimJobs,
    completeJob,
    failJob,
    recoverJobs,
    getJobsSummary,
    setGenerationMetadata,
    getGenerationMetadata,
    invalidateFiles,
    refreshModuleDependencies,
    publishGeneration,
    pauseGeneration,
    cancelGeneration,
    resumeGeneration,
    setSettings,
    getSettings,
    clear,
    writePublication,
  };
}

export type KnowledgeKvStore = ReturnType<typeof makeKnowledgeKvStore>;

// A RocksDB read-only handle can miss writes made by a concurrently open writer.
// Queries in this server reuse the active handle so publication is visible immediately.
const activeWritableStores = new Map<string, KnowledgeKvStore>();

const openStore = Effect.fn("KnowledgeStoreKv.open")(
  function* (input: { readonly workspaceRoot: string; readonly readonly: boolean }) {
    const workspace = yield* (
      input.readonly
        ? resolveKnowledgeWorkspace(input.workspaceRoot)
        : prepareKnowledgeWorkspace(input.workspaceRoot)
    ).pipe(Effect.mapError((cause) => storeError("prepare workspace", cause)));
    const path = metadataPath(workspace);
    if (input.readonly) {
      const active = activeWritableStores.get(path);
      if (active) return active;
    }
    const existing = yield* run("locate KV store", async () => {
      await assertNoSymlinkPath(workspace.workspaceRoot, path);
      return NodeFSP.stat(path)
        .then((stat) => stat.isDirectory())
        .catch((cause: unknown) => {
          if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
          throw cause;
        });
    });
    if (input.readonly && !existing) return null;
    const manifest = yield* readKnowledgeManifest(workspace);
    if (!existing && manifest === null) {
      const hasIndex = yield* run("check generated view ownership", async () =>
        NodeFSP.lstat(NodePath.join(workspace.knowledgeRoot, "INDEX.md"))
          .then(() => true)
          .catch((cause: unknown) => {
            if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
            throw cause;
          }),
      );
      if (hasIndex)
        return yield* new KnowledgeStoreError({
          code: "unowned-store",
          detail:
            "An existing INDEX.md has no ownership manifest. Project indexing preserved the file.",
        });
    }
    const meta = yield* Effect.acquireRelease(
      run("open KV store", async () => {
        await NodeFSP.mkdir(workspace.knowledgeRoot, { recursive: true, mode: 0o700 });
        return openKnowledgeKvDatabase(path, { readOnly: input.readonly });
      }),
      (database) => Effect.sync(() => database.close()),
    );
    if (!existing) {
      const now = yield* Clock.currentTimeMillis;
      const state: KvState = {
        schemaVersion: KV_SCHEMA_VERSION,
        workspaceId: workspace.workspaceId,
        revision: 0,
        publishedRevision: null,
        activeRevision: null,
        status: "idle",
        settings: DEFAULT_PROJECT_INDEX_SETTINGS,
        coverage: null,
        updatedAt: now,
        lease: null,
      };
      yield* run("initialize KV store", () => meta.put(META_KEY, state));
      yield* writeKnowledgeFile(
        workspace,
        "INDEX.md",
        "# Project knowledge\n\nNo published knowledge is available.\n",
      );
      yield* writeKnowledgeManifest(workspace, {
        owner: KNOWLEDGE_STORE_OWNER,
        schemaVersion: KNOWLEDGE_STORE_VERSION,
        workspaceId: workspace.workspaceId,
        publishedRevision: null,
        generationPath: null,
      });
    }
    const state = yield* run("validate KV store", () => getState(meta));
    if (state.workspaceId !== workspace.workspaceId)
      return yield* new KnowledgeStoreError({
        code: "workspace-mismatch",
        detail: "The knowledge KV store belongs to a different effective workspace.",
      });
    if (
      !input.readonly &&
      existing &&
      (manifest === null || manifest.publishedRevision !== state.publishedRevision)
    ) {
      const published =
        state.publishedRevision === null
          ? undefined
          : yield* run("read publication", () => getGeneration(meta, state.publishedRevision!));
      yield* writeKnowledgeManifest(workspace, {
        owner: KNOWLEDGE_STORE_OWNER,
        schemaVersion: KNOWLEDGE_STORE_VERSION,
        workspaceId: workspace.workspaceId,
        publishedRevision: state.publishedRevision,
        generationPath: published?.viewsPath ?? null,
      });
    }
    const databases = new Map<number, RocksDatabase>();
    const clock = yield* Clock.Clock;
    yield* Effect.acquireRelease(Effect.succeed(databases), (handles) =>
      Effect.sync(() => {
        for (const handle of handles.values()) handle.close();
      }),
    );
    const store = makeKnowledgeKvStore(meta, workspace, input.readonly, databases, clock);
    if (!input.readonly)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          activeWritableStores.set(path, store);
        }),
        () =>
          Effect.sync(() => {
            if (activeWritableStores.get(path) === store) activeWritableStores.delete(path);
          }),
      );
    return store;
  },
  Effect.mapError((cause) => storeError("open project knowledge", cause)),
);

export const openKnowledgeKvStore = Effect.fn("openKnowledgeKvStore")(function* (input: {
  readonly workspaceRoot: string;
}): Effect.fn.Return<KnowledgeKvStore, KnowledgeStoreError, Scope.Scope> {
  const store = yield* openStore({ ...input, readonly: false });
  if (store === null) fail("storage-failed", "The knowledge KV store could not be created.");
  return store;
});

export const openExistingKnowledgeKvStore = (input: { readonly workspaceRoot: string }) =>
  openStore({ ...input, readonly: true });
