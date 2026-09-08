// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  ApprovalRequestId,
  CodexSettings,
  EnvironmentId,
  EventId,
  McpRuntimeServerKey,
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderItemId,
  SubagentId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  RuntimeSessionId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, vi } from "@effect/vitest";

import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as EffectCodexSchema from "effect-codex-app-server/schema";
import { describe } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterValidationError } from "../Errors.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  type CodexSessionRuntimeOptions,
  type CodexSessionRuntimeForkInput,
  type CodexSessionRuntimeSendTurnInput,
  type CodexSessionRuntimeShape,
  type CodexMcpServerStatus,
  type CodexThreadSnapshot,
} from "./CodexSessionRuntime.ts";
import {
  makeCodexAdapter,
  makeCodexRuntimeEventMapper,
  normalizeCodexCollabAgentStatus,
  sanitizeCodexMcpNativeEvent,
} from "./CodexAdapter.ts";
const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const decodeMcpServerDefinition = Schema.decodeSync(McpServerDefinition);

// Test-local service tag so the rest of the file can keep using `yield* CodexAdapter`.
class CodexAdapter extends Context.Service<CodexAdapter, CodexAdapterShape>()(
  "t3/provider/Layers/CodexAdapter.test/CodexAdapter",
) {}

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const FORCE_STOP_RUNTIME_SESSION_ID = RuntimeSessionId.make("codex-force-stop-runtime");
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asItemId = (value: string): ProviderItemId => ProviderItemId.make(value);

function makeProviderNotification(
  input: Pick<ProviderEvent, "id" | "method" | "payload"> &
    Partial<Pick<ProviderEvent, "providerThreadId" | "subagentId" | "turnId" | "itemId">>,
): ProviderEvent {
  return {
    id: input.id,
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: asThreadId("thread-1"),
    createdAt: "2026-01-01T00:00:00.000Z",
    method: input.method,
    payload: input.payload,
    ...(input.providerThreadId ? { providerThreadId: input.providerThreadId } : {}),
    ...(input.subagentId ? { subagentId: input.subagentId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: input.itemId } : {}),
  };
}

