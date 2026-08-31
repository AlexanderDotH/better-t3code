import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ClientOrchestrationCommand,
  ModelSelection,
  OrchestrationCommand,
  OrchestrationDispatchCommandError,
  OrchestrationEvent,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationSubagentDetail,
  OrchestrationSubagentSummary,
  OrchestrationThread,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationSession,
  OrchestrationThreadShell,
  ProjectCreateCommand,
  OrchestrationMessage,
  ThreadMessageSentPayload,
  ThreadMetaUpdatedPayload,
  ThreadForkCommand,
  ThreadForkedPayload,
  ThreadForkHandoffCompleteCommand,
  ThreadForkHandoffCompletedPayload,
  ThreadForkWorkspaceUpdateCommand,
  ThreadForkWorkspaceUpdatedPayload,
  ThreadHarnessSyncLinkCommand,
  ThreadHarnessSyncMessageImportCommand,
  ThreadTurnRetryCommand,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { RuntimeSessionId, TurnId } from "./baseSchemas.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeFullThreadDiffInput = Schema.decodeUnknownEffect(OrchestrationGetFullThreadDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnRetryCommand = Schema.decodeUnknownEffect(ThreadTurnRetryCommand);
const decodeOrchestrationMessage = Schema.decodeUnknownEffect(OrchestrationMessage);
const decodeThreadMessageSentPayload = Schema.decodeUnknownEffect(ThreadMessageSentPayload);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const decodeOrchestrationThread = Schema.decodeUnknownEffect(OrchestrationThread);
const decodeOrchestrationThreadShell = Schema.decodeUnknownEffect(OrchestrationThreadShell);
const decodeOrchestrationSubagentDetail = Schema.decodeUnknownEffect(OrchestrationSubagentDetail);
const decodeOrchestrationSubagentSummary = Schema.decodeUnknownEffect(OrchestrationSubagentSummary);
const encodeThreadCreatedPayload = Schema.encodeEffect(ThreadCreatedPayload);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeClientOrchestrationCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
const decodeThreadForkCommand = Schema.decodeUnknownEffect(ThreadForkCommand);
const decodeThreadForkedPayload = Schema.decodeUnknownEffect(ThreadForkedPayload);
const decodeThreadForkWorkspaceUpdateCommand = Schema.decodeUnknownEffect(
  ThreadForkWorkspaceUpdateCommand,
);
const decodeThreadForkWorkspaceUpdatedPayload = Schema.decodeUnknownEffect(
  ThreadForkWorkspaceUpdatedPayload,
);
const decodeThreadForkHandoffCompleteCommand = Schema.decodeUnknownEffect(
  ThreadForkHandoffCompleteCommand,
);
const decodeThreadForkHandoffCompletedPayload = Schema.decodeUnknownEffect(
  ThreadForkHandoffCompletedPayload,
);
const decodeThreadHarnessSyncLinkCommand = Schema.decodeUnknownEffect(ThreadHarnessSyncLinkCommand);
const decodeThreadHarnessSyncMessageImportCommand = Schema.decodeUnknownEffect(
  ThreadHarnessSyncMessageImportCommand,
);
const decodeDispatchCommandError = Schema.decodeUnknownEffect(OrchestrationDispatchCommandError);

const forkWorkspace = {
  mode: "worktree",
  baseBranch: "main",
  startFromOrigin: true,
  runSetupScript: true,
} as const;

