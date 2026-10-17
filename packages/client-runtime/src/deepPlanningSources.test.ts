import {
  DeepPlanExportId,
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type DeepPlanSourceRecord,
  type DeepPlanSourceSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  loadDeepPlanSourceCatalog,
  transferDeepPlanSources,
  type DeepPlanningSourceApi,
} from "./deepPlanningSources.ts";

const environmentId = EnvironmentId.make("local");
const remoteId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("owner");
const runId = DeepPlanRunId.make("run");
const capturedAt = "2026-10-16T08:00:00.000Z";

function snapshot(id: string, overrides?: Partial<DeepPlanSourceSnapshot>): DeepPlanSourceSnapshot {
  return {
    sourceId: DeepPlanSourceId.make(id),
    origin: { environmentId, projectId, threadId: ThreadId.make(id) },
    projectTitle: "Project",
    threadTitle: id,
    archived: false,
    capturedAt,
    contentVersion: "1",
    contentHash: `hash-${id}`,
    messageCount: 1,
    activityCount: 0,
    attachmentCount: 0,
    recordCount: 2,
    forkOrigin: null,
    ...overrides,
  };
}

function record(source: DeepPlanSourceSnapshot, index: number): DeepPlanSourceRecord {
  const recordId = `${source.sourceId}-${index}`;
  return {
    kind: "content",
    recordId,
    origin: { ...source.origin, recordId },
    contentHash: `hash-${recordId}`,
    contentId: `body-${source.sourceId}`,
    mediaType: "text/plain",
    chunkIndex: index,
    totalChunks: source.recordCount,
    data: `Complete history chunk ${index}`,
    requiredForAnalysis: true,
  };
}

function apiFor(sources: ReadonlyArray<DeepPlanSourceSnapshot>) {
  const api = {
    catalogSources: vi
      .fn<DeepPlanningSourceApi["catalogSources"]>()
      .mockResolvedValue({ sources, nextCursor: null }),
    exportSources: vi.fn<DeepPlanningSourceApi["exportSources"]>().mockResolvedValue({
      exportId: DeepPlanExportId.make(`export-${sources[0]?.origin.environmentId ?? "empty"}`),
      capturedAt,
      sources,
      nextCursor: null,
    }),
    readExportChunk: vi
      .fn<DeepPlanningSourceApi["readExportChunk"]>()
      .mockImplementation(async (input) => {
        const source = sources.find((source) => source.sourceId === input.sourceId);
        if (!source) throw new Error("Unknown source");
        const index = input.cursor ? Number(input.cursor) : 0;
        return {
          snapshot: source,
          records: source.recordCount ? [record(source, index)] : [],
          chunkHash: `chunk-${index}`,
          nextCursor: index + 1 < source.recordCount ? String(index + 1) : null,
        };
      }),
    initializeSources: vi
      .fn<DeepPlanningSourceApi["initializeSources"]>()
      .mockImplementation(async (input) => ({
        runId: input.runId,
        sources: input.snapshots,
        coverage: [],
      })),
    importSourceChunk: vi
      .fn<DeepPlanningSourceApi["importSourceChunk"]>()
      .mockImplementation(async (input) => ({
        runId: input.runId,
        sourceId: input.snapshot.sourceId,
        importedRecordCount: input.finalChunk ? input.snapshot.recordCount : input.chunkIndex + 1,
        complete: input.finalChunk,
        coverage: {
          sourceId: input.snapshot.sourceId,
          status: input.finalChunk ? "ready" : "importing",
          importedRecordCount: input.chunkIndex + input.records.length,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: capturedAt,
        },
      })),
  } satisfies DeepPlanningSourceApi;
  return api;
}

function transfer(
  api: DeepPlanningSourceApi,
  extra?: Partial<Parameters<typeof transferDeepPlanSources>[0]>,
) {
  return transferDeepPlanSources({
    environmentId,
    projectId,
    threadId,
    runId,
    apiForEnvironment: () => api,
    ...extra,
  });
}

