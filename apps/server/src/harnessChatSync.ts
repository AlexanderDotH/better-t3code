// @effect-diagnostics nodeBuiltinImport:off - Deterministic import identifiers use SHA-256.
import * as NodeCrypto from "node:crypto";

import {
  CHAT_ATTACHMENT_MAX_AUDIO_BYTES,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncError,
  HarnessChatSyncFailure,
  HarnessChatSyncSourceId,
  IsoDateTime,
  MessageId,
  OrchestrationProposedPlanId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ThreadId,
  type ChatAttachment,
  type HarnessChatActivity,
  type HarnessChatLink,
  type HarnessChatSummary,
  type HarnessChatSyncListInput,
  type HarnessChatSyncListResult,
  type HarnessChatSyncRunInput,
  type HarnessChatSyncRunItem,
  type HarnessChatSyncRunResult,
  type HarnessChatSyncSource,
  type HarnessChatSyncSourcesResult,
  type HarnessChatSyncStatusInput,
  type HarnessChatSyncStatusResult,
  type HarnessChatTargetProject,
  type ModelSelection,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { resolveAttachmentPath, toSafeThreadAttachmentSegment } from "./attachmentStore.ts";
import { ServerConfig } from "./config.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  HarnessChatNativeMessageId,
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncLink,
} from "./persistence/Services/ProjectionHarnessChatSync.ts";
import type { ProviderInstance } from "./provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory.ts";
import {
  ProviderHistorySyncError,
  type ProviderHistoryAttachment,
  type ProviderHistoryThreadSummary,
  type ProviderHistoryTranscript,
} from "./provider/Services/ProviderHistorySync.ts";

const HISTORY_SCAN_PAGE_SIZE = 200;
const HISTORY_SCAN_MAX_PAGES = 10_000;
const HISTORY_SUMMARY_CACHE_TTL_MS = 15_000;
const HISTORY_SUMMARY_CACHE_MAX_ENTRIES = 32;
const LIST_CURSOR_PREFIX = "harness-offset:";
const isIsoDateTime = Schema.is(IsoDateTime);
const isHarnessChatSyncError = Schema.is(HarnessChatSyncError);

interface HarnessHistorySourceGroup {
  readonly sourceId: HarnessChatSyncSourceId;
  readonly continuationKey: HarnessChatContinuationKey;
  readonly label: string;
  readonly driver: ProviderInstance["driverKind"];
  readonly instanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly instances: ReadonlyArray<ProviderInstance>;
  readonly preferred: ProviderInstance | undefined;
  readonly status: HarnessChatSyncSource["status"];
}

interface NormalizedHistorySummary {
  readonly sessionId: HarnessChatSessionId;
  readonly title: string;
  readonly preview: string | null;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly createdAt: IsoDateTime | null;
  readonly updatedAt: IsoDateTime;
  readonly archived: boolean;
  readonly messageCount: number;
  readonly activity: HarnessChatActivity;
}

class SessionSyncFailure extends Schema.TaggedErrorClass<SessionSyncFailure>()(
  "SessionSyncFailure",
  {
    failure: HarnessChatSyncFailure,
    messagesImported: Schema.Number,
    attachmentsImported: Schema.Number,
    attachmentsSkipped: Schema.Number,
  },
) {}

interface ResolvedRunTarget {
  readonly projectId?: ProjectId | undefined;
  readonly create?:
    | {
        readonly rootPath: string;
        readonly suggestedName: string;
      }
    | undefined;
}

export interface HarnessChatSyncShape {
  readonly sources: Effect.Effect<HarnessChatSyncSourcesResult, HarnessChatSyncError>;
  readonly list: (
    input: HarnessChatSyncListInput,
  ) => Effect.Effect<HarnessChatSyncListResult, HarnessChatSyncError>;
  readonly run: (
    input: HarnessChatSyncRunInput,
  ) => Effect.Effect<HarnessChatSyncRunResult, HarnessChatSyncError>;
  readonly status: (
    input: HarnessChatSyncStatusInput,
  ) => Effect.Effect<HarnessChatSyncStatusResult, HarnessChatSyncError>;
}

export function makeHarnessChatSyncId(
  kind: string,
  ...identityParts: ReadonlyArray<string>
): string {
  const digest = NodeCrypto.createHash("sha256")
    .update(identityParts.join("\0"))
    .digest("hex")
    .slice(0, 32);
  return `harness-sync-${kind}-${digest}`;
}

export function makeHarnessChatSyncAttachmentId(input: {
  readonly threadId: string;
  readonly sourceId: string;
  readonly nativeMessageId: string;
  readonly nativeAttachmentId: string;
}): string {
  const threadSegment = toSafeThreadAttachmentSegment(input.threadId) ?? "harness-sync";
  const digest = NodeCrypto.createHash("sha256")
    .update([input.sourceId, input.nativeMessageId, input.nativeAttachmentId].join("\0"))
    .digest("hex")
    .slice(0, 32);
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20),
  ].join("-");
  return `${threadSegment}-${uuid}`;
}

/**
 * Reuses a message already projected from a live provider turn before creating
 * a second local message during a later history refresh. Provider item ids are
 * authoritative for assistant output; exact role/text matching covers user
 * messages whose harness protocol does not echo T3's client message id.
 */
