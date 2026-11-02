// @effect-diagnostics-next-line nodeBuiltinImport:off - Fixtures use synchronous host-path normalization outside Effect services.
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  findExistingHarnessMessageMatch,
  makeHarnessChatSyncAttachmentId,
  makeHarnessChatSyncId,
  makeHarnessChatSync,
  resolveHarnessChatTargetProject,
} from "./harnessChatSync.ts";
import * as SqlClient from "effect/sql/SqlClient";
import { historyTestLayer } from "./harnessChatSync/historyTestLayer.ts";
import { makeHistoryWriter } from "./harnessChatSync/HistoryWriter.ts";
import { ProjectionStoreV2 } from "./orchestration-v2/ProjectionStore.ts";
import { resolveAttachmentPath } from "./attachmentStore.ts";
import * as ServerConfig from "./config.ts";
import {
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncLink,
  type ProjectionHarnessChatSyncMessageLink,
} from "./persistence/Services/ProjectionHarnessChatSync.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import { ProviderInstanceRegistry } from "./provider/ProviderInstanceRegistry.ts";
import {
  makeSupportedProviderHistorySync,
  type ProviderHistorySyncAdapter,
} from "@t3tools/provider-core/server/ProviderHistorySync";

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
      resolveMaintenance: () => Effect.die("unused"),
      refresh: Effect.die("unused"),
      streamChanges: Stream.empty,
      applyUsageLimits: () => Effect.void,
    },
    orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
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
  readonly links?: Map<string, ProjectionHarnessChatSyncLink>;
  readonly messageLinks?: Map<string, ProjectionHarnessChatSyncMessageLink>;
  readonly projects?: Array<OrchestrationProjectShell>;
  readonly unavailable?: ReadonlyArray<ServerProvider>;
}) {
  const registry = Layer.mock(ProviderInstanceRegistry, {
    getInstance: (instanceId) =>
      Effect.succeed(input.instances.find((instance) => instance.instanceId === instanceId)),
    listInstances: Effect.succeed(input.instances),
    listUnavailable: Effect.succeed(input.unavailable ?? []),
    streamChanges: Stream.empty,
  });
  const base = Layer.mergeAll(historyTestLayer(input.baseDir), registry);
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const writer = yield* makeHistoryWriter();
      const repository = yield* ProjectionHarnessChatSyncRepository;
      for (const project of input.projects ?? [])
        yield* writer.createProject({
          commandId: CommandId.make(`seed:${project.id}`),
          projectId: project.id,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
          createdAt: project.createdAt,
        });
      for (const link of input.links?.values() ?? []) yield* repository.upsertLink(link);
      for (const link of input.messageLinks?.values() ?? [])
        yield* repository.upsertMessageLink(link);
    }),
  ).pipe(Layer.provideMerge(base));
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
          ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
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
});