it.effect("decodes message and proposed-plan thread fork commands", () =>
  Effect.gen(function* () {
    const base = {
      type: "thread.fork",
      commandId: "fork-command",
      threadId: "thread-fork",
      sourceThreadId: "thread-source",
      modelSelection: { instanceId: "codex", model: "gpt-5.6" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspace: forkWorkspace,
      createdAt: "2026-08-24T10:00:00.000Z",
    } as const;
    const fromMessage = yield* decodeThreadForkCommand({
      ...base,
      boundary: { kind: "message", messageId: "message-source" },
    });
    const fromPlan = yield* decodeClientOrchestrationCommand({
      ...base,
      boundary: { kind: "proposed-plan", planId: "plan-source" },
      workspace: {
        mode: "local",
        baseBranch: null,
        startFromOrigin: false,
        runSetupScript: false,
      },
    });

    assert.strictEqual(fromMessage.boundary.kind, "message");
    assert.strictEqual(fromPlan.type, "thread.fork");
    if (fromPlan.type === "thread.fork") {
      assert.strictEqual(fromPlan.boundary.kind, "proposed-plan");
      assert.strictEqual(fromPlan.workspace.baseBranch, null);
    }
  }),
);

it.effect("decodes frozen fork history with provenance and remaining first-turn budget", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadForkedPayload({
      threadId: "thread-fork",
      fork: {
        provenance: {
          sourceThreadId: "thread-source",
          sourceTitle: "Source thread",
          boundary: { kind: "message", messageId: "message-source" },
          forkedAt: "2026-08-24T10:00:00.000Z",
        },
        workspace: {
          spec: forkWorkspace,
          status: "pending",
          preparedAt: null,
          lastError: null,
        },
        handoff: {
          status: "pending",
          historyInputChars: 4_000,
          historyAttachmentCount: 1,
          remainingInputChars: 116_000,
          remainingAttachmentCount: 7,
          completedAt: null,
        },
      },
      history: {
        messages: [
          {
            id: "message-fork",
            role: "user",
            text: "Question",
            turnId: "turn-fork",
            streaming: false,
            createdAt: "2026-08-24T09:59:00.000Z",
            updatedAt: "2026-08-24T09:59:00.000Z",
            historyOrigin: {
              sourceThreadId: "thread-source",
              sourceId: "message-source",
              ordinal: 0,
            },
          },
        ],
        proposedPlans: [],
        activities: [],
        subagents: [],
        turns: [
          {
            turnId: "turn-fork",
            pendingMessageId: "message-fork",
            assistantMessageId: null,
            state: "running",
            requestedAt: "2026-08-24T09:59:00.000Z",
            startedAt: "2026-08-24T09:59:01.000Z",
            completedAt: null,
            checkpointTurnCount: null,
            checkpointRef: null,
            checkpointStatus: null,
            checkpointFiles: [],
            historyOrigin: {
              sourceThreadId: "thread-source",
              sourceId: "turn-source",
              ordinal: 1,
            },
          },
        ],
        checkpoints: [],
      },
    });

    assert.strictEqual(parsed.history.messages[0]?.historyOrigin.sourceId, "message-source");
    assert.strictEqual(parsed.fork.handoff.remainingInputChars, 116_000);
    assert.strictEqual(parsed.fork.workspace.status, "pending");

    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-forked",
      aggregateKind: "thread",
      aggregateId: "thread-fork",
      type: "thread.forked",
      occurredAt: "2026-08-24T10:00:00.000Z",
      commandId: "fork-command",
      causationEventId: null,
      correlationId: "fork-command",
      metadata: {},
      payload: parsed,
    });
    assert.strictEqual(event.type, "thread.forked");
  }),
);

it.effect("decodes internal fork workspace and handoff state transitions", () =>
  Effect.gen(function* () {
    const workspaceCommand = yield* decodeThreadForkWorkspaceUpdateCommand({
      type: "thread.fork.workspace.update",
      commandId: "workspace-command",
      threadId: "thread-fork",
      status: "error",
      preparedAt: null,
      lastError: "Could not create worktree",
      createdAt: "2026-08-24T10:01:00.000Z",
    });
    const workspacePayload = yield* decodeThreadForkWorkspaceUpdatedPayload({
      threadId: "thread-fork",
      status: "ready",
      preparedAt: "2026-08-24T10:02:00.000Z",
      lastError: null,
      createdAt: "2026-08-24T10:02:00.000Z",
    });
    const handoffCommand = yield* decodeThreadForkHandoffCompleteCommand({
      type: "thread.fork.handoff.complete",
      commandId: "handoff-command",
      threadId: "thread-fork",
      completedAt: "2026-08-24T10:03:00.000Z",
    });
    const handoffPayload = yield* decodeThreadForkHandoffCompletedPayload({
      threadId: "thread-fork",
      completedAt: "2026-08-24T10:03:00.000Z",
    });
    const internalCommand = yield* decodeOrchestrationCommand(workspaceCommand);
    const internalHandoffCommand = yield* decodeOrchestrationCommand(handoffCommand);
    const clientWorkspaceCommand = yield* Effect.exit(
      decodeClientOrchestrationCommand(workspaceCommand),
    );
    const workspaceEvent = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-workspace-updated",
      aggregateKind: "thread",
      aggregateId: "thread-fork",
      type: "thread.fork-workspace-updated",
      occurredAt: workspacePayload.createdAt,
      commandId: workspaceCommand.commandId,
      causationEventId: null,
      correlationId: workspaceCommand.commandId,
      metadata: {},
      payload: workspacePayload,
    });
    const handoffEvent = yield* decodeOrchestrationEvent({
      sequence: 3,
      eventId: "event-handoff-completed",
      aggregateKind: "thread",
      aggregateId: "thread-fork",
      type: "thread.fork-handoff-completed",
      occurredAt: handoffPayload.completedAt,
      commandId: handoffCommand.commandId,
      causationEventId: null,
      correlationId: handoffCommand.commandId,
      metadata: {},
      payload: handoffPayload,
    });

    assert.strictEqual(workspaceCommand.status, "error");
    assert.strictEqual(workspacePayload.status, "ready");
    assert.strictEqual(handoffCommand.completedAt, handoffPayload.completedAt);
    assert.strictEqual(internalCommand.type, "thread.fork.workspace.update");
    assert.strictEqual(internalHandoffCommand.type, "thread.fork.handoff.complete");
    assert.strictEqual(clientWorkspaceCommand._tag, "Failure");
    assert.strictEqual(workspaceEvent.type, "thread.fork-workspace-updated");
    assert.strictEqual(handoffEvent.type, "thread.fork-handoff-completed");
  }),
);