export function findExistingHarnessMessageMatch(input: {
  readonly nativeMessageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly linkedMessageIds: ReadonlySet<MessageId>;
  readonly claimedMessageIds: ReadonlySet<MessageId>;
}): OrchestrationMessage | undefined {
  const available = (message: OrchestrationMessage) =>
    !input.linkedMessageIds.has(message.id) && !input.claimedMessageIds.has(message.id);
  if (input.role === "assistant") {
    const nativeAssistantId = MessageId.make(`assistant:${input.nativeMessageId}`);
    const exact = input.messages.find(
      (message) => message.id === nativeAssistantId && available(message),
    );
    if (exact) return exact;
  }
  const normalizedText = input.text.trim();
  return input.messages.find(
    (message) =>
      message.role === input.role && message.text.trim() === normalizedText && available(message),
  );
}

export const resolveHarnessChatTargetProject = Effect.fn("resolveHarnessChatTargetProject")(
  function* (input: {
    readonly cwd: string | null;
    readonly projects: ReadonlyArray<{
      readonly id: ProjectId;
      readonly workspaceRoot: string;
    }>;
  }): Effect.fn.Return<HarnessChatTargetProject, never, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceCwd = input.cwd?.trim();
    if (!sourceCwd) {
      return { kind: "unresolved", sourceCwd: null };
    }

    const normalizedCwd = path.resolve(sourceCwd);
    const existing = input.projects.find(
      (project) => path.resolve(project.workspaceRoot) === normalizedCwd,
    );
    if (existing) {
      return { kind: "existing", projectId: existing.id };
    }

    const isDirectory = yield* fileSystem.stat(normalizedCwd).pipe(
      Effect.map((stat) => stat.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!isDirectory) {
      return { kind: "unresolved", sourceCwd: normalizedCwd };
    }

    return {
      kind: "create",
      rootPath: normalizedCwd,
      suggestedName: path.basename(normalizedCwd).trim() || "Imported project",
    };
  },
);

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

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeIsoDateTime(value: string | undefined, fallback: IsoDateTime): IsoDateTime {
  return value !== undefined && isIsoDateTime(value) ? value : fallback;
}

function normalizeHistorySummary(
  summary: ProviderHistoryThreadSummary,
  fallbackTimestamp: IsoDateTime,
): NormalizedHistorySummary {
  const title = normalizeOptionalText(summary.title) ?? "Imported chat";
  return {
    sessionId: HarnessChatSessionId.make(summary.sessionId.trim()),
    title,
    preview: summary.preview,
    cwd: normalizeOptionalText(summary.cwd),
    model: normalizeOptionalText(summary.model),
    createdAt:
      summary.createdAt !== undefined && isIsoDateTime(summary.createdAt)
        ? summary.createdAt
        : null,
    updatedAt: normalizeIsoDateTime(summary.updatedAt, fallbackTimestamp),
    archived: summary.archived,
    messageCount:
      summary.messageCount === undefined ? 0 : Math.max(0, Math.floor(summary.messageCount)),
    activity: summary.activity,
  };
}

function isChanged(
  sourceUpdatedAt: IsoDateTime | null,
  link: ProjectionHarnessChatSyncLink | undefined,
): boolean {
  if (!link) return true;
  if (sourceUpdatedAt === null) return false;
  if (link.sourceUpdatedAt === null) return true;
  return sourceUpdatedAt > link.sourceUpdatedAt;
}

function toPublicLink(link: ProjectionHarnessChatSyncLink): HarnessChatLink {
  return {
    sourceId: link.sourceId,
    nativeSessionId: link.nativeSessionId,
    threadId: link.threadId,
    projectId: link.projectId,
    providerInstanceId: link.providerInstanceId,
    providerLabel: link.providerLabel,
    activity: link.activity,
    sourceUpdatedAt: link.sourceUpdatedAt,
    lastSyncedAt: link.lastSyncedAt,
  };
}

