import {
  DEEP_PLAN_MAX_CHUNK_RECORDS,
  DEEP_PLAN_MAX_PAGE_SIZE,
  type DeepPlanCatalogSourcesInput,
  type DeepPlanCatalogSourcesResult,
  type DeepPlanSourceCatalogEntry,
  type DeepPlanExportId,
  type DeepPlanExportSourcesInput,
  type DeepPlanExportSourcesResult,
  type DeepPlanImportSourceChunkInput,
  type DeepPlanImportSourceChunkResult,
  type DeepPlanInitializeSourcesInput,
  type DeepPlanInitializeSourcesResult,
  type DeepPlanReadExportChunkInput,
  type DeepPlanReadExportChunkResult,
  type DeepPlanRunId,
  type DeepPlanSourceCoverage,
  type DeepPlanSourceRef,
  type DeepPlanSourceSnapshot,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

export interface DeepPlanningSourceApi {
  readonly catalogSources: (
    input: DeepPlanCatalogSourcesInput,
  ) => Promise<DeepPlanCatalogSourcesResult>;
  readonly exportSources: (
    input: DeepPlanExportSourcesInput,
  ) => Promise<DeepPlanExportSourcesResult>;
  readonly readExportChunk: (
    input: DeepPlanReadExportChunkInput,
  ) => Promise<DeepPlanReadExportChunkResult>;
  readonly initializeSources: (
    input: DeepPlanInitializeSourcesInput,
  ) => Promise<DeepPlanInitializeSourcesResult>;
  readonly importSourceChunk: (
    input: DeepPlanImportSourceChunkInput,
  ) => Promise<DeepPlanImportSourceChunkResult>;
}

export interface DeepPlanSourceCatalog {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly sources: ReadonlyArray<DeepPlanSourceCatalogEntry>;
}

interface FrozenDeepPlanSourceCatalog {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly exportId: DeepPlanExportId;
  readonly capturedAt: string;
  readonly sources: ReadonlyArray<DeepPlanSourceSnapshot>;
}

class DeepPlanSourceTransferError extends Error {
  override readonly name = "DeepPlanSourceTransferError";

  readonly code: "aborted" | "unavailable" | "stale" | "incomplete" | "failed";
  readonly sourceRef: DeepPlanSourceRef | undefined;

  constructor(
    code: DeepPlanSourceTransferError["code"],
    message: string,
    sourceRef?: DeepPlanSourceRef,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.sourceRef = sourceRef;
  }
}

const SOURCE_TRANSFER_ATTEMPTS = 3;
const SOURCE_TRANSFER_CHUNK_RECORDS = Math.min(32, DEEP_PLAN_MAX_CHUNK_RECORDS);
export const EMPTY_DEEP_PLAN_SOURCE_REFS: ReadonlyArray<DeepPlanSourceRef> = Object.freeze([]);

export function deepPlanSourceRefKey(ref: DeepPlanSourceRef): string {
  return JSON.stringify([ref.environmentId, ref.projectId, ref.threadId]);
}

export function uniqueDeepPlanSourceRefs(
  refs: ReadonlyArray<DeepPlanSourceRef>,
): ReadonlyArray<DeepPlanSourceRef> {
  return [...new Map(refs.map((ref) => [deepPlanSourceRefKey(ref), ref])).values()];
}

function abortError(): DeepPlanSourceTransferError {
  return new DeepPlanSourceTransferError("aborted", "DeepPlan source collection was canceled.");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function isPermanentSourceError(error: unknown): boolean {
  if (error instanceof DeepPlanSourceTransferError) return true;
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return (
    typeof error.code === "string" &&
    [
      "source-not-found",
      "export-not-found",
      "run-not-found",
      "invalid-chunk",
      "content-mismatch",
      "incomplete-source",
      "source-unavailable",
    ].includes(error.code)
  );
}

async function retrySourceOperation<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    throwIfAborted(signal);
    try {
      const result = await withAbort(operation(), signal);
      throwIfAborted(signal);
      return result;
    } catch (error) {
      throwIfAborted(signal);
      if (attempt >= SOURCE_TRANSFER_ATTEMPTS || isPermanentSourceError(error)) throw error;
    }
  }
}

function advanceCursor(seen: Set<string>, cursor: string | null): void {
  if (cursor === null) return;
  if (seen.has(cursor)) {
    throw new DeepPlanSourceTransferError(
      "stale",
      "The source server returned a repeated page. Retry source collection.",
    );
  }
  seen.add(cursor);
}