it.effect("decodes a dispatch error after its bootstrap thread was deleted", () =>
  Effect.gen(function* () {
    const error = yield* decodeDispatchCommandError({
      _tag: "OrchestrationDispatchCommandError",
      message: "Failed to create worktree.",
      bootstrapThreadDisposition: "deleted",
    });

    assert.strictEqual(error.bootstrapThreadDisposition, "deleted");
  }),
);

it.effect("decodes harness history link and native message import commands", () =>
  Effect.gen(function* () {
    const linked = yield* decodeThreadHarnessSyncLinkCommand({
      type: "thread.harness-sync.link",
      commandId: "sync-link-1",
      threadId: "thread-1",
      sourceId: "codex-home",
      continuationKey: "codex:/tmp/codex-home",
      nativeSessionId: "native-session-1",
      providerInstanceId: "codex-work",
      providerLabel: "Codex Work",
      activity: "active",
      sourceUpdatedAt: "2026-08-23T10:00:00.000Z",
      lastSyncedAt: "2026-08-23T10:01:00.000Z",
    });
    const imported = yield* decodeThreadHarnessSyncMessageImportCommand({
      type: "thread.harness-sync.message.import",
      commandId: "sync-message-1",
      threadId: "thread-1",
      nativeMessageId: "native-message-1",
      message: {
        id: "message-1",
        role: "assistant",
        text: "Imported answer",
        turnId: null,
        streaming: false,
        createdAt: "2026-08-23T09:59:00.000Z",
        updatedAt: "2026-08-23T09:59:00.000Z",
      },
      linkedAt: "2026-08-23T10:01:00.000Z",
    });

    assert.strictEqual(linked.providerInstanceId, "codex-work");
    assert.strictEqual(linked.activity, "active");
    assert.strictEqual(imported.nativeMessageId, "native-message-1");
    assert.strictEqual(imported.message.id, "message-1");
  }),
);

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("parses turn diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("parses full thread diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeFullThreadDiffInput({
      threadId: "thread-1",
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects thread turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeThreadTurnDiff({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.checkpointsEnabled, true);
  }),
);

it.effect("defaults checkpoint capture for projects in historical cached snapshots", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationReadModel({
      snapshotSequence: 1,
      projects: [
        {
          id: "project-1",
          title: "Historical project",
          workspaceRoot: "/tmp/historical-project",
          defaultModelSelection: null,
          scripts: [],
          coordinationClaims: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      threads: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.projects[0]?.checkpointsEnabled, true);
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.fetchMode, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("decodes a result-only retry against an existing user message and turn", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnRetryCommand({
      type: "thread.turn.retry",
      commandId: "cmd-turn-retry-1",
      threadId: "thread-1",
      turnId: "turn-1",
      messageId: "msg-1",
      fetchMode: "repository-exploration",
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.6",
      },
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    assert.strictEqual(parsed.type, "thread.turn.retry");
    assert.strictEqual(parsed.turnId, "turn-1");
    assert.strictEqual(parsed.messageId, "msg-1");
    assert.strictEqual(parsed.fetchMode, "repository-exploration");
    assert.strictEqual(parsed.modelSelection?.model, "gpt-5.6");
  }),
);

it.effect("decodes a result-only retry before a provider turn id exists", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnRetryCommand({
      type: "thread.turn.retry",
      commandId: "cmd-turn-retry-pending",
      threadId: "thread-1",
      turnId: null,
      messageId: "msg-1",
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    assert.strictEqual(parsed.type, "thread.turn.retry");
    assert.strictEqual(parsed.turnId, null);
    assert.strictEqual(parsed.messageId, "msg-1");
  }),
);

it.effect("preserves Fetch mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-instructions",
      threadId: "thread-1",
      message: {
        messageId: "msg-turn-instructions",
        role: "user",
        text: "inspect the repository",
        attachments: [],
      },
      fetchMode: "repository-exploration",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.message.text, "inspect the repository");
    assert.strictEqual(parsed.fetchMode, "repository-exploration");
  }),
);

it.effect("keeps Fetch mode narrow on client turn-start commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeClientOrchestrationCommand({
      type: "thread.turn.start",
      commandId: "cmd-client-fetch",
      threadId: "thread-1",
      message: {
        messageId: "msg-client-fetch",
        role: "user",
        text: "inspect the repository",
        attachments: [],
      },
      fetchMode: "repository-exploration",
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.type, "thread.turn.start");
    if (parsed.type !== "thread.turn.start") {
      return;
    }
    assert.strictEqual(parsed.fetchMode, "repository-exploration");

    const invalid = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.turn.start",
        commandId: "cmd-client-fetch-invalid",
        threadId: "thread-1",
        message: {
          messageId: "msg-client-fetch-invalid",
          role: "user",
          text: "inspect the repository",
          attachments: [],
        },
        fetchMode: "arbitrary-hidden-prompt",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(invalid._tag, "Failure");
  }),
);

