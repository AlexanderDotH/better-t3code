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
import * as CodexErrors from "effect-codex-app-server/errors";
import * as EffectCodexSchema from "effect-codex-app-server/schema";
import { describe } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderAdapterValidationError } from "../Errors.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  type CodexSessionRuntimeOptions,
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

  public readonly interruptTurnImpl = vi.fn(
    (_turnId?: TurnId): Promise<void> => Promise.resolve(undefined),
  );

  public readonly readThreadImpl = vi.fn(
    (): Promise<CodexThreadSnapshot> =>
      Promise.resolve({
        threadId: "provider-thread-1",
        turns: [],
      }),
  );

  public readonly rollbackThreadImpl = vi.fn(
    (_numTurns: number): Promise<CodexThreadSnapshot> =>
      Promise.resolve({
        threadId: "provider-thread-1",
        turns: [],
      }),
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

  constructor(
    options: CodexSessionRuntimeOptions,
    private readonly eventStreamStarted: Deferred.Deferred<void>,
  ) {
    this.options = options;
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

      const details = yield* mcpRuntime.getServerDetails?.({
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

lifecycleLayer("CodexAdapterLive lifecycle", (it) => {
  it.effect("keeps the runtime event pump alive after the session starter fiber completes", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;
      const startFiber = yield* adapter
        .startSession({
          provider: ProviderDriverKind.make("codex"),
          threadId: asThreadId("thread-event-pump"),
          runtimeMode: "full-access",
        })
        .pipe(Effect.forkChild);

      yield* Fiber.join(startFiber);

      const runtime = lifecycleRuntimeFactory.lastRuntime;
      NodeAssert.ok(runtime);
      NodeAssert.equal(runtime.eventStreamFinalized, false);
    }),
  );

  it.effect("force-stops the exact owned Codex runtime without cooperative close", () =>
    Effect.gen(function* () {
      const { adapter, runtime } = yield* startLifecycleRuntime();

      const result = yield* adapter.forceStopSession(
        asThreadId("thread-1"),
        FORCE_STOP_RUNTIME_SESSION_ID,
      );

      NodeAssert.deepStrictEqual(result, {
        outcome: "terminated",
        mechanism: "process-tree",
      });
      NodeAssert.equal(runtime.forceCloseImpl.mock.calls.length, 1);
      NodeAssert.equal(runtime.closeImpl.mock.calls.length, 0);
      NodeAssert.equal(yield* adapter.hasSession(asThreadId("thread-1")), false);
    }),
  );

  it.effect("does not stop a missing Codex runtime", () =>
    Effect.gen(function* () {
      const adapter = yield* CodexAdapter;

      NodeAssert.deepStrictEqual(
        yield* adapter.forceStopSession(
          asThreadId("missing-force-stop"),
          FORCE_STOP_RUNTIME_SESSION_ID,
        ),
        {
          outcome: "terminated",
          mechanism: "already-stopped",
        },
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
