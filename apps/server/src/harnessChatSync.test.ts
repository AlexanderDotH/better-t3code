import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  findExistingHarnessMessageMatch,
  makeHarnessChatSyncAttachmentId,
  makeHarnessChatSyncId,
  makeHarnessChatSync,
  resolveHarnessChatTargetProject,
} from "./harnessChatSync.ts";
import { resolveAttachmentPath } from "./attachmentStore.ts";
import * as ServerConfig from "./config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncLink,
  type ProjectionHarnessChatSyncMessageLink,
} from "./persistence/Services/ProjectionHarnessChatSync.ts";
import type { ProviderInstance } from "./provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "./provider/Services/ProviderInstanceRegistry.ts";
import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory.ts";
import type { ProviderRuntimeBinding } from "./provider/Services/ProviderSessionDirectory.ts";
import {
  makeSupportedProviderHistorySync,
  type ProviderHistorySyncAdapter,
} from "./provider/Services/ProviderHistorySync.ts";

const createdAt = "2026-08-23T10:00:00.000Z";

function makeProjectShell(id: string, workspaceRoot: string): OrchestrationProjectShell {
  return {
    id: ProjectId.make(id),
    title: NodePath.basename(workspaceRoot),
    workspaceRoot,
    defaultModelSelection: null,
    checkpointsEnabled: true,
    scripts: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function makeHistoryInstance(input: {
  readonly instanceId: string;
  readonly sourceId: string;
  readonly continuationKey: string;
  readonly adapter: ProviderHistorySyncAdapter;
}): ProviderInstance {
  const instanceId = ProviderInstanceId.make(input.instanceId);
  const driverKind = ProviderDriverKind.make("customHarness");
  return {
    instanceId,
    driverKind,
    continuationIdentity: { driverKind, continuationKey: input.continuationKey },
    displayName: input.instanceId,
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed({
        models: [{ slug: "custom-default", isDefault: true }],
      } as never),
    } as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    historySync: makeSupportedProviderHistorySync({
      source: {
        sourceId: input.sourceId,
        continuationKey: input.continuationKey,
        displayName: "Custom history",
        capabilities: { search: true, archived: true, resume: true, activity: true },
      },
      adapter: input.adapter,
    }),
    textGeneration: {} as ProviderInstance["textGeneration"],
  };
}

function makeHarnessSyncTestLayer(input: {
  readonly baseDir: string;
  readonly instances: ReadonlyArray<ProviderInstance>;
  readonly commands?: Array<OrchestrationCommand>;
  readonly links?: Map<string, ProjectionHarnessChatSyncLink>;
  readonly messageLinks?: Map<string, ProjectionHarnessChatSyncMessageLink>;
  readonly projects?: Array<OrchestrationProjectShell>;
  readonly bindings?: Array<ProviderRuntimeBinding>;
  readonly unavailable?: ReadonlyArray<ServerProvider>;
}) {
  const links = input.links ?? new Map<string, ProjectionHarnessChatSyncLink>();
  const messageLinks =
    input.messageLinks ?? new Map<string, ProjectionHarnessChatSyncMessageLink>();
  const commands = input.commands ?? [];
  const projects = input.projects ?? [];
  const bindings = input.bindings ?? [];
  const threadProjects = new Map<ThreadId, ProjectId>(
    [...links.values()].map((link) => [link.threadId, link.projectId]),
  );
  const repositoryLayer = Layer.succeed(ProjectionHarnessChatSyncRepository, {
    upsertLink: (link) => Effect.sync(() => void links.set(link.nativeSessionId, link)),
    getLinkByThreadId: ({ threadId }) =>
      Effect.succeed(
        Option.fromNullishOr(links.values().find((link) => link.threadId === threadId)),
      ),
    getLinkBySourceSession: ({ sourceId, nativeSessionId }) =>
      Effect.succeed(
        Option.fromNullishOr(
          links.get(nativeSessionId)?.sourceId === sourceId
            ? links.get(nativeSessionId)
            : undefined,
        ),
      ),
    getLinkByContinuationSession: ({ continuationKey, nativeSessionId }) =>
      Effect.succeed(
        Option.fromNullishOr(
          links.get(nativeSessionId)?.continuationKey === continuationKey
            ? links.get(nativeSessionId)
            : undefined,
        ),
      ),
    listLinksByContinuationKey: ({ continuationKey }) =>
      Effect.succeed(
        [...links.values()].filter((link) => link.continuationKey === continuationKey),
      ),
    listLinksBySourceId: ({ sourceId }) =>
      Effect.succeed([...links.values()].filter((link) => link.sourceId === sourceId)),
    upsertMessageLink: (link) =>
      Effect.sync(() => void messageLinks.set(`${link.threadId}:${link.nativeMessageId}`, link)),
    getMessageLink: ({ threadId, nativeMessageId }) =>
      Effect.succeed(Option.fromNullishOr(messageLinks.get(`${threadId}:${nativeMessageId}`))),
    listMessageLinksByThreadId: ({ threadId }) =>
      Effect.succeed([...messageLinks.values()].filter((link) => link.threadId === threadId)),
  });
  const projectionLayer = Layer.succeed(ProjectionSnapshotQuery, {
    getShellSnapshot: () =>
      Effect.succeed({ snapshotSequence: 0, projects, threads: [], updatedAt: createdAt }),
    getActiveProjectByWorkspaceRoot: (workspaceRoot) =>
      Effect.succeed(
        Option.fromNullishOr(projects.find((project) => project.workspaceRoot === workspaceRoot)),
      ),
  } as ProjectionSnapshotQuery["Service"]);
  const orchestrationLayer = Layer.succeed(OrchestrationEngineService, {
    readEvents: () => Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        if (command.type === "project.create") {
          projects.push({
            id: command.projectId,
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            defaultModelSelection: command.defaultModelSelection ?? null,
            checkpointsEnabled: true,
            scripts: [],
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          });
        }
        if (command.type === "thread.create") {
          threadProjects.set(command.threadId, command.projectId);
        }
        if (command.type === "thread.harness-sync.message.import") {
          const key = `${command.threadId}:${command.nativeMessageId}`;
          if (!messageLinks.has(key)) {
            messageLinks.set(key, {
              threadId: command.threadId,
              nativeMessageId: command.nativeMessageId,
              messageId: command.message.id,
              linkedAt: command.linkedAt,
            });
          }
        }
        if (command.type === "thread.harness-sync.link") {
          const projectId = threadProjects.get(command.threadId);
          if (projectId) {
            links.set(command.nativeSessionId, {
              threadId: command.threadId,
              projectId,
              sourceId: command.sourceId,
              continuationKey: command.continuationKey,
              nativeSessionId: command.nativeSessionId,
              providerInstanceId: command.providerInstanceId,
              providerLabel: command.providerLabel,
              activity: command.activity,
              sourceUpdatedAt: command.sourceUpdatedAt,
              lastSyncedAt: command.lastSyncedAt,
            });
          }
        }
        return { sequence: commands.length };
      }),
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  });
  const instanceRegistryLayer = Layer.succeed(ProviderInstanceRegistry, {
    getInstance: (instanceId) =>
      Effect.succeed(input.instances.find((instance) => instance.instanceId === instanceId)),
    listInstances: Effect.succeed(input.instances),
    listUnavailable: Effect.succeed(input.unavailable ?? []),
    streamChanges: Stream.empty,
  } as ProviderInstanceRegistry["Service"]);
  const sessionDirectoryLayer = Layer.succeed(ProviderSessionDirectory, {
    upsert: (binding) => Effect.sync(() => void bindings.push(binding)),
    getProvider: () => Effect.die("not used"),
    getBinding: () => Effect.succeed(Option.none()),
    listThreadIds: () => Effect.succeed([]),
    listBindings: () => Effect.succeed([]),
  });
  const configLayer = ServerConfig.layerTest(process.cwd(), input.baseDir).pipe(
    Layer.provide(NodeServices.layer),
  );
  return Layer.mergeAll(
    NodeServices.layer,
    configLayer,
    repositoryLayer,
    projectionLayer,
    orchestrationLayer,
    instanceRegistryLayer,
    sessionDirectoryLayer,
  );
}