it.effect("accepts inline images, uploaded images, and uploaded files from clients", () =>
  Effect.gen(function* () {
    const command = yield* decodeClientOrchestrationCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-attachments",
      threadId: "thread-1",
      message: {
        messageId: "msg-attachments",
        role: "user",
        text: "hello",
        attachments: [
          {
            type: "image",
            name: "legacy.png",
            mimeType: "image/png",
            sizeBytes: 3,
            dataUrl: "data:image/png;base64,YWJj",
          },
          {
            type: "image",
            id: "pending-00000000-0000-4000-8000-000000000001",
            name: "uploaded.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
          {
            type: "file",
            id: "pending-00000000-0000-4000-8000-000000000002-pdf",
            name: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 3,
          },
        ],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    if (command.type !== "thread.turn.start") {
      assert.fail(`Expected thread.turn.start, received ${command.type}.`);
    }
    assert.strictEqual(command.message.attachments.length, 3);
    assert.strictEqual("dataUrl" in command.message.attachments[0]!, true);
    assert.strictEqual("id" in command.message.attachments[1]!, true);
    assert.strictEqual(command.message.attachments[2]!.type, "file");
  }),
);

it.effect("rejects display-only and unknown attachment types on new turns", () =>
  Effect.gen(function* () {
    const makeCommand = (attachment: unknown) => ({
      type: "thread.turn.start",
      commandId: "cmd-turn-unsupported-attachment",
      threadId: "thread-1",
      message: {
        messageId: "msg-unsupported-attachment",
        role: "user",
        text: "inspect this",
        attachments: [attachment],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const base = {
      id: "pending-00000000-0000-4000-8000-000000000003",
      name: "recording.bin",
      sizeBytes: 12,
    };

    const audio = yield* Effect.exit(
      decodeClientOrchestrationCommand(
        makeCommand({ ...base, type: "audio", mimeType: "audio/webm" }),
      ),
    );
    const unknown = yield* Effect.exit(
      decodeClientOrchestrationCommand(
        makeCommand({ ...base, type: "future", mimeType: "application/octet-stream" }),
      ),
    );

    assert.strictEqual(Exit.isFailure(audio), true);
    assert.strictEqual(Exit.isFailure(unknown), true);
  }),
);

// Attachments ride on persisted events and thread streams with no client
// version negotiation. A type this build does not know must decode instead of
// failing the whole message.
it.effect("tolerates attachment types from newer builds when decoding messages", () =>
  Effect.gen(function* () {
    const futureAttachment = {
      type: "somethingnew",
      id: "thread-1-00000000-0000-4000-8000-000000000003-glb",
      name: "scene.glb",
      mimeType: "model/gltf-binary",
      sizeBytes: 12,
    };

    const message = yield* decodeOrchestrationMessage({
      id: "message-1",
      role: "user",
      text: "look at this",
      attachments: [futureAttachment],
      turnId: null,
      streaming: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(message.attachments?.length, 1);
    assert.strictEqual(message.attachments?.[0]!.type, "somethingnew");

    const payload = yield* decodeThreadMessageSentPayload({
      threadId: "thread-1",
      messageId: "message-1",
      role: "user",
      text: "look at this",
      attachments: [futureAttachment],
      turnId: null,
      streaming: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(payload.attachments?.[0]!.type, "somethingnew");
  }),
);

// The tolerant member must not catch malformed known attachments: a file over
// the size cap or an image with a bad mime has to fail its own schema, not
// slide through the open one with those constraints unchecked.
it.effect("rejects malformed known attachment types instead of tolerating them", () =>
  Effect.gen(function* () {
    const base = {
      id: "thread-1-00000000-0000-4000-8000-000000000003-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
    };
    const decode = (attachment: unknown) =>
      decodeOrchestrationMessage({
        id: "message-1",
        role: "user",
        text: "look at this",
        attachments: [attachment],
        turnId: null,
        streaming: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

    const oversizedFile = yield* Effect.exit(
      decode({ ...base, type: "file", sizeBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1 }),
    );
    assert.strictEqual(Exit.isFailure(oversizedFile), true);

    const badMimeImage = yield* Effect.exit(
      decode({ ...base, type: "image", mimeType: "application/pdf", sizeBytes: 12 }),
    );
    assert.strictEqual(Exit.isFailure(badMimeImage), true);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("accepts bootstrap metadata in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-bootstrap",
      threadId: "thread-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "Bootstrap thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "t3code/example",
          startFromOrigin: true,
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createThread?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.startFromOrigin, true);
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.instanceId, "codex");
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      regenerateTitle: true,
      previousTitle: "Previous title",
      titleRegeneration: {
        requestId: "cmd-title-regenerate",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.previousTitle, "Previous title");
    assert.strictEqual(parsed.titleRegeneration?.requestId, "cmd-title-regenerate");
    assert.strictEqual(parsed.modelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread settle and unsettle commands", () =>
  Effect.gen(function* () {
    const settle = yield* decodeOrchestrationCommand({
      type: "thread.settle",
      commandId: "cmd-settle-1",
      threadId: "thread-1",
    });
    const unsettle = yield* decodeOrchestrationCommand({
      type: "thread.unsettle",
      commandId: "cmd-unsettle-1",
      threadId: "thread-1",
      reason: "user",
    });

    assert.strictEqual(settle.type, "thread.settle");
    assert.strictEqual(unsettle.type, "thread.unsettle");

    // "activity" is server-owned: it exists on the event, never on the
    // command, so a client cannot forge the neutral reset.
    const forged = yield* decodeOrchestrationCommand({
      type: "thread.unsettle",
      commandId: "cmd-unsettle-2",
      threadId: "thread-1",
      reason: "activity",
    }).pipe(Effect.flip);
    assert.ok(forged);
  }),
);

it.effect("defaults settled fields when decoding historical thread data", () =>
  Effect.gen(function* () {
    const common = {
      id: "thread-1",
      projectId: "project-1",
      title: "Historical thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      session: null,
    };
    const thread = yield* decodeOrchestrationThread({
      ...common,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });
    const shell = yield* decodeOrchestrationThreadShell({
      ...common,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    });

    assert.strictEqual(thread.settledOverride, null);
    assert.strictEqual(thread.settledAt, null);
    assert.strictEqual(thread.fork, undefined);
    assert.strictEqual(shell.settledOverride, null);
    assert.strictEqual(shell.settledAt, null);
    assert.strictEqual(shell.fork, undefined);
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    if (archived.type !== "thread.archived") {
      assert.fail(`Expected thread.archived event, received ${archived.type}.`);
    }
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("decodes thread settled and unsettled events", () =>
  Effect.gen(function* () {
    const settled = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-settle-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.settled",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-settle-1",
      causationEventId: null,
      correlationId: "cmd-settle-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        settledAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unsettled = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unsettle-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unsettled",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unsettle-1",
      causationEventId: null,
      correlationId: "cmd-unsettle-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        reason: "user",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.strictEqual(settled.type, "thread.settled");
    assert.strictEqual(unsettled.type, "thread.unsettled");
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "reasoningEffort"), "high");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "fastMode"), true);
  }),
);

it.effect("normalizes legacy object-shaped modelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Legacy options thread",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: {
          effort: "max",
          fastMode: true,
          // Falsy/garbage entries are dropped, matching migration 026.
          emptyStr: "   ",
          nullish: null,
          nested: { foo: 1 },
        },
      },
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.modelSelection.instanceId, ProviderInstanceId.make("claudeAgent"));
    assert.deepStrictEqual(parsed.modelSelection.options, [
      { id: "effort", value: "max" },
      { id: "fastMode", value: true },
    ]);
  }),
);

it.effect("normalizes legacy object-shaped defaultModelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Legacy default project",
      workspaceRoot: "/tmp/legacy",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
        options: { reasoningEffort: "low" },
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(parsed.defaultModelSelection?.options, [
      { id: "reasoningEffort", value: "low" },
    ]);
  }),
);

it.effect(
  "normalizes legacy object-shaped options on decode and re-encodes as canonical array",
  () =>
    Effect.gen(function* () {
      const decoded = yield* decodeThreadCreatedPayload({
        threadId: "thread-1",
        projectId: "project-1",
        title: "Round trip thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { fastMode: true },
        },
        branch: null,
        worktreePath: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const encoded = yield* encodeThreadCreatedPayload(decoded);
      assert.deepStrictEqual(encoded.modelSelection.options, [{ id: "fastMode", value: true }]);
    }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a title regeneration intent in thread.meta.update", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.meta.update",
      commandId: "cmd-title-regenerate",
      threadId: "thread-1",
      regenerateTitle: true,
    });
    assert.strictEqual(parsed.type, "thread.meta.update");
    if (parsed.type === "thread.meta.update") {
      assert.strictEqual(parsed.regenerateTitle, true);
    }
  }),
);

it.effect("accepts a linked pull request in thread.meta.update", () =>
  Effect.gen(function* () {
    const linkedPullRequest = {
      projectId: "project-1",
      repository: "pingdotgg/t3code",
      number: 42,
      url: "https://github.com/pingdotgg/t3code/pull/42",
    };
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.meta.update",
      commandId: "cmd-link-pull-request",
      threadId: "thread-1",
      linkedPullRequest,
    });

    assert.strictEqual(parsed.type, "thread.meta.update");
    if (parsed.type === "thread.meta.update") {
      assert.deepStrictEqual(parsed.linkedPullRequest, linkedPullRequest);
    }
  }),
);

it.effect("accepts an internal title regeneration completion", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.title.regeneration.complete",
      commandId: "cmd-title-regeneration-complete",
      threadId: "thread-1",
      requestId: "cmd-title-regenerate",
      title: "Updated title",
    });
    assert.strictEqual(parsed.type, "thread.title.regeneration.complete");
    if (parsed.type === "thread.title.regeneration.complete") {
      assert.strictEqual(parsed.requestId, "cmd-title-regenerate");
      assert.strictEqual(parsed.title, "Updated title");
    }
  }),
);