it.effect("imports native messages, plans and audio into V2 and keeps retries additive", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "native-history-v2-" });
    const workspace = yield* fs.makeTempDirectoryScoped({ prefix: "native-history-workspace-" });
    const sourceId = HarnessChatSyncSourceId.make("native-history-test");
    const sessionId = HarnessChatSessionId.make("native-session");
    let activity: "idle" | "active" = "idle";
    let planMarkdown = "# Saved plan";
    const adapter: ProviderHistorySyncAdapter = {
      list: () =>
        Effect.succeed({
          items: [
            {
              sessionId,
              title: "Saved native chat",
              preview: "Saved answer",
              cwd: workspace,
              model: "custom-model",
              updatedAt: createdAt,
              archived: false,
              isChild: false,
              activity,
            },
          ],
        }),
      read: () =>
        Effect.succeed({
          sessionId,
          cwd: workspace,
          updatedAt: createdAt,
          items: [
            {
              kind: "message",
              nativeMessageId: "native-user",
              role: "user",
              text: "Saved question",
              attachments: [],
              createdAt,
            },
            {
              kind: "message",
              nativeMessageId: "native-answer",
              role: "assistant",
              text: "Saved answer",
              attachments: [
                {
                  type: "audio",
                  nativeAttachmentId: "audio",
                  name: "voice.ogg",
                  mimeType: "audio/ogg",
                  content: { type: "data-url", dataUrl: "data:audio/ogg;base64,YXVkaW8=" },
                },
              ],
              createdAt,
            },
            { kind: "plan", nativePlanId: "native-plan", markdown: planMarkdown, createdAt },
          ],
        }),
      resumeCursor: () => Effect.succeed({ resumeCursor: { sessionId: "actual-resume-session" } }),
      checkActivity: () => Effect.succeed(activity),
    };
    const instance = makeHistoryInstance({
      instanceId: "custom-native",
      sourceId,
      continuationKey: "native-history-home",
      adapter,
    });
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* makeHarnessChatSync();
      const writer = yield* makeHistoryWriter();
      const ownerId = ThreadId.make("existing-native-owner");
      const projectId = ProjectId.make("existing-native-project");
      yield* writer.createProject({
        commandId: CommandId.make("existing-native-project"),
        projectId,
        title: "Existing",
        workspaceRoot: workspace,
        createdAt,
      });
      yield* writer.createThread({
        commandId: CommandId.make("existing-native-thread"),
        threadId: ownerId,
        projectId,
        title: "Existing native chat",
        modelSelection: { instanceId: instance.instanceId, model: "custom-model" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      yield* writer.bindNativeThread({
        threadId: ownerId,
        driver: instance.driverKind,
        providerInstanceId: instance.instanceId,
        nativeId: "actual-resume-session",
      });
      yield* writer.importMessage({
        commandId: CommandId.make("existing-native-message"),
        threadId: ownerId,
        message: {
          id: MessageId.make("live-user-message"),
          role: "user",
          text: "Saved question",
          createdAt,
          updatedAt: createdAt,
        },
      });
      const request = {
        sourceId,
        selection: { mode: "only" as const, sessionIds: [sessionId] },
        targetResolutions: [],
      };
      const first = yield* service.run(request);
      expect(first).toMatchObject({
        syncedCount: 1,
        failedCount: 0,
        messagesImported: 1,
        threadsCreated: 0,
        attachmentsImported: 1,
      });
      const threadId = first.items[0]!.threadId;
      expect(threadId).toBe(ownerId);
      const store = yield* ProjectionStoreV2;
      const projection = yield* store.getThreadProjection(threadId);
      expect(projection.messages.map((message) => message.text)).toEqual([
        "Saved question",
        "Saved answer",
      ]);
      expect(
        projection.turnItems.some(
          (item) => item.type === "proposed_plan" && item.markdown === "# Saved plan",
        ),
      ).toBe(true);
      expect(projection.providerThreads[0]?.nativeThreadRef?.nativeId).toBe(
        "actual-resume-session",
      );
      expect(projection.thread.activeProviderThreadId).toBe(projection.providerThreads[0]?.id);
      expect(projection.runs).toEqual([]);
      expect(yield* sql`SELECT effect_id FROM orchestration_v2_effect_outbox`).toEqual([]);
      const config = yield* ServerConfig.ServerConfig;
      const attachment = projection.messages[1]!.attachments[0]!;
      expect(attachment.type).toBe("audio");
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      });
      expect(attachmentPath).not.toBeNull();
      expect(yield* fs.readFileString(attachmentPath!)).toBe("audio");
      const second = yield* service.run(request);
      expect(second.failures).toEqual([]);
      expect(second).toMatchObject({ threadsCreated: 0, threadsUpdated: 1, messagesImported: 0 });
      expect((yield* store.getThreadProjection(threadId)).messages).toHaveLength(2);
      planMarkdown = "# Updated native plan";
      const updated = yield* service.run(request);
      expect(updated.failures).toEqual([]);
      const plans = (yield* store.getThreadProjection(threadId)).turnItems.filter(
        (item) => item.type === "proposed_plan",
      );
      expect(plans).toHaveLength(1);
      expect(plans[0]?.markdown).toBe(planMarkdown);
      activity = "active";
      const status = yield* service.status({ threadId });
      expect(status.statuses[0]?.activity).toBe("active");
      expect((yield* store.getThreadProjection(threadId)).thread.harnessSync?.activity).toBe(
        "active",
      );
      expect((yield* store.getThreadProjection(threadId)).thread.harnessSync?.sourceUpdatedAt).toBe(
        createdAt,
      );
    }).pipe(Effect.provide(makeHarnessSyncTestLayer({ baseDir, instances: [instance] })));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rejects mismatched native transcripts before creating V2 history", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "native-history-mismatch-" });
    const workspace = yield* fs.makeTempDirectoryScoped({
      prefix: "native-history-mismatch-workspace-",
    });
    const sourceId = HarnessChatSyncSourceId.make("mismatched-native-history");
    const sessionId = HarnessChatSessionId.make("expected-session");
    const adapter: ProviderHistorySyncAdapter = {
      list: () =>
        Effect.succeed({
          items: [
            {
              sessionId,
              title: "Expected chat",
              preview: null,
              cwd: workspace,
              model: null,
              updatedAt: createdAt,
              archived: false,
              isChild: false,
              activity: "idle",
            },
          ],
        }),
      read: () => Effect.succeed({ sessionId: "wrong-session", items: [], updatedAt: createdAt }),
      resumeCursor: () => Effect.succeed({ resumeCursor: { sessionId } }),
    };
    const instance = makeHistoryInstance({
      instanceId: "custom-mismatch",
      sourceId,
      continuationKey: "mismatch-home",
      adapter,
    });
    yield* Effect.gen(function* () {
      const service = yield* makeHarnessChatSync();
      const result = yield* service.run({
        sourceId,
        selection: { mode: "only", sessionIds: [sessionId] },
        targetResolutions: [],
      });
      expect(result.failedCount).toBe(1);
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`).toEqual([]);
      expect(yield* sql`SELECT message_id FROM orchestration_v2_projection_messages`).toEqual([]);
    }).pipe(Effect.provide(makeHarnessSyncTestLayer({ baseDir, instances: [instance] })));
  }).pipe(Effect.provide(NodeServices.layer)),
);