describe("Harness chat sync", () => {
  it("matches live provider messages before a later native history refresh", () => {
    const userMessage = {
      id: MessageId.make("local-user-message"),
      role: "user" as const,
      text: "Continue the work",
      turnId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    };
    const assistantMessage = {
      id: MessageId.make("assistant:native-assistant-message"),
      role: "assistant" as const,
      text: "Done",
      turnId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    };
    const messages = [userMessage, assistantMessage];

    expect(
      findExistingHarnessMessageMatch({
        nativeMessageId: "native-user-message",
        role: "user",
        text: "Continue the work",
        messages,
        linkedMessageIds: new Set(),
        claimedMessageIds: new Set(),
      })?.id,
    ).toBe(userMessage.id);
    expect(
      findExistingHarnessMessageMatch({
        nativeMessageId: "native-assistant-message",
        role: "assistant",
        text: "Done",
        messages,
        linkedMessageIds: new Set(),
        claimedMessageIds: new Set(),
      })?.id,
    ).toBe(assistantMessage.id);
    expect(
      findExistingHarnessMessageMatch({
        nativeMessageId: "native-user-message",
        role: "user",
        text: "Continue the work",
        messages,
        linkedMessageIds: new Set([userMessage.id]),
        claimedMessageIds: new Set(),
      }),
    ).toBeUndefined();
  });

  it("uses deterministic local ids for retry-safe imports", () => {
    const first = makeHarnessChatSyncId("thread", "codex:/home/work", "session-1");
    const second = makeHarnessChatSyncId("thread", "codex:/home/work", "session-1");
    const different = makeHarnessChatSyncId("thread", "codex:/home/work", "session-2");

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^harness-sync-thread-/);
  });

  it("uses a deterministic thread-scoped attachment id", () => {
    const first = makeHarnessChatSyncAttachmentId({
      threadId: "harness-sync-thread-123",
      sourceId: "codex-home",
      nativeMessageId: "message-1",
      nativeAttachmentId: "image-1",
    });
    const second = makeHarnessChatSyncAttachmentId({
      threadId: "harness-sync-thread-123",
      sourceId: "codex-home",
      nativeMessageId: "message-1",
      nativeAttachmentId: "image-1",
    });

    expect(first).toBe(second);
    expect(first).toMatch(
      /^harness-sync-thread-123-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it.effect("resolves normalized cwd matches before offering project creation", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-target-",
      });
      const existingProjectId = ProjectId.make("project-existing");

      const existing = yield* resolveHarnessChatTargetProject({
        cwd: NodePath.join(workspaceRoot, "nested", ".."),
        projects: [{ id: existingProjectId, workspaceRoot }],
      });
      const unregisteredRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-create-",
      });
      const create = yield* resolveHarnessChatTargetProject({
        cwd: unregisteredRoot,
        projects: [],
      });
      const missingRoot = NodePath.join(workspaceRoot, "missing");
      const unresolved = yield* resolveHarnessChatTargetProject({
        cwd: missingRoot,
        projects: [],
      });

      expect(existing).toEqual({ kind: "existing", projectId: existingProjectId });
      expect(create).toEqual({
        kind: "create",
        rootPath: unregisteredRoot,
        suggestedName: NodePath.basename(unregisteredRoot),
      });
      expect(unresolved).toEqual({ kind: "unresolved", sourceCwd: missingRoot });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("probes only one page for provider instances that share a continuation source", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-service-",
      });
      let secondaryListCalls = 0;
      let primaryListCalls = 0;
      const primaryListLimits: number[] = [];
      const summaries = Array.from({ length: 12 }, (_, index) => ({
        sessionId: `session-${index + 1}`,
        title: `Imported session ${index + 1}`,
        preview: "Preview",
        cwd: null,
        model: null,
        updatedAt: createdAt,
        archived: false,
        isChild: false,
        messageCount: 1,
        activity: "idle" as const,
      }));
      const primaryAdapter: ProviderHistorySyncAdapter = {
        list: ({ cursor, limit }) =>
          Effect.sync(() => {
            primaryListCalls += 1;
            primaryListLimits.push(limit);
            const offset = cursor === undefined ? 0 : Number(cursor);
            const items = summaries.slice(offset, offset + limit);
            const nextOffset = offset + items.length;
            return {
              items,
              ...(nextOffset < summaries.length ? { nextCursor: String(nextOffset) } : {}),
            };
          }),
        read: ({ sessionId }) => Effect.succeed({ sessionId, items: [], updatedAt: createdAt }),
        resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { sessionId } }),
      };
      const secondaryAdapter: ProviderHistorySyncAdapter = {
        ...primaryAdapter,
        list: (request) =>
          Effect.sync(() => {
            secondaryListCalls += 1;
            return { items: [], nextCursor: request.cursor };
          }),
      };
      const instances = [
        makeHistoryInstance({
          instanceId: "custom-primary",
          sourceId: "custom:history:shared",
          continuationKey: "custom:home:shared",
          adapter: primaryAdapter,
        }),
        makeHistoryInstance({
          instanceId: "custom-secondary",
          sourceId: "custom:history:shared",
          continuationKey: "custom:home:shared",
          adapter: secondaryAdapter,
        }),
      ];

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        const sources = yield* service.sources;
        const firstPage = yield* service.list({
          sourceId: HarnessChatSyncSourceId.make("custom:history:shared"),
          query: "",
          includeArchived: false,
          limit: 10,
        });
        const status = yield* service.status({
          sourceId: HarnessChatSyncSourceId.make("custom:history:shared"),
          sessionIds: firstPage.chats.map((chat) => chat.sessionId),
        });
        return { sources, firstPage, status };
      }).pipe(Effect.provide(makeHarnessSyncTestLayer({ baseDir, instances })));

      expect(result.sources.sources).toEqual([
        expect.objectContaining({
          id: HarnessChatSyncSourceId.make("custom:history:shared"),
          continuationKey: HarnessChatContinuationKey.make("custom:home:shared"),
          instanceIds: [
            ProviderInstanceId.make("custom-primary"),
            ProviderInstanceId.make("custom-secondary"),
          ],
          preferredInstanceId: ProviderInstanceId.make("custom-primary"),
          chatCount: 11,
          changedCount: 10,
        }),
      ]);
      expect(result.firstPage.chats).toHaveLength(10);
      expect(result.firstPage.nextCursor).not.toBeNull();
      expect(result.status.statuses).toHaveLength(10);
      expect(secondaryListCalls).toBe(0);
      expect(primaryListCalls).toBe(2);
      expect(primaryListLimits).toEqual([10, 10]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps an unavailable harness driver visible as an unsupported source", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-unavailable-",
      });
      const missing = {
        instanceId: ProviderInstanceId.make("missing-instance"),
        driver: ProviderDriverKind.make("missingHarness"),
        displayName: "Missing harness",
        continuation: { groupKey: "missing:group" },
        unavailableReason: "Install the missing harness driver.",
      } as ServerProvider;

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        return yield* service.sources;
      }).pipe(
        Effect.provide(
          makeHarnessSyncTestLayer({ baseDir, instances: [], unavailable: [missing] }),
        ),
      );

      expect(result.sources).toEqual([
        expect.objectContaining({
          id: HarnessChatSyncSourceId.make("missingHarness:history:missing:group"),
          continuationKey: HarnessChatContinuationKey.make("missing:group"),
          instanceIds: [ProviderInstanceId.make("missing-instance")],
          preferredInstanceId: null,
          status: {
            kind: "unsupported",
            reason: "Install the missing harness driver.",
          },
        }),
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves repeated provider cursor provenance at the public list boundary", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-repeated-cursor-",
      });
      const sourceId = HarnessChatSyncSourceId.make("custom:history:repeated-cursor");
      const adapter: ProviderHistorySyncAdapter = {
        list: () => Effect.succeed({ items: [], nextCursor: "repeat" }),
        read: ({ sessionId }) => Effect.succeed({ sessionId, items: [], updatedAt: createdAt }),
        resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { sessionId } }),
      };
      const instance = makeHistoryInstance({
        instanceId: "custom-repeated-cursor",
        sourceId,
        continuationKey: "custom:home:repeated-cursor",
        adapter,
      });

      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const service = yield* makeHarnessChatSync();
          return yield* service.list({
            sourceId,
            query: "",
            includeArchived: false,
            limit: 10,
          });
        }).pipe(Effect.provide(makeHarnessSyncTestLayer({ baseDir, instances: [instance] }))),
      );

      expect(error).toMatchObject({
        code: "source-unavailable",
        message: "Could not list that harness history.",
      });
      expect(String(error.cause)).toContain("repeated a pagination cursor");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("returns the first native history page without scanning the remaining chats", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-list-",
      });
      const existingRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-existing-",
      });
      const newRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-new-",
      });
      const sourceId = HarnessChatSyncSourceId.make("custom:history:list");
      const continuationKey = HarnessChatContinuationKey.make("custom:home:list");
      const project = makeProjectShell("project-list-existing", existingRoot);
      const linkedSessionId = HarnessChatSessionId.make("session-linked");
      const links = new Map<string, ProjectionHarnessChatSyncLink>([
        [
          linkedSessionId,
          {
            threadId: ThreadId.make("thread-linked"),
            projectId: project.id,
            sourceId,
            continuationKey,
            nativeSessionId: linkedSessionId,
            providerInstanceId: ProviderInstanceId.make("custom-primary"),
            providerLabel: "Custom history",
            activity: "idle",
            sourceUpdatedAt: createdAt,
            lastSyncedAt: createdAt,
          },
        ],
      ]);
      const summaries = [
        {
          sessionId: linkedSessionId,
          title: "Match linked",
          preview: null,
          cwd: existingRoot,
          model: null,
          updatedAt: createdAt,
          archived: false,
          isChild: false,
          messageCount: 1,
          activity: "idle" as const,
        },
        ...Array.from({ length: 11 }, (_, index) => ({
          sessionId: `session-new-${index + 1}`,
          title: `Match new ${index + 1}`,
          preview: null,
          cwd: newRoot,
          model: null,
          updatedAt: createdAt,
          archived: false,
          isChild: false,
          messageCount: 1,
          activity: "unknown" as const,
        })),
      ];
      const listRequests: Array<{ readonly cursor?: string; readonly limit: number }> = [];
      const adapter: ProviderHistorySyncAdapter = {
        list: ({ cursor, limit }) =>
          Effect.sync(() => {
            listRequests.push({ ...(cursor === undefined ? {} : { cursor }), limit });
            const offset = cursor === undefined ? 0 : Number(cursor);
            const items = summaries.slice(offset, offset + limit);
            const nextOffset = offset + items.length;
            return {
              items,
              ...(nextOffset < summaries.length ? { nextCursor: String(nextOffset) } : {}),
            };
          }),
        read: ({ sessionId }) => Effect.succeed({ sessionId, items: [], updatedAt: createdAt }),
        resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { sessionId } }),
      };
      const instance = makeHistoryInstance({
        instanceId: "custom-primary",
        sourceId,
        continuationKey,
        adapter,
      });

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        const first = yield* service.list({
          sourceId,
          query: "match",
          includeArchived: false,
          limit: 10,
        });
        const second = yield* service.list({
          sourceId,
          query: "match",
          includeArchived: false,
          cursor: first.nextCursor ?? undefined,
          limit: 10,
        });
        const legacyCursor = yield* service.list({
          sourceId,
          query: "match",
          includeArchived: false,
          cursor: "legacy-client-cursor",
          limit: 10,
        });
        const malformedVersionedCursor = yield* service.list({
          sourceId,
          query: "match",
          includeArchived: false,
          cursor: "harness-native:not-valid-base64",
          limit: 10,
        });
        return { first, second, legacyCursor, malformedVersionedCursor };
      }).pipe(
        Effect.provide(
          makeHarnessSyncTestLayer({
            baseDir,
            instances: [instance],
            links,
            projects: [project],
          }),
        ),
      );

      expect(result.first.chats).toHaveLength(10);
      expect(result.first).toMatchObject({
        totalMatching: 11,
        changedMatching: 9,
        countsAreComplete: false,
      });
      expect(result.first.chats[0]).toMatchObject({
        sessionId: linkedSessionId,
        hasChanges: false,
        targetProject: { kind: "existing", projectId: project.id },
      });
      expect(result.first.nextCursor).not.toBeNull();
      expect(result.second).toMatchObject({
        totalMatching: 12,
        changedMatching: 11,
        countsAreComplete: true,
      });
      expect(result.second.chats).toHaveLength(2);
      expect(result.second.nextCursor).toBeNull();
      expect(result.legacyCursor).toEqual(result.first);
      expect(result.malformedVersionedCursor).toEqual(result.first);
      expect(listRequests).toEqual([{ limit: 10 }, { cursor: "10", limit: 10 }]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("syncs selected root chats additively and refreshes external activity", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-run-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-workspace-",
      });
      const missingRoot = NodePath.join(workspaceRoot, "missing");
      const sourceId = HarnessChatSyncSourceId.make("custom:history:run");
      const continuationKey = HarnessChatContinuationKey.make("custom:home:run");
      const project = makeProjectShell("project-existing", workspaceRoot);
      const commands: OrchestrationCommand[] = [];
      const links = new Map<string, ProjectionHarnessChatSyncLink>();
      const messageLinks = new Map<string, ProjectionHarnessChatSyncMessageLink>();
      const bindings: ProviderRuntimeBinding[] = [];
      const readCalls: string[] = [];
      let externalActivity: "active" | "idle" | "unknown" = "idle";
      const summaries = {
        first: {
          sessionId: "session-1",
          title: "Release chat",
          preview: "Ship it",
          cwd: workspaceRoot,
          model: "custom-model",
          createdAt,
          updatedAt: createdAt,
          archived: false,
          isChild: false,
          messageCount: 2,
          activity: "idle" as const,
        },
        unresolved: {
          sessionId: "session-missing",
          title: "Missing workspace",
          preview: null,
          cwd: missingRoot,
          model: null,
          updatedAt: createdAt,
          archived: false,
          isChild: false,
          messageCount: 1,
          activity: "unknown" as const,
        },
        excluded: {
          sessionId: "session-excluded",
          title: "Excluded chat",
          preview: null,
          cwd: workspaceRoot,
          model: null,
          updatedAt: createdAt,
          archived: false,
          isChild: false,
          messageCount: 1,
          activity: "idle" as const,
        },
      };
      const adapter: ProviderHistorySyncAdapter = {
        list: ({ cursor }) =>
          Effect.succeed(
            cursor === undefined
              ? {
                  items: [
                    summaries.first,
                    summaries.unresolved,
                    { ...summaries.first, sessionId: "child-session", isChild: true },
                  ],
                  nextCursor: "page-2",
                }
              : { items: cursor === "page-2" ? [summaries.excluded] : [] },
          ),
        read: ({ sessionId }) =>
          Effect.sync(() => {
            readCalls.push(sessionId);
            return {
              sessionId,
              cwd: workspaceRoot,
              model: "custom-model",
              updatedAt: createdAt,
              items: [
                {
                  kind: "message" as const,
                  nativeMessageId: "native-message-1",
                  role: "user" as const,
                  text: "Import me",
                  attachments: [
                    {
                      type: "image" as const,
                      nativeAttachmentId: "native-image-1",
                      name: "imported.png",
                      mimeType: "image/png",
                      content: {
                        type: "data-url" as const,
                        dataUrl: "data:image/png;base64,AA==",
                      },
                    },
                    {
                      type: "audio" as const,
                      nativeAttachmentId: "native-audio-1",
                      name: "voice.ogg",
                      mimeType: "audio/ogg",
                      content: { type: "file" as const, path: "/missing/voice.ogg" },
                    },
                  ],
                  createdAt,
                  updatedAt: createdAt,
                },
                {
                  kind: "plan" as const,
                  nativePlanId: "native-plan-1",
                  markdown: "# Plan\n\n- Ship it",
                  createdAt,
                  updatedAt: createdAt,
                },
              ],
            };
          }),
        resumeCursor: ({ sessionId }) =>
          Effect.succeed({ resumeCursor: { sessionId }, adapterKey: "custom" }),
        checkActivity: () => Effect.succeed(externalActivity),
      };
      const instance = makeHistoryInstance({
        instanceId: "custom-primary",
        sourceId,
        continuationKey,
        adapter,
      });
      const testLayer = makeHarnessSyncTestLayer({
        baseDir,
        instances: [instance],
        commands,
        links,
        messageLinks,
        projects: [project],
        bindings,
      });

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        const first = yield* service.run({
          sourceId,
          selection: {
            mode: "allMatching",
            query: "",
            includeArchived: false,
            excludedSessionIds: [HarnessChatSessionId.make("session-excluded")],
          },
          targetResolutions: [],
        });
        const second = yield* service.run({
          sourceId,
          selection: {
            mode: "only",
            sessionIds: [HarnessChatSessionId.make("session-1")],
          },
          targetResolutions: [],
        });
        externalActivity = "active";
        const status = yield* service.status({
          sourceId,
          sessionIds: [HarnessChatSessionId.make("session-1")],
        });
        return { first, second, status };
      }).pipe(Effect.provide(testLayer));

      expect(result.first).toMatchObject({
        selectedCount: 2,
        syncedCount: 1,
        failedCount: 1,
        threadsCreated: 1,
        threadsUpdated: 0,
        messagesImported: 1,
        attachmentsImported: 1,
        attachmentsSkipped: 1,
      });
      expect(result.first.failures).toEqual([
        expect.objectContaining({
          sessionId: HarnessChatSessionId.make("session-missing"),
          code: "target-unresolved",
        }),
      ]);
      expect(result.second).toMatchObject({
        selectedCount: 1,
        syncedCount: 1,
        failedCount: 0,
        threadsCreated: 0,
        threadsUpdated: 1,
        messagesImported: 0,
        attachmentsImported: 0,
        attachmentsSkipped: 0,
      });
      expect(result.status.statuses).toEqual([
        expect.objectContaining({
          sessionId: HarnessChatSessionId.make("session-1"),
          activity: "active",
          link: expect.objectContaining({ activity: "active" }),
        }),
      ]);
      expect(readCalls).toEqual(["session-1", "session-1"]);
      expect(bindings).toHaveLength(2);
      expect(bindings[0]).toMatchObject({
        status: "stopped",
        resumeCursor: { sessionId: "session-1" },
      });
      expect(
        commands.filter((command) => command.type === "thread.harness-sync.message.import"),
      ).toHaveLength(1);
      expect(commands.some((command) => command.type === "thread.turn.start")).toBe(false);
      expect(links.get("session-1")?.activity).toBe("active");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("persists provider-history audio as a canonical chat attachment", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-audio-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-audio-workspace-",
      });
      const commands: OrchestrationCommand[] = [];
      const sessionId = HarnessChatSessionId.make("session-with-audio");
      const sourceId = HarnessChatSyncSourceId.make("custom:history:audio");
      const adapter: ProviderHistorySyncAdapter = {
        list: () =>
          Effect.succeed({
            items: [
              {
                sessionId,
                title: "Audio history",
                preview: null,
                cwd: workspaceRoot,
                model: null,
                updatedAt: createdAt,
                archived: false,
                isChild: false,
                messageCount: 1,
                activity: "idle",
              },
            ],
          }),
        read: () =>
          Effect.succeed({
            sessionId,
            cwd: workspaceRoot,
            updatedAt: createdAt,
            items: [
              {
                kind: "message",
                nativeMessageId: "native-audio-message",
                role: "user",
                text: "Listen to this",
                attachments: [
                  {
                    type: "audio",
                    nativeAttachmentId: "native-audio",
                    name: "voice-note.ogg",
                    mimeType: "audio/ogg",
                    content: {
                      type: "data-url",
                      dataUrl: "data:audio/ogg;base64,YXVkaW8=",
                    },
                  },
                ],
              },
            ],
          }),
        resumeCursor: () => Effect.succeed({ resumeCursor: { sessionId } }),
      };
      const instance = makeHistoryInstance({
        instanceId: "custom-audio",
        sourceId,
        continuationKey: "custom:home:audio",
        adapter,
      });

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        return yield* service.run({
          sourceId,
          selection: { mode: "only", sessionIds: [sessionId] },
          targetResolutions: [],
        });
      }).pipe(
        Effect.provide(makeHarnessSyncTestLayer({ baseDir, instances: [instance], commands })),
      );

      expect(result.attachmentsImported).toBe(1);
      expect(result.attachmentsSkipped).toBe(0);
      const imported = commands.find(
        (command) => command.type === "thread.harness-sync.message.import",
      );
      expect(imported?.type).toBe("thread.harness-sync.message.import");
      if (imported?.type !== "thread.harness-sync.message.import") return;
      const attachment = imported.message.attachments?.[0];
      expect(attachment).toMatchObject({
        type: "audio",
        name: "voice-note.ogg",
        mimeType: "audio/ogg",
      });
      if (!attachment) return;
      const config = yield* ServerConfig.ServerConfig.pipe(
        Effect.provide(
          ServerConfig.layerTest(process.cwd(), baseDir).pipe(Layer.provide(NodeServices.layer)),
        ),
      );
      const persistedPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      });
      expect(persistedPath).not.toBeNull();
      if (persistedPath) expect(yield* fileSystem.exists(persistedPath)).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a transcript whose native session differs without creating local state", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-mismatched-session-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-mismatched-workspace-",
      });
      const sessionId = HarnessChatSessionId.make("session-expected");
      const sourceId = HarnessChatSyncSourceId.make("custom:history:mismatched-session");
      const commands: OrchestrationCommand[] = [];
      const adapter: ProviderHistorySyncAdapter = {
        list: () =>
          Effect.succeed({
            items: [
              {
                sessionId,
                title: "Mismatched transcript",
                preview: null,
                cwd: workspaceRoot,
                model: null,
                updatedAt: createdAt,
                archived: false,
                isChild: false,
                messageCount: 1,
                activity: "idle",
              },
            ],
          }),
        read: () =>
          Effect.succeed({
            sessionId: "session-from-another-request",
            items: [],
            updatedAt: createdAt,
          }),
        resumeCursor: () => Effect.die("resume must not run for a mismatched transcript"),
      };
      const instance = makeHistoryInstance({
        instanceId: "custom-mismatched-session",
        sourceId,
        continuationKey: "custom:home:mismatched-session",
        adapter,
      });

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        return yield* service.run({
          sourceId,
          selection: { mode: "only", sessionIds: [sessionId] },
          targetResolutions: [],
        });
      }).pipe(
        Effect.provide(
          makeHarnessSyncTestLayer({
            baseDir,
            instances: [instance],
            projects: [makeProjectShell("project-mismatched-session", workspaceRoot)],
            commands,
          }),
        ),
      );

      expect(result).toMatchObject({
        selectedCount: 1,
        syncedCount: 0,
        failedCount: 1,
        threadsCreated: 0,
        messagesImported: 0,
      });
      expect(result.failures).toEqual([
        {
          sessionId,
          code: "history-read-failed",
          message: "The provider returned a transcript for a different session.",
          retryable: false,
        },
      ]);
      expect(commands).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refreshes a linked chat by local thread id", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-harness-sync-thread-status-",
      });
      const threadId = ThreadId.make("thread-linked-status");
      const projectId = ProjectId.make("project-linked-status");
      const sessionId = HarnessChatSessionId.make("session-linked-status");
      const sourceId = HarnessChatSyncSourceId.make("custom:history:status");
      const continuationKey = HarnessChatContinuationKey.make("custom:home:status");
      const providerInstanceId = ProviderInstanceId.make("custom-status");
      const links = new Map<string, ProjectionHarnessChatSyncLink>([
        [
          sessionId,
          {
            threadId,
            projectId,
            sourceId,
            continuationKey,
            nativeSessionId: sessionId,
            providerInstanceId,
            providerLabel: "Custom status",
            activity: "active",
            sourceUpdatedAt: createdAt,
            lastSyncedAt: createdAt,
          },
        ],
      ]);
      const adapter: ProviderHistorySyncAdapter = {
        list: () =>
          Effect.succeed({
            items: [
              {
                sessionId,
                title: "Linked status",
                preview: null,
                cwd: null,
                model: null,
                updatedAt: createdAt,
                archived: false,
                isChild: false,
                activity: "active",
              },
            ],
          }),
        read: () => Effect.succeed({ sessionId, items: [], updatedAt: createdAt }),
        resumeCursor: () => Effect.succeed({ resumeCursor: { sessionId } }),
        checkActivity: () => Effect.succeed("idle"),
      };
      const instance = makeHistoryInstance({
        instanceId: providerInstanceId,
        sourceId,
        continuationKey,
        adapter,
      });

      const result = yield* Effect.gen(function* () {
        const service = yield* makeHarnessChatSync();
        return yield* service.status({ threadId });
      }).pipe(Effect.provide(makeHarnessSyncTestLayer({ baseDir, instances: [instance], links })));

      expect(result.statuses).toEqual([
        expect.objectContaining({
          sessionId,
          activity: "idle",
          link: expect.objectContaining({ threadId, activity: "idle" }),
        }),
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