it.effect("rejects an explicit title combined with title regeneration", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeOrchestrationCommand({
        type: "thread.meta.update",
        commandId: "cmd-title-regenerate-with-title",
        threadId: "thread-1",
        title: "Explicit title",
        regenerateTitle: true,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.fetchMode, undefined);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes Fetch mode on a turn-start request", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-1",
      messageId: "msg-1",
      fetchMode: "repository-exploration",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.fetchMode, "repository-exploration");
  }),
);

it.effect("decodes result-only retry metadata on a turn-start request", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-1",
      messageId: "msg-1",
      resultOnly: true,
      retryOfTurnId: "turn-1",
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    assert.strictEqual(parsed.resultOnly, true);
    assert.strictEqual(parsed.retryOfTurnId, "turn-1");
  }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.runtimeSessionId, null);
    assert.strictEqual(parsed.abortState, null);
  }),
);

it.effect("decodes orchestration session abort synchronization state", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "running",
      providerName: "codex",
      runtimeSessionId: " runtime-session-1 ",
      runtimeMode: "full-access",
      activeTurnId: "turn-1",
      abortState: {
        runtimeSessionId: " runtime-session-1 ",
        targetTurnId: "turn-1",
        phase: "interrupting",
        requestedAt: "2026-01-01T00:00:01.000Z",
        forceAt: "2026-01-01T00:00:06.000Z",
      },
      lastError: null,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });

    assert.strictEqual(parsed.runtimeSessionId, "runtime-session-1");
    assert.deepStrictEqual(parsed.abortState, {
      runtimeSessionId: RuntimeSessionId.make("runtime-session-1"),
      targetTurnId: TurnId.make("turn-1"),
      phase: "interrupting",
      requestedAt: "2026-01-01T00:00:01.000Z",
      forceAt: "2026-01-01T00:00:06.000Z",
    });
  }),
);

