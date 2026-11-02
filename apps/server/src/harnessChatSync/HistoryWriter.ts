import {
  type ChatAttachment,
  type CommandId,
  EventId,
  type MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  PlanId,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { makeHarnessChatSyncId } from "./Identifiers.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import {
  HarnessChatNativeMessageId,
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncLink,
} from "../persistence/Services/ProjectionHarnessChatSync.ts";

class HistoryImportConflictError extends Schema.TaggedError<HistoryImportConflictError>()(
  "HistoryImportConflictError",
  { identifier: Schema.String },
) {
  override get message() {
    return "This history is already linked to another local thread.";
  }
}

interface ImportedMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const makeHistoryWriter = Effect.fn("makeHistoryWriter")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink.EventSinkV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const sync = yield* ProjectionHarnessChatSyncRepository;

  const createProject = Effect.fn("HistoryWriter.createProject")(function* (input: {
    readonly commandId: CommandId;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly defaultModelSelection?: ModelSelection | null;
    readonly createdAt: string;
    readonly createWorkspaceRootIfMissing?: boolean;
  }) {
    const existing = yield* projects.get(input.projectId, { includeDeleted: true });
    if (Option.isSome(existing)) return input.projectId;
    const owner = yield* projects.findActiveByWorkspaceRoot(input.workspaceRoot);
    if (Option.isSome(owner)) return owner.value.projectId;
    yield* sink.commitProjectCommand({
      commandId: input.commandId,
      projectId: input.projectId,
      commandType: "project.create",
      acceptedAt: DateTime.makeUnsafe(input.createdAt),
      event: {
        eventId: EventId.make(`history:${input.commandId}`),
        aggregateKind: "project",
        aggregateId: input.projectId,
        occurredAt: input.createdAt,
        commandId: input.commandId,
        causationEventId: null,
        correlationId: input.commandId,
        metadata: {},
        type: "project.created",
        payload: {
          projectId: input.projectId,
          title: input.title,
          workspaceRoot: input.workspaceRoot,
          defaultModelSelection: input.defaultModelSelection ?? null,
          scripts: [],
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        },
      },
    });
    return input.projectId;
  });

  const createThread = Effect.fn("HistoryWriter.createThread")(function* (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly createdAt: string;
  }) {
    const existing = yield* projections
      .getThread(input.threadId)
      .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }));
    if (existing) return;
    const time = DateTime.makeUnsafe(input.createdAt);
    const thread: OrchestrationV2AppThread = {
      createdBy: "system",
      creationSource: "server",
      id: input.threadId,
      projectId: input.projectId,
      title: input.title,
      providerInstanceId: input.modelSelection.instanceId,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      activeProviderThreadId: null,
      historyOrigin: "v1_import",
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
      forkedFrom: null,
      createdAt: time,
      updatedAt: time,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    };
    yield* sink.write({
      events: [
        {
          id: EventId.make(`history:${input.commandId}`),
          type: "thread.created",
          threadId: input.threadId,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: time,
          payload: thread,
        },
      ],
    });
  });

  const importMessage = Effect.fn("HistoryWriter.importMessage")(function* (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly message: ImportedMessage;
    readonly nativeMessageId?: string;
    readonly linkedAt?: string;
  }) {
    const message: OrchestrationV2ConversationMessage = {
      ...input.message,
      threadId: input.threadId,
      runId: null,
      nodeId: null,
      createdBy: input.message.role === "user" ? "user" : "agent",
      creationSource: "server",
      attachments: input.message.attachments ?? [],
      streaming: false,
      createdAt: DateTime.makeUnsafe(input.message.createdAt),
      updatedAt: DateTime.makeUnsafe(input.message.updatedAt),
    };
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const existing = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id FROM orchestration_v2_projection_messages WHERE message_id = ${message.id}
      `;
        if (existing[0] && existing[0].thread_id !== input.threadId) {
          return yield* new HistoryImportConflictError({ identifier: message.id });
        }
        const positions = yield* sql<{ readonly ordinal: number }>`
        SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM orchestration_v2_turn_item_positions
        WHERE thread_id = ${input.threadId}
      `;
        const base = {
          id: TurnItemId.make(`history:message:${message.id}`),
          threadId: input.threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: positions[0]?.ordinal ?? 1,
          status: "completed" as const,
          title: null,
          startedAt: message.createdAt,
          completedAt: message.updatedAt,
          updatedAt: message.updatedAt,
        };
        const item: OrchestrationV2TurnItem =
          message.role === "user"
            ? {
                ...base,
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId: message.id,
                inputIntent: "turn_start",
                text: message.text,
                attachments: message.attachments,
              }
            : {
                ...base,
                type: "assistant_message",
                messageId: message.id,
                text: message.text,
                streaming: false,
              };
        if (!existing[0])
          yield* sink.write({
            events: [
              {
                id: EventId.make(`history:${input.commandId}:message`),
                type: "message.updated",
                threadId: input.threadId,
                occurredAt: message.updatedAt,
                payload: message,
              },
              {
                id: EventId.make(`history:${input.commandId}:item`),
                type: "turn-item.updated",
                threadId: input.threadId,
                occurredAt: message.updatedAt,
                payload: item,
              },
            ],
          });
        if (input.nativeMessageId !== undefined)
          yield* sync.upsertMessageLink({
            threadId: input.threadId,
            nativeMessageId: HarnessChatNativeMessageId.make(input.nativeMessageId),
            messageId: message.id,
            linkedAt: input.linkedAt ?? input.message.updatedAt,
          });
      }),
    );
  });

  const importPlan = Effect.fn("HistoryWriter.importPlan")(function* (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly proposedPlan: {
      readonly id: string;
      readonly planMarkdown: string;
      readonly createdAt: string;
      readonly updatedAt: string;
    };
  }) {
    const itemId = TurnItemId.make(`history:plan:${input.proposedPlan.id}`);
    const existing = yield* projections.getTurnItem({ threadId: input.threadId, itemId });
    if (existing?.type === "proposed_plan" && existing.markdown === input.proposedPlan.planMarkdown)
      return;
    const updatedAt = DateTime.makeUnsafe(input.proposedPlan.updatedAt);
    const rows = yield* sql<{
      readonly ordinal: number;
    }>`SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal
      FROM orchestration_v2_turn_item_positions WHERE thread_id = ${input.threadId}`;
    yield* sink.write({
      events: [
        {
          id: EventId.make(
            makeHarnessChatSyncId(
              "plan-event",
              input.commandId,
              input.proposedPlan.planMarkdown,
              input.proposedPlan.updatedAt,
            ),
          ),
          type: "turn-item.updated",
          threadId: input.threadId,
          occurredAt: updatedAt,
          payload: {
            id: itemId,
            threadId: input.threadId,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: existing?.ordinal ?? rows[0]?.ordinal ?? 1,
            status: "completed",
            title: null,
            startedAt: DateTime.makeUnsafe(input.proposedPlan.createdAt),
            completedAt: updatedAt,
            updatedAt,
            type: "proposed_plan",
            planId: PlanId.make(input.proposedPlan.id),
            markdown: input.proposedPlan.planMarkdown,
            streaming: false,
          },
        },
      ],
    });
  });

  const getNativeThread = Effect.fn("HistoryWriter.getNativeThread")(function* (input: {
    readonly driver: ProviderDriverKind;
    readonly providerInstanceId: ProviderInstanceId;
    readonly nativeId: string;
  }) {
    const id = ids.derive.providerThread({
      driver: input.driver,
      providerInstanceId: input.providerInstanceId,
      nativeThreadId: input.nativeId,
    });
    const owners = yield* sql<{
      readonly thread_id: string | null;
    }>`SELECT thread_id FROM orchestration_v2_projection_provider_threads WHERE provider_thread_id = ${id}`;
    return owners[0]?.thread_id
      ? yield* projections.getThread(ThreadId.make(owners[0].thread_id))
      : null;
  });

  const bindNativeThread = Effect.fn("HistoryWriter.bindNativeThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly driver: ProviderDriverKind;
    readonly providerInstanceId: ProviderInstanceId;
    readonly nativeId: string;
  }) {
    const thread = yield* projections.getThread(input.threadId);
    const id = ids.derive.providerThread({
      driver: input.driver,
      providerInstanceId: input.providerInstanceId,
      nativeThreadId: input.nativeId,
    });
    if (thread.activeProviderThreadId === id) return;
    const now = yield* DateTime.now;
    const events: Array<OrchestrationV2DomainEvent> = [
      {
        id: EventId.make(`history:provider-thread:${id}`),
        type: "provider-thread.updated",
        threadId: thread.id,
        driver: input.driver,
        providerInstanceId: input.providerInstanceId,
        occurredAt: now,
        payload: {
          id,
          driver: input.driver,
          providerInstanceId: input.providerInstanceId,
          providerSessionId: null,
          appThreadId: thread.id,
          ownerNodeId: null,
          nativeThreadRef: { driver: input.driver, nativeId: input.nativeId, strength: "strong" },
          nativeConversationHeadRef: null,
          status: "not_loaded",
          firstRunOrdinal: null,
          lastRunOrdinal: null,
          handoffIds: [],
          forkedFrom: null,
          contextUsage: null,
          nativeMetadata: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        id: EventId.make(`history:thread-native:${thread.id}:${id}`),
        type: "thread.metadata-updated",
        threadId: thread.id,
        occurredAt: now,
        payload: { ...thread, activeProviderThreadId: id, historyOrigin: "native" },
      },
    ];
    const stored = yield* sink.write({
      unlessNativeThreadOwned: {
        driver: input.driver,
        providerInstanceId: input.providerInstanceId,
        appThreadId: thread.id,
        nativeThreadRef: { driver: input.driver, nativeId: input.nativeId, strength: "strong" },
      },
      events,
    });
    if (stored.length === 0)
      return yield* new HistoryImportConflictError({ identifier: input.nativeId });
  });

  const linkHarness = Effect.fn("HistoryWriter.linkHarness")(function* (
    input: Omit<ProjectionHarnessChatSyncLink, "projectId"> & { readonly commandId: CommandId },
  ) {
    const thread = yield* projections.getThread(input.threadId);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sync.upsertLink({ ...input, projectId: thread.projectId });
        const current = thread.harnessSync;
        if (
          current?.providerInstanceId === input.providerInstanceId &&
          current.providerLabel === input.providerLabel &&
          current.activity === input.activity &&
          current.sourceUpdatedAt === input.sourceUpdatedAt &&
          current.lastSyncedAt === input.lastSyncedAt
        )
          return;
        const eventId = yield* ids.allocate.event({
          threadId: thread.id,
          commandId: input.commandId,
        });
        yield* sink.write({
          events: [
            {
              id: eventId,
              type: "thread.metadata-updated",
              threadId: thread.id,
              occurredAt: DateTime.makeUnsafe(input.lastSyncedAt),
              payload: {
                ...thread,
                harnessSync: {
                  providerInstanceId: input.providerInstanceId,
                  providerLabel: input.providerLabel,
                  activity: input.activity,
                  sourceUpdatedAt: input.sourceUpdatedAt,
                  lastSyncedAt: input.lastSyncedAt,
                },
              },
            },
          ],
        });
      }),
    );
  });

  const archiveThread = Effect.fn("HistoryWriter.archiveThread")(function* (input: {
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
  }) {
    const thread = yield* projections.getThread(input.threadId);
    if (thread.archivedAt !== null) return;
    const now = yield* DateTime.now;
    yield* sink.write({
      events: [
        {
          id: EventId.make(`history:${input.commandId}`),
          type: "thread.archived",
          threadId: thread.id,
          occurredAt: now,
          payload: { ...thread, archivedAt: now },
        },
      ],
    });
  });
  return {
    getNativeThread,
    createProject,
    createThread,
    importMessage,
    importPlan,
    bindNativeThread,
    linkHarness,
    archiveThread,
  };
});