describe("Codex subagent event mapping", () => {
  it("adds the current model traits to native subagents while preserving spawn overrides", () => {
    const events = makeCodexRuntimeEventMapper("provider-root", {
      model: "gpt-5.6",
      reasoningEffort: "xhigh",
      serviceTier: "priority",
    })(
      makeProviderNotification({
        id: asEventId("evt-subagent-traits"),
        method: "item/completed",
        providerThreadId: "provider-root",
        payload: {
          threadId: "provider-root",
          turnId: "root-turn",
          item: {
            id: "spawn-child-2",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            senderThreadId: "provider-root",
            receiverThreadIds: ["provider-child-2"],
            agentsStates: {},
            status: "completed",
            reasoningEffort: "high",
          },
        },
      }),
      asThreadId("thread-1"),
    );
    NodeAssert.deepStrictEqual(
      events.find((event) => event.type === "subagent.discovered")?.payload,
      {
        subagentId: SubagentId.make("codex:provider-child-2"),
        providerThreadId: "provider-child-2",
        model: "gpt-5.6",
        reasoningEffort: "high",
        serviceTier: "priority",
      },
    );
  });

  it("discovers a placeholder before child metadata and preserves child turn and item ids", () => {
    const mapEvent = makeCodexRuntimeEventMapper();
    const childId = SubagentId.make("codex:provider-child");

    const events = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-child-item"),
        method: "item/started",
        providerThreadId: "provider-child",
        subagentId: childId,
        turnId: asTurnId("child-turn"),
        itemId: asItemId("child-item"),
        payload: {
          startedAtMs: 1_778_000_000_000,
          threadId: "provider-child",
          turnId: "child-turn",
          item: {
            id: "child-item",
            type: "agentMessage",
            text: "",
          },
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.deepStrictEqual(
      events.map((event) => event.type),
      ["subagent.discovered", "item.started"],
    );
    NodeAssert.deepStrictEqual(events[0]?.payload, {
      subagentId: childId,
      providerThreadId: "provider-child",
    });
    NodeAssert.equal(events[1]?.subagentId, childId);
    NodeAssert.equal(events[1]?.turnId, "child-turn");
    NodeAssert.equal(events[1]?.itemId, "child-item");
    NodeAssert.equal(events[1]?.providerRefs?.providerThreadId, "provider-child");
    NodeAssert.equal(events[1]?.providerRefs?.providerTurnId, "child-turn");
    NodeAssert.equal(events[1]?.providerRefs?.providerItemId, "child-item");
  });

  it("discovers agents from subAgentActivity when collab receiver lists are empty", () => {
    const mapEvent = makeCodexRuntimeEventMapper();

    const collabEvents = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-empty-receivers"),
        method: "item/completed",
        providerThreadId: "provider-root",
        turnId: asTurnId("root-turn"),
        itemId: asItemId("collab-wait"),
        payload: {
          threadId: "provider-root",
          turnId: "root-turn",
          item: {
            id: "collab-wait",
            type: "collabAgentToolCall",
            tool: "wait",
            senderThreadId: "provider-root",
            receiverThreadIds: [],
            agentsStates: {},
            status: "completed",
          },
        },
      }),
      asThreadId("thread-1"),
    );
    NodeAssert.equal(
      collabEvents.some((event) => event.type === "subagent.discovered"),
      false,
    );

    const activityEvents = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-subagent-activity"),
        method: "item/completed",
        providerThreadId: "provider-root",
        turnId: asTurnId("root-turn"),
        itemId: asItemId("activity-1"),
        payload: {
          threadId: "provider-root",
          turnId: "root-turn",
          item: {
            id: "activity-1",
            type: "subAgentActivity",
            agentThreadId: "provider-child",
            agentPath: "/root/research",
            kind: "started",
          },
        },
      }),
      asThreadId("thread-1"),
    );

    const discovered = activityEvents.find((event) => event.type === "subagent.discovered");
    NodeAssert.ok(discovered);
    NodeAssert.deepStrictEqual(discovered.payload, {
      subagentId: SubagentId.make("codex:provider-child"),
      providerThreadId: "provider-child",
      agentPath: "/root/research",
      depth: 1,
    });
  });

  it("never discovers the root provider thread as a subagent", () => {
    const mapEvent = makeCodexRuntimeEventMapper("provider-root");
    const rootSubagentId = SubagentId.make("codex:provider-root");

    const unknownRootEvents = makeCodexRuntimeEventMapper()(
      makeProviderNotification({
        id: asEventId("evt-unknown-root-subagent-activity"),
        method: "item/completed",
        providerThreadId: "provider-child",
        subagentId: SubagentId.make("codex:provider-child"),
        turnId: asTurnId("child-turn"),
        itemId: asItemId("unknown-root-activity"),
        payload: {
          threadId: "provider-child",
          turnId: "child-turn",
          item: {
            id: "unknown-root-activity",
            type: "subAgentActivity",
            agentThreadId: "provider-root",
            agentPath: "/root",
            kind: "interacted",
          },
        },
      }),
      asThreadId("thread-1"),
    );
    const activityEvents = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-root-subagent-activity"),
        method: "item/completed",
        providerThreadId: "provider-child",
        subagentId: SubagentId.make("codex:provider-child"),
        turnId: asTurnId("child-turn"),
        itemId: asItemId("root-activity"),
        payload: {
          threadId: "provider-child",
          turnId: "child-turn",
          item: {
            id: "root-activity",
            type: "subAgentActivity",
            agentThreadId: "provider-root",
            agentPath: "/root",
            kind: "interacted",
          },
        },
      }),
      asThreadId("thread-1"),
    );
    const collabEvents = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-root-collab-target"),
        method: "item/completed",
        providerThreadId: "provider-child",
        subagentId: SubagentId.make("codex:provider-child"),
        turnId: asTurnId("child-turn"),
        itemId: asItemId("root-collab"),
        payload: {
          threadId: "provider-child",
          turnId: "child-turn",
          item: {
            id: "root-collab",
            type: "collabAgentToolCall",
            tool: "sendInput",
            senderThreadId: "provider-child",
            receiverThreadIds: ["provider-root"],
            agentsStates: {
              "provider-root": { status: "running" },
            },
            status: "completed",
          },
        },
      }),
      asThreadId("thread-1"),
    );

    const rootLifecycleEvents = [...unknownRootEvents, ...activityEvents, ...collabEvents].filter(
      (event) =>
        (event.type === "subagent.discovered" || event.type === "subagent.state.changed") &&
        event.payload.subagentId === rootSubagentId,
    );
    NodeAssert.deepStrictEqual(rootLifecycleEvents, []);
  });

  it("treats subagent interaction as metadata instead of proof that the agent is running", () => {
    const mapEvent = makeCodexRuntimeEventMapper("provider-root");

    const events = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-child-interacted"),
        method: "item/completed",
        providerThreadId: "provider-root",
        turnId: asTurnId("root-turn"),
        itemId: asItemId("child-interacted"),
        payload: {
          threadId: "provider-root",
          turnId: "root-turn",
          item: {
            id: "child-interacted",
            type: "subAgentActivity",
            agentThreadId: "provider-child",
            agentPath: "/root/research",
            kind: "interacted",
          },
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.ok(events.some((event) => event.type === "subagent.discovered"));
    NodeAssert.equal(
      events.some((event) => event.type === "subagent.state.changed"),
      false,
    );
  });

  it("does not revive a subagent from sendInput without an authoritative agent state", () => {
    const mapEvent = makeCodexRuntimeEventMapper("provider-root");

    const events = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-child-send-input"),
        method: "item/completed",
        providerThreadId: "provider-root",
        turnId: asTurnId("root-turn"),
        itemId: asItemId("child-send-input"),
        payload: {
          threadId: "provider-root",
          turnId: "root-turn",
          item: {
            id: "child-send-input",
            type: "collabAgentToolCall",
            tool: "sendInput",
            senderThreadId: "provider-root",
            receiverThreadIds: ["provider-child"],
            agentsStates: {},
            status: "completed",
          },
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.ok(events.some((event) => event.type === "subagent.discovered"));
    NodeAssert.equal(
      events.some((event) => event.type === "subagent.state.changed"),
      false,
    );
  });

  it("maps an idle child thread to completed until an explicit turn starts", () => {
    const mapEvent = makeCodexRuntimeEventMapper("provider-root");
    const childId = SubagentId.make("codex:provider-child");

    const idleEvents = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-child-idle"),
        method: "thread/status/changed",
        providerThreadId: "provider-child",
        subagentId: childId,
        payload: {
          threadId: "provider-child",
          status: { type: "idle" },
        },
      }),
      asThreadId("thread-1"),
    );
    const startedEvents = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-child-turn-started"),
        method: "turn/started",
        providerThreadId: "provider-child",
        subagentId: childId,
        turnId: asTurnId("child-turn-2"),
        payload: {},
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.deepStrictEqual(
      idleEvents.find((event) => event.type === "subagent.state.changed")?.payload,
      { subagentId: childId, state: "completed" },
    );
    NodeAssert.deepStrictEqual(
      startedEvents.find((event) => event.type === "subagent.state.changed")?.payload,
      { subagentId: childId, state: "running" },
    );
  });

  it("enriches nested agents from thread metadata", () => {
    const mapEvent = makeCodexRuntimeEventMapper();
    const childId = SubagentId.make("codex:provider-child");

    const events = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-child-thread-started"),
        method: "thread/started",
        providerThreadId: "provider-child",
        subagentId: childId,
        payload: {
          thread: {
            id: "provider-child",
            agentNickname: "researcher",
            agentRole: "explorer",
            cliVersion: "0.145.0",
            createdAt: 1,
            cwd: "/tmp/project",
            ephemeral: false,
            modelProvider: "openai",
            preview: "Inspect the runtime",
            sessionId: "session-1",
            source: {
              subAgent: {
                thread_spawn: {
                  agent_nickname: "researcher",
                  agent_path: "/root/planner/researcher",
                  agent_role: "explorer",
                  depth: 2,
                  parent_thread_id: "provider-parent",
                },
              },
            },
            status: {
              type: "active",
              activeFlags: [],
            },
            turns: [],
            updatedAt: 1,
          },
        },
      }),
      asThreadId("thread-1"),
    );

    const discovered = events.find((event) => event.type === "subagent.discovered");
    NodeAssert.ok(discovered);
    NodeAssert.deepStrictEqual(discovered.payload, {
      subagentId: childId,
      providerThreadId: "provider-child",
      parentSubagentId: SubagentId.make("codex:provider-parent"),
      agentPath: "/root/planner/researcher",
      nickname: "researcher",
      role: "explorer",
      task: "Inspect the runtime",
      depth: 2,
    });
    const state = events.find((event) => event.type === "subagent.state.changed");
    NodeAssert.deepStrictEqual(state?.payload, {
      subagentId: childId,
      state: "running",
    });
  });

  it("maps collab agent states even when receiverThreadIds is empty", () => {
    const mapEvent = makeCodexRuntimeEventMapper();

    const events = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-collab-state"),
        method: "item/completed",
        providerThreadId: "provider-root",
        turnId: asTurnId("root-turn"),
        itemId: asItemId("collab-state"),
        payload: {
          threadId: "provider-root",
          turnId: "root-turn",
          item: {
            id: "collab-state",
            type: "collabAgentToolCall",
            tool: "wait",
            senderThreadId: "provider-root",
            receiverThreadIds: [],
            agentsStates: {
              "provider-child": {
                status: "errored",
                message: "command failed",
              },
            },
            status: "completed",
          },
        },
      }),
      asThreadId("thread-1"),
    );

    const state = events.find((event) => event.type === "subagent.state.changed");
    NodeAssert.deepStrictEqual(state?.payload, {
      subagentId: SubagentId.make("codex:provider-child"),
      state: "error",
      statusMessage: "command failed",
    });
  });

  it("normalizes every Codex collab status", () => {
    NodeAssert.deepStrictEqual(
      ["pendingInit", "running", "interrupted", "completed", "errored", "shutdown", "notFound"].map(
        (status) =>
          normalizeCodexCollabAgentStatus(
            status as Parameters<typeof normalizeCodexCollabAgentStatus>[0],
          ),
      ),
      ["starting", "running", "interrupted", "completed", "error", "completed", "unavailable"],
    );
  });

  it("synchronizes a completed collab turn with the dedicated subagent lifecycle", () => {
    const mapEvent = makeCodexRuntimeEventMapper("provider-root");
    const childId = SubagentId.make("codex:provider-child");

    const events = mapEvent(
      makeProviderNotification({
        id: asEventId("evt-collab-turn-completed"),
        method: "collabAgent/turnCompleted",
        turnId: asTurnId("root-turn"),
        payload: {
          agentThreadId: "provider-child",
          agentPath: "/root/audit-ui",
          turn: { id: "child-turn", status: "completed", items: [] },
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.deepStrictEqual(
      events.find((event) => event.type === "subagent.state.changed")?.payload,
      { subagentId: childId, state: "completed" },
    );
    NodeAssert.deepStrictEqual(events.find((event) => event.type === "task.updated")?.payload, {
      taskId: "provider-child",
      status: "idle",
      role: "audit-ui",
      title: "audit-ui",
      agentPath: "/root/audit-ui",
      timelineBypass: true,
    });
  });
});

describe("Codex MCP event mapping", () => {
  it("retains authentication failure reasons from startup status notifications", () => {
    const events = makeCodexRuntimeEventMapper("provider-root")(
      makeProviderNotification({
        id: asEventId("evt-mcp-auth-required"),
        method: "mcpServer/startupStatus/updated",
        providerThreadId: "provider-root",
        payload: {
          threadId: "provider-root",
          name: "notion",
          status: "failed",
          error: "OAuth token expired",
          failureReason: "reauthenticationRequired",
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.equal(events.length, 1);
    NodeAssert.deepStrictEqual(events[0]?.payload, {
      status: {
        name: "notion",
        status: "failed",
        error: "OAuth token expired",
        failureReason: "reauthenticationRequired",
      },
    });
  });

  it("retains OAuth completion success and failure details", () => {
    const events = makeCodexRuntimeEventMapper("provider-root")(
      makeProviderNotification({
        id: asEventId("evt-mcp-oauth-failed"),
        method: "mcpServer/oauthLogin/completed",
        providerThreadId: "provider-root",
        payload: {
          threadId: "provider-root",
          name: "notion",
          success: false,
          error: "Authorization was cancelled",
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.equal(events.length, 1);
    NodeAssert.deepStrictEqual(events[0]?.payload, {
      success: false,
      name: "notion",
      error: "Authorization was cancelled",
    });
  });

  it("redacts credentials from MCP startup diagnostics", () => {
    const secret = "codex-mcp-secret-token";
    const events = makeCodexRuntimeEventMapper("provider-root")(
      makeProviderNotification({
        id: asEventId("evt-mcp-secret-error"),
        method: "mcpServer/startupStatus/updated",
        providerThreadId: "provider-root",
        payload: {
          threadId: "provider-root",
          name: "notion",
          status: "failed",
          error: `Authorization: Bearer ${secret}`,
        },
      }),
      asThreadId("thread-1"),
    );

    NodeAssert.equal(events.length, 1);
    NodeAssert.doesNotMatch(JSON.stringify(events[0]?.payload), new RegExp(secret));
    NodeAssert.match(JSON.stringify(events[0]?.payload), /REDACTED/);
  });

  it("redacts MCP diagnostics before writing native event logs", () => {
    const secret = "native-log-secret";
    const event = sanitizeCodexMcpNativeEvent(
      makeProviderNotification({
        id: asEventId("evt-mcp-native-log-secret"),
        method: "mcpServer/oauthLogin/completed",
        payload: {
          threadId: "provider-root",
          name: "notion",
          success: false,
          error: `Authorization: Bearer ${secret}`,
          oauthState: "must-not-be-retained",
        },
      }),
    );

    const serialized = JSON.stringify(event.payload);
    NodeAssert.doesNotMatch(serialized, new RegExp(secret));
    NodeAssert.doesNotMatch(serialized, /must-not-be-retained/);
    NodeAssert.match(serialized, /REDACTED/);
  });
});

class FakeCodexRuntime implements CodexSessionRuntimeShape {
  private readonly eventQueue = Effect.runSync(Queue.unbounded<ProviderEvent>());
  private readonly now = "2026-01-01T00:00:00.000Z";
  public eventStreamFinalized = false;

  public readonly startImpl = vi.fn(() =>
    Promise.resolve({
      provider: ProviderDriverKind.make("codex"),
      status: "ready" as const,
      runtimeMode: this.options.runtimeMode,
      threadId: this.options.threadId,
      cwd: this.options.cwd,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.providerInstanceId
        ? { providerInstanceId: this.options.providerInstanceId }
        : {}),
      ...(this.options.resumeCursor ? { resumeCursor: this.options.resumeCursor } : {}),
      createdAt: this.now,
      updatedAt: this.now,
    } satisfies ProviderSession),
  );

  public readonly sendTurnImpl = vi.fn(
    (_input: CodexSessionRuntimeSendTurnInput): Promise<ProviderTurnStartResult> =>
      Promise.resolve({
        threadId: this.options.threadId,
        turnId: asTurnId("turn-1"),
      }),
  );

  public readonly compactThread = Effect.promise(() => this.compactThreadImpl());

  public readonly interruptTurnImpl = vi.fn((_turnId?: TurnId): Promise<void> =>
    Promise.resolve(undefined),
  );

  public readonly readThreadImpl = vi.fn((): Promise<CodexThreadSnapshot> =>
    Promise.resolve({
      threadId: "provider-thread-1",
      turns: [],
    }),
  );

  public readonly rollbackThreadImpl = vi.fn((_numTurns: number): Promise<CodexThreadSnapshot> =>
    Promise.resolve({
      threadId: "provider-thread-1",
      turns: [],
    }),
  );

  public readonly forkThreadImpl = vi.fn((_input: CodexSessionRuntimeForkInput) =>
    Promise.resolve({
      threadId: "provider-child",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    }),
  );

  public readonly compactThreadImpl = vi.fn(() => Promise.resolve(undefined));

  public readonly uploadFeedbackImpl = vi.fn((_reason?: string) =>
    Promise.resolve({ threadId: "provider-thread-1" }),
  );

  public readonly respondToRequestImpl = vi.fn(
    (_requestId: ApprovalRequestId, _decision: ProviderApprovalDecision): Promise<void> =>
      Promise.resolve(undefined),
  );

  public readonly respondToUserInputImpl = vi.fn(
    (_requestId: ApprovalRequestId, _answers: ProviderUserInputAnswers): Promise<void> =>
      Promise.resolve(undefined),
  );

  public readonly listMcpServerStatusesImpl = vi.fn(
    (
      _detail?: EffectCodexSchema.V2ListMcpServerStatusParams__McpServerStatusDetail,
    ): Promise<ReadonlyArray<CodexMcpServerStatus>> => Promise.resolve([]),
  );
  public readonly reloadMcpServersImpl = vi.fn(() => Promise.resolve(undefined));
  public readonly startMcpOauthImpl = vi.fn((_input: { readonly serverName: string }) =>
    Promise.resolve({ authorizationUrl: "https://auth.example.test/authorize" }),
  );

  public readonly closeImpl = vi.fn(() => Promise.resolve(undefined));
  public readonly forceCloseImpl = vi.fn(() => Promise.resolve(undefined));

  readonly options: CodexSessionRuntimeOptions;

  private readonly eventStreamStarted: Deferred.Deferred<void>;

  constructor(options: CodexSessionRuntimeOptions, eventStreamStarted: Deferred.Deferred<void>) {
    this.options = options;
    this.eventStreamStarted = eventStreamStarted;
  }

  start() {
    return Deferred.await(this.eventStreamStarted).pipe(
      Effect.andThen(Effect.promise(() => this.startImpl())),
    );
  }

  getSession = Effect.promise(() => this.startImpl());

  sendTurn(input: CodexSessionRuntimeSendTurnInput) {
    return Effect.promise(() => this.sendTurnImpl(input));
  }

  interruptTurn(turnId?: TurnId) {
    return Effect.promise(() => this.interruptTurnImpl(turnId));
  }

  readThread = Effect.promise(() => this.readThreadImpl());

  rollbackThread(numTurns: number) {
    return Effect.promise(() => this.rollbackThreadImpl(numTurns));
  }

  forkThread(input: CodexSessionRuntimeForkInput) {
    return Effect.promise(() => this.forkThreadImpl(input));
  }

  uploadFeedback(reason?: string) {
    return Effect.promise(() => this.uploadFeedbackImpl(reason));
  }

  respondToRequest(requestId: ApprovalRequestId, decision: ProviderApprovalDecision) {
    return Effect.promise(() => this.respondToRequestImpl(requestId, decision));
  }

  respondToUserInput(requestId: ApprovalRequestId, answers: ProviderUserInputAnswers) {
    return Effect.promise(() => this.respondToUserInputImpl(requestId, answers));
  }

  listMcpServerStatuses(
    detail?: EffectCodexSchema.V2ListMcpServerStatusParams__McpServerStatusDetail,
  ) {
    return Effect.promise(() => this.listMcpServerStatusesImpl(detail));
  }

  reloadMcpServers = Effect.promise(() => this.reloadMcpServersImpl());

  startMcpOauth(input: { readonly serverName: string }) {
    return Effect.promise(() => this.startMcpOauthImpl(input));
  }

  get events() {
    return Stream.concat(
      Stream.fromEffect(Deferred.succeed(this.eventStreamStarted, undefined)).pipe(Stream.drain),
      Stream.fromQueue(this.eventQueue),
    ).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          this.eventStreamFinalized = true;
        }),
      ),
    );
  }

  close = Effect.promise(() => this.closeImpl());
  forceClose = Effect.promise(() => this.forceCloseImpl());

  emit(event: ProviderEvent) {
    return Queue.offer(this.eventQueue, event).pipe(Effect.asVoid);
  }
}

function makeRuntimeFactory() {
  const runtimes: Array<FakeCodexRuntime> = [];
  const factory = vi.fn((options: CodexSessionRuntimeOptions) =>
    Effect.gen(function* () {
      const eventStreamStarted = yield* Deferred.make<void>();
      const runtime = new FakeCodexRuntime(options, eventStreamStarted);
      runtimes.push(runtime);
      return runtime;
    }),
  );

  return {
    factory,
    get lastRuntime(): FakeCodexRuntime | undefined {
      return runtimes.at(-1);
    },
  };
}

function makeScopedRuntimeFactory(options?: { readonly failConstruction?: boolean }) {
  const runtimes: Array<FakeCodexRuntime> = [];
  const releasedThreadIds: Array<ThreadId> = [];

  const factory = vi.fn((runtimeOptions: CodexSessionRuntimeOptions) =>
    Effect.gen(function* () {
      yield* Scope.Scope;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          releasedThreadIds.push(runtimeOptions.threadId);
        }),
      );

      if (options?.failConstruction) {
        return yield* new CodexErrors.CodexAppServerSpawnError({
          command: `${runtimeOptions.binaryPath} app-server`,
          cause: new Error("runtime construction failed"),
        });
      }

      const eventStreamStarted = yield* Deferred.make<void>();
      const runtime = new FakeCodexRuntime(runtimeOptions, eventStreamStarted);
      runtimes.push(runtime);
      return runtime;
    }),
  );

  return {
    factory,
    releasedThreadIds,
    get lastRuntime(): FakeCodexRuntime | undefined {
      return runtimes.at(-1);
    },
  };
}

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  recordImportedTranscript: () => Effect.die("unused"),
  getProvider: () =>
    Effect.die(new Error("ProviderSessionDirectory.getProvider is not used in test")),
  getBinding: () => Effect.succeed(Option.none()),
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

const validationRuntimeFactory = makeRuntimeFactory();
const validationLayer = it.layer(
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = decodeCodexSettings({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: validationRuntimeFactory.factory,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

validationLayer("CodexAdapterLive validation", (it) => {
  it.effect("returns validation error for non-codex provider on startSession", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("claudeAgent"),
          threadId: asThreadId("thread-1"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.deepStrictEqual(
        result.failure,
        new ProviderAdapterValidationError({
          provider: ProviderDriverKind.make("codex"),
          operation: "startSession",
          issue: "Expected provider 'codex' but received 'claudeAgent'.",
        }),
      );
      NodeAssert.equal(validationRuntimeFactory.factory.mock.calls.length, 0);
    }),
  );
  it.effect("maps codex model options before starting a session", () =>
    Effect.gen(function* () {
      validationRuntimeFactory.factory.mockClear();
      const adapter = yield* CodexAdapter;

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
          { id: "serviceTier", value: "priority" },
        ]),
        runtimeMode: "full-access",
      });

      NodeAssert.deepStrictEqual(validationRuntimeFactory.factory.mock.calls[0]?.[0], {
        binaryPath: "codex",
        cwd: process.cwd(),
        launchArgs: "",
        model: "gpt-5.3-codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        serviceTier: "priority",
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });
    }),
  );

  it.effect("isolates project/off memory modes and restores provider-native memory", () =>
    Effect.gen(function* () {
      validationRuntimeFactory.factory.mockClear();
      const adapter = yield* CodexAdapter;

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-project-memory"),
        projectMemoryMode: "project",
        runtimeMode: "full-access",
      });
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-memory-off"),
        projectMemoryMode: "off",
        runtimeMode: "full-access",
      });
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-provider-memory"),
        projectMemoryMode: "provider",
        runtimeMode: "full-access",
      });

      NodeAssert.deepStrictEqual(
        validationRuntimeFactory.factory.mock.calls[0]?.[0]?.appServerArgs,
        ["-c", "memories.use_memories=false", "-c", "memories.generate_memories=false"],
      );
      NodeAssert.deepStrictEqual(
        validationRuntimeFactory.factory.mock.calls[1]?.[0]?.appServerArgs,
        ["-c", "memories.use_memories=false", "-c", "memories.generate_memories=false"],
      );
      NodeAssert.equal(
        validationRuntimeFactory.factory.mock.calls[2]?.[0]?.appServerArgs,
        undefined,
      );
    }),
  );

  it.effect("gives Fetch workers only the authenticated workspace MCP without delegation", () => {
    const runtimeFactory = makeRuntimeFactory();
    const resolveMcpServers = vi.fn(() =>
      Effect.succeed([
        decodeMcpServerDefinition({
          id: "configured",
          name: "Configured",
          enabled: true,
          scope: "global",
          transport: "http",
          url: "https://example.com/mcp",
          headers: {},
        }),
      ]),
    );
    const layer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({});
        return yield* makeCodexAdapter(codexConfig, {
          makeRuntime: runtimeFactory.factory,
          resolveMcpServers,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    const threadId = asThreadId("fetch:thread:run:0");
    return Effect.gen(function* () {
      McpProviderSession.setMcpProviderSession({
        environmentId: EnvironmentId.make("environment-fetch"),
        threadId,
        providerSessionId: "provider-session-fetch",
        providerInstanceId: ProviderInstanceId.make("codex"),
        endpoint: "http://127.0.0.1:43123/mcp/workspace",
        authorizationHeader: "Bearer fetch-token",
      });
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId,
        purpose: "fetch-worker",
        resumeCursor: { threadId: "must-not-resume" },
        runtimeMode: "full-access",
      });

      NodeAssert.equal(resolveMcpServers.mock.calls.length, 0);
      const runtimeInput = runtimeFactory.factory.mock.calls[0]?.[0];
      NodeAssert.equal(runtimeInput?.runtimeMode, "approval-required");
      NodeAssert.deepStrictEqual(runtimeInput?.appServerArgs, [
        "--disable",
        "multi_agent",
        "-c",
        "mcp_servers.t3-code.url=http://127.0.0.1:43123/mcp/workspace",
        "-c",
        'mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"',
      ]);
      NodeAssert.equal(runtimeInput?.resumeCursor, undefined);
      NodeAssert.deepStrictEqual(runtimeInput?.mcpServers, []);
      NodeAssert.equal(runtimeInput?.environment?.T3_MCP_BEARER_TOKEN, "fetch-token");
      NodeAssert.deepStrictEqual(runtimeInput?.internalMcpServer, {
        url: "http://127.0.0.1:43123/mcp/workspace",
        bearerTokenEnvVar: "T3_MCP_BEARER_TOKEN",
      });
    }).pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId))),
    );
  });

  it.effect("gives general subagents the full MCP surface without nested delegation", () => {
    const runtimeFactory = makeRuntimeFactory();
    const configuredMcp = decodeMcpServerDefinition({
      id: "configured",
      name: "Configured",
      enabled: true,
      scope: "global",
      transport: "http",
      url: "https://example.com/mcp",
      headers: {},
    });
    const resolveMcpServers = vi.fn(() => Effect.succeed([configuredMcp]));
    const layer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({});
        return yield* makeCodexAdapter(codexConfig, {
          makeRuntime: runtimeFactory.factory,
          resolveMcpServers,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    const threadId = asThreadId("general:thread:worker");
    return Effect.gen(function* () {
      McpProviderSession.setMcpProviderSession({
        environmentId: EnvironmentId.make("environment-general"),
        threadId,
        providerSessionId: "provider-session-general",
        providerInstanceId: ProviderInstanceId.make("codex"),
        endpoint: "http://127.0.0.1:43123/mcp/workspace",
        authorizationHeader: "Bearer general-token",
      });
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId,
        purpose: "subagent-worker",
        freshSession: true,
        resumeCursor: { threadId: "must-not-resume" },
        runtimeMode: "full-access",
      });

      NodeAssert.equal(resolveMcpServers.mock.calls.length, 1);
      const runtimeInput = runtimeFactory.factory.mock.calls[0]?.[0];
      NodeAssert.equal(runtimeInput?.runtimeMode, "full-access");
      NodeAssert.deepStrictEqual(runtimeInput?.appServerArgs, [
        "--disable",
        "multi_agent",
        "-c",
        "mcp_servers.t3-code.url=http://127.0.0.1:43123/mcp/workspace",
        "-c",
        'mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"',
      ]);
      NodeAssert.equal(runtimeInput?.resumeCursor, undefined);
      NodeAssert.deepStrictEqual(runtimeInput?.mcpServers, [configuredMcp]);
      NodeAssert.equal(runtimeInput?.environment?.T3_MCP_BEARER_TOKEN, "general-token");
    }).pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId))),
    );
  });
});