it.effect("decodes the internal turn abort settlement command", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.turn.abort.settle",
      commandId: "cmd-abort-settle",
      threadId: "thread-1",
      runtimeSessionId: "runtime-session-1",
      turnId: "turn-1",
      outcome: "force-terminated",
      settledAt: "2026-01-01T00:00:07.000Z",
      createdAt: "2026-01-01T00:00:07.000Z",
    });

    assert.strictEqual(parsed.type, "thread.turn.abort.settle");
    if (parsed.type !== "thread.turn.abort.settle") {
      return;
    }
    assert.strictEqual(parsed.outcome, "force-terminated");
    assert.strictEqual(parsed.turnId, "turn-1");
  }),
);

it.effect("keeps interrupt public without exposing a force-abort client command", () =>
  Effect.gen(function* () {
    const interrupt = yield* decodeClientOrchestrationCommand({
      type: "thread.turn.interrupt",
      commandId: "cmd-interrupt",
      threadId: "thread-1",
      turnId: "turn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(interrupt.type, "thread.turn.interrupt");

    const forceAbort = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.turn.force-abort",
        commandId: "cmd-force-abort",
        threadId: "thread-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(forceAbort._tag, "Failure");
  }),
);

it.effect("decodes the authoritative turn abort settlement event", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 42,
      eventId: "evt-abort-settled",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-01-01T00:00:07.000Z",
      commandId: "cmd-abort-settle",
      causationEventId: null,
      correlationId: "cmd-abort-settle",
      metadata: {},
      type: "thread.turn-abort-settled",
      payload: {
        threadId: "thread-1",
        runtimeSessionId: "runtime-session-1",
        turnId: null,
        outcome: "force-detached",
        detail: "Remote termination could not be confirmed",
        settledAt: "2026-01-01T00:00:07.000Z",
      },
    });

    assert.strictEqual(parsed.type, "thread.turn-abort-settled");
    if (parsed.type !== "thread.turn-abort-settled") {
      return;
    }
    assert.strictEqual(parsed.payload.outcome, "force-detached");
    assert.strictEqual(parsed.payload.turnId, null);
  }),
);