describe("DeepPlan source collection", () => {
  it("loads archived metadata without exporting any history", async () => {
    const source = snapshot("archived", { archived: true });
    const api = apiFor([source]);
    const catalog = await loadDeepPlanSourceCatalog({ environmentId, projectId, api });
    expect(catalog.sources).toEqual([source]);
    expect(api.catalogSources).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
    );
    expect(api.exportSources).not.toHaveBeenCalled();
    expect(api.readExportChunk).not.toHaveBeenCalled();
  });

  it("declares every frozen source before streaming complete local and remote histories sequentially", async () => {
    const local = snapshot("local-chat");
    const archived = snapshot("archived-chat", { archived: true });
    const remote = snapshot("remote-chat", {
      origin: { environmentId: remoteId, projectId, threadId: ThreadId.make("remote-chat") },
    });
    const localApi = apiFor([local, archived]);
    const remoteApi = apiFor([remote]);
    const ordering: string[] = [];
    let active = 0;
    let peak = 0;
    for (const api of [localApi, remoteApi]) {
      const read = api.readExportChunk.getMockImplementation()!;
      api.readExportChunk.mockImplementation(async (input) => {
        active += 1;
        peak = Math.max(peak, active);
        ordering.push(`read:${input.sourceId}`);
        const result = await read(input);
        active -= 1;
        return result;
      });
    }
    const initialize = localApi.initializeSources.getMockImplementation()!;
    localApi.initializeSources.mockImplementation(async (input) => {
      ordering.push("initialize");
      return initialize(input);
    });
    const result = await transfer(localApi, {
      apiForEnvironment: (id) => (id === remoteId ? remoteApi : localApi),
      additionalSourceRefs: [remote.origin, remote.origin, local.origin],
    });
    expect(ordering[0]).toBe("initialize");
    expect(peak).toBe(1);
    expect(result.sources).toEqual([local, archived, remote]);
    expect(localApi.initializeSources).toHaveBeenCalledWith({
      threadId,
      runId,
      localExportId: DeepPlanExportId.make("export-local"),
      snapshots: [local, archived, remote],
    });
    expect(localApi.importSourceChunk).toHaveBeenCalledTimes(6);
    expect(localApi.importSourceChunk.mock.calls.map(([chunk]) => chunk.records[0])).toEqual([
      record(local, 0),
      record(local, 1),
      record(archived, 0),
      record(archived, 1),
      record(remote, 0),
      record(remote, 1),
    ]);
    expect(remoteApi.exportSources).toHaveBeenCalledWith(
      expect.objectContaining({ threadIds: [remote.origin.threadId], includeArchived: true }),
    );
  });

  it("reuses the export identity for manifest and record pages", async () => {
    const first = snapshot("first");
    const second = snapshot("second");
    const api = apiFor([first, second]);
    const exportId = DeepPlanExportId.make("frozen");
    api.exportSources.mockResolvedValueOnce({
      exportId,
      capturedAt,
      sources: [first],
      nextCursor: "page-2",
    });
    api.exportSources.mockResolvedValueOnce({
      exportId,
      capturedAt,
      sources: [second],
      nextCursor: null,
    });
    await transfer(api);
    expect(api.exportSources.mock.calls[1]?.[0]).toMatchObject({ exportId, cursor: "page-2" });
    expect(api.readExportChunk.mock.calls.every(([input]) => input.exportId === exportId)).toBe(
      true,
    );
  });

  it("uses complete frozen sources already owned by the target without retransferring their histories", async () => {
    const source = snapshot("local-frozen");
    const api = apiFor([source]);
    const coverage = {
      sourceId: source.sourceId,
      status: "ready" as const,
      importedRecordCount: source.recordCount,
      readRecordCount: 0,
      summary: null,
      error: null,
      updatedAt: capturedAt,
    };
    api.initializeSources.mockResolvedValue({ runId, sources: [source], coverage: [coverage] });
    expect(await transfer(api)).toEqual({ sources: [source], coverage: [coverage] });
    expect(api.readExportChunk).not.toHaveBeenCalled();
    expect(api.importSourceChunk).not.toHaveBeenCalled();
  });

  it("retries the identical immutable chunk after a connection failure", async () => {
    const api = apiFor([snapshot("retry")]);
    api.importSourceChunk.mockRejectedValueOnce(
      Object.assign(new Error("disconnected"), { code: "ECONNRESET" }),
    );
    await transfer(api);
    expect(api.importSourceChunk.mock.calls[0]).toEqual(api.importSourceChunk.mock.calls[1]);
    expect(api.importSourceChunk).toHaveBeenCalledTimes(3);
  });

  it("blocks unavailable selected environments before declaring an incomplete manifest", async () => {
    const api = apiFor([snapshot("local")]);
    await expect(
      transfer(api, {
        additionalSourceRefs: [{ environmentId: remoteId, projectId, threadId }],
        apiForEnvironment: (id) => (id === remoteId ? null : api),
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(api.initializeSources).not.toHaveBeenCalled();
  });

  it("blocks selected chats that disappeared from the default project", async () => {
    const api = apiFor([]);
    await expect(
      transfer(api, { additionalSourceRefs: [{ environmentId, projectId, threadId }] }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(api.initializeSources).not.toHaveBeenCalled();
  });

  it("blocks truncated histories before importing an incomplete final chunk", async () => {
    const source = snapshot("truncated");
    const api = apiFor([source]);
    api.readExportChunk.mockResolvedValueOnce({
      snapshot: source,
      records: [record(source, 0)],
      chunkHash: "chunk",
      nextCursor: null,
    });
    await expect(transfer(api)).rejects.toMatchObject({ code: "incomplete" });
    expect(api.importSourceChunk).not.toHaveBeenCalled();
  });

  it("blocks stale snapshots rather than mixing source versions", async () => {
    const source = snapshot("stale");
    const api = apiFor([source]);
    api.readExportChunk.mockResolvedValueOnce({
      snapshot: { ...source, contentVersion: "2" },
      records: [record(source, 0)],
      chunkHash: "chunk",
      nextCursor: "1",
    });
    await expect(transfer(api)).rejects.toMatchObject({ code: "stale" });
    expect(api.importSourceChunk).not.toHaveBeenCalled();
  });

  it("cancels in-flight reads without importing or continuing collection", async () => {
    const api = apiFor([snapshot("cancel")]);
    const controller = new AbortController();
    api.readExportChunk.mockImplementation(() => {
      controller.abort();
      return new Promise(() => {});
    });
    await expect(transfer(api, { signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(api.importSourceChunk).not.toHaveBeenCalled();
  });

  it("bounds retries and never reports a failed import as complete", async () => {
    const api = apiFor([snapshot("fail")]);
    api.importSourceChunk.mockRejectedValue(new Error("offline"));
    await expect(transfer(api)).rejects.toThrow("offline");
    expect(api.importSourceChunk).toHaveBeenCalledTimes(3);
    expect(api.readExportChunk).toHaveBeenCalledTimes(1);
  });
});
