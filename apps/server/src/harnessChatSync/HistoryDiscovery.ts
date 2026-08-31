import {
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncError,
  HarnessChatSyncSourceId,
  IsoDateTime,
  ProjectId,
  type HarnessChatSummary,
  type HarnessChatSyncListInput,
  type HarnessChatSyncListResult,
  type HarnessChatSyncSource,
  type HarnessChatSyncSourcesResult,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncLink,
} from "../persistence/Services/ProjectionHarnessChatSync.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import {
  ProviderHistorySyncError,
  type ProviderHistoryThreadSummary,
} from "../provider/Services/ProviderHistorySync.ts";
import { describeFailure, harnessSyncError, isHarnessChatSyncError } from "./Errors.ts";
import { resolveHarnessChatTargetProject } from "./ProjectTarget.ts";
import {
  isHarnessChatChanged,
  normalizeHistorySummary,
  toPublicHarnessChatLink,
} from "./TranscriptNormalization.ts";

const HISTORY_SCAN_PAGE_SIZE = 200;
const HISTORY_SCAN_MAX_PAGES = 10_000;
const HISTORY_PREVIEW_PAGE_SIZE = 10;
const HISTORY_CACHE_TTL_MS = 15_000;
const HISTORY_CACHE_MAX_ENTRIES = 32;
const LIST_CURSOR_PREFIX = "harness-native:";
const isIsoDateTime = Schema.is(IsoDateTime);
const HistoryListCursorState = Schema.Struct({
  providerCursor: Schema.String,
  visibleOffset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  changedOffset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const decodeHistoryListCursorState = Schema.decodeUnknownOption(HistoryListCursorState);

interface DecodedHistoryListCursor {
  readonly providerCursor?: string | undefined;
  readonly visibleOffset: number;
  readonly changedOffset: number;
}

export interface HarnessHistorySourceGroup {
  readonly sourceId: HarnessChatSyncSourceId;
  readonly continuationKey: HarnessChatContinuationKey;
  readonly label: string;
  readonly driver: ProviderInstance["driverKind"];
  readonly instanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly instances: ReadonlyArray<ProviderInstance>;
  readonly preferred: ProviderInstance | undefined;
  readonly status: HarnessChatSyncSource["status"];
}

interface HistorySummaryPage {
  readonly summaries: ReadonlyArray<ProviderHistoryThreadSummary>;
  readonly nextProviderCursor?: string | undefined;
  readonly totalMatching?: number | undefined;
}

export interface HarnessHistoryDiscoveryShape {
  readonly sources: Effect.Effect<HarnessChatSyncSourcesResult, HarnessChatSyncError>;
  readonly list: (
    input: HarnessChatSyncListInput,
  ) => Effect.Effect<HarnessChatSyncListResult, HarnessChatSyncError>;
  readonly requireSource: (
    sourceId: HarnessChatSyncSourceId,
  ) => Effect.Effect<HarnessHistorySourceGroup, HarnessChatSyncError>;
  readonly readLinks: (
    group: HarnessHistorySourceGroup,
  ) => Effect.Effect<
    ReadonlyMap<HarnessChatSessionId, ProjectionHarnessChatSyncLink>,
    HarnessChatSyncError
  >;
  readonly loadHistorySummaries: (
    group: HarnessHistorySourceGroup,
    input: { readonly query: string; readonly includeArchived: boolean },
    refresh?: boolean,
  ) => Effect.Effect<ReadonlyArray<ProviderHistoryThreadSummary>, ProviderHistorySyncError>;
  readonly loadHistorySummariesForSessions: (
    group: HarnessHistorySourceGroup,
    sessionIds: ReadonlyArray<HarnessChatSessionId>,
  ) => Effect.Effect<ReadonlyArray<ProviderHistoryThreadSummary>, ProviderHistorySyncError>;
}

function sourceStatusForInstances(
  instances: ReadonlyArray<ProviderInstance>,
  preferred: ProviderInstance | undefined,
): HarnessChatSyncSource["status"] {
  if (preferred?.historySync.availability === "supported") {
    return {
      kind: "supported",
      supportsActivityStatus:
        preferred.historySync.source.capabilities.activity &&
        preferred.historySync.adapter.checkActivity !== undefined,
    };
  }
  const alreadyLocal = instances.find(
    (instance) => instance.historySync.availability === "already-local",
  );
  if (alreadyLocal?.historySync.availability === "already-local") {
    return {
      kind: "already-local",
      reason: alreadyLocal.historySync.reason.trim() || "History is already stored by T3 Code.",
    };
  }
  const unsupported = instances.find(
    (instance) => instance.historySync.availability === "unsupported",
  );
  if (unsupported?.historySync.availability === "unsupported") {
    return {
      kind: "unsupported",
      reason: unsupported.historySync.reason.trim() || "History sync is not supported.",
    };
  }
  return {
    kind: "unsupported",
    reason: "Enable a compatible provider instance to synchronize this history.",
  };
}

function groupProviderHistorySources(
  instances: ReadonlyArray<ProviderInstance>,
  unavailable: ReadonlyArray<ServerProvider>,
): ReadonlyArray<HarnessHistorySourceGroup> {
  const grouped = Map.groupBy(instances, (instance) => instance.historySync.source.continuationKey);
  const sources: HarnessHistorySourceGroup[] = [];
  for (const [continuationKeyRaw, sourceInstances] of grouped) {
    const first = sourceInstances[0];
    if (!first) continue;
    const preferred = sourceInstances.find(
      (instance) => instance.enabled && instance.historySync.availability === "supported",
    );
    const source = preferred?.historySync.source ?? first.historySync.source;
    const sourceId = source.sourceId.trim();
    const continuationKey = continuationKeyRaw.trim();
    if (!sourceId || !continuationKey) continue;
    const label =
      source.displayName.trim() ||
      preferred?.displayName?.trim() ||
      first.displayName?.trim() ||
      first.driverKind;
    sources.push({
      sourceId: HarnessChatSyncSourceId.make(sourceId),
      continuationKey: HarnessChatContinuationKey.make(continuationKey),
      label,
      driver: first.driverKind,
      instanceIds: sourceInstances.map((instance) => instance.instanceId),
      instances: sourceInstances,
      preferred,
      status: sourceStatusForInstances(sourceInstances, preferred),
    });
  }

  for (const shadow of unavailable) {
    const continuationKeyRaw =
      shadow.continuation?.groupKey ?? `${shadow.driver}:instance:${shadow.instanceId}`;
    const continuationKey = continuationKeyRaw.trim();
    if (!continuationKey) continue;
    const existingIndex = sources.findIndex((source) => source.continuationKey === continuationKey);
    if (existingIndex >= 0) {
      const existing = sources[existingIndex]!;
      if (!existing.instanceIds.includes(shadow.instanceId)) {
        sources[existingIndex] = {
          ...existing,
          instanceIds: [...existing.instanceIds, shadow.instanceId],
        };
      }
      continue;
    }
    sources.push({
      sourceId: HarnessChatSyncSourceId.make(`${shadow.driver}:history:${continuationKey}`),
      continuationKey: HarnessChatContinuationKey.make(continuationKey),
      label: shadow.displayName?.trim() || shadow.driver,
      driver: shadow.driver,
      instanceIds: [shadow.instanceId],
      instances: [],
      preferred: undefined,
      status: {
        kind: "unsupported",
        reason:
          shadow.unavailableReason?.trim() ||
          "This provider driver is unavailable in the current server build.",
      },
    });
  }
  return sources.sort((left, right) => {
    const byLabel = left.label.localeCompare(right.label);
    return byLabel !== 0 ? byLabel : left.sourceId.localeCompare(right.sourceId);
  });
}

function matchesSummaryQuery(summary: ProviderHistoryThreadSummary, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [summary.title, summary.preview, summary.cwd]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

const loadAllHistorySummaries = Effect.fn("HarnessChatSync.loadAllHistorySummaries")(function* (
  group: HarnessHistorySourceGroup,
  input: { readonly query: string; readonly includeArchived: boolean },
): Effect.fn.Return<ReadonlyArray<ProviderHistoryThreadSummary>, ProviderHistorySyncError> {
  const facet = group.preferred?.historySync;
  if (!facet || facet.availability !== "supported") {
    return yield* new ProviderHistorySyncError({
      sourceId: group.sourceId,
      operation: "list",
      detail: "No enabled provider instance can read this history source.",
    });
  }
  const summaries: ProviderHistoryThreadSummary[] = [];
  const seenSessionIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < HISTORY_SCAN_MAX_PAGES; pageIndex += 1) {
    const page = yield* facet.adapter.list({
      query: input.query.trim() || undefined,
      includeArchived: input.includeArchived,
      cursor,
      limit: HISTORY_SCAN_PAGE_SIZE,
    });
    for (const summary of page.items) {
      const sessionId = summary.sessionId.trim();
      if (!sessionId || seenSessionIds.has(sessionId) || summary.isChild) continue;
      if (!input.includeArchived && summary.archived) continue;
      if (!matchesSummaryQuery(summary, input.query)) continue;
      seenSessionIds.add(sessionId);
      summaries.push(summary);
    }
    const nextCursor = page.nextCursor?.trim();
    if (!nextCursor) return summaries;
    if (seenCursors.has(nextCursor)) {
      return yield* new ProviderHistorySyncError({
        sourceId: group.sourceId,
        operation: "list",
        detail: "The history provider repeated a pagination cursor.",
      });
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return yield* new ProviderHistorySyncError({
    sourceId: group.sourceId,
    operation: "list",
    detail: "The history provider did not terminate pagination.",
  });
});

const loadHistorySummaryPage = Effect.fn("HarnessChatSync.loadHistorySummaryPage")(function* (
  group: HarnessHistorySourceGroup,
  input: {
    readonly query: string;
    readonly includeArchived: boolean;
    readonly providerCursor?: string | undefined;
    readonly limit: number;
  },
): Effect.fn.Return<HistorySummaryPage, ProviderHistorySyncError> {
  const facet = group.preferred?.historySync;
  if (!facet || facet.availability !== "supported") {
    return yield* new ProviderHistorySyncError({
      sourceId: group.sourceId,
      operation: "list",
      detail: "No enabled provider instance can read this history source.",
    });
  }
  const summaries: ProviderHistoryThreadSummary[] = [];
  const seenSessionIds = new Set<string>();
  const seenCursors = new Set<string>();
  let providerCursor = input.providerCursor;
  let totalMatching: number | undefined;
  for (let pageIndex = 0; pageIndex < HISTORY_SCAN_MAX_PAGES; pageIndex += 1) {
    const remaining = input.limit - summaries.length;
    if (remaining <= 0) {
      return {
        summaries,
        ...(providerCursor === undefined ? {} : { nextProviderCursor: providerCursor }),
        ...(totalMatching === undefined ? {} : { totalMatching }),
      };
    }
    const page = yield* facet.adapter.list({
      query: input.query.trim() || undefined,
      includeArchived: input.includeArchived,
      ...(providerCursor === undefined ? {} : { cursor: providerCursor }),
      limit: remaining,
    });
    if (page.totalMatching !== undefined) totalMatching = page.totalMatching;
    for (const summary of page.items) {
      const sessionId = summary.sessionId.trim();
      if (!sessionId || seenSessionIds.has(sessionId) || summary.isChild) continue;
      if (!input.includeArchived && summary.archived) continue;
      if (!matchesSummaryQuery(summary, input.query)) continue;
      seenSessionIds.add(sessionId);
      summaries.push(summary);
      if (summaries.length >= input.limit) break;
    }
    const nextCursor = page.nextCursor?.trim();
    if (!nextCursor) {
      return { summaries, ...(totalMatching === undefined ? {} : { totalMatching }) };
    }
    if (seenCursors.has(nextCursor) || nextCursor === providerCursor) {
      return yield* new ProviderHistorySyncError({
        sourceId: group.sourceId,
        operation: "list",
        detail: "The history provider repeated a pagination cursor.",
      });
    }
    seenCursors.add(nextCursor);
    providerCursor = nextCursor;
  }
  return yield* new ProviderHistorySyncError({
    sourceId: group.sourceId,
    operation: "list",
    detail: "The history provider did not terminate pagination.",
  });
});

const loadHistorySummariesForSessions = Effect.fn(
  "HarnessChatSync.loadHistorySummariesForSessions",
)(function* (
  group: HarnessHistorySourceGroup,
  sessionIds: ReadonlyArray<HarnessChatSessionId>,
): Effect.fn.Return<ReadonlyArray<ProviderHistoryThreadSummary>, ProviderHistorySyncError> {
  const requested = new Set(sessionIds);
  if (requested.size === 0) return [];
  const summaries = new Map<HarnessChatSessionId, ProviderHistoryThreadSummary>();
  const limit = Math.min(
    HISTORY_SCAN_PAGE_SIZE,
    Math.max(HISTORY_PREVIEW_PAGE_SIZE, requested.size),
  );
  let providerCursor: string | undefined;
  for (let pageIndex = 0; pageIndex < HISTORY_SCAN_MAX_PAGES; pageIndex += 1) {
    const page = yield* loadHistorySummaryPage(group, {
      query: "",
      includeArchived: true,
      ...(providerCursor === undefined ? {} : { providerCursor }),
      limit,
    });
    for (const summary of page.summaries) {
      const sessionId = HarnessChatSessionId.make(summary.sessionId.trim());
      if (requested.has(sessionId)) summaries.set(sessionId, summary);
    }
    if (summaries.size === requested.size || page.nextProviderCursor === undefined) {
      return sessionIds.flatMap((sessionId) => {
        const summary = summaries.get(sessionId);
        return summary ? [summary] : [];
      });
    }
    providerCursor = page.nextProviderCursor;
  }
  return yield* new ProviderHistorySyncError({
    sourceId: group.sourceId,
    operation: "status",
    detail: "The history provider did not terminate pagination.",
  });
});

function decodeListCursor(cursor: string | undefined): DecodedHistoryListCursor {
  if (!cursor?.startsWith(LIST_CURSOR_PREFIX)) return { visibleOffset: 0, changedOffset: 0 };
  try {
    const encoded = cursor.slice(LIST_CURSOR_PREFIX.length);
    const decoded = decodeHistoryListCursorState(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    return Option.isNone(decoded) ? { visibleOffset: 0, changedOffset: 0 } : decoded.value;
  } catch {
    return { visibleOffset: 0, changedOffset: 0 };
  }
}

function encodeListCursor(input: {
  readonly providerCursor: string;
  readonly visibleOffset: number;
  readonly changedOffset: number;
}): string {
  return `${LIST_CURSOR_PREFIX}${Buffer.from(JSON.stringify(input), "utf8").toString("base64url")}`;
}

export const makeHarnessHistoryDiscovery = Effect.fn("makeHarnessHistoryDiscovery")(
  function* (input: { readonly now: Effect.Effect<IsoDateTime> }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const projections = yield* ProjectionSnapshotQuery;
    const providerInstances = yield* ProviderInstanceRegistry;
    const syncRepository = yield* ProjectionHarnessChatSyncRepository;
    const summaryCache = yield* Ref.make(
      new Map<
        string,
        {
          readonly expiresAt: number;
          readonly summaries: ReadonlyArray<ProviderHistoryThreadSummary>;
        }
      >(),
    );
    const pageCache = yield* Ref.make(
      new Map<string, { readonly expiresAt: number; readonly page: HistorySummaryPage }>(),
    );

    const getGroups = Effect.all({
      instances: providerInstances.listInstances,
      unavailable: providerInstances.listUnavailable,
    }).pipe(
      Effect.map(({ instances, unavailable }) =>
        groupProviderHistorySources(instances, unavailable),
      ),
    );

    const requireSource = Effect.fn("HarnessChatSync.requireSource")(function* (
      sourceId: HarnessChatSyncSourceId,
    ) {
      const groups = yield* getGroups;
      const group = groups.find((candidate) => candidate.sourceId === sourceId);
      if (!group) {
        return yield* harnessSyncError(
          "invalid-source",
          "That harness history source is no longer configured.",
        );
      }
      if (!group.preferred || group.preferred.historySync.availability !== "supported") {
        return yield* harnessSyncError(
          "source-unavailable",
          "No enabled provider instance can read that harness history source.",
        );
      }
      return group;
    });

    const readLinks = (group: HarnessHistorySourceGroup) =>
      syncRepository.listLinksByContinuationKey({ continuationKey: group.continuationKey }).pipe(
        Effect.map((links) => new Map(links.map((link) => [link.nativeSessionId, link]))),
        Effect.mapError((cause) =>
          harnessSyncError("operation-failed", "Could not read synchronized chat links.", cause),
        ),
      );

    const loadCachedHistorySummaryPage = Effect.fn("HarnessChatSync.loadCachedHistorySummaryPage")(
      function* (
        group: HarnessHistorySourceGroup,
        request: {
          readonly query: string;
          readonly includeArchived: boolean;
          readonly providerCursor?: string | undefined;
          readonly limit: number;
        },
      ) {
        const cacheKey = [
          group.continuationKey,
          request.includeArchived ? "1" : "0",
          request.query.trim(),
          request.providerCursor ?? "",
          String(request.limit),
        ].join("\0");
        const currentTime = yield* Clock.currentTimeMillis;
        const cached = (yield* Ref.get(pageCache)).get(cacheKey);
        if (cached && cached.expiresAt > currentTime) return cached.page;
        const page = yield* loadHistorySummaryPage(group, request);
        yield* Ref.update(pageCache, (current) => {
          const next = new Map(current);
          for (const [key, value] of next) {
            if (value.expiresAt <= currentTime) next.delete(key);
          }
          while (next.size >= HISTORY_CACHE_MAX_ENTRIES) {
            const oldestKey = next.keys().next().value;
            if (oldestKey === undefined) break;
            next.delete(oldestKey);
          }
          next.set(cacheKey, { expiresAt: currentTime + HISTORY_CACHE_TTL_MS, page });
          return next;
        });
        return page;
      },
    );

    const loadHistorySummaries = Effect.fn("HarnessChatSync.loadHistorySummaries")(function* (
      group: HarnessHistorySourceGroup,
      request: { readonly query: string; readonly includeArchived: boolean },
      refresh = false,
    ) {
      const cacheKey = `${group.continuationKey}\0${request.includeArchived ? "1" : "0"}\0${request.query.trim()}`;
      const currentTime = yield* Clock.currentTimeMillis;
      if (!refresh) {
        const cached = (yield* Ref.get(summaryCache)).get(cacheKey);
        if (cached && cached.expiresAt > currentTime) return cached.summaries;
      }
      const summaries = yield* loadAllHistorySummaries(group, request);
      yield* Ref.update(summaryCache, (current) => {
        const next = new Map(current);
        for (const [key, value] of next) {
          if (value.expiresAt <= currentTime) next.delete(key);
        }
        while (next.size >= HISTORY_CACHE_MAX_ENTRIES) {
          const oldestKey = next.keys().next().value;
          if (oldestKey === undefined) break;
          next.delete(oldestKey);
        }
        next.set(cacheKey, { expiresAt: currentTime + HISTORY_CACHE_TTL_MS, summaries });
        return next;
      });
      return summaries;
    });

    const sourceDescriptor = Effect.fn("HarnessChatSync.sourceDescriptor")(function* (
      group: HarnessHistorySourceGroup,
    ): Effect.fn.Return<HarnessChatSyncSource, never> {
      const base = {
        id: group.sourceId,
        continuationKey: group.continuationKey,
        label: group.label,
        driver: group.driver,
        instanceIds: group.instanceIds,
        preferredInstanceId: group.preferred?.instanceId ?? null,
        status: group.status,
      } as const;
      if (!group.preferred || group.preferred.historySync.availability !== "supported") {
        return { ...base, chatCount: 0, changedCount: 0, latestUpdatedAt: null };
      }
      const probed = yield* Effect.result(
        Effect.all({
          page: loadCachedHistorySummaryPage(group, {
            query: "",
            includeArchived: false,
            limit: HISTORY_PREVIEW_PAGE_SIZE,
          }),
          links: readLinks(group),
        }),
      );
      if (Result.isFailure(probed)) {
        return {
          ...base,
          status: {
            kind: "unsupported",
            reason: describeFailure(
              probed.failure,
              "This harness could not list resumable chat history.",
            ),
          },
          chatCount: 0,
          changedCount: 0,
          latestUpdatedAt: null,
        };
      }
      const summaries = probed.success.page.summaries;
      if (summaries.length === 0) {
        return { ...base, chatCount: 0, changedCount: 0, latestUpdatedAt: null };
      }
      let latestUpdatedAt: IsoDateTime | null = null;
      let changedCount = 0;
      for (const summary of summaries) {
        const updatedAt = isIsoDateTime(summary.updatedAt) ? summary.updatedAt : null;
        if (updatedAt !== null && (latestUpdatedAt === null || updatedAt > latestUpdatedAt)) {
          latestUpdatedAt = updatedAt;
        }
        const sessionId = HarnessChatSessionId.make(summary.sessionId.trim());
        if (isHarnessChatChanged(updatedAt, probed.success.links.get(sessionId))) changedCount += 1;
      }
      const visibleLowerBound =
        summaries.length + (probed.success.page.nextProviderCursor === undefined ? 0 : 1);
      return {
        ...base,
        chatCount: Math.max(probed.success.page.totalMatching ?? 0, visibleLowerBound),
        changedCount,
        latestUpdatedAt,
      };
    });

    const sources = Effect.gen(function* () {
      const groups = yield* getGroups;
      return { sources: yield* Effect.forEach(groups, sourceDescriptor, { concurrency: 4 }) };
    }).pipe(
      Effect.mapError((cause) =>
        isHarnessChatSyncError(cause)
          ? cause
          : harnessSyncError("operation-failed", "Could not discover harness histories.", cause),
      ),
    );

    const publicSummary = Effect.fn("HarnessChatSync.publicSummary")(function* (request: {
      readonly summary: ProviderHistoryThreadSummary;
      readonly fallbackTimestamp: IsoDateTime;
      readonly link: ProjectionHarnessChatSyncLink | undefined;
      readonly supportsActivityStatus: boolean;
      readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly workspaceRoot: string }>;
    }): Effect.fn.Return<HarnessChatSummary, never> {
      const summary = normalizeHistorySummary(request.summary, request.fallbackTimestamp);
      const targetProject = request.link
        ? ({ kind: "existing", projectId: request.link.projectId } as const)
        : yield* resolveHarnessChatTargetProject({
            cwd: summary.cwd,
            projects: request.projects,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
      return {
        sessionId: summary.sessionId,
        title: summary.title,
        preview: summary.preview,
        cwd: summary.cwd,
        model: summary.model,
        updatedAt: summary.updatedAt,
        archived: summary.archived,
        messageCount: summary.messageCount,
        hasChanges: isHarnessChatChanged(summary.updatedAt, request.link),
        activity: request.supportsActivityStatus ? summary.activity : "unknown",
        targetProject,
        link: request.link ? toPublicHarnessChatLink(request.link) : null,
      };
    });

    const list = Effect.fn("HarnessChatSync.list")(function* (request: HarnessChatSyncListInput) {
      const group = yield* requireSource(request.sourceId);
      const fallbackTimestamp = yield* input.now;
      const cursorState = decodeListCursor(request.cursor);
      const [historyPage, links, snapshot] = yield* Effect.all([
        loadCachedHistorySummaryPage(group, {
          query: request.query,
          includeArchived: request.includeArchived,
          ...(cursorState.providerCursor === undefined
            ? {}
            : { providerCursor: cursorState.providerCursor }),
          limit: request.limit,
        }).pipe(
          Effect.mapError((cause) =>
            harnessSyncError("source-unavailable", "Could not list that harness history.", cause),
          ),
        ),
        readLinks(group),
        projections
          .getShellSnapshot()
          .pipe(
            Effect.mapError((cause) =>
              harnessSyncError("operation-failed", "Could not resolve target projects.", cause),
            ),
          ),
      ]);
      const pageSummaries = historyPage.summaries;
      const chats = yield* Effect.forEach(
        pageSummaries,
        (summary) =>
          publicSummary({
            summary,
            fallbackTimestamp,
            link: links.get(HarnessChatSessionId.make(summary.sessionId.trim())),
            supportsActivityStatus:
              group.status.kind === "supported" && group.status.supportsActivityStatus,
            projects: snapshot.projects,
          }),
        { concurrency: 8 },
      );
      const pageChanged = pageSummaries.reduce((count, summary) => {
        const normalized = normalizeHistorySummary(summary, fallbackTimestamp);
        return (
          count +
          (isHarnessChatChanged(normalized.updatedAt, links.get(normalized.sessionId)) ? 1 : 0)
        );
      }, 0);
      const visibleCount = cursorState.visibleOffset + pageSummaries.length;
      const changedMatching = cursorState.changedOffset + pageChanged;
      const countsAreComplete = historyPage.nextProviderCursor === undefined;
      const nextCursor = countsAreComplete
        ? null
        : encodeListCursor({
            providerCursor: historyPage.nextProviderCursor!,
            visibleOffset: visibleCount,
            changedOffset: changedMatching,
          });
      return {
        chats,
        nextCursor,
        totalMatching: countsAreComplete
          ? visibleCount
          : Math.max(historyPage.totalMatching ?? 0, visibleCount + 1),
        changedMatching,
        countsAreComplete,
      };
    });

    return {
      sources,
      list,
      requireSource,
      readLinks,
      loadHistorySummaries,
      loadHistorySummariesForSessions,
    } satisfies HarnessHistoryDiscoveryShape;
  },
);