describe("CodexAdapter resource protection", () => {
  it.effect("adds lifecycle hooks without changing MCP, model, or launch configuration", () =>
    Effect.gen(function* () {
      const governor = yield* ResourceProtection.makeSubagentResourceGovernor();
      const runtimeFactory = makeRuntimeFactory();
      const mcpServer = decodeMcpServerDefinition({
        id: "mock-mcp",
        name: "Mock MCP",
        enabled: true,
        scope: "global",
        transport: "http",
        url: "https://mcp.example.test",
        headers: {
          authorization: { value: "secret-never-in-hook-key", sensitive: true },
        },
      });
      const layer = Layer.effect(
        CodexAdapter,
        Effect.gen(function* () {
          const codexConfig = decodeCodexSettings({ launchArgs: "--strict-config" });
          return yield* makeCodexAdapter(codexConfig, {
            makeRuntime: runtimeFactory.factory,
            resolveMcpServers: () => Effect.succeed([mcpServer]),
          });
        }),
      ).pipe(
        Layer.provideMerge(Layer.succeed(ResourceProtection.SubagentResourceGovernor, governor)),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(providerSessionDirectoryTestLayer),
        Layer.provideMerge(NodeServices.layer),
      );
      const threadId = asThreadId("codex-resource-hook");
      const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
        { id: "reasoningEffort", value: "high" },
      ]);

      McpProviderSession.setMcpProviderSession({
        environmentId: EnvironmentId.make("environment-resource-hook"),
        threadId,
        providerSessionId: "provider-session-resource-hook",
        providerInstanceId: ProviderInstanceId.make("codex"),
        endpoint: "http://127.0.0.1:43123/mcp",
        authorizationHeader: "Bearer hook-token",
      });
      yield* Effect.gen(function* () {
        const adapter = yield* CodexAdapter;
        yield* adapter.startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId,
          runtimeMode: "full-access",
          modelSelection,
        });

        const runtimeInput = runtimeFactory.factory.mock.calls[0]?.[0];
        NodeAssert.deepStrictEqual(runtimeInput?.appServerGlobalArgs, [
          "--dangerously-bypass-hook-trust",
        ]);
        NodeAssert.deepStrictEqual(runtimeInput?.mcpServers, [mcpServer]);
        NodeAssert.equal(runtimeInput?.model, "gpt-5.6-sol");
        NodeAssert.equal(runtimeInput?.launchArgs, "--strict-config");
        NodeAssert.deepStrictEqual(runtimeInput?.appServerArgs?.slice(0, 4), [
          "-c",
          "mcp_servers.t3-code.url=http://127.0.0.1:43123/mcp",
          "-c",
          'mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"',
        ]);
        const hookOverrides =
          runtimeInput?.appServerArgs?.filter((argument) => argument.startsWith("hooks.")) ?? [];
        NodeAssert.deepStrictEqual(
          hookOverrides.map((argument) => /^hooks\.([A-Za-z]+)=/u.exec(argument)?.[1]),
          ["PreToolUse", "UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop"],
        );
        NodeAssert.equal(
          runtimeInput?.environment?.T3_RESOURCE_PROTECTION_URL,
          "http://127.0.0.1:43123/internal/resource-protection/codex-admit",
        );
        NodeAssert.match(
          runtimeInput?.environment?.T3_RESOURCE_PROTECTION_CONFIGURATION ?? "",
          /^sha256:[a-f0-9]{64}$/u,
        );
        NodeAssert.doesNotMatch(
          runtimeInput?.environment?.T3_RESOURCE_PROTECTION_CONFIGURATION ?? "",
          /secret-never-in-hook-key/u,
        );
        yield* adapter.stopSession(threadId);
      }).pipe(
        Effect.provide(layer),
        Effect.ensuring(Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId))),
      );
    }),
  );
});

const sessionRuntimeFactory = makeRuntimeFactory();
const sessionErrorLayer = it.layer(
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = decodeCodexSettings({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: sessionRuntimeFactory.factory,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

sessionErrorLayer("CodexAdapterLive session errors", (it) => {
  it.effect("advertises native thread forking and manual compaction", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;

      NodeAssert.deepStrictEqual(adapter.capabilities, {
        sessionModelSwitch: "in-session",
        mcp: "nativeConfig",
        nativeThreadFork: true,
        manualCompaction: true,
        promptlessTurnContinuation: true,
      });
    }),
  );

  it.effect("forks the provider thread into a resumed destination without replaying a turn", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const sourceThreadId = asThreadId("thread-native-fork-source");
      const destinationThreadId = asThreadId("thread-native-fork-destination");
      const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
        { id: "reasoningEffort", value: "high" },
        { id: "contextWindow", value: "262144" },
      ]);
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: sourceThreadId,
        runtimeMode: "full-access",
        modelSelection,
      });
      const sourceRuntime = sessionRuntimeFactory.lastRuntime;
      NodeAssert.ok(sourceRuntime);
      sourceRuntime.sendTurnImpl.mockClear();

      const destination = yield* adapter.forkSession({
        sourceThreadId,
        destinationThreadId,
        sourceProviderThreadId: "provider-parent-exact",
        lastProviderTurnId: "provider-turn-7",
        session: {
          provider: ProviderDriverKind.make("codex"),
          threadId: destinationThreadId,
          runtimeMode: "full-access",
          modelSelection,
        },
      });
      const destinationRuntime = sessionRuntimeFactory.lastRuntime;
      NodeAssert.ok(destinationRuntime);
      NodeAssert.notStrictEqual(destinationRuntime, sourceRuntime);

      NodeAssert.deepStrictEqual(sourceRuntime.forkThreadImpl.mock.calls, [
        [
          {
            sourceProviderThreadId: "provider-parent-exact",
            lastProviderTurnId: "provider-turn-7",
          },
        ],
      ]);
      NodeAssert.deepStrictEqual(sourceRuntime.sendTurnImpl.mock.calls, []);
      NodeAssert.deepStrictEqual(destinationRuntime.options.resumeCursor, {
        threadId: "provider-child",
      });
      NodeAssert.equal(destinationRuntime.options.model, "gpt-5.6-sol");
      NodeAssert.equal(destinationRuntime.options.reasoningEffort, "high");
      NodeAssert.equal(destinationRuntime.options.contextWindow, 262_144);
      NodeAssert.deepStrictEqual(destination.resumeCursor, { threadId: "provider-child" });
    }),
  );

  it.effect("compacts only the runtime covered by the supplied lease", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const threadId = asThreadId("thread-manual-compact");
      const session = yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId,
        runtimeMode: "full-access",
      });
      const runtime = sessionRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      runtime.compactThreadImpl.mockClear();
      NodeAssert.ok(session.runtimeSessionId);

      yield* adapter.compactThread(threadId, session.runtimeSessionId);
      yield* adapter.compactThread(threadId, RuntimeSessionId.make("stale-runtime"));

      NodeAssert.equal(runtime.compactThreadImpl.mock.calls.length, 1);
    }),
  );

  it.effect("maps missing adapter sessions to ProviderAdapterSessionNotFoundError", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const result = yield* adapter
        .sendTurn({
          threadId: asThreadId("sess-missing"),
          input: "hello",
          attachments: [],
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterSessionNotFoundError");
      NodeAssert.equal(result.failure.provider, "codex");
      NodeAssert.equal(result.failure.threadId, "sess-missing");
    }),
  );

  it.effect("compacts the active Codex thread and emits compacted state", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const threadId = asThreadId("thread-compact");
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId,
        runtimeMode: "full-access",
      });
      const runtime = sessionRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const compactedEventFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "thread.state.changed"),
        Stream.runHead,
        Effect.forkChild,
      );
      NodeAssert.ok(adapter.compaction?.type === "native");
      yield* adapter.compaction.start(threadId);
      yield* runtime.emit({
        id: asEventId("evt-compaction-item-completed"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/completed",
        threadId,
        payload: {
          completedAtMs: 1_778_000_000_000,
          threadId: "provider-thread-1",
          turnId: "provider-compact-turn",
          item: {
            id: "provider-compact-item",
            type: "contextCompaction",
          },
        },
      });
      const event = Option.getOrThrow(yield* Fiber.join(compactedEventFiber));
      NodeAssert.ok(event.type === "thread.state.changed");
      NodeAssert.equal(event.payload.state, "compacted");
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("uploads feedback for the active Codex thread", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const threadId = asThreadId("thread-feedback");
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId,
        runtimeMode: "full-access",
      });
      const runtime = sessionRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const result = yield* adapter.uploadFeedback({
        threadId,
        reason: "The agent stopped early.",
      });

      NodeAssert.deepStrictEqual(result, { feedbackId: "provider-thread-1" });
      NodeAssert.deepStrictEqual(runtime.uploadFeedbackImpl.mock.calls, [
        ["The agent stopped early."],
      ]);
    }),
  );

  it.effect("rejects feedback for an unknown Codex thread", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const result = yield* adapter
        .uploadFeedback({ threadId: asThreadId("thread-feedback-missing") })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterSessionNotFoundError");
    }),
  );

  it.effect("maps codex model options before sending a turn", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("sess-missing"),
        runtimeMode: "full-access",
      });
      const runtime = sessionRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      runtime.sendTurnImpl.mockClear();

      yield* Effect.ignore(
        adapter.sendTurn({
          threadId: asThreadId("sess-missing"),
          input: "hello",
          modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
            { id: "reasoningEffort", value: "high" },
            { id: "serviceTier", value: "priority" },
          ]),
          attachments: [],
        }),
      );

      NodeAssert.deepStrictEqual(runtime.sendTurnImpl.mock.calls[0]?.[0], {
        input: "hello",
        model: "gpt-5.3-codex",
        effort: "high",
        serviceTier: "priority",
      });
    }),
  );

  it.effect("passes the per-chat context window into the session runtime", () =>
    Effect.gen(function* () {
      const runtimeFactory = makeRuntimeFactory();
      const layer = Layer.effect(
        CodexAdapter,
        Effect.gen(function* () {
          const codexConfig = decodeCodexSettings({});
          return yield* makeCodexAdapter(codexConfig, {
            makeRuntime: runtimeFactory.factory,
          });
        }),
      ).pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(providerSessionDirectoryTestLayer),
        Layer.provideMerge(NodeServices.layer),
      );

      yield* Effect.gen(function* () {
        const adapter = yield* CodexAdapter;
        yield* adapter.startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("sess-context-window"),
          runtimeMode: "full-access",
          modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
            { id: "contextWindow", value: "262144" },
          ]),
        });

        NodeAssert.equal(runtimeFactory.factory.mock.calls[0]?.[0].contextWindow, 262_144);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("passes configured launch args into the session runtime", () => {
    const runtimeFactory = makeRuntimeFactory();
    const layer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({ launchArgs: "--strict-config --enable foo" });
        return yield* makeCodexAdapter(codexConfig, {
          makeRuntime: runtimeFactory.factory,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("sess-launch-args"),
        runtimeMode: "full-access",
      });

      const runtime = runtimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      NodeAssert.equal(runtime.options.launchArgs, "--strict-config --enable foo");
    }).pipe(Effect.provide(layer));
  });

  it.effect("uses T3CODE_CODEX_LAUNCH_ARGS for the session runtime", () => {
    const runtimeFactory = makeRuntimeFactory();
    const layer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({ launchArgs: "--enable settings-feature" });
        return yield* makeCodexAdapter(codexConfig, {
          environment: { T3CODE_CODEX_LAUNCH_ARGS: " --strict-config --enable env-feature " },
          makeRuntime: runtimeFactory.factory,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("sess-launch-args-env"),
        runtimeMode: "full-access",
      });

      const runtime = runtimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      NodeAssert.equal(runtime.options.launchArgs, "--strict-config --enable env-feature");
    }).pipe(Effect.provide(layer));
  });

  it.effect("maps codex model options for the adapter's bound custom instance id", () => {
    const customInstanceId = ProviderInstanceId.make("codex_personal");
    const customRuntimeFactory = makeRuntimeFactory();
    const customLayer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({});
        return yield* makeCodexAdapter(codexConfig, {
          instanceId: customInstanceId,
          makeRuntime: customRuntimeFactory.factory,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("sess-custom-instance"),
        runtimeMode: "full-access",
      });
      const runtime = customRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      runtime.sendTurnImpl.mockClear();

      yield* Effect.ignore(
        adapter.sendTurn({
          threadId: asThreadId("sess-custom-instance"),
          input: "hello",
          modelSelection: createModelSelection(
            ProviderInstanceId.make("codex_personal"),
            "gpt-5.3-codex",
            [
              { id: "reasoningEffort", value: "high" },
              { id: "serviceTier", value: "flex" },
            ],
          ),
          attachments: [],
        }),
      );

      NodeAssert.deepStrictEqual(runtime.sendTurnImpl.mock.calls[0]?.[0], {
        input: "hello",
        model: "gpt-5.3-codex",
        effort: "high",
        serviceTier: "flex",
      });
    }).pipe(Effect.provide(customLayer));
  });
});