function decodeListOffset(cursor: string | undefined): number {
  if (!cursor?.startsWith(LIST_CURSOR_PREFIX)) return 0;
  const value = Number(cursor.slice(LIST_CURSOR_PREFIX.length));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function harnessSyncError(
  code: HarnessChatSyncError["code"],
  message: string,
  cause?: unknown,
): HarnessChatSyncError {
  return new HarnessChatSyncError({
    code,
    message: message.trim() || "Harness chat sync failed.",
    ...(cause === undefined ? {} : { cause }),
  });
}

function describeFailure(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  const rendered = String(cause).trim();
  return rendered && rendered !== "[object Object]" ? rendered : fallback;
}

function sessionSyncFailure(input: {
  readonly sessionId: HarnessChatSessionId;
  readonly code: HarnessChatSyncFailure["code"];
  readonly message: string;
  readonly retryable: boolean;
  readonly messagesImported?: number;
  readonly attachmentsImported?: number;
  readonly attachmentsSkipped?: number;
}): SessionSyncFailure {
  return new SessionSyncFailure({
    failure: {
      sessionId: input.sessionId,
      code: input.code,
      message: input.message.trim() || "This chat could not be synchronized.",
      retryable: input.retryable,
    },
    messagesImported: input.messagesImported ?? 0,
    attachmentsImported: input.attachmentsImported ?? 0,
    attachmentsSkipped: input.attachmentsSkipped ?? 0,
  });
}

export const makeHarnessChatSync = Effect.fn("makeHarnessChatSync")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const orchestration = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const providerInstances = yield* ProviderInstanceRegistry;
  const sessionDirectory = yield* ProviderSessionDirectory;
  const syncRepository = yield* ProjectionHarnessChatSyncRepository;

  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const summaryCache = yield* Ref.make(
    new Map<
      string,
      {
        readonly expiresAt: number;
        readonly summaries: ReadonlyArray<ProviderHistoryThreadSummary>;
      }
    >(),
  );

  const getGroups = Effect.all({
    instances: providerInstances.listInstances,
    unavailable: providerInstances.listUnavailable,
  }).pipe(
    Effect.map(({ instances, unavailable }) => groupProviderHistorySources(instances, unavailable)),
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

  const loadHistorySummaries = Effect.fn("HarnessChatSync.loadHistorySummaries")(function* (
    group: HarnessHistorySourceGroup,
    input: { readonly query: string; readonly includeArchived: boolean },
    refresh = false,
  ) {
    const cacheKey = `${group.continuationKey}\0${input.includeArchived ? "1" : "0"}\0${input.query.trim()}`;
    const currentTime = yield* Clock.currentTimeMillis;
    if (!refresh) {
      const cached = (yield* Ref.get(summaryCache)).get(cacheKey);
      if (cached && cached.expiresAt > currentTime) return cached.summaries;
    }
    const summaries = yield* loadAllHistorySummaries(group, input);
    yield* Ref.update(summaryCache, (current) => {
      const next = new Map(current);
      for (const [key, value] of next) {
        if (value.expiresAt <= currentTime) next.delete(key);
      }
      while (next.size >= HISTORY_SUMMARY_CACHE_MAX_ENTRIES) {
        const oldestKey = next.keys().next().value;
        if (oldestKey === undefined) break;
        next.delete(oldestKey);
      }
      next.set(cacheKey, {
        expiresAt: currentTime + HISTORY_SUMMARY_CACHE_TTL_MS,
        summaries,
      });
      return next;
    });
    return summaries;
  });

  const sourceDescriptor = Effect.fn("HarnessChatSync.sourceDescriptor")(function* (
    group: HarnessHistorySourceGroup,
  ): Effect.fn.Return<HarnessChatSyncSource, HarnessChatSyncError> {
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

    const loaded = yield* Effect.result(
      Effect.all({
        summaries: loadHistorySummaries(group, { query: "", includeArchived: false }),
        links: readLinks(group),
      }),
    );
    if (Result.isFailure(loaded)) {
      return {
        ...base,
        status: {
          kind: "unsupported" as const,
          reason: describeFailure(
            loaded.failure,
            "This harness could not list resumable chat history.",
          ),
        },
        chatCount: 0,
        changedCount: 0,
        latestUpdatedAt: null,
      };
    }

    const links = loaded.success.links;
    let latestUpdatedAt: IsoDateTime | null = null;
    let changedCount = 0;
    for (const summary of loaded.success.summaries) {
      const updatedAt = isIsoDateTime(summary.updatedAt) ? summary.updatedAt : null;
      if (updatedAt !== null && (latestUpdatedAt === null || updatedAt > latestUpdatedAt)) {
        latestUpdatedAt = updatedAt;
      }
      const nativeSessionId = HarnessChatSessionId.make(summary.sessionId.trim());
      if (isChanged(updatedAt, links.get(nativeSessionId))) changedCount += 1;
    }
    return {
      ...base,
      chatCount: loaded.success.summaries.length,
      changedCount,
      latestUpdatedAt,
    };
  });

  const sources: HarnessChatSyncShape["sources"] = Effect.gen(function* () {
    const groups = yield* getGroups;
    return {
      sources: yield* Effect.forEach(groups, sourceDescriptor, { concurrency: 4 }),
    };
  }).pipe(
    Effect.mapError((cause) =>
      isHarnessChatSyncError(cause)
        ? cause
        : harnessSyncError("operation-failed", "Could not discover harness histories.", cause),
    ),
  );

  const publicSummary = Effect.fn("HarnessChatSync.publicSummary")(function* (input: {
    readonly summary: ProviderHistoryThreadSummary;
    readonly fallbackTimestamp: IsoDateTime;
    readonly link: ProjectionHarnessChatSyncLink | undefined;
    readonly supportsActivityStatus: boolean;
    readonly projects: ReadonlyArray<{
      readonly id: ProjectId;
      readonly workspaceRoot: string;
    }>;
  }): Effect.fn.Return<HarnessChatSummary, never> {
    const summary = normalizeHistorySummary(input.summary, input.fallbackTimestamp);
    const targetProject = input.link
      ? ({ kind: "existing", projectId: input.link.projectId } as const)
      : yield* resolveHarnessChatTargetProject({
          cwd: summary.cwd,
          projects: input.projects,
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
      hasChanges: isChanged(summary.updatedAt, input.link),
      activity: input.supportsActivityStatus ? summary.activity : "unknown",
      targetProject,
      link: input.link ? toPublicLink(input.link) : null,
    };
  });

  const list: HarnessChatSyncShape["list"] = Effect.fn("HarnessChatSync.list")(function* (input) {
    const group = yield* requireSource(input.sourceId);
    const fallbackTimestamp = yield* now;
    const loaded = yield* loadHistorySummaries(group, {
      query: input.query,
      includeArchived: input.includeArchived,
    }).pipe(
      Effect.mapError((cause) =>
        harnessSyncError("source-unavailable", "Could not list that harness history.", cause),
      ),
    );
    const [links, snapshot] = yield* Effect.all([
      readLinks(group),
      projections
        .getShellSnapshot()
        .pipe(
          Effect.mapError((cause) =>
            harnessSyncError("operation-failed", "Could not resolve target projects.", cause),
          ),
        ),
    ]);
    const offset = decodeListOffset(input.cursor);
    const page = loaded.slice(offset, offset + input.limit);
    const chats = yield* Effect.forEach(
      page,
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
    const changedMatching = loaded.reduce((count, summary) => {
      const normalized = normalizeHistorySummary(summary, fallbackTimestamp);
      return count + (isChanged(normalized.updatedAt, links.get(normalized.sessionId)) ? 1 : 0);
    }, 0);
    const nextOffset = offset + page.length;
    return {
      chats,
      nextCursor: nextOffset < loaded.length ? `${LIST_CURSOR_PREFIX}${nextOffset}` : null,
      totalMatching: loaded.length,
      changedMatching,
    };
  });

  const persistAttachment = Effect.fn("HarnessChatSync.persistAttachment")(function* (input: {
    readonly threadId: ThreadId;
    readonly sourceId: HarnessChatSyncSourceId;
    readonly nativeMessageId: string;
    readonly attachment: ProviderHistoryAttachment;
  }): Effect.fn.Return<ChatAttachment | null, never> {
    let mimeType = input.attachment.mimeType.trim().toLowerCase();
    let bytes: Uint8Array;
    switch (input.attachment.content.type) {
      case "data-url": {
        const parsed = parseBase64DataUrl(input.attachment.content.dataUrl);
        if (!parsed) return null;
        mimeType = parsed.mimeType.toLowerCase();
        bytes = new Uint8Array(Buffer.from(parsed.base64, "base64"));
        break;
      }
      case "file": {
        const read = yield* Effect.result(fileSystem.readFile(input.attachment.content.path));
        if (Result.isFailure(read)) return null;
        bytes = read.success;
        break;
      }
      case "url":
        return null;
    }
    if (!mimeType.startsWith(`${input.attachment.type}/`)) return null;
    const maxBytes =
      input.attachment.type === "image"
        ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
        : CHAT_ATTACHMENT_MAX_AUDIO_BYTES;
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;

    const attachment: ChatAttachment = {
      type: input.attachment.type,
      id: makeHarnessChatSyncAttachmentId({
        threadId: input.threadId,
        sourceId: input.sourceId,
        nativeMessageId: input.nativeMessageId,
        nativeAttachmentId: input.attachment.nativeAttachmentId,
      }),
      name: input.attachment.name.trim().slice(0, 255) || "imported-image",
      mimeType: mimeType.slice(0, 100),
      sizeBytes: bytes.byteLength,
    };
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: config.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) return null;

    const exists = yield* fileSystem.exists(attachmentPath).pipe(Effect.orElseSucceed(() => false));
    if (exists) return attachment;
    const persisted = yield* Effect.result(
      fileSystem
        .makeDirectory(path.dirname(attachmentPath), { recursive: true })
        .pipe(Effect.andThen(fileSystem.writeFile(attachmentPath, bytes))),
    );
    return Result.isSuccess(persisted) ? attachment : null;
  });

  const status: HarnessChatSyncShape["status"] = Effect.fn("HarnessChatSync.status")(
    function* (input) {
      let sourceId: HarnessChatSyncSourceId;
      let requestedSessionIds: ReadonlyArray<HarnessChatSessionId>;
      if ("threadId" in input) {
        const linked = yield* syncRepository
          .getLinkByThreadId({ threadId: input.threadId })
          .pipe(
            Effect.mapError((cause) =>
              harnessSyncError("operation-failed", "Could not read the harness chat link.", cause),
            ),
          );
        if (Option.isNone(linked)) return { statuses: [] };
        sourceId = linked.value.sourceId;
        requestedSessionIds = [linked.value.nativeSessionId];
      } else {
        sourceId = input.sourceId;
        requestedSessionIds = input.sessionIds;
      }

      const group = yield* requireSource(sourceId);
      const instance = group.preferred;
      if (!instance || instance.historySync.availability !== "supported") {
        return yield* harnessSyncError(
          "source-unavailable",
          "No enabled provider instance can read that harness history source.",
        );
      }
      const fallbackTimestamp = yield* now;
      const summaries = yield* loadHistorySummaries(
        group,
        { query: "", includeArchived: true },
        true,
      ).pipe(
        Effect.mapError((cause) =>
          harnessSyncError("source-unavailable", "Could not refresh harness chat status.", cause),
        ),
      );
      const summariesById = new Map(
        summaries.map((summary) => [
          HarnessChatSessionId.make(summary.sessionId.trim()),
          normalizeHistorySummary(summary, fallbackTimestamp),
        ]),
      );
      const links = yield* readLinks(group);
      const sessionIds = [
        ...new Set(requestedSessionIds.map((sessionId) => HarnessChatSessionId.make(sessionId))),
      ];
      const statuses = yield* Effect.forEach(
        sessionIds,
        Effect.fn("HarnessChatSync.refreshOneStatus")(function* (sessionId) {
          const summary = summariesById.get(sessionId);
          const existingLink = links.get(sessionId);
          let activity: HarnessChatActivity = existingLink?.activity ?? "unknown";
          if (instance.historySync.availability === "supported") {
            const checkActivity = instance.historySync.adapter.checkActivity;
            if (checkActivity) {
              const checked = yield* Effect.result(checkActivity({ sessionId }));
              if (Result.isSuccess(checked)) activity = checked.success;
            } else {
              activity = "unknown";
            }
          }

          let publicLink = existingLink ? toPublicLink(existingLink) : null;
          if (existingLink && existingLink.activity !== activity) {
            const updatedLink: ProjectionHarnessChatSyncLink = {
              ...existingLink,
              activity,
            };
            const dispatched = yield* Effect.result(
              orchestration.dispatch({
                type: "thread.harness-sync.link",
                commandId: CommandId.make(
                  makeHarnessChatSyncId(
                    "status",
                    group.continuationKey,
                    sessionId,
                    activity,
                    fallbackTimestamp,
                  ),
                ),
                threadId: existingLink.threadId,
                sourceId: existingLink.sourceId,
                continuationKey: existingLink.continuationKey,
                nativeSessionId: existingLink.nativeSessionId,
                providerInstanceId: existingLink.providerInstanceId,
                providerLabel: existingLink.providerLabel,
                activity,
                // A status refresh must not advance the last-imported source
                // watermark or hide newly arrived provider messages.
                sourceUpdatedAt: existingLink.sourceUpdatedAt,
                lastSyncedAt: existingLink.lastSyncedAt,
              }),
            );
            if (Result.isFailure(dispatched)) {
              return yield* harnessSyncError(
                "operation-failed",
                "Could not persist the refreshed harness activity status.",
                dispatched.failure,
              );
            }
            publicLink = toPublicLink(updatedLink);
          }

          return {
            sessionId,
            activity,
            sourceUpdatedAt: summary?.updatedAt ?? null,
            hasChanges: summary ? isChanged(summary.updatedAt, existingLink) : false,
            link: publicLink,
          };
        }),
        { concurrency: 4 },
      );
      return { statuses };
    },
  );

  const resolveModelSelection = Effect.fn("HarnessChatSync.resolveModelSelection")(function* (
    instance: ProviderInstance,
    sourceModel: string | null,
  ): Effect.fn.Return<ModelSelection> {
    if (sourceModel) return { instanceId: instance.instanceId, model: sourceModel };
    const snapshot = yield* instance.snapshot.getSnapshot;
    const model =
      snapshot.models.find((candidate) => candidate.isDefault)?.slug ??
      snapshot.models[0]?.slug ??
      DEFAULT_MODEL_BY_PROVIDER[instance.driverKind] ??
      DEFAULT_MODEL;
    return { instanceId: instance.instanceId, model };
  });

  const run: HarnessChatSyncShape["run"] = Effect.fn("HarnessChatSync.run")(function* (input) {
    const group = yield* requireSource(input.sourceId);
    const selectedInstance = input.providerInstanceId
      ? group.instances.find(
          (instance) =>
            instance.instanceId === input.providerInstanceId &&
            instance.enabled &&
            instance.historySync.availability === "supported",
        )
      : group.preferred;
    if (!selectedInstance || selectedInstance.historySync.availability !== "supported") {
      return yield* harnessSyncError(
        "source-unavailable",
        "The selected provider instance cannot read this harness history.",
      );
    }
    const selectedHistory = selectedInstance.historySync;
    if (input.selection.mode === "only" && input.selection.sessionIds.length === 0) {
      return yield* harnessSyncError("invalid-selection", "Select at least one chat to sync.");
    }

    const fallbackTimestamp = yield* now;
    const nativeSummaries = yield* loadHistorySummaries(
      group,
      {
        query: input.selection.mode === "allMatching" ? input.selection.query : "",
        includeArchived:
          input.selection.mode === "allMatching" ? input.selection.includeArchived : true,
      },
      true,
    ).pipe(
      Effect.mapError((cause) =>
        harnessSyncError("source-unavailable", "Could not enumerate selected chats.", cause),
      ),
    );
    const summariesById = new Map(
      nativeSummaries.map((summary) => {
        const normalized = normalizeHistorySummary(summary, fallbackTimestamp);
        return [normalized.sessionId, normalized] as const;
      }),
    );
    let selectedSessionIds: ReadonlyArray<HarnessChatSessionId>;
    if (input.selection.mode === "allMatching") {
      const excluded = new Set(input.selection.excludedSessionIds);
      selectedSessionIds = nativeSummaries
        .map((summary) => HarnessChatSessionId.make(summary.sessionId.trim()))
        .filter((sessionId) => !excluded.has(sessionId));
    } else {
      selectedSessionIds = input.selection.sessionIds;
    }
    const uniqueSessionIds = [
      ...new Set(selectedSessionIds.map((sessionId) => HarnessChatSessionId.make(sessionId))),
    ];
    const links = yield* readLinks(group);
    const snapshot = yield* projections
      .getShellSnapshot()
      .pipe(
        Effect.mapError((cause) =>
          harnessSyncError("operation-failed", "Could not resolve target projects.", cause),
        ),
      );
    const projects: Array<Pick<OrchestrationProjectShell, "id" | "title" | "workspaceRoot">> =
      snapshot.projects.map((project) => ({
        id: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
      }));
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const targetResolutions = new Map(
      input.targetResolutions.map((resolution) => [resolution.sessionId, resolution.projectId]),
    );

    const resolveTarget = Effect.fn("HarnessChatSync.resolveRunTarget")(function* (candidate: {
      readonly summary: NormalizedHistorySummary;
      readonly link: ProjectionHarnessChatSyncLink | undefined;
    }): Effect.fn.Return<ResolvedRunTarget, SessionSyncFailure> {
      if (candidate.link) return { projectId: candidate.link.projectId };

      const explicitProjectId = targetResolutions.get(candidate.summary.sessionId);
      if (explicitProjectId) {
        if (projectsById.has(explicitProjectId)) return { projectId: explicitProjectId };
        return yield* sessionSyncFailure({
          sessionId: candidate.summary.sessionId,
          code: "target-unresolved",
          message: "The selected target project is no longer available.",
          retryable: true,
        });
      }

      const automatic = yield* resolveHarnessChatTargetProject({
        cwd: candidate.summary.cwd,
        projects,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      if (automatic.kind === "existing") return { projectId: automatic.projectId };
      if (automatic.kind === "create") {
        return {
          create: {
            rootPath: automatic.rootPath,
            suggestedName: automatic.suggestedName,
          },
        };
      }

      if (input.unresolvedTargetProjectId && projectsById.has(input.unresolvedTargetProjectId)) {
        return { projectId: input.unresolvedTargetProjectId };
      }
      return yield* sessionSyncFailure({
        sessionId: candidate.summary.sessionId,
        code: "target-unresolved",
        message: "Choose a target project before synchronizing this chat.",
        retryable: true,
      });
    });

    const createTargetProject = Effect.fn("HarnessChatSync.createTargetProject")(function* (input: {
      readonly sessionId: HarnessChatSessionId;
      readonly create: NonNullable<ResolvedRunTarget["create"]>;
      readonly modelSelection: ModelSelection;
    }): Effect.fn.Return<ProjectId, SessionSyncFailure> {
      const normalizedRoot = path.resolve(input.create.rootPath);
      const existing = projects.find(
        (project) => path.resolve(project.workspaceRoot) === normalizedRoot,
      );
      if (existing) return existing.id;

      const projectId = ProjectId.make(makeHarnessChatSyncId("project", normalizedRoot));
      const dispatched = yield* Effect.result(
        orchestration.dispatch({
          type: "project.create",
          commandId: CommandId.make(makeHarnessChatSyncId("project-command", normalizedRoot)),
          projectId,
          title: input.create.suggestedName,
          workspaceRoot: normalizedRoot,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: input.modelSelection,
          createdAt: fallbackTimestamp,
        }),
      );
      if (Result.isFailure(dispatched)) {
        const concurrent = yield* Effect.result(
          projections.getActiveProjectByWorkspaceRoot(normalizedRoot),
        );
        if (Result.isSuccess(concurrent) && Option.isSome(concurrent.success)) {
          const project = concurrent.success.value;
          projects.push({
            id: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
          });
          projectsById.set(project.id, project);
          return project.id;
        }
        return yield* sessionSyncFailure({
          sessionId: input.sessionId,
          code: "project-create-failed",
          message: describeFailure(dispatched.failure, "Could not create the target project."),
          retryable: true,
        });
      }

      const project = {
        id: projectId,
        title: input.create.suggestedName,
        workspaceRoot: normalizedRoot,
      };
      projects.push(project);
      projectsById.set(projectId, project);
      return projectId;
    });

    const syncOne = Effect.fn("HarnessChatSync.syncOne")(function* (input: {
      readonly summary: NormalizedHistorySummary;
      readonly link: ProjectionHarnessChatSyncLink | undefined;
    }): Effect.fn.Return<HarnessChatSyncRunItem, SessionSyncFailure> {
      const target = yield* resolveTarget(input);
      const read = yield* Effect.result(
        selectedHistory.adapter.read({ sessionId: input.summary.sessionId }),
      );
      if (Result.isFailure(read)) {
        return yield* sessionSyncFailure({
          sessionId: input.summary.sessionId,
          code: "history-read-failed",
          message: describeFailure(read.failure, "Could not read the provider transcript."),
          retryable: true,
        });
      }
      const transcript: ProviderHistoryTranscript = read.success;
      if (transcript.sessionId.trim() !== input.summary.sessionId) {
        return yield* sessionSyncFailure({
          sessionId: input.summary.sessionId,
          code: "history-read-failed",
          message: "The provider returned a transcript for a different session.",
          retryable: false,
        });
      }

      const sourceUpdatedAt = normalizeIsoDateTime(transcript.updatedAt, input.summary.updatedAt);
      const modelSelection = yield* resolveModelSelection(
        selectedInstance,
        normalizeOptionalText(transcript.model) ?? input.summary.model,
      );
      const projectId = target.projectId
        ? target.projectId
        : yield* createTargetProject({
            sessionId: input.summary.sessionId,
            create: target.create!,
            modelSelection,
          });
      const created = input.link === undefined;
      const threadId =
        input.link?.threadId ??
        ThreadId.make(
          makeHarnessChatSyncId("thread", group.continuationKey, input.summary.sessionId),
        );
      const threadCreatedAt =
        input.summary.createdAt ??
        transcript.items.reduce<IsoDateTime | null>((earliest, item) => {
          const candidate =
            item.createdAt !== undefined && isIsoDateTime(item.createdAt) ? item.createdAt : null;
          if (candidate === null) return earliest;
          return earliest === null || candidate < earliest ? candidate : earliest;
        }, null) ??
        sourceUpdatedAt;
      if (created) {
        const threadCreated = yield* Effect.result(
          orchestration.dispatch({
            type: "thread.create",
            commandId: CommandId.make(
              makeHarnessChatSyncId(
                "thread-command",
                group.continuationKey,
                input.summary.sessionId,
              ),
            ),
            threadId,
            projectId,
            title: input.summary.title,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: threadCreatedAt,
          }),
        );
        if (Result.isFailure(threadCreated)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "sync-failed",
            message: describeFailure(threadCreated.failure, "Could not create the local chat."),
            retryable: true,
          });
        }
      }

      const existingMessageLinks = yield* Effect.result(
        syncRepository.listMessageLinksByThreadId({ threadId }),
      );
      if (Result.isFailure(existingMessageLinks)) {
        return yield* sessionSyncFailure({
          sessionId: input.summary.sessionId,
          code: "sync-failed",
          message: "Could not read existing native message mappings.",
          retryable: true,
        });
      }
      const importedNativeIds = new Set<string>(
        existingMessageLinks.success.map((entry) => entry.nativeMessageId),
      );
      const linkedMessageIds = new Set<MessageId>(
        existingMessageLinks.success.map((entry) => entry.messageId),
      );
      const hasUnmappedMessages = transcript.items.some(
        (item) =>
          item.kind === "message" &&
          item.nativeMessageId.trim().length > 0 &&
          !importedNativeIds.has(item.nativeMessageId.trim()),
      );
      let existingMessages: ReadonlyArray<OrchestrationMessage> = [];
      if (input.link && hasUnmappedMessages) {
        const detail = yield* Effect.result(projections.getThreadDetailById(threadId));
        if (Result.isFailure(detail)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "sync-failed",
            message: "Could not compare the native transcript with existing local messages.",
            retryable: true,
          });
        }
        existingMessages = Option.isSome(detail.success) ? detail.success.value.messages : [];
      }
      const claimedMessageIds = new Set<MessageId>();
      let messagesImported = 0;
      let attachmentsImported = 0;
      let attachmentsSkipped = 0;
      for (const item of transcript.items) {
        if (item.kind === "plan") {
          const nativePlanId = item.nativePlanId.trim();
          const planMarkdown = item.markdown.trim();
          if (!nativePlanId || !planMarkdown) continue;
          const planCreatedAt = normalizeIsoDateTime(item.createdAt, sourceUpdatedAt);
          const planUpdatedAt = normalizeIsoDateTime(item.updatedAt, planCreatedAt);
          const planned = yield* Effect.result(
            orchestration.dispatch({
              type: "thread.proposed-plan.upsert",
              commandId: CommandId.make(
                makeHarnessChatSyncId(
                  "plan-command",
                  group.continuationKey,
                  input.summary.sessionId,
                  nativePlanId,
                ),
              ),
              threadId,
              proposedPlan: {
                id: OrchestrationProposedPlanId.make(
                  makeHarnessChatSyncId(
                    "plan",
                    group.continuationKey,
                    input.summary.sessionId,
                    nativePlanId,
                  ),
                ),
                turnId: null,
                planMarkdown,
                implementedAt: null,
                implementationThreadId: null,
                createdAt: planCreatedAt,
                updatedAt: planUpdatedAt,
              },
              createdAt: planCreatedAt,
            }),
          );
          if (Result.isFailure(planned)) {
            return yield* sessionSyncFailure({
              sessionId: input.summary.sessionId,
              code: "sync-failed",
              message: describeFailure(planned.failure, "Could not import a provider plan."),
              retryable: true,
              messagesImported,
              attachmentsImported,
              attachmentsSkipped,
            });
          }
          continue;
        }

        const nativeMessageId = item.nativeMessageId.trim();
        if (!nativeMessageId || importedNativeIds.has(nativeMessageId)) continue;
        const existingMessage = findExistingHarnessMessageMatch({
          nativeMessageId,
          role: item.role,
          text: item.text,
          messages: existingMessages,
          linkedMessageIds,
          claimedMessageIds,
        });
        if (existingMessage) {
          const linked = yield* Effect.result(
            orchestration.dispatch({
              type: "thread.harness-sync.message.import",
              commandId: CommandId.make(
                makeHarnessChatSyncId(
                  "message-link-command",
                  group.continuationKey,
                  input.summary.sessionId,
                  nativeMessageId,
                ),
              ),
              threadId,
              nativeMessageId,
              message: existingMessage,
              linkedAt: fallbackTimestamp,
            }),
          );
          if (Result.isFailure(linked)) {
            return yield* sessionSyncFailure({
              sessionId: input.summary.sessionId,
              code: "sync-failed",
              message: describeFailure(
                linked.failure,
                "Could not link an existing local message to the native transcript.",
              ),
              retryable: true,
              messagesImported,
              attachmentsImported,
              attachmentsSkipped,
            });
          }
          importedNativeIds.add(nativeMessageId);
          claimedMessageIds.add(existingMessage.id);
          continue;
        }
        const persistedAttachments = yield* Effect.forEach(
          item.attachments,
          (attachment) =>
            persistAttachment({
              threadId,
              sourceId: group.sourceId,
              nativeMessageId,
              attachment,
            }),
          { concurrency: 1 },
        );
        const availableAttachments = persistedAttachments.filter(
          (attachment): attachment is ChatAttachment => attachment !== null,
        );
        attachmentsImported += availableAttachments.length;
        attachmentsSkipped += item.attachments.length - availableAttachments.length;
        const messageCreatedAt = normalizeIsoDateTime(item.createdAt, sourceUpdatedAt);
        const messageUpdatedAt = normalizeIsoDateTime(item.updatedAt, messageCreatedAt);
        const imported = yield* Effect.result(
          orchestration.dispatch({
            type: "thread.harness-sync.message.import",
            commandId: CommandId.make(
              makeHarnessChatSyncId(
                "message-command",
                group.continuationKey,
                input.summary.sessionId,
                nativeMessageId,
              ),
            ),
            threadId,
            nativeMessageId,
            message: {
              id:
                item.role === "assistant"
                  ? MessageId.make(`assistant:${nativeMessageId}`)
                  : MessageId.make(
                      makeHarnessChatSyncId(
                        "message",
                        group.continuationKey,
                        input.summary.sessionId,
                        nativeMessageId,
                      ),
                    ),
              role: item.role,
              text: item.text,
              ...(availableAttachments.length > 0 ? { attachments: availableAttachments } : {}),
              turnId: null,
              streaming: false,
              createdAt: messageCreatedAt,
              updatedAt: messageUpdatedAt,
            },
            linkedAt: fallbackTimestamp,
          }),
        );
        if (Result.isFailure(imported)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "sync-failed",
            message: describeFailure(imported.failure, "Could not import a provider message."),
            retryable: true,
            messagesImported,
            attachmentsImported,
            attachmentsSkipped,
          });
        }
        importedNativeIds.add(HarnessChatNativeMessageId.make(nativeMessageId));
        messagesImported += 1;
      }

      const resumed = yield* Effect.result(
        selectedHistory.adapter.resumeCursor({ sessionId: input.summary.sessionId }),
      );
      if (Result.isFailure(resumed)) {
        return yield* sessionSyncFailure({
          sessionId: input.summary.sessionId,
          code: "resume-bind-failed",
          message: describeFailure(resumed.failure, "Could not prepare the native resume cursor."),
          retryable: true,
          messagesImported,
          attachmentsImported,
          attachmentsSkipped,
        });
      }

      let activity: HarnessChatActivity = "unknown";
      const checkActivity = selectedHistory.adapter.checkActivity;
      if (checkActivity) {
        const checked = yield* Effect.result(checkActivity({ sessionId: input.summary.sessionId }));
        activity = Result.isSuccess(checked)
          ? checked.success
          : (input.link?.activity ?? "unknown");
      }
      const owningInstanceId: ProviderInstanceId =
        input.link?.providerInstanceId ?? selectedInstance.instanceId;
      const owningInstance = group.instances.find(
        (instance) => instance.instanceId === owningInstanceId,
      );
      const providerLabel =
        input.link?.providerLabel ?? selectedInstance.displayName?.trim() ?? group.label;
      const bound = yield* Effect.result(
        sessionDirectory.upsert({
          threadId,
          provider: owningInstance?.driverKind ?? selectedInstance.driverKind,
          providerInstanceId: owningInstanceId,
          ...(resumed.success.adapterKey === undefined
            ? {}
            : { adapterKey: resumed.success.adapterKey }),
          status: "stopped",
          resumeCursor: resumed.success.resumeCursor,
          ...(resumed.success.runtimePayload === undefined
            ? {}
            : { runtimePayload: resumed.success.runtimePayload }),
          runtimeMode: DEFAULT_RUNTIME_MODE,
        }),
      );
      if (Result.isFailure(bound)) {
        return yield* sessionSyncFailure({
          sessionId: input.summary.sessionId,
          code: "resume-bind-failed",
          message: describeFailure(bound.failure, "Could not persist the native resume binding."),
          retryable: true,
          messagesImported,
          attachmentsImported,
          attachmentsSkipped,
        });
      }

      const lastSyncedAt = yield* now;
      const linked = yield* Effect.result(
        orchestration.dispatch({
          type: "thread.harness-sync.link",
          commandId: CommandId.make(
            makeHarnessChatSyncId(
              "link-command",
              group.continuationKey,
              input.summary.sessionId,
              sourceUpdatedAt,
              activity,
              lastSyncedAt,
            ),
          ),
          threadId,
          sourceId: group.sourceId,
          continuationKey: group.continuationKey,
          nativeSessionId: input.summary.sessionId,
          providerInstanceId: owningInstanceId,
          providerLabel,
          activity,
          sourceUpdatedAt,
          lastSyncedAt,
        }),
      );
      if (Result.isFailure(linked)) {
        return yield* sessionSyncFailure({
          sessionId: input.summary.sessionId,
          code: "sync-failed",
          message: describeFailure(linked.failure, "Could not link the native harness session."),
          retryable: true,
          messagesImported,
          attachmentsImported,
          attachmentsSkipped,
        });
      }

      const link: HarnessChatLink = {
        sourceId: group.sourceId,
        nativeSessionId: input.summary.sessionId,
        threadId,
        projectId,
        providerInstanceId: owningInstanceId,
        providerLabel,
        activity,
        sourceUpdatedAt,
        lastSyncedAt,
      };
      return {
        sessionId: input.summary.sessionId,
        threadId,
        projectId,
        created,
        messagesImported,
        attachmentsImported,
        attachmentsSkipped,
        link,
      };
    });

    const outcomes = yield* Effect.forEach(
      uniqueSessionIds,
      (sessionId) => {
        const summary = summariesById.get(sessionId);
        if (!summary) {
          return Effect.succeed(
            Result.fail(
              sessionSyncFailure({
                sessionId,
                code: "session-unavailable",
                message: "That provider session is no longer available.",
                retryable: true,
              }),
            ),
          );
        }
        return Effect.result(syncOne({ summary, link: links.get(sessionId) }));
      },
      { concurrency: 1 },
    );
    const successful = outcomes.filter(Result.isSuccess).map((outcome) => outcome.success);
    const failed = outcomes.filter(Result.isFailure).map((outcome) => outcome.failure);
    const messagesImported =
      successful.reduce((total, item) => total + item.messagesImported, 0) +
      failed.reduce((total, item) => total + item.messagesImported, 0);
    const attachmentsImported =
      successful.reduce((total, item) => total + item.attachmentsImported, 0) +
      failed.reduce((total, item) => total + item.attachmentsImported, 0);
    const attachmentsSkipped =
      successful.reduce((total, item) => total + item.attachmentsSkipped, 0) +
      failed.reduce((total, item) => total + item.attachmentsSkipped, 0);
    return {
      selectedCount: uniqueSessionIds.length,
      syncedCount: successful.length,
      failedCount: failed.length,
      threadsCreated: successful.filter((item) => item.created).length,
      threadsUpdated: successful.filter((item) => !item.created).length,
      messagesImported,
      attachmentsImported,
      attachmentsSkipped,
      items: successful,
      failures: failed.map((item) => item.failure),
    };
  });

  return { sources, list, run, status } satisfies HarnessChatSyncShape;
});