async function exportDeepPlanSourceCatalog(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly api: Pick<DeepPlanningSourceApi, "exportSources">;
  readonly threadIds?: ReadonlyArray<ThreadId>;
  readonly signal?: AbortSignal;
}): Promise<FrozenDeepPlanSourceCatalog> {
  let exportId: DeepPlanExportId | undefined;
  let capturedAt: string | undefined;
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  const sources = new Map<string, DeepPlanSourceSnapshot>();
  do {
    const page = await retrySourceOperation(
      () =>
        input.api.exportSources({
          projectId: input.projectId,
          includeArchived: true,
          ...(input.threadIds ? { threadIds: input.threadIds } : {}),
          ...(exportId ? { exportId } : {}),
          ...(cursor ? { cursor } : {}),
          limit: DEEP_PLAN_MAX_PAGE_SIZE,
        }),
      input.signal,
    );
    if (
      (exportId && page.exportId !== exportId) ||
      (capturedAt && page.capturedAt !== capturedAt)
    ) {
      throw new DeepPlanSourceTransferError(
        "stale",
        "The source snapshot changed during collection. Retry source collection.",
      );
    }
    exportId = page.exportId;
    capturedAt = page.capturedAt;
    for (const source of page.sources) {
      if (
        source.origin.environmentId !== input.environmentId ||
        source.origin.projectId !== input.projectId ||
        (input.threadIds && !input.threadIds.includes(source.origin.threadId)) ||
        sources.has(deepPlanSourceRefKey(source.origin))
      ) {
        throw new DeepPlanSourceTransferError(
          "stale",
          "The source manifest contains an unexpected or duplicate chat.",
          source.origin,
        );
      }
      sources.set(deepPlanSourceRefKey(source.origin), source);
    }
    cursor = page.nextCursor;
    advanceCursor(seenCursors, cursor);
  } while (cursor !== null);
  return {
    environmentId: input.environmentId,
    projectId: input.projectId,
    exportId,
    capturedAt,
    sources: [...sources.values()],
  };
}

export async function loadDeepPlanSourceCatalog(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly api: Pick<DeepPlanningSourceApi, "catalogSources">;
  readonly threadIds?: ReadonlyArray<ThreadId>;
  readonly signal?: AbortSignal;
}): Promise<DeepPlanSourceCatalog> {
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  const sources = new Map<string, DeepPlanSourceCatalogEntry>();
  do {
    const page = await retrySourceOperation(
      () =>
        input.api.catalogSources({
          projectId: input.projectId,
          includeArchived: true,
          ...(input.threadIds ? { threadIds: input.threadIds } : {}),
          ...(cursor ? { cursor } : {}),
          limit: DEEP_PLAN_MAX_PAGE_SIZE,
        }),
      input.signal,
    );
    for (const source of page.sources) {
      if (
        source.origin.environmentId !== input.environmentId ||
        source.origin.projectId !== input.projectId
      ) {
        throw new DeepPlanSourceTransferError(
          "stale",
          "The source catalog contains a chat from an unexpected project.",
          source.origin,
        );
      }
      sources.set(deepPlanSourceRefKey(source.origin), source);
    }
    cursor = page.nextCursor;
    advanceCursor(seenCursors, cursor);
  } while (cursor !== null);
  return {
    environmentId: input.environmentId,
    projectId: input.projectId,
    sources: [...sources.values()],
  };
}

export interface DeepPlanSourceTransferProgress {
  readonly source: DeepPlanSourceSnapshot;
  readonly completedSources: number;
  readonly totalSources: number;
  readonly importedRecords: number;
  readonly totalRecords: number;
}

function sameSnapshot(left: DeepPlanSourceSnapshot, right: DeepPlanSourceSnapshot): boolean {
  return (
    left.sourceId === right.sourceId &&
    deepPlanSourceRefKey(left.origin) === deepPlanSourceRefKey(right.origin) &&
    left.contentHash === right.contentHash &&
    left.contentVersion === right.contentVersion &&
    left.recordCount === right.recordCount &&
    left.capturedAt === right.capturedAt
  );
}