describe("CodexAdapter MCP runtime", () => {
  it.effect("normalizes provider status and exposes only safe lazy tool metadata", () => {
    const runtimeFactory = makeRuntimeFactory();
    const managedServer = decodeMcpServerDefinition({
      id: "notion",
      name: "Notion",
      enabled: true,
      scope: "global",
      transport: "http",
      url: "https://mcp.notion.example/mcp",
      headers: {},
    });
    const missingServer = decodeMcpServerDefinition({
      id: "github",
      name: "GitHub",
      enabled: true,
      scope: "global",
      transport: "http",
      url: "https://mcp.github.example/mcp",
      headers: {},
    });
    const providerInstanceId = ProviderInstanceId.make("codex-work");
    const runtimeSessionId = RuntimeSessionId.make("codex-mcp-runtime");
    const threadId = asThreadId("thread-mcp-runtime");
    const layer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({});
        return yield* makeCodexAdapter(codexConfig, {
          instanceId: providerInstanceId,
          makeRuntime: runtimeFactory.factory,
          resolveMcpServers: () => Effect.succeed([managedServer, missingServer]),
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      yield* Effect.sync(() =>
        McpProviderSession.setMcpProviderSession({
          environmentId: EnvironmentId.make("environment-codex-mcp-runtime"),
          threadId,
          providerSessionId: "provider-session-codex-mcp-runtime",
          providerInstanceId,
          endpoint: "http://127.0.0.1:3000/mcp",
          authorizationHeader: "Bearer test-token",
        }),
      );
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId,
        runtimeSessionId,
        runtimeMode: "full-access",
      });

      const runtime = runtimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      NodeAssert.deepStrictEqual(runtimeFactory.factory.mock.calls[0]?.[0]?.internalMcpServer, {
        url: "http://127.0.0.1:3000/mcp",
        bearerTokenEnvVar: "T3_MCP_BEARER_TOKEN",
      });
      runtime.listMcpServerStatusesImpl.mockResolvedValue([
        {
          authStatus: "notLoggedIn",
          name: "notion",
          resourceTemplates: [],
          resources: [],
          serverInfo: {
            name: "notion-mcp",
            version: "1.2.3",
          },
          tools: {
            search: {
              name: "search",
              title: "Search",
              description: "Search the workspace",
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: true,
              },
              inputSchema: { secretSchemaValue: "must-not-cross-the-boundary" },
            },
          },
        },
        {
          authStatus: "bearerToken",
          name: "t3-code",
          resourceTemplates: [],
          resources: [],
          serverInfo: null,
          tools: {},
        },
      ]);

      const observedEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);
      yield* runtime.emit(
        makeProviderNotification({
          id: asEventId("evt-notion-reauthorize"),
          method: "mcpServer/startupStatus/updated",
          payload: {
            name: "notion",
            status: "failed",
            error: "The OAuth session expired",
            failureReason: "reauthenticationRequired",
          },
        }),
      );
      yield* Fiber.join(observedEventFiber);

      const mcpRuntime = adapter.mcpRuntime;
      NodeAssert.ok(mcpRuntime);
      const target = {
        providerInstanceId,
        threadId,
        runtimeSessionId,
      };
      const snapshot = yield* mcpRuntime.getSnapshot(target);

      NodeAssert.equal(snapshot.length, 3);
      NodeAssert.deepStrictEqual(snapshot[0]?.issue, {
        code: "reauthenticationRequired",
        message: "The OAuth session expired",
      });
      NodeAssert.equal(snapshot[0]?.statusSource, "provider-event");
      NodeAssert.deepStrictEqual(
        snapshot.map((server) => ({
          providerKey: server.providerKey,
          source: server.source,
          state: server.state,
          authState: server.authState,
          actions: server.availableActions,
          toolCount: server.toolCount,
        })),
        [
          {
            providerKey: McpRuntimeServerKey.make("notion"),
            source: "t3-managed",
            state: "auth-required",
            authState: "required",
            actions: ["refresh", "reconnect", "authorize"],
            toolCount: 1,
          },
          {
            providerKey: McpRuntimeServerKey.make("t3-code"),
            source: "t3-built-in",
            state: "connected",
            authState: "authenticated",
            actions: ["refresh", "reconnect"],
            toolCount: 0,
          },
          {
            providerKey: McpRuntimeServerKey.make("github"),
            source: "t3-managed",
            state: "unknown",
            authState: "unknown",
            actions: ["refresh", "reconnect"],
            toolCount: undefined,
          },
        ],
      );

      NodeAssert.ok(mcpRuntime.getServerDetails);
      const details = yield* mcpRuntime.getServerDetails({
        ...target,
        providerKey: McpRuntimeServerKey.make("notion"),
      });
      NodeAssert.ok(details);
      NodeAssert.deepStrictEqual(details.tools, [
        {
          name: "search",
          title: "Search",
          description: "Search the workspace",
          readOnly: true,
          destructive: false,
          openWorld: true,
        },
      ]);
      // @effect-diagnostics-next-line preferSchemaOverJson:off - Inspect the complete serialized value so encoding cannot hide leaked fields.
      NodeAssert.doesNotMatch(JSON.stringify(details), /secretSchemaValue/);
      NodeAssert.deepStrictEqual(runtime.listMcpServerStatusesImpl.mock.calls, [
        ["toolsAndAuthOnly"],
        ["full"],
      ]);
    }).pipe(
      Effect.ensuring(Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId))),
      Effect.provide(layer),
    );
  });

  it.effect("fences stale runtime actions and returns the native OAuth URL", () => {
    const runtimeFactory = makeRuntimeFactory();
    const providerInstanceId = ProviderInstanceId.make("codex-work");
    const runtimeSessionId = RuntimeSessionId.make("codex-current-runtime");
    const layer = Layer.effect(
      CodexAdapter,
      Effect.gen(function* () {
        const codexConfig = decodeCodexSettings({});
        return yield* makeCodexAdapter(codexConfig, {
          instanceId: providerInstanceId,
          makeRuntime: runtimeFactory.factory,
        });
      }),
    ).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-mcp-actions"),
        runtimeSessionId,
        runtimeMode: "full-access",
      });
      const runtime = runtimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      runtime.listMcpServerStatusesImpl.mockResolvedValue([
        {
          authStatus: "notLoggedIn",
          name: "notion",
          resourceTemplates: [],
          resources: [],
          serverInfo: null,
          tools: {},
        },
      ]);

      const mcpRuntime = adapter.mcpRuntime;
      NodeAssert.ok(mcpRuntime?.runAction);
      const stale = yield* mcpRuntime
        .runAction({
          providerInstanceId,
          threadId: asThreadId("thread-mcp-actions"),
          runtimeSessionId: RuntimeSessionId.make("codex-replaced-runtime"),
          providerKey: McpRuntimeServerKey.make("notion"),
          action: "authorize",
        })
        .pipe(Effect.result);
      NodeAssert.equal(stale._tag, "Failure");
      NodeAssert.equal(stale.failure._tag, "ProviderAdapterSessionNotFoundError");
      NodeAssert.equal(runtime.startMcpOauthImpl.mock.calls.length, 0);

      const authorized = yield* mcpRuntime.runAction({
        providerInstanceId,
        threadId: asThreadId("thread-mcp-actions"),
        runtimeSessionId,
        providerKey: McpRuntimeServerKey.make("notion"),
        action: "authorize",
      });
      NodeAssert.deepStrictEqual(authorized, {
        accepted: true,
        action: "authorize",
        providerKey: McpRuntimeServerKey.make("notion"),
        authorizationUrl: "https://auth.example.test/authorize",
      });
      NodeAssert.deepStrictEqual(runtime.startMcpOauthImpl.mock.calls, [
        [{ serverName: "notion" }],
      ]);

      const refreshed = yield* mcpRuntime.runAction({
        providerInstanceId,
        threadId: asThreadId("thread-mcp-actions"),
        runtimeSessionId,
        providerKey: McpRuntimeServerKey.make("notion"),
        action: "refresh",
      });
      NodeAssert.equal(refreshed.accepted, true);
      NodeAssert.equal(runtime.reloadMcpServersImpl.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "only reports live configuration as applied after Codex reflects the desired keys",
    () => {
      const runtimeFactory = makeRuntimeFactory();
      const notionServer = decodeMcpServerDefinition({
        id: "notion",
        name: "Notion",
        transport: "http",
        url: "https://mcp.notion.example/mcp",
        headers: {},
      });
      const githubServer = decodeMcpServerDefinition({
        id: "github",
        name: "GitHub",
        transport: "http",
        url: "https://mcp.github.example/mcp",
        headers: {},
      });
      let desiredServers: ReadonlyArray<typeof notionServer> = [notionServer];
      const providerInstanceId = ProviderInstanceId.make("codex-work");
      const runtimeSessionId = RuntimeSessionId.make("codex-configuration-runtime");
      const layer = Layer.effect(
        CodexAdapter,
        Effect.gen(function* () {
          const codexConfig = decodeCodexSettings({});
          return yield* makeCodexAdapter(codexConfig, {
            instanceId: providerInstanceId,
            makeRuntime: runtimeFactory.factory,
            resolveMcpServers: () => Effect.succeed(desiredServers),
          });
        }),
      ).pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(providerSessionDirectoryTestLayer),
        Layer.provideMerge(NodeServices.layer),
      );

      return Effect.gen(function* () {
        const adapter = yield* CodexAdapter;
        yield* adapter.startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-mcp-configuration"),
          runtimeSessionId,
          runtimeMode: "full-access",
        });
        const runtime = runtimeFactory.lastRuntime;
        NodeAssert.ok(runtime);
        runtime.listMcpServerStatusesImpl.mockResolvedValue([
          {
            authStatus: "oAuth",
            name: "notion",
            resourceTemplates: [],
            resources: [],
            serverInfo: null,
            tools: {},
          },
        ]);
        const target = {
          providerInstanceId,
          threadId: asThreadId("thread-mcp-configuration"),
          runtimeSessionId,
        };
        const applyConfiguration = adapter.mcpRuntime?.applyConfiguration;
        NodeAssert.ok(applyConfiguration);

        const applied = yield* applyConfiguration(target);
        NodeAssert.equal(applied, "applied");
        desiredServers = [githubServer];
        const unapplied = yield* applyConfiguration(target);

        NodeAssert.equal(unapplied, "pending-next-session");
        NodeAssert.equal(runtime.reloadMcpServersImpl.mock.calls.length, 2);
        NodeAssert.deepStrictEqual(runtime.listMcpServerStatusesImpl.mock.calls, [
          ["toolsAndAuthOnly"],
          ["toolsAndAuthOnly"],
        ]);
      }).pipe(Effect.provide(layer));
    },
  );
});