const orchestrationThreadFixture = {
  id: "thread-1",
  projectId: "project-1",
  title: "Subagent contracts",
  modelSelection: {
    instanceId: "codex",
    model: "gpt-5.6-codex",
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: "/tmp/project",
  latestTurn: null,
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
} as const;

const orchestrationSubagentSummaryFixture = {
  id: "agent-contracts",
  providerThreadId: "provider-thread-contracts",
  parentId: null,
  path: "/root/contracts",
  name: "contracts",
  nickname: "contracts",
  role: "worker",
  task: "Implement contract schemas",
  model: "gpt-5.6-codex",
  reasoningEffort: "ultra",
  depth: 1,
  status: "running",
  statusMessage: "Adding tests",
  latestProgress: {
    kind: "test",
    summary: "Running contract tests",
    detail: null,
    createdAt: "2026-07-30T10:00:01.000Z",
  },
  latestTurn: null,
  startedAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:01.000Z",
  completedAt: null,
} as const;

it.effect("defaults subagents to an empty list for historical thread snapshots", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationThread(orchestrationThreadFixture);

    assert.deepStrictEqual(parsed.subagents, []);
  }),
);

it.effect("decodes subagent summaries with explicit progress and lifecycle state", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSubagentSummary(orchestrationSubagentSummaryFixture);

    assert.strictEqual(parsed.id, "agent-contracts");
    assert.strictEqual(parsed.status, "running");
    assert.strictEqual(parsed.latestProgress?.summary, "Running contract tests");
    assert.strictEqual(parsed.origin, "provider-native");
    assert.strictEqual(parsed.providerInstanceId, null);
    assert.strictEqual(parsed.providerDriver, null);
  }),
);

it.effect("decodes T3 Fetch subagent provider metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSubagentSummary({
      ...orchestrationSubagentSummaryFixture,
      origin: "t3-fetch",
      providerInstanceId: "claude_work",
      providerDriver: "claudeAgent",
    });

    assert.strictEqual(parsed.origin, "t3-fetch");
    assert.strictEqual(parsed.providerInstanceId, "claude_work");
    assert.strictEqual(parsed.providerDriver, "claudeAgent");
  }),
);

it.effect("decodes T3-managed general subagent provider metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSubagentSummary({
      ...orchestrationSubagentSummaryFixture,
      origin: "t3-managed",
      providerInstanceId: "codex",
      providerDriver: "codex",
    });

    assert.strictEqual(parsed.origin, "t3-managed");
    assert.strictEqual(parsed.providerInstanceId, "codex");
    assert.strictEqual(parsed.providerDriver, "codex");
  }),
);

it.effect("decodes a subagent detail using the existing transcript schemas", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSubagentDetail({
      ...orchestrationSubagentSummaryFixture,
      messages: [
        {
          id: "message-agent-1",
          role: "assistant",
          text: "Contracts are ready.",
          turnId: "turn-agent-1",
          streaming: false,
          createdAt: "2026-07-30T10:00:02.000Z",
          updatedAt: "2026-07-30T10:00:02.000Z",
        },
      ],
      proposedPlans: [],
      activities: [],
    });

    assert.strictEqual(parsed.messages[0]?.text, "Contracts are ready.");
  }),
);

it.effect("routes internal transcript commands to an optional subagent", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.message.assistant.delta",
      commandId: "command-agent-delta-1",
      threadId: "thread-1",
      subagentId: "agent-contracts",
      messageId: "message-agent-1",
      delta: "Contracts",
      turnId: "turn-agent-1",
      createdAt: "2026-07-30T10:00:01.000Z",
    });

    assert.strictEqual(parsed.type, "thread.message.assistant.delta");
    if (parsed.type !== "thread.message.assistant.delta") {
      return;
    }
    assert.strictEqual(parsed.subagentId, "agent-contracts");
  }),
);

it.effect("decodes subagent summary and progress commands", () =>
  Effect.gen(function* () {
    const upsert = yield* decodeOrchestrationCommand({
      type: "thread.subagent.upsert",
      commandId: "command-agent-upsert-1",
      threadId: "thread-1",
      subagent: orchestrationSubagentSummaryFixture,
      createdAt: "2026-07-30T10:00:01.000Z",
    });
    const progress = yield* decodeOrchestrationCommand({
      type: "thread.subagent.progress.set",
      commandId: "command-agent-progress-1",
      threadId: "thread-1",
      subagentId: "agent-contracts",
      progress: null,
      updatedAt: "2026-07-30T10:00:02.000Z",
    });

    assert.strictEqual(upsert.type, "thread.subagent.upsert");
    assert.strictEqual(progress.type, "thread.subagent.progress.set");
  }),
);