async function transferSource(input: {
  readonly catalog: FrozenDeepPlanSourceCatalog;
  readonly snapshot: DeepPlanSourceSnapshot;
  readonly sourceApi: DeepPlanningSourceApi;
  readonly targetApi: DeepPlanningSourceApi;
  readonly threadId: ThreadId;
  readonly runId: DeepPlanRunId;
  readonly signal?: AbortSignal;
  readonly onChunk: (importedRecords: number) => void;
}): Promise<DeepPlanSourceCoverage> {
  let cursor: string | null = null;
  let chunkIndex = 0;
  let importedRecords = 0;
  let coverage: DeepPlanSourceCoverage;
  const seenCursors = new Set<string>();
  const seenRecords = new Set<string>();
  do {
    const chunk = await retrySourceOperation(
      () =>
        input.sourceApi.readExportChunk({
          exportId: input.catalog.exportId,
          sourceId: input.snapshot.sourceId,
          ...(cursor ? { cursor } : {}),
          limit: SOURCE_TRANSFER_CHUNK_RECORDS,
        }),
      input.signal,
    );
    if (!sameSnapshot(input.snapshot, chunk.snapshot)) {
      throw new DeepPlanSourceTransferError(
        "stale",
        "A selected chat changed during transfer. Retry source collection.",
        input.snapshot.origin,
      );
    }
    if (chunk.records.length > DEEP_PLAN_MAX_CHUNK_RECORDS) {
      throw new DeepPlanSourceTransferError(
        "incomplete",
        "The source server returned an oversized chunk.",
        input.snapshot.origin,
      );
    }
    for (const record of chunk.records) {
      if (seenRecords.has(record.recordId)) {
        throw new DeepPlanSourceTransferError(
          "stale",
          "The source server repeated a chat record.",
          input.snapshot.origin,
        );
      }
      seenRecords.add(record.recordId);
    }
    const nextRecordCount = importedRecords + chunk.records.length;
    const finalChunk = chunk.nextCursor === null;
    if (
      nextRecordCount > input.snapshot.recordCount ||
      (finalChunk && nextRecordCount !== input.snapshot.recordCount) ||
      (!finalChunk && chunk.records.length === 0)
    ) {
      throw new DeepPlanSourceTransferError(
        "incomplete",
        "The selected chat history is incomplete. Retry source collection.",
        input.snapshot.origin,
      );
    }
    advanceCursor(seenCursors, chunk.nextCursor);
    const result = await retrySourceOperation(
      () =>
        input.targetApi.importSourceChunk({
          threadId: input.threadId,
          runId: input.runId,
          snapshot: input.snapshot,
          chunkIndex,
          chunkHash: chunk.chunkHash,
          records: chunk.records,
          finalChunk,
        }),
      input.signal,
    );
    if (
      result.runId !== input.runId ||
      result.sourceId !== input.snapshot.sourceId ||
      result.importedRecordCount !== nextRecordCount ||
      result.coverage.sourceId !== input.snapshot.sourceId ||
      result.coverage.importedRecordCount !== nextRecordCount ||
      result.complete !== finalChunk
    ) {
      throw new DeepPlanSourceTransferError(
        "incomplete",
        "The target environment did not confirm the complete source chunk.",
        input.snapshot.origin,
      );
    }
    coverage = result.coverage;
    importedRecords = nextRecordCount;
    input.onChunk(importedRecords);
    cursor = chunk.nextCursor;
    chunkIndex += 1;
  } while (cursor !== null);
  if (coverage.status !== "ready" && coverage.status !== "summarized") {
    throw new DeepPlanSourceTransferError(
      "incomplete",
      "The target environment has not completed source import.",
      input.snapshot.origin,
    );
  }
  return coverage;
}