const lifecycleRuntimeFactory = makeRuntimeFactory();
const lifecycleLayer = it.layer(
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = decodeCodexSettings({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: lifecycleRuntimeFactory.factory,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

function startLifecycleRuntime() {
  return Effect.gen(function* () {
    const adapter = yield* CodexAdapter;
    yield* adapter.startSession({
      provider: ProviderDriverKind.make("codex"),
      threadId: asThreadId("thread-1"),
      runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
      runtimeMode: "full-access",
    });
    const runtime = lifecycleRuntimeFactory.lastRuntime;
    NodeAssert.ok(runtime);
    return { adapter, runtime };
  });
}

function codexTokenUsageEvent(input: {
  readonly id: string;
  readonly turnId: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly last?: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheCreationTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
  };
}): ProviderEvent {
  const totalTokens = input.inputTokens + input.outputTokens;
  const last = input.last ?? input;
  return {
    id: asEventId(input.id),
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: asThreadId("thread-1"),
    turnId: asTurnId(input.turnId),
    createdAt: "2026-01-01T00:00:00.000Z",
    method: "thread/tokenUsage/updated",
    payload: {
      threadId: "thread-1",
      turnId: input.turnId,
      tokenUsage: {
        total: {
          inputTokens: input.inputTokens,
          cachedInputTokens: input.cachedInputTokens,
          cacheWriteInputTokens: input.cacheCreationTokens,
          outputTokens: input.outputTokens,
          reasoningOutputTokens: input.reasoningTokens,
          totalTokens,
        },
        last: {
          inputTokens: last.inputTokens,
          cachedInputTokens: last.cachedInputTokens,
          cacheWriteInputTokens: last.cacheCreationTokens,
          outputTokens: last.outputTokens,
          reasoningOutputTokens: last.reasoningTokens,
          totalTokens: last.inputTokens + last.outputTokens,
        },
      },
    },
  };
}

function codexTurnEvent(method: "turn/started" | "turn/completed", turnId: string): ProviderEvent {
  return {
    id: asEventId(`evt-${method}-${turnId}`),
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: asThreadId("thread-1"),
    turnId: asTurnId(turnId),
    createdAt: "2026-01-01T00:00:00.000Z",
    method,
    payload:
      method === "turn/started"
        ? {}
        : {
            threadId: "thread-1",
            turn: { id: turnId, items: [], status: "completed" },
          },
  };
}

lifecycleLayer("CodexAdapterLive lifecycle", (it) => {
  it.effect("calculates one Codex turn total from cumulative counters", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const completedFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );

      yield* runtime.emit(codexTurnEvent("turn/started", "turn-usage"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-usage-1",
          turnId: "turn-usage",
          inputTokens: 100,
          cachedInputTokens: 40,
          cacheCreationTokens: 10,
          outputTokens: 20,
          reasoningTokens: 8,
        }),
      );
      // Codex can repeat both notifications without new work.
      yield* runtime.emit(codexTurnEvent("turn/started", "turn-usage"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-usage-duplicate",
          turnId: "turn-usage",
          inputTokens: 100,
          cachedInputTokens: 40,
          cacheCreationTokens: 10,
          outputTokens: 20,
          reasoningTokens: 8,
        }),
      );
      yield* runtime.emit({
        id: asEventId("evt-collab-activity"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-usage"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "collabAgent/activity",
        payload: {
          agentThreadId: "child-1",
          agentPath: "/root/child-1",
          activityKind: "started",
        },
      });
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-usage-2",
          turnId: "turn-usage",
          inputTokens: 150,
          cachedInputTokens: 60,
          cacheCreationTokens: 15,
          outputTokens: 30,
          reasoningTokens: 12,
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-usage"));

      const completed = yield* Fiber.join(completedFiber);
      NodeAssert.equal(completed._tag, "Some");
      if (completed._tag === "Some" && completed.value.type === "turn.completed") {
        NodeAssert.deepStrictEqual(completed.value.payload.tokenUsage, {
          usageStatus: "complete",
          usageScope: "main_agent",
          inputTokens: 150,
          cachedInputTokens: 60,
          cacheCreationTokens: 15,
          outputTokens: 30,
          reasoningTokens: 12,
          hasSubagents: true,
        });
      }
    }),
  );

  it.effect("does not charge a late prior-turn update to the next Codex turn", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const completedFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit(codexTurnEvent("turn/started", "turn-first"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-late-1",
          turnId: "turn-first",
          inputTokens: 100,
          cachedInputTokens: 40,
          cacheCreationTokens: 10,
          outputTokens: 20,
          reasoningTokens: 8,
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-first"));
      yield* runtime.emit(codexTurnEvent("turn/started", "turn-second"));
      // A late update for the finished turn lands after the next turn starts.
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-late-2",
          turnId: "turn-first",
          inputTokens: 150,
          cachedInputTokens: 60,
          cacheCreationTokens: 15,
          outputTokens: 30,
          reasoningTokens: 12,
        }),
      );
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-late-3",
          turnId: "turn-second",
          inputTokens: 170,
          cachedInputTokens: 65,
          cacheCreationTokens: 16,
          outputTokens: 35,
          reasoningTokens: 14,
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-second"));

      const completed = Array.from(yield* Fiber.join(completedFiber));
      const second = completed[1];
      NodeAssert.equal(second?.type, "turn.completed");
      if (second?.type === "turn.completed") {
        NodeAssert.deepStrictEqual(second.payload.tokenUsage, {
          usageStatus: "complete",
          usageScope: "main_agent",
          inputTokens: 20,
          cachedInputTokens: 5,
          cacheCreationTokens: 1,
          outputTokens: 5,
          reasoningTokens: 2,
          hasSubagents: false,
        });
      }
    }),
  );

  it.effect("clamps Codex cache and reasoning subsets to their totals", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const completedFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );

      yield* runtime.emit(codexTurnEvent("turn/started", "turn-clamp"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-clamp-1",
          turnId: "turn-clamp",
          inputTokens: 100,
          cachedInputTokens: 140,
          cacheCreationTokens: 120,
          outputTokens: 20,
          reasoningTokens: 30,
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-clamp"));

      const completed = yield* Fiber.join(completedFiber);
      NodeAssert.equal(completed._tag, "Some");
      if (completed._tag === "Some" && completed.value.type === "turn.completed") {
        NodeAssert.deepStrictEqual(completed.value.payload.tokenUsage, {
          usageStatus: "complete",
          usageScope: "main_agent",
          inputTokens: 100,
          cachedInputTokens: 100,
          cacheCreationTokens: 100,
          outputTokens: 20,
          reasoningTokens: 20,
          hasSubagents: false,
        });
      }
    }),
  );

  it.effect("counts the last response when Codex resets its running total mid-turn", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const completedFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );

      yield* runtime.emit(codexTurnEvent("turn/started", "turn-reset"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-reset-1",
          turnId: "turn-reset",
          inputTokens: 5_000,
          cachedInputTokens: 4_000,
          cacheCreationTokens: 100,
          outputTokens: 500,
          reasoningTokens: 200,
          last: {
            inputTokens: 100,
            cachedInputTokens: 80,
            cacheCreationTokens: 10,
            outputTokens: 20,
            reasoningTokens: 8,
          },
        }),
      );
      // Codex restarted its cumulative total. The new total is smaller than
      // the previous one, so only `last` is counted for this update.
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-reset-2",
          turnId: "turn-reset",
          inputTokens: 150,
          cachedInputTokens: 90,
          cacheCreationTokens: 5,
          outputTokens: 30,
          reasoningTokens: 12,
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-reset"));

      const completed = yield* Fiber.join(completedFiber);
      NodeAssert.equal(completed._tag, "Some");
      if (completed._tag === "Some" && completed.value.type === "turn.completed") {
        NodeAssert.deepStrictEqual(completed.value.payload.tokenUsage, {
          usageStatus: "complete",
          usageScope: "main_agent",
          inputTokens: 250,
          cachedInputTokens: 170,
          cacheCreationTokens: 15,
          outputTokens: 50,
          reasoningTokens: 20,
          hasSubagents: false,
        });
      }
    }),
  );

  it.effect("uses the last response usage when no prior Codex total exists", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        resumeCursor: { threadId: "provider-thread-1" },
        runtimeMode: "full-access",
      });
      const runtime = lifecycleRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      const firstCompletionsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      // Resumed thread: the cumulative total already holds old history, so the
      // first update must count only `last`.
      yield* runtime.emit(codexTurnEvent("turn/started", "turn-resumed"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-resume-baseline",
          turnId: "turn-resumed",
          inputTokens: 1_000,
          cachedInputTokens: 400,
          cacheCreationTokens: 100,
          outputTokens: 200,
          reasoningTokens: 80,
          last: {
            inputTokens: 300,
            cachedInputTokens: 120,
            cacheCreationTokens: 30,
            outputTokens: 60,
            reasoningTokens: 24,
          },
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-resumed"));

      yield* runtime.emit(codexTurnEvent("turn/started", "turn-after-resume"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-after-resume",
          turnId: "turn-after-resume",
          inputTokens: 1_100,
          cachedInputTokens: 440,
          cacheCreationTokens: 110,
          outputTokens: 220,
          reasoningTokens: 88,
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-after-resume"));

      const firstCompletions = Array.from(yield* Fiber.join(firstCompletionsFiber));

      yield* adapter.rollbackThread(asThreadId("thread-1"), 1);
      const rollbackCompletionFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );
      // Rollback drops the baseline and Codex shrinks its total, so the first
      // update after it counts only `last` again.
      yield* runtime.emit(codexTurnEvent("turn/started", "turn-after-rollback"));
      yield* runtime.emit(
        codexTokenUsageEvent({
          id: "evt-after-rollback",
          turnId: "turn-after-rollback",
          inputTokens: 1_050,
          cachedInputTokens: 420,
          cacheCreationTokens: 105,
          outputTokens: 210,
          reasoningTokens: 84,
          last: {
            inputTokens: 50,
            cachedInputTokens: 20,
            cacheCreationTokens: 5,
            outputTokens: 10,
            reasoningTokens: 4,
          },
        }),
      );
      yield* runtime.emit(codexTurnEvent("turn/completed", "turn-after-rollback"));

      const rollbackCompletion = yield* Fiber.join(rollbackCompletionFiber);
      const completions = [
        ...firstCompletions,
        ...(rollbackCompletion._tag === "Some" ? [rollbackCompletion.value] : []),
      ];
      NodeAssert.deepStrictEqual(
        completions.map((event) =>
          event.type === "turn.completed" ? event.payload.tokenUsage : undefined,
        ),
        [
          {
            usageStatus: "complete",
            usageScope: "main_agent",
            inputTokens: 300,
            cachedInputTokens: 120,
            cacheCreationTokens: 30,
            outputTokens: 60,
            reasoningTokens: 24,
            hasSubagents: false,
          },
          {
            usageStatus: "complete",
            usageScope: "main_agent",
            inputTokens: 100,
            cachedInputTokens: 40,
            cacheCreationTokens: 10,
            outputTokens: 20,
            reasoningTokens: 8,
            hasSubagents: false,
          },
          {
            usageStatus: "complete",
            usageScope: "main_agent",
            inputTokens: 50,
            cachedInputTokens: 20,
            cacheCreationTokens: 5,
            outputTokens: 10,
            reasoningTokens: 4,
            hasSubagents: false,
          },
        ],
      );
    }),
  );

  it.effect("carries child model metadata through every task event", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const eventsFiber = yield* Stream.runCollect(
        Stream.take(
          Stream.filter(adapter.streamEvents, (event) => event.type.startsWith("task.")),
          10,
        ),
      ).pipe(Effect.forkChild);

      const cases = [
        ["collabAgent/started", {}],
        ["collabAgent/activity", { activityKind: "started" }],
        ["collabAgent/turnStarted", {}],
        ["collabAgent/turnCompleted", { turn: { status: "completed" } }],
        ["collabAgent/statusChanged", { status: { type: "active", activeFlags: [] } }],
        ["collabAgent/tokenUsage", { tokenUsage: { total: { totalTokens: 42 } } }],
        ["collabAgent/item", { item: { type: "commandExecution", command: "pwd" } }],
        ["collabAgent/closed", {}],
        ["collabAgent/metadataUpdated", {}],
      ] as const;

      for (const [index, [method, extra]] of cases.entries()) {
        yield* runtime.emit({
          id: asEventId(`evt-child-model-${index}`),
          kind: "notification",
          provider: ProviderDriverKind.make("codex"),
          createdAt: "2026-01-01T00:00:00.000Z",
          method,
          threadId: asThreadId("thread-1"),
          turnId: asTurnId("turn-1"),
          payload: {
            agentThreadId: "child-model",
            agentPath: "/root/model-check",
            model: " gpt-5.6-sol ",
            effort: " high ",
            ...extra,
          },
        });
      }
      yield* runtime.emit({
        id: asEventId("evt-child-model-blank"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "collabAgent/metadataUpdated",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        payload: {
          agentThreadId: "child-model",
          model: "  ",
          effort: "",
        },
      });

      const events = Array.from(yield* Fiber.join(eventsFiber));
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        [
          "task.started",
          "task.started",
          "task.updated",
          "task.updated",
          "task.updated",
          "task.progress",
          "task.progress",
          "task.updated",
          "task.updated",
          "task.updated",
        ],
      );
      for (const event of events.slice(0, -1)) {
        const payload = event.payload as Record<string, unknown>;
        NodeAssert.equal(payload.model, "gpt-5.6-sol");
        NodeAssert.equal(payload.effort, "high");
      }

      const metadataPayload = events[8]?.payload as Record<string, unknown>;
      NodeAssert.equal("status" in metadataPayload, false);
      const blankMetadataPayload = events[9]?.payload as Record<string, unknown>;
      NodeAssert.equal("status" in blankMetadataPayload, false);
      NodeAssert.equal("model" in blankMetadataPayload, false);
      NodeAssert.equal("effort" in blankMetadataPayload, false);
    }),
  );

  it.effect("does not reactivate an idle child after a parent interaction", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const eventsFiber = yield* Stream.runCollect(
        Stream.take(
          Stream.filter(adapter.streamEvents, (event) => event.type.startsWith("task.")),
          3,
        ),
      ).pipe(Effect.forkChild);

      const childEvent = (id: string, method: string, payload: Record<string, unknown>) => ({
        id: asEventId(id),
        kind: "notification" as const,
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method,
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        payload,
      });

      yield* runtime.emit(
        childEvent("evt-child-running", "collabAgent/turnStarted", {
          agentThreadId: "child-1",
          agentPath: "/root/audit",
        }),
      );
      yield* runtime.emit(
        childEvent("evt-child-idle", "collabAgent/turnCompleted", {
          agentThreadId: "child-1",
          agentPath: "/root/audit",
          turn: { status: "completed" },
        }),
      );
      yield* runtime.emit(
        childEvent("evt-child-interacted", "collabAgent/activity", {
          agentThreadId: "child-1",
          agentPath: "/root/audit",
          activityKind: "interacted",
        }),
      );
      yield* runtime.emit(
        childEvent("evt-other-child-running", "collabAgent/turnStarted", {
          agentThreadId: "child-2",
          agentPath: "/root/other",
        }),
      );

      const events = Array.from(yield* Fiber.join(eventsFiber));
      NodeAssert.deepStrictEqual(
        events.map((event) =>
          event.type === "task.updated"
            ? { taskId: event.payload.taskId, status: event.payload.status }
            : { type: event.type },
        ),
        [
          { taskId: "child-1", status: "running" },
          { taskId: "child-1", status: "idle" },
          { taskId: "child-2", status: "running" },
        ],
      );
    }),
  );

  it.effect("maps completed agent message items to canonical item.completed events", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const event: ProviderEvent = {
        id: asEventId("evt-msg-complete"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/completed",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("msg_1"),
        payload: {
          completedAtMs: 1_778_000_000_000,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agentMessage",
            id: "msg_1",
            text: "done",
          },
        },
      };

      yield* runtime.emit(event);
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "item.completed");
      if (firstEvent.value.type !== "item.completed") {
        return;
      }
      NodeAssert.equal(firstEvent.value.itemId, "msg_1");
      NodeAssert.equal(firstEvent.value.turnId, "turn-1");
      NodeAssert.equal(firstEvent.value.runtimeSessionId, FORCE_STOP_RUNTIME_SESSION_ID);
      NodeAssert.equal(firstEvent.value.payload.itemType, "assistant_message");
    }),
  );

  it.effect("labels MCP lifecycle entries with server and tool names", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-mcp-complete"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/completed",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("mcp_1"),
        payload: {
          completedAtMs: 1_778_000_000_000,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "mcp_1",
            server: "t3-code",
            tool: "preview_status",
            arguments: {},
            durationMs: 12,
            error: null,
            result: { content: [{ type: "text", text: "attached" }] },
            status: "completed",
          },
        },
      });
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "item.completed") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.itemType, "mcp_tool_call");
      NodeAssert.equal(firstEvent.value.payload.title, "t3-code · preview_status");
      NodeAssert.deepStrictEqual(firstEvent.value.payload.data, {
        completedAtMs: 1_778_000_000_000,
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "mcpToolCall",
          id: "mcp_1",
          server: "t3-code",
          tool: "preview_status",
          arguments: {},
          durationMs: 12,
          error: null,
          result: { content: [{ type: "text", text: "attached" }] },
          status: "completed",
        },
      });
    }),
  );

  it.effect("presents browser and computer-use calls with Codex-style titles and sources", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const eventsFiber = yield* Stream.runCollect(Stream.take(adapter.streamEvents, 3)).pipe(
        Effect.forkChild,
      );
      const longIntentTitle = `  ${"a".repeat(39)}   ${"a".repeat(38)}😀bc  `;
      const serializedOverContractUrl = `https://example.com/?query=${"😀".repeat(400)}`;

      yield* runtime.emit({
        id: asEventId("evt-computer-start"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/started",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("computer_1"),
        payload: {
          startedAtMs: 1_778_000_000_000,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "computer_1",
            server: "node_repl",
            tool: "js",
            arguments: {
              code: 'await sky.click({ app: "Finder", x: 10, y: 20 })',
              title: longIntentTitle,
            },
            durationMs: null,
            error: null,
            result: {
              _meta: {
                "codex/toolSurface": {
                  kind: "computerUse",
                  app: { kind: "appId", appId: "com.apple.finder" },
                },
              },
              content: [],
            },
            status: "inProgress",
          },
        },
      });
      yield* runtime.emit({
        id: asEventId("evt-browser-complete"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:01.000Z",
        method: "item/completed",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("browser_1"),
        payload: {
          completedAtMs: 1_778_000_001_000,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "browser_1",
            server: "node_repl",
            tool: "js",
            arguments: { code: "await tab.playwright.domSnapshot()", title: "Inspect checkout" },
            durationMs: 12,
            error: null,
            result: {
              _meta: {
                "codex/toolSurface": {
                  kind: "browserUse",
                  backend: "chrome",
                  openTabs: [
                    {
                      pageUrl: "https://www.mathworks.com/help/matlab/",
                      faviconUrl: "https://www.mathworks.com/favicon.ico",
                      faviconUrlDark: "https://www.mathworks.com/favicon-dark.ico",
                      url: "https://www.mathworks.com/help/matlab/",
                    },
                  ],
                },
                browser_use: { url: serializedOverContractUrl },
              },
              content: [],
            },
            status: "completed",
          },
        },
      });
      yield* runtime.emit({
        id: asEventId("evt-computer-use-complete"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:02.000Z",
        method: "item/completed",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("computer_2"),
        payload: {
          completedAtMs: 1_778_000_002_000,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "mcpToolCall",
            id: "computer_2",
            server: "computer-use",
            tool: "type_text",
            arguments: { text: "Hello world", app: "TextEdit" },
            durationMs: 12,
            error: null,
            result: {
              _meta: {
                "codex/toolSurface": {
                  kind: "computerUse",
                  app: { kind: "displayName", displayName: "TextEdit" },
                },
              },
              content: [],
            },
            status: "completed",
          },
        },
      });

      const events = Array.from(yield* Fiber.join(eventsFiber));
      NodeAssert.deepStrictEqual(
        events.map((event) => ({
          type: event.type,
          title: "title" in event.payload ? event.payload.title : undefined,
          toolSurface: "toolSurface" in event.payload ? event.payload.toolSurface : undefined,
          toolIcon: "toolIcon" in event.payload ? event.payload.toolIcon : undefined,
          toolSource: "toolSource" in event.payload ? event.payload.toolSource : undefined,
        })),
        [
          {
            type: "item.started",
            title: `${"a".repeat(39)} ${"a".repeat(38)}😀…`,
            toolSurface: "computer",
            toolIcon: {
              _tag: "native-app",
              app: { _tag: "app-id", appId: "com.apple.finder" },
            },
            toolSource: {
              key: "native-app:com.apple.finder",
              name: "Finder",
              kind: "computer",
              icon: {
                _tag: "native-app",
                app: { _tag: "app-id", appId: "com.apple.finder" },
              },
            },
          },
          {
            type: "item.completed",
            title: "Inspect checkout",
            toolSurface: "browser",
            toolIcon: {
              _tag: "website",
              pageUrl: "https://www.mathworks.com/help/matlab/",
              faviconUrl: "https://www.mathworks.com/favicon.ico",
              faviconUrlDark: "https://www.mathworks.com/favicon-dark.ico",
            },
            toolSource: {
              key: "browser-use:chrome",
              name: "Chrome",
              kind: "integration",
              icon: {
                _tag: "native-app",
                app: { _tag: "display-name", displayName: "Google Chrome" },
              },
            },
          },
          {
            type: "item.completed",
            title: "Typed text in TextEdit",
            toolSurface: "computer",
            toolIcon: {
              _tag: "native-app",
              app: { _tag: "display-name", displayName: "TextEdit" },
            },
            toolSource: {
              key: "native-app-name:textedit",
              name: "TextEdit",
              kind: "computer",
              icon: {
                _tag: "native-app",
                app: { _tag: "display-name", displayName: "TextEdit" },
              },
            },
          },
        ],
      );
    }),
  );

  it.effect("preserves failed and declined outcomes on completed tool items", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const maxLengthAppId = `com.${"a".repeat(508)}`;
      const collidingMaxLengthAppId = `com.${"a".repeat(507)}b`;
      const longAppSourceKeys: string[] = [];
      const items = [
        {
          type: "commandExecution",
          id: "failed-command",
          command: "vp test run",
          commandActions: [],
          cwd: "/tmp",
          exitCode: 1,
          status: "failed",
        },
        {
          type: "mcpToolCall",
          id: "failed-mcp",
          server: "simulator",
          tool: "build",
          arguments: {},
          error: { message: "Build failed" },
          status: "failed",
        },
        {
          type: "mcpToolCall",
          id: "failed-computer",
          server: "computer-use",
          tool: "click",
          arguments: { app: "Finder" },
          error: { message: "Click failed" },
          result: {
            _meta: {
              "codex/toolSurface": {
                kind: "computerUse",
                app: { kind: "appId", appId: maxLengthAppId },
              },
            },
            content: [],
          },
          status: "failed",
        },
        {
          type: "mcpToolCall",
          id: "failed-computer-collision",
          server: "computer-use",
          tool: "click",
          arguments: { app: "Other" },
          error: { message: "Click failed" },
          result: {
            _meta: {
              "codex/toolSurface": {
                kind: "computerUse",
                app: { kind: "appId", appId: collidingMaxLengthAppId },
              },
            },
            content: [],
          },
          status: "failed",
        },
        {
          type: "fileChange",
          id: "declined-change",
          changes: [],
          status: "declined",
        },
      ] as const;

      for (const item of items) {
        const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

        yield* runtime.emit({
          id: asEventId(`evt-${item.id}`),
          kind: "notification",
          provider: ProviderDriverKind.make("codex"),
          createdAt: "2026-01-01T00:00:00.000Z",
          method: "item/completed",
          threadId: asThreadId("thread-1"),
          turnId: asTurnId("turn-1"),
          itemId: asItemId(item.id),
          payload: {
            completedAtMs: 1_778_000_000_000,
            threadId: "thread-1",
            turnId: "turn-1",
            item,
          },
        });

        const firstEvent = yield* Fiber.join(firstEventFiber);
        NodeAssert.equal(firstEvent._tag, "Some");
        if (firstEvent._tag !== "Some" || firstEvent.value.type !== "item.completed") {
          return;
        }
        NodeAssert.equal(firstEvent.value.payload.status, item.status);
        if (item.id.startsWith("failed-computer")) {
          NodeAssert.equal(firstEvent.value.payload.title, "computer-use · click");
          const sourceKey = firstEvent.value.payload.toolSource?.key;
          NodeAssert.equal(sourceKey?.length, 512);
          if (sourceKey) longAppSourceKeys.push(sourceKey);
        }
      }
      NodeAssert.equal(new Set(longAppSourceKeys).size, 2);
    }),
  );

  it.effect("maps completed plan items to canonical proposed-plan completion events", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const event: ProviderEvent = {
        id: asEventId("evt-plan-complete"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/completed",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("plan_1"),
        payload: {
          completedAtMs: 1_778_000_000_000,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "plan",
            id: "plan_1",
            text: "## Final plan\n\n- one\n- two",
          },
        },
      };

      yield* runtime.emit(event);
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "turn.proposed.completed");
      if (firstEvent.value.type !== "turn.proposed.completed") {
        return;
      }
      NodeAssert.equal(firstEvent.value.turnId, "turn-1");
      NodeAssert.equal(firstEvent.value.payload.planMarkdown, "## Final plan\n\n- one\n- two");
    }),
  );

  it.effect("maps plan deltas to canonical proposed-plan delta events", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-plan-delta"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/plan/delta",
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("plan_1"),
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "plan_1",
          delta: "## Final plan",
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "turn.proposed.delta");
      if (firstEvent.value.type !== "turn.proposed.delta") {
        return;
      }
      NodeAssert.equal(firstEvent.value.turnId, "turn-1");
      NodeAssert.equal(firstEvent.value.payload.delta, "## Final plan");
    }),
  );

  it.effect("maps session/closed lifecycle events to canonical session.exited runtime events", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const event: ProviderEvent = {
        id: asEventId("evt-session-closed"),
        kind: "session",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "session/closed",
        message: "Session stopped",
      };

      yield* runtime.emit(event);
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "session.exited");
      if (firstEvent.value.type !== "session.exited") {
        return;
      }
      NodeAssert.equal(firstEvent.value.threadId, "thread-1");
      NodeAssert.equal(firstEvent.value.payload.reason, "Session stopped");
    }),
  );

  it.effect("maps retryable Codex error notifications to runtime.warning", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-retryable-error"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "error",
        turnId: asTurnId("turn-1"),
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          error: {
            message: "Reconnecting... 2/5",
          },
          willRetry: true,
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "runtime.warning");
      if (firstEvent.value.type !== "runtime.warning") {
        return;
      }
      NodeAssert.equal(firstEvent.value.turnId, "turn-1");
      NodeAssert.equal(firstEvent.value.payload.message, "Reconnecting... 2/5");
    }),
  );

  it.effect("maps process stderr notifications to runtime.warning", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-process-stderr"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "process/stderr",
        turnId: asTurnId("turn-1"),
        message: "The filename or extension is too long. (os error 206)",
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "runtime.warning");
      if (firstEvent.value.type !== "runtime.warning") {
        return;
      }
      NodeAssert.equal(firstEvent.value.turnId, "turn-1");
      NodeAssert.equal(
        firstEvent.value.payload.message,
        "The filename or extension is too long. (os error 206)",
      );
    }),
  );

  it.effect("maps realtime started notifications with upstream realtime session ids", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-realtime-started"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "thread/realtime/started",
        payload: {
          threadId: "thread-1",
          realtimeSessionId: "realtime-session-1",
          version: "v2",
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "thread.realtime.started");
      if (firstEvent.value.type !== "thread.realtime.started") {
        return;
      }
      NodeAssert.equal(firstEvent.value.threadId, "thread-1");
      NodeAssert.equal(firstEvent.value.payload.realtimeSessionId, "realtime-session-1");
    }),
  );

  it.effect("maps fatal websocket stderr notifications to runtime.error", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-process-stderr-websocket"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "process/stderr",
        turnId: asTurnId("turn-1"),
        message:
          "2026-03-31T18:14:06.833399Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 503 Service Unavailable, url: wss://chatgpt.com/backend-api/codex/responses",
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "runtime.error");
      if (firstEvent.value.type !== "runtime.error") {
        return;
      }
      NodeAssert.equal(firstEvent.value.turnId, "turn-1");
      NodeAssert.equal(firstEvent.value.payload.class, "provider_error");
      NodeAssert.equal(
        firstEvent.value.payload.message,
        "2026-03-31T18:14:06.833399Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 503 Service Unavailable, url: wss://chatgpt.com/backend-api/codex/responses",
      );
    }),
  );

  it.effect("preserves request type when mapping serverRequest/resolved", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const event: ProviderEvent = {
        id: asEventId("evt-request-resolved"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "serverRequest/resolved",
        requestKind: "command",
        requestId: ApprovalRequestId.make("req-1"),
        payload: {
          threadId: "thread-1",
          requestId: "req-1",
        },
      };

      yield* runtime.emit(event);
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "request.resolved");
      if (firstEvent.value.type !== "request.resolved") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "command_execution_approval");
    }),
  );

  it.effect("names the edited files in an apply-patch approval without a reason", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-apply-patch"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "applyPatchApproval",
        requestKind: "file-change",
        requestId: ApprovalRequestId.make("req-patch"),
        turnId: asTurnId("turn-1"),
        payload: {
          callId: "call-1",
          conversationId: "provider-thread-1",
          fileChanges: {
            "/tmp/removed.md": { type: "delete", content: "gone" },
            "/tmp/added.ts": { type: "add", content: "export {};" },
          },
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "apply_patch_approval");
      NodeAssert.equal(
        firstEvent.value.payload.detail,
        "add /tmp/added.ts\ndelete /tmp/removed.md",
      );
    }),
  );

  it.effect("keeps the reason when an apply-patch approval carries one", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-apply-patch-reason"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "applyPatchApproval",
        requestKind: "file-change",
        requestId: ApprovalRequestId.make("req-patch-reason"),
        turnId: asTurnId("turn-1"),
        payload: {
          callId: "call-2",
          conversationId: "provider-thread-1",
          reason: "Needs to rewrite the changelog",
          fileChanges: { "/tmp/CHANGELOG.md": { type: "add", content: "x" } },
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.detail, "Needs to rewrite the changelog");
    }),
  );

  it.effect("falls back to the grant root for a file-change approval without a reason", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-file-change"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "item/fileChange/requestApproval",
        requestKind: "file-change",
        requestId: ApprovalRequestId.make("req-file-change"),
        turnId: asTurnId("turn-1"),
        payload: {
          itemId: "item-1",
          grantRoot: "/tmp/workspace",
          startedAtMs: 0,
          threadId: "provider-thread-1",
          turnId: "turn-1",
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "file_change_approval");
      NodeAssert.equal(firstEvent.value.payload.detail, "/tmp/workspace");
    }),
  );

  it.effect("prefers the edited files over a blank apply-patch reason", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-apply-patch-blank"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "applyPatchApproval",
        requestKind: "file-change",
        requestId: ApprovalRequestId.make("req-patch-blank"),
        turnId: asTurnId("turn-1"),
        payload: {
          callId: "call-3",
          conversationId: "provider-thread-1",
          reason: "   ",
          fileChanges: {
            "/tmp/moved.ts": { type: "update", unified_diff: "@@", move_path: "/tmp/renamed.ts" },
          },
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.detail, "update /tmp/moved.ts -> /tmp/renamed.ts");
    }),
  );

  it.effect("caps the described files in an oversized apply-patch approval", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const fileChanges = Object.fromEntries(
        Array.from({ length: 25 }, (_unused, index) => [
          `/tmp/file-${String(index).padStart(2, "0")}.ts`,
          { type: "add", content: "x" },
        ]),
      );

      yield* runtime.emit({
        id: asEventId("evt-apply-patch-many"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "applyPatchApproval",
        requestKind: "file-change",
        requestId: ApprovalRequestId.make("req-patch-many"),
        turnId: asTurnId("turn-1"),
        payload: { callId: "call-4", conversationId: "provider-thread-1", fileChanges },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      const detail = firstEvent.value.payload.detail ?? "";
      NodeAssert.equal(detail.split("\n").length, 21);
      NodeAssert.ok(detail.endsWith("+5 more"));
    }),
  );

  it.effect("leaves an apply-patch approval without changes or a reason undetailed", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-apply-patch-empty"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "applyPatchApproval",
        requestKind: "file-change",
        requestId: ApprovalRequestId.make("req-patch-empty"),
        turnId: asTurnId("turn-1"),
        payload: { callId: "call-5", conversationId: "provider-thread-1", fileChanges: {} },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.detail, undefined);
    }),
  );

  it.effect("maps MCP elicitation requests into app access approvals", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-mcp-elicitation"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "mcpServer/elicitation/request",
        requestKind: "mcp-elicitation",
        requestId: ApprovalRequestId.make("req-safari"),
        turnId: asTurnId("turn-1"),
        payload: {
          mode: "form",
          message: "Allow ChatGPT to use Safari?",
          serverName: "computer-use",
          threadId: "provider-thread-1",
          turnId: "turn-1",
          _meta: { app_name: "Safari", persist: ["session", "always"] },
          requestedSchema: { type: "object", properties: {} },
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "mcp_elicitation_approval");
      NodeAssert.equal(firstEvent.value.payload.appName, "Safari");
      NodeAssert.equal(firstEvent.value.payload.detail, "Allow ChatGPT to use Safari?");
      NodeAssert.deepStrictEqual(firstEvent.value.payload.options, [
        { decision: "cancel", label: "Cancel" },
        { decision: "decline", label: "Decline" },
        { decision: "acceptForSession", label: "Always allow this session" },
        { decision: "acceptAlways", label: "Always allow" },
        { decision: "accept", label: "Approve" },
      ]);
    }),
  );

  it.effect("preserves MCP elicitation type when an app access request resolves", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-mcp-elicitation-resolved"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "item/requestApproval/decision",
        requestKind: "mcp-elicitation",
        requestId: ApprovalRequestId.make("req-safari"),
        payload: { decision: "acceptAlways" },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.resolved") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "mcp_elicitation_approval");
      NodeAssert.equal(firstEvent.value.payload.decision, "acceptAlways");
    }),
  );

  it.effect("maps MCP elicitation requests into app access approvals", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-mcp-elicitation"),
        kind: "request",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "mcpServer/elicitation/request",
        requestKind: "mcp-elicitation",
        requestId: ApprovalRequestId.make("req-safari"),
        turnId: asTurnId("turn-1"),
        payload: {
          mode: "form",
          message: "Allow ChatGPT to use Safari?",
          serverName: "computer-use",
          threadId: "provider-thread-1",
          turnId: "turn-1",
          _meta: { app_name: "Safari", persist: ["session", "always"] },
          requestedSchema: { type: "object", properties: {} },
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.opened") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "mcp_elicitation_approval");
      NodeAssert.equal(firstEvent.value.payload.appName, "Safari");
      NodeAssert.equal(firstEvent.value.payload.detail, "Allow ChatGPT to use Safari?");
      NodeAssert.deepStrictEqual(firstEvent.value.payload.options, [
        { decision: "cancel", label: "Cancel" },
        { decision: "decline", label: "Decline" },
        { decision: "acceptForSession", label: "Always allow this session" },
        { decision: "acceptAlways", label: "Always allow" },
        { decision: "accept", label: "Approve" },
      ]);
    }),
  );

  it.effect("preserves MCP elicitation type when an app access request resolves", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-mcp-elicitation-resolved"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-08-24T00:00:00.000Z",
        method: "item/requestApproval/decision",
        requestKind: "mcp-elicitation",
        requestId: ApprovalRequestId.make("req-safari"),
        payload: { decision: "acceptAlways" },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some" || firstEvent.value.type !== "request.resolved") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "mcp_elicitation_approval");
      NodeAssert.equal(firstEvent.value.payload.decision, "acceptAlways");
    }),
  );

  it.effect("preserves file-read request type when mapping serverRequest/resolved", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const event: ProviderEvent = {
        id: asEventId("evt-file-read-request-resolved"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "serverRequest/resolved",
        requestKind: "file-read",
        requestId: ApprovalRequestId.make("req-file-read-1"),
        payload: {
          threadId: "thread-1",
          requestId: "req-file-read-1",
        },
      };

      yield* runtime.emit(event);
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "request.resolved");
      if (firstEvent.value.type !== "request.resolved") {
        return;
      }
      NodeAssert.equal(firstEvent.value.payload.requestType, "file_read_approval");
    }),
  );

  it.effect("preserves explicit empty multi-select user-input answers", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      const event: ProviderEvent = {
        id: asEventId("evt-user-input-empty"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/tool/requestUserInput/answered",
        payload: {
          answers: {
            scope: {
              answers: [],
            },
          },
        },
      };

      yield* runtime.emit(event);
      const firstEvent = yield* Fiber.join(firstEventFiber);

      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "user-input.resolved");
      if (firstEvent.value.type !== "user-input.resolved") {
        return;
      }
      NodeAssert.deepEqual(firstEvent.value.payload.answers, {
        scope: [],
      });
    }),
  );

  it.effect("maps windowsSandbox/setupCompleted to session state and warning on failure", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const eventsFiber = yield* Stream.runCollect(Stream.take(adapter.streamEvents, 2)).pipe(
        Effect.forkChild,
      );

      const event: ProviderEvent = {
        id: asEventId("evt-windows-sandbox-failed"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "windowsSandbox/setupCompleted",
        message: "Sandbox setup failed",
        payload: {
          mode: "unelevated",
          success: false,
          error: "unsupported environment",
        },
      };

      yield* runtime.emit(event);
      const events = Array.from(yield* Fiber.join(eventsFiber));

      NodeAssert.equal(events.length, 2);

      const firstEvent = events[0];
      const secondEvent = events[1];

      NodeAssert.equal(firstEvent?.type, "session.state.changed");
      if (firstEvent?.type === "session.state.changed") {
        NodeAssert.equal(firstEvent.payload.state, "error");
        NodeAssert.equal(firstEvent.payload.reason, "Sandbox setup failed");
      }

      NodeAssert.equal(secondEvent?.type, "runtime.warning");
      if (secondEvent?.type === "runtime.warning") {
        NodeAssert.equal(secondEvent.payload.message, "Sandbox setup failed");
      }
    }),
  );

  it.effect(
    "maps requestUserInput requests and answered notifications to canonical user-input events",
    () =>
      Effect.gen(function* () {
        const { adapter, runtime } = yield* startLifecycleRuntime();
        const eventsFiber = yield* Stream.runCollect(Stream.take(adapter.streamEvents, 2)).pipe(
          Effect.forkChild,
        );

        yield* runtime.emit({
          id: asEventId("evt-user-input-requested"),
          kind: "request",
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-1"),
          createdAt: "2026-01-01T00:00:00.000Z",
          method: "item/tool/requestUserInput",
          requestId: ApprovalRequestId.make("req-user-input-1"),
          payload: {
            itemId: "item-user-input-1",
            threadId: "thread-1",
            turnId: "turn-1",
            questions: [
              {
                id: "sandbox_mode",
                header: "Sandbox",
                question: "Which mode should be used?",
                options: [
                  {
                    label: "workspace-write",
                    description: "Allow workspace writes only",
                  },
                ],
              },
            ],
          },
        } satisfies ProviderEvent);
        yield* runtime.emit({
          id: asEventId("evt-user-input-resolved"),
          kind: "notification",
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-1"),
          createdAt: "2026-01-01T00:00:00.000Z",
          method: "item/tool/requestUserInput/answered",
          requestId: ApprovalRequestId.make("req-user-input-1"),
          payload: {
            answers: {
              sandbox_mode: {
                answers: ["workspace-write"],
              },
            },
          },
        } satisfies ProviderEvent);

        const events = Array.from(yield* Fiber.join(eventsFiber));
        NodeAssert.equal(events[0]?.type, "user-input.requested");
        if (events[0]?.type === "user-input.requested") {
          NodeAssert.equal(events[0].requestId, "req-user-input-1");
          NodeAssert.equal(events[0].payload.questions[0]?.id, "sandbox_mode");
          NodeAssert.equal(events[0].payload.questions[0]?.multiSelect, false);
        }

        NodeAssert.equal(events[1]?.type, "user-input.resolved");
        if (events[1]?.type === "user-input.resolved") {
          NodeAssert.equal(events[1].requestId, "req-user-input-1");
          NodeAssert.deepEqual(events[1].payload.answers, {
            sandbox_mode: "workspace-write",
          });
        }
      }),
  );

  it.effect("maps async agent questions without ending the turn", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const eventsFiber = yield* Stream.runCollect(Stream.take(adapter.streamEvents, 2)).pipe(
        Effect.forkChild,
      );
      yield* runtime.emit({
        id: asEventId("evt-async-question"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/completed",
        payload: {
          completedAtMs: 0,
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "agentMessage",
            id: "async-question-1",
            text: "Which package manager?\n- pnpm\n- npm\n\nWhat should it be named?",
            phase: "final_answer",
            delivery: "async",
            questions: [
              { title: "Which package manager?", options: ["pnpm", "npm"] },
              { title: "What should it be named?" },
            ],
          },
        },
      });
      yield* runtime.emit({
        id: asEventId("evt-async-continued"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        createdAt: "2026-01-01T00:00:01.000Z",
        method: "item/agentMessage/delta",
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "message-2",
          delta: "I will keep working.",
        },
      });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      NodeAssert.equal(events[0]?.type, "user-input.requested");
      NodeAssert.equal(events[0]?.requestId, "codex-async:thread-1:async-question-1");
      NodeAssert.deepEqual(events[0]?.payload, {
        responseMode: "message",
        questions: [
          {
            id: "0",
            header: "Question",
            question: "Which package manager?",
            options: [
              { label: "pnpm", description: "" },
              { label: "npm", description: "" },
            ],
            allowCustomAnswer: true,
            multiSelect: false,
          },
          {
            id: "1",
            header: "Question",
            question: "What should it be named?",
            options: [],
            allowCustomAnswer: true,
            multiSelect: false,
          },
        ],
      });
      NodeAssert.equal(events[1]?.type, "content.delta");
    }),
  );

  it.effect("unwraps Codex token usage payloads for context window events", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit({
        id: asEventId("evt-codex-thread-token-usage-updated"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "thread/tokenUsage/updated",
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          tokenUsage: {
            total: {
              inputTokens: 11_833,
              cachedInputTokens: 3456,
              outputTokens: 6,
              reasoningOutputTokens: 0,
              totalTokens: 11_839,
            },
            last: {
              inputTokens: 120,
              cachedInputTokens: 0,
              outputTokens: 6,
              reasoningOutputTokens: 0,
              totalTokens: 126,
            },
            modelContextWindow: 258_400,
          },
        },
      } satisfies ProviderEvent);

      const firstEvent = yield* Fiber.join(firstEventFiber);
      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "thread.token-usage.updated");
      if (firstEvent.value.type !== "thread.token-usage.updated") {
        return;
      }

      NodeAssert.deepEqual(firstEvent.value.payload.usage, {
        usedTokens: 126,
        totalProcessedTokens: 11_839,
        maxTokens: 258_400,
        inputTokens: 120,
        cachedInputTokens: 0,
        outputTokens: 6,
        reasoningOutputTokens: 0,
        lastUsedTokens: 126,
        lastInputTokens: 120,
        lastCachedInputTokens: 0,
        lastOutputTokens: 6,
        lastReasoningOutputTokens: 0,
        compactsAutomatically: true,
      });
    }),
  );

  // Production calls startSession from a request fiber that finishes as soon as
  // the session exists. `Effect.forkChild` made the runtime event consumer a
  // child of that fiber, and Effect interrupts a fiber's children when it
  // completes, so the consumer died on return and every event the session
  // emitted afterwards was dropped. The other tests here start the session from
  // the test fiber, which never completes, so the consumer survived and the bug
  // stayed invisible. Starting it in a fiber that finishes reproduces
  // production.
  it.effect("keeps consuming runtime events after the startSession fiber completes", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const startSessionFiber = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-outlives-start"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);
      yield* Fiber.join(startSessionFiber);

      const runtime = lifecycleRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);
      yield* runtime.emit({
        id: asEventId("evt-after-start-session"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "item/completed",
        threadId: asThreadId("thread-outlives-start"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("msg_after_start"),
        payload: {
          completedAtMs: 1_778_000_000_000,
          threadId: "thread-outlives-start",
          turnId: "turn-1",
          item: {
            type: "agentMessage",
            id: "msg_after_start",
            text: "emitted after startSession returned",
          },
        },
      });

      const firstEvent = yield* Fiber.join(firstEventFiber).pipe(Effect.timeout("10 seconds"));
      NodeAssert.equal(firstEvent._tag, "Some");
      if (firstEvent._tag !== "Some") {
        return;
      }
      NodeAssert.equal(firstEvent.value.type, "item.completed");
      // Live clock so the timeout above is real: under the default test clock it
      // waits on virtual time that never advances, and a regression would hang
      // until the suite timeout instead of failing here.
    }).pipe(TestClock.withLive),
  );
});