it.effect("decodes routed subagent transcript events and state updates", () =>
  Effect.gen(function* () {
    const stateEvent = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-agent-state-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-07-30T10:00:02.000Z",
      commandId: "command-agent-state-1",
      causationEventId: null,
      correlationId: "command-agent-state-1",
      metadata: {},
      type: "thread.subagent-state-set",
      payload: {
        threadId: "thread-1",
        subagentId: "agent-contracts",
        status: "waiting",
        statusMessage: null,
        updatedAt: "2026-07-30T10:00:02.000Z",
      },
    });
    const activityEvent = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-agent-activity-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      occurredAt: "2026-07-30T10:00:03.000Z",
      commandId: "command-agent-activity-1",
      causationEventId: null,
      correlationId: "command-agent-activity-1",
      metadata: {},
      type: "thread.activity-appended",
      payload: {
        threadId: "thread-1",
        subagentId: "agent-contracts",
        activity: {
          id: "activity-agent-1",
          tone: "tool",
          kind: "command",
          summary: "Running tests",
          payload: {},
          turnId: "turn-agent-1",
          createdAt: "2026-07-30T10:00:03.000Z",
        },
      },
    });

    assert.strictEqual(stateEvent.type, "thread.subagent-state-set");
    assert.strictEqual(activityEvent.type, "thread.activity-appended");
    if (activityEvent.type !== "thread.activity-appended") {
      return;
    }
    assert.strictEqual(activityEvent.payload.subagentId, "agent-contracts");
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);

// ── ModelSelection: instance-keyed wire shape + legacy decoder ────────
//
// `ModelSelection` is routing-keyed on `instanceId` — never a driver kind.
// Persisted and in-flight payloads from pre-instance builds carry a
// `provider` field whose value was a driver kind; those payloads are migrated
// at the wire boundary by
// promoting `provider` to the default instance id for that driver
// (built-in drivers use the driver kind slug as their default instance id, so
// the migration is a 1:1 rename).
//
// These tests pin the rollback/fork tolerance invariant: legacy payloads
// decode cleanly for fork-provided drivers, and the decoded form uses
// `instanceId` uniformly regardless of origin.

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);

it.effect("ModelSelection migrates legacy `provider` field to `instanceId`", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex"));
    assert.strictEqual(parsed.model, "gpt-5-codex");
    assert.deepStrictEqual(parsed.options, [{ id: "reasoningEffort", value: "high" }]);
  }),
);

it.effect("ModelSelection accepts an explicit instanceId routing key", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect("ModelSelection prefers explicit instanceId over legacy provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect(
  "ModelSelection decodes unknown driver kinds via legacy provider (rollback / fork invariant)",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeModelSelection({
        provider: "ollama",
        model: "llama3:70b",
        options: [{ id: "temperature", value: "0.4" }],
      });
      assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("ollama"));
      assert.strictEqual(parsed.model, "llama3:70b");
    }),
);

it.effect("ModelSelection encodes to the canonical instanceId wire form", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeModelSelection({
      provider: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
    const encoded = yield* encodeModelSelection(decoded);
    assert.deepStrictEqual(encoded, {
      instanceId: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
  }),
);

it.effect("ModelSelection rejects malformed instance ids", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeModelSelection({
        instanceId: "1invalid", // must start with a letter
        model: "x",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("project favicon overrides accept only supported image files", () =>
  Effect.gen(function* () {
    const valid = yield* decodeOrchestrationCommand({
      type: "project.meta.update",
      commandId: "cmd-project-favicon",
      projectId: "project-1",
      faviconPath: "brand/icon.svg",
    });
    assert.strictEqual(valid.type, "project.meta.update");

    const invalid = yield* Effect.exit(
      decodeOrchestrationCommand({
        type: "project.meta.update",
        commandId: "cmd-project-secret",
        projectId: "project-1",
        faviconPath: ".env",
      }),
    );
    assert.strictEqual(invalid._tag, "Failure");
  }),
);

it("isProviderSendTurnSupportedImageMimeType accepts raster formats and rejects svg", () => {
  assert.strictEqual(isProviderSendTurnSupportedImageMimeType("image/png"), true);
  assert.strictEqual(isProviderSendTurnSupportedImageMimeType("IMAGE/JPEG"), true);
  assert.strictEqual(isProviderSendTurnSupportedImageMimeType("image/svg+xml"), false);
});