export async function transferDeepPlanSources(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly runId: DeepPlanRunId;
  readonly additionalSourceRefs?: ReadonlyArray<DeepPlanSourceRef>;
  readonly apiForEnvironment: (
    environmentId: EnvironmentId,
  ) => DeepPlanningSourceApi | null | Promise<DeepPlanningSourceApi | null>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DeepPlanSourceTransferProgress) => void;
}): Promise<{
  readonly sources: ReadonlyArray<DeepPlanSourceSnapshot>;
  readonly coverage: ReadonlyArray<DeepPlanSourceCoverage>;
}> {
  const apis = new Map<EnvironmentId, DeepPlanningSourceApi>();
  const getApi = async (environmentId: EnvironmentId) => {
    const cached = apis.get(environmentId);
    if (cached) return cached;
    throwIfAborted(input.signal);
    const api = await withAbort(
      Promise.resolve(input.apiForEnvironment(environmentId)),
      input.signal,
    );
    if (!api)
      throw new DeepPlanSourceTransferError(
        "unavailable",
        "A selected environment is unavailable. Reconnect it and retry source collection.",
      );
    apis.set(environmentId, api);
    return api;
  };
  const targetApi = await getApi(input.environmentId);
  const defaultCatalog = await exportDeepPlanSourceCatalog({
    environmentId: input.environmentId,
    projectId: input.projectId,
    api: targetApi,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const catalogs: FrozenDeepPlanSourceCatalog[] = [defaultCatalog];
  const defaultSourceRefs = new Set(
    defaultCatalog.sources.map((source) => deepPlanSourceRefKey(source.origin)),
  );
  const groups = new Map<
    string,
    { environmentId: EnvironmentId; projectId: ProjectId; threadIds: ThreadId[] }
  >();
  for (const ref of uniqueDeepPlanSourceRefs(input.additionalSourceRefs ?? [])) {
    if (ref.environmentId === input.environmentId && ref.projectId === input.projectId) {
      if (!defaultSourceRefs.has(deepPlanSourceRefKey(ref))) {
        throw new DeepPlanSourceTransferError(
          "unavailable",
          "A selected chat is unavailable. Restore access or remove it before continuing.",
          ref,
        );
      }
      continue;
    }
    const key = JSON.stringify([ref.environmentId, ref.projectId]);
    const group = groups.get(key) ?? {
      environmentId: ref.environmentId,
      projectId: ref.projectId,
      threadIds: [],
    };
    group.threadIds.push(ref.threadId);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const api = await getApi(group.environmentId);
    const catalog = await exportDeepPlanSourceCatalog({
      ...group,
      api,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const available = new Set(catalog.sources.map((source) => source.origin.threadId));
    for (const threadId of group.threadIds) {
      if (!available.has(threadId)) {
        throw new DeepPlanSourceTransferError(
          "unavailable",
          "A selected chat is unavailable. Restore access or remove it before continuing.",
          { environmentId: group.environmentId, projectId: group.projectId, threadId },
        );
      }
    }
    catalogs.push(catalog);
  }
  const sources = catalogs.flatMap((catalog) => catalog.sources);
  const initialized = await retrySourceOperation(
    () =>
      targetApi.initializeSources({
        threadId: input.threadId,
        runId: input.runId,
        localExportId: defaultCatalog.exportId,
        snapshots: sources,
      }),
    input.signal,
  );
  if (
    initialized.runId !== input.runId ||
    initialized.sources.length !== sources.length ||
    !sources.every((source) =>
      initialized.sources.some((accepted) => sameSnapshot(source, accepted)),
    )
  ) {
    throw new DeepPlanSourceTransferError(
      "incomplete",
      "The target environment did not confirm every selected source.",
    );
  }
  const coverage: DeepPlanSourceCoverage[] = [];
  const existingCoverage = new Map(initialized.coverage.map((entry) => [entry.sourceId, entry]));
  let completedSources = 0;
  for (const catalog of catalogs) {
    const sourceApi = await getApi(catalog.environmentId);
    for (const snapshot of catalog.sources) {
      const existing = existingCoverage.get(snapshot.sourceId);
      if (
        existing &&
        (existing.status === "ready" || existing.status === "summarized") &&
        existing.importedRecordCount === snapshot.recordCount
      ) {
        coverage.push(existing);
        completedSources += 1;
        input.onProgress?.({
          source: snapshot,
          completedSources,
          totalSources: sources.length,
          importedRecords: snapshot.recordCount,
          totalRecords: snapshot.recordCount,
        });
        continue;
      }
      coverage.push(
        await transferSource({
          catalog,
          snapshot,
          sourceApi,
          targetApi,
          threadId: input.threadId,
          runId: input.runId,
          ...(input.signal ? { signal: input.signal } : {}),
          onChunk: (importedRecords) =>
            input.onProgress?.({
              source: snapshot,
              completedSources:
                completedSources + (importedRecords === snapshot.recordCount ? 1 : 0),
              totalSources: sources.length,
              importedRecords,
              totalRecords: snapshot.recordCount,
            }),
        }),
      );
      completedSources += 1;
    }
  }
  throwIfAborted(input.signal);
  return { sources, coverage };
}