const scopedLifecycleRuntimeFactory = makeScopedRuntimeFactory();
const scopedLifecycleLayer = it.layer(
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = decodeCodexSettings({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: scopedLifecycleRuntimeFactory.factory,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

scopedLifecycleLayer("CodexAdapterLive scoped lifecycle", (it) => {
  it.effect("closes the externally owned session scope on stopSession", () =>
    Effect.gen(function* () {
      scopedLifecycleRuntimeFactory.releasedThreadIds.length = 0;
      const adapter = yield* CodexAdapter;

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-stop"),
        runtimeMode: "full-access",
      });

      const runtime = scopedLifecycleRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);

      yield* adapter.stopSession(asThreadId("thread-stop"));

      NodeAssert.equal(runtime.closeImpl.mock.calls.length, 1);
      NodeAssert.deepStrictEqual(scopedLifecycleRuntimeFactory.releasedThreadIds, [
        asThreadId("thread-stop"),
      ]);
      NodeAssert.equal(yield* adapter.hasSession(asThreadId("thread-stop")), false);
    }),
  );
});

const scopedFailureRuntimeFactory = makeScopedRuntimeFactory({ failConstruction: true });
const scopedFailureLayer = it.layer(
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = decodeCodexSettings({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: scopedFailureRuntimeFactory.factory,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

scopedFailureLayer("CodexAdapterLive scoped startup failure", (it) => {
  it.effect("closes the externally owned session scope when startSession fails", () =>
    Effect.gen(function* () {
      scopedFailureRuntimeFactory.releasedThreadIds.length = 0;
      const adapter = yield* CodexAdapter;

      const result = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-fail"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      NodeAssert.equal(result.failure._tag, "ProviderAdapterProcessError");
      NodeAssert.deepStrictEqual(scopedFailureRuntimeFactory.releasedThreadIds, [
        asThreadId("thread-fail"),
      ]);
      NodeAssert.equal(yield* adapter.hasSession(asThreadId("thread-fail")), false);
    }),
  );
});

it.effect("flushes managed native logs when the adapter layer shuts down", () =>
  Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-codex-adapter-native-log-"),
    );
    const basePath = NodePath.join(tempDir, "provider-native.ndjson");
    const runtimeFactory = makeRuntimeFactory();
    const scope = yield* Scope.make("sequential");
    let scopeClosed = false;

    try {
      const layer = Layer.effect(
        CodexAdapter,
        Effect.gen(function* () {
          const codexConfig = decodeCodexSettings({});
          return yield* makeCodexAdapter(codexConfig, {
            makeRuntime: runtimeFactory.factory,
            nativeEventLogPath: basePath,
          });
        }),
      ).pipe(
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
        Layer.provideMerge(ServerSettingsService.layerTest()),
        Layer.provideMerge(providerSessionDirectoryTestLayer),
        Layer.provideMerge(NodeServices.layer),
      );
      const context = yield* Layer.buildWithScope(layer, scope);
      const adapter = yield* Effect.service(CodexAdapter).pipe(Effect.provide(context));

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-logger"),
        runtimeMode: "full-access",
      });

      const runtime = runtimeFactory.lastRuntime;
      NodeAssert.ok(runtime);

      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);
      yield* runtime.emit({
        id: asEventId("evt-native-log"),
        kind: "notification",
        provider: ProviderDriverKind.make("codex"),
        threadId: asThreadId("thread-logger"),
        createdAt: "2026-01-01T00:00:00.000Z",
        method: "process/stderr",
        message: "native flush test",
      } satisfies ProviderEvent);
      yield* Fiber.join(firstEventFiber);

      yield* Scope.close(scope, Exit.void);
      scopeClosed = true;

      const threadLogPath = NodePath.join(tempDir, "provider-native.thread-logger.log");
      NodeAssert.equal(NodeFS.existsSync(threadLogPath), true);
      const contents = NodeFS.readFileSync(threadLogPath, "utf8");
      NodeAssert.match(contents, /NTIVE: .*"message":"native flush test"/);
    } finally {
      if (!scopeClosed) {
        yield* Scope.close(scope, Exit.void);
      }
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  }),
);

const usageLimitRuntimeFactory = makeRuntimeFactory();
const usageLimitLayer = it.layer(
  Layer.effect(
    CodexAdapter,
    Effect.gen(function* () {
      const codexConfig = decodeCodexSettings({});
      return yield* makeCodexAdapter(codexConfig, {
        makeRuntime: usageLimitRuntimeFactory.factory,
      });
    }),
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(providerSessionDirectoryTestLayer),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const USAGE_LIMIT_NOW = "2026-01-01T00:00:00.000Z";
const USAGE_LIMIT_NOW_SECONDS = Date.parse(USAGE_LIMIT_NOW) / 1000;
const CODEX_OUT_OF_CREDITS =
  "Your workspace is out of credits. Ask your workspace owner to refill in order to continue.";

function startUsageLimitRuntime() {
  return Effect.gen(function* () {
    const adapter = yield* CodexAdapter;
    yield* adapter.startSession({
      provider: ProviderDriverKind.make("codex"),
      threadId: asThreadId("thread-1"),
      runtimeMode: "full-access",
    });
    const runtime = usageLimitRuntimeFactory.lastRuntime;
    NodeAssert.ok(runtime);
    return { adapter, runtime };
  });
}

function codexErrorNotification(input: {
  readonly id: string;
  readonly message: string;
  readonly codexErrorInfo?: string;
}): ProviderEvent {
  return {
    id: asEventId(input.id),
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-limit"),
    createdAt: USAGE_LIMIT_NOW,
    method: "error",
    payload: {
      threadId: "thread-1",
      turnId: "turn-limit",
      willRetry: false,
      error: {
        message: input.message,
        ...(input.codexErrorInfo ? { codexErrorInfo: input.codexErrorInfo } : {}),
      },
    },
  };
}

function codexRateLimitsNotification(input: {
  readonly id: string;
  readonly rateLimitReachedType?: string;
  readonly primary?: { readonly usedPercent: number; readonly resetsInSeconds: number };
  readonly secondary?: { readonly usedPercent: number; readonly resetsInSeconds: number };
}): ProviderEvent {
  return {
    id: asEventId(input.id),
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-limit"),
    createdAt: USAGE_LIMIT_NOW,
    method: "account/rateLimits/updated",
    payload: {
      rateLimits: {
        limitId: "codex",
        ...(input.rateLimitReachedType ? { rateLimitReachedType: input.rateLimitReachedType } : {}),
        ...(input.primary
          ? {
              primary: {
                usedPercent: input.primary.usedPercent,
                resetsAt: USAGE_LIMIT_NOW_SECONDS + input.primary.resetsInSeconds,
                windowDurationMins: 300,
              },
            }
          : {}),
        ...(input.secondary
          ? {
              secondary: {
                usedPercent: input.secondary.usedPercent,
                resetsAt: USAGE_LIMIT_NOW_SECONDS + input.secondary.resetsInSeconds,
                windowDurationMins: 10_080,
              },
            }
          : {}),
      },
    },
  };
}

function codexUsageLimitTurnFailed(id: string, turnId = "turn-limit"): ProviderEvent {
  return {
    id: asEventId(id),
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: asThreadId("thread-1"),
    turnId: asTurnId(turnId),
    createdAt: USAGE_LIMIT_NOW,
    method: "turn/completed",
    payload: {
      threadId: "thread-1",
      turn: {
        id: turnId,
        items: [],
        status: "failed",
        error: { message: CODEX_OUT_OF_CREDITS, codexErrorInfo: "usageLimitExceeded" },
      },
    },
  };
}

usageLimitLayer("CodexAdapterLive usage limits", (it) => {
  it.effect("names the exhausted window and the workspace's missing credits", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startUsageLimitRuntime();
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(5),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit(
        codexErrorNotification({
          id: "evt-limit-error",
          message: CODEX_OUT_OF_CREDITS,
          codexErrorInfo: "usageLimitExceeded",
        }),
      );
      yield* runtime.emit(
        codexRateLimitsNotification({
          id: "evt-limit-rate-limits",
          rateLimitReachedType: "workspace_owner_credits_depleted",
          primary: { usedPercent: 40, resetsInSeconds: 3_600 },
          secondary: { usedPercent: 100, resetsInSeconds: 5 * 86_400 + 5 * 3_600 },
        }),
      );
      yield* runtime.emit(codexUsageLimitTurnFailed("evt-limit-turn"));
      // A second turn stopping on the same limit says as much as the first.
      yield* runtime.emit(codexUsageLimitTurnFailed("evt-limit-turn-2", "turn-limit-2"));

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const expected =
        "Codex usage limit reached. The weekly limit resets in 5d 5h. The workspace has no credits to continue sooner: ask your workspace owner to add credits, or send the message again once the limit resets.";
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        [
          "account.rate-limits.updated",
          "runtime.error",
          "turn.completed",
          "runtime.error",
          "turn.completed",
        ],
      );
      for (const event of events) {
        if (event.type === "runtime.error") {
          NodeAssert.equal(event.payload.message, expected);
          NodeAssert.equal(event.payload.detail, CODEX_OUT_OF_CREDITS);
        }
        if (event.type === "turn.completed") {
          NodeAssert.equal(event.payload.errorMessage, expected);
        }
      }
    }),
  );

  it.effect("names the session window for a plan limit", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startUsageLimitRuntime();
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit(
        codexErrorNotification({
          id: "evt-plan-error",
          message: "You've hit your usage limit.",
          codexErrorInfo: "usageLimitExceeded",
        }),
      );
      yield* runtime.emit(
        codexRateLimitsNotification({
          id: "evt-plan-rate-limits",
          rateLimitReachedType: "rate_limit_reached",
          primary: { usedPercent: 100, resetsInSeconds: 3 * 3_600 + 20 * 60 },
        }),
      );
      yield* runtime.emit(codexUsageLimitTurnFailed("evt-plan-turn"));

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const completed = events.find((event) => event.type === "turn.completed");
      NodeAssert.equal(
        completed?.payload.errorMessage,
        "Codex usage limit reached. The session limit resets in 3h 20m. Send the message again once the limit resets.",
      );
    }),
  );

  it.effect("reads a rate-limit snapshot seen earlier in the session", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startUsageLimitRuntime();
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      // The window arrives long before the stop, and the update that reports the
      // limit as reached carries no windows of its own.
      yield* runtime.emit(
        codexRateLimitsNotification({
          id: "evt-early-rate-limits",
          primary: { usedPercent: 100, resetsInSeconds: 3 * 3_600 + 20 * 60 },
        }),
      );
      yield* runtime.emit(
        codexRateLimitsNotification({
          id: "evt-sparse-rate-limits",
          rateLimitReachedType: "rate_limit_reached",
        }),
      );
      yield* runtime.emit(codexUsageLimitTurnFailed("evt-early-turn"));

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const completed = events.find((event) => event.type === "turn.completed");
      NodeAssert.equal(
        completed?.payload.errorMessage,
        "Codex usage limit reached. The session limit resets in 3h 20m. Send the message again once the limit resets.",
      );
    }),
  );

  it.effect("falls back to the short message without a rate-limit snapshot", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startUsageLimitRuntime();
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* runtime.emit(
        codexErrorNotification({
          id: "evt-bare-error",
          message: CODEX_OUT_OF_CREDITS,
          codexErrorInfo: "usageLimitExceeded",
        }),
      );
      yield* runtime.emit(codexUsageLimitTurnFailed("evt-bare-turn"));

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const expected = "Codex usage limit reached. Send the message again once the limit resets.";
      NodeAssert.deepStrictEqual(
        events.map((event) => event.type),
        ["runtime.error", "turn.completed"],
      );
      const runtimeError = events.find((event) => event.type === "runtime.error");
      NodeAssert.equal(runtimeError?.payload.message, expected);
      const completed = events.find((event) => event.type === "turn.completed");
      NodeAssert.equal(completed?.payload.errorMessage, expected);
    }),
  );

  it.effect("still relays other provider errors as they arrive", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startUsageLimitRuntime();
      const firstEventFiber = yield* Stream.runHead(adapter.streamEvents).pipe(Effect.forkChild);

      yield* runtime.emit(
        codexErrorNotification({
          id: "evt-other-error",
          message: "Codex is temporarily unavailable.",
          codexErrorInfo: "internalServerError",
        }),
      );

      const first = yield* Fiber.join(firstEventFiber);
      NodeAssert.equal(first._tag, "Some");
      if (first._tag !== "Some" || first.value.type !== "runtime.error") return;
      NodeAssert.equal(first.value.payload.message, "Codex is temporarily unavailable.");
      NodeAssert.equal(first.value.payload.class, "provider_error");
    }),
  );
});
