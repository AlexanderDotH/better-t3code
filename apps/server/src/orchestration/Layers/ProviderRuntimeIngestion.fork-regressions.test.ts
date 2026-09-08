import type { OrchestrationEvent } from "@t3tools/contracts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  OrchestrationReadModel,
  ProviderDriverKind,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderInstanceId,
  RuntimeSessionId,
  SubagentId,
} from "@t3tools/contracts";
import {
  ApprovalRequestId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type OrchestrationCommand,
  ProjectId,
  ProviderItemId,
  type ServerSettings,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import {
  PROVIDER_RUNTIME_INGESTION_MEMORY_LIMITS,
  ProviderRuntimeIngestionLive,
} from "./ProviderRuntimeIngestion.ts";
import { DEFAULT_THREAD_TITLE } from "../threadTitles.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TurnAbortCoordinator,
  type SettleCooperativeTurnAbortInput,
} from "../Services/TurnAbortCoordinator.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

function makeTestServerSettingsLayer(overrides: Partial<ServerSettings> = {}) {
  return ServerSettingsService.layerTest(overrides);
}

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asItemId = (value: string): ProviderItemId => ProviderItemId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asSubagentId = (value: string): SubagentId => SubagentId.make(value);

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderRuntimeEvent["provider"];
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

type LegacyTurnCompletedEvent = LegacyProviderRuntimeEvent & {
  readonly type: "turn.completed";
  readonly payload?: undefined;
  readonly status: "completed" | "failed" | "interrupted" | "cancelled";
  readonly errorMessage?: string | undefined;
};

function isLegacyTurnCompletedEvent(
  event: LegacyProviderRuntimeEvent,
): event is LegacyTurnCompletedEvent {
  return (
    event.type === "turn.completed" &&
    event.payload === undefined &&
    typeof event.status === "string"
  );
}

function createProviderServiceHarness(options?: {
  readonly manualCompaction?: boolean;
  readonly compactThreadEffect?: ProviderServiceShape["compactThread"];
}) {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const runtimeSessions: ProviderSession[] = [];

  const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
  const compactThread = vi.fn<ProviderServiceShape["compactThread"]>(
    (threadId, runtimeSessionId) =>
      options?.compactThreadEffect?.(threadId, runtimeSessionId) ?? Effect.void,
  );
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    forkSession: () => unsupported(),
    startTransientSession: () => unsupported(),
    sendTurn: () => unsupported(),
    compactThread,
    interruptTurn: () => unsupported(),
    resolveAbortTarget: () => unsupported(),
    interruptAbortTarget: () => unsupported(),
    forceStopAbortTarget: () => unsupported(),
    isAbortTargetCurrent: () => Effect.succeed(false),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    stopTransientSession: () => unsupported(),
    listSessions: () => Effect.succeed([...runtimeSessions]),
    getCapabilities: () =>
      Effect.succeed({
        sessionModelSwitch: "in-session",
        mcp: "unsupported",
        manualCompaction: options?.manualCompaction === true,
      }),
    getInstanceInfo: (instanceId) => {
      const driverKind = ProviderDriverKind.make(String(instanceId));
      return Effect.succeed({
        instanceId,
        driverKind,
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind,
          continuationKey: `${driverKind}:instance:${instanceId}`,
        },
      });
    },
    assertConversationRollbackSupported: () => Effect.void,
    rollbackConversation: () => unsupported(),
    uploadFeedback: () => unsupported(),
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  const setSession = (session: ProviderSession): void => {
    const existingIndex = runtimeSessions.findIndex((entry) => entry.threadId === session.threadId);
    if (existingIndex >= 0) {
      runtimeSessions[existingIndex] = session;
      return;
    }
    runtimeSessions.push(session);
  };

  const normalizeLegacyEvent = (event: LegacyProviderRuntimeEvent): ProviderRuntimeEvent => {
    if (isLegacyTurnCompletedEvent(event)) {
      const normalized: Extract<ProviderRuntimeEvent, { type: "turn.completed" }> = {
        ...(event as Omit<Extract<ProviderRuntimeEvent, { type: "turn.completed" }>, "payload">),
        payload: {
          state: event.status,
          ...(typeof event.errorMessage === "string" ? { errorMessage: event.errorMessage } : {}),
        },
      };
      return normalized;
    }

    return event as ProviderRuntimeEvent;
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, normalizeLegacyEvent(event)));
  };

  return {
    service,
    emit,
    setSession,
    compactThread,
  };
}

type ProviderRuntimeTestReadModel = OrchestrationReadModel;
type ProviderRuntimeTestThread = ProviderRuntimeTestReadModel["threads"][number];
type ProviderRuntimeTestMessage = ProviderRuntimeTestThread["messages"][number];
type ProviderRuntimeTestProposedPlan = ProviderRuntimeTestThread["proposedPlans"][number];
type ProviderRuntimeTestActivity = ProviderRuntimeTestThread["activities"][number];
type ProviderRuntimeTestCheckpoint = ProviderRuntimeTestThread["checkpoints"][number];

async function waitForThread(
  readModel: () => Promise<ProviderRuntimeTestReadModel>,
  predicate: (thread: ProviderRuntimeTestThread) => boolean,
  timeoutMs = 2000,
  threadId: ThreadId = asThreadId("thread-1"),
) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<ProviderRuntimeTestThread> => {
    const snapshot = await readModel();
    const thread = snapshot.threads.find((entry) => entry.id === threadId);
    if (thread && predicate(thread)) {
      return thread;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for thread state");
    }
    await Effect.runPromise(Effect.yieldNow);
    return poll();
  };
  return poll();
}
describe("ProviderRuntimeIngestion.test.ts fork regressions", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ProviderRuntimeIngestionService | ProjectionSnapshotQuery,
    unknown
  > | null = null;

  let scope: Scope.Closeable | null = null;

  const tempDirs: string[] = [];

  it("bounds transient provider buffers for high-fan-out agent work", () => {
    expect(
      PROVIDER_RUNTIME_INGESTION_MEMORY_LIMITS.bufferedContentStreams *
        PROVIDER_RUNTIME_INGESTION_MEMORY_LIMITS.bufferedContentStreamChars,
    ).toBeLessThanOrEqual(32_768_000);
    expect(
      PROVIDER_RUNTIME_INGESTION_MEMORY_LIMITS.bufferedAssistantMessages *
        PROVIDER_RUNTIME_INGESTION_MEMORY_LIMITS.bufferedAssistantChars,
    ).toBeLessThanOrEqual(24_576_000);
  });

  function makeTempDir(prefix: string): string {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const dir of tempDirs.splice(0)) {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createHarness(options?: {
    serverSettings?: Partial<ServerSettings>;
    threadTitle?: string;
    manualCompaction?: boolean;
    compactThreadEffect?: ProviderServiceShape["compactThread"];
  }) {
    const workspaceRoot = makeTempDir("t3-provider-project-");
    NodeFS.mkdirSync(NodePath.join(workspaceRoot, ".git"));
    const provider = createProviderServiceHarness(options);
    const abortSettlements: SettleCooperativeTurnAbortInput[] = [];
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const layer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      // Single shared liveness instance across ingestion (writer), the
      // engine, and the snapshot query (reader).
      Layer.provideMerge(ThreadBackgroundLiveness.layer),
      Layer.provideMerge(ThreadPlanProgress.layer),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(
        Layer.succeed(TurnAbortCoordinator, {
          requestAbort: () => Effect.die("requestAbort should not run in ingestion tests"),
          settleCooperative: (input) =>
            Effect.sync(() => {
              abortSettlements.push(input);
              return true;
            }),
        }),
      ),
      Layer.provideMerge(makeTestServerSettingsLayer(options?.serverSettings)),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(CheckpointStore.layer.pipe(Layer.provide(VcsDriverRegistry.layer))),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const ingestion = await runtime.runPromise(Effect.service(ProviderRuntimeIngestionService));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(ingestion.start().pipe(Scope.provide(scope)));
    const drain = () => Effect.runPromise(ingestion.drain);
    const runEffect = <A, E>(effect: Effect.Effect<A, E, never>) => runtime!.runPromise(effect);
    const dispatch = (command: OrchestrationCommand) => Effect.runPromise(engine.dispatch(command));

    const createdAt = "2026-01-01T00:00:00.000Z";
    await dispatch({
      type: "project.create",
      commandId: CommandId.make("cmd-provider-project-create"),
      projectId: asProjectId("project-1"),
      title: "Provider Project",
      workspaceRoot,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      createdAt,
    });
    await dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-thread-create"),
      threadId: ThreadId.make("thread-1"),
      projectId: asProjectId("project-1"),
      title: options?.threadTitle ?? "Thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt,
    });
    await dispatch({
      type: "thread.session.set",
      commandId: CommandId.make("cmd-session-seed"),
      threadId: ThreadId.make("thread-1"),
      session: {
        threadId: ThreadId.make("thread-1"),
        status: "ready",
        providerName: "codex",
        runtimeSessionId: null,
        runtimeMode: "approval-required",
        activeTurnId: null,
        abortState: null,
        updatedAt: createdAt,
        lastError: null,
      },
      createdAt,
    });
    provider.setSession({
      provider: ProviderDriverKind.make("codex"),
      status: "ready",
      runtimeMode: "approval-required",
      threadId: ThreadId.make("thread-1"),
      createdAt,
      updatedAt: createdAt,
    });

    return {
      engine,
      dispatch,
      readModel: () => Effect.runPromise(snapshotQuery.getSnapshot()),
      readShell: () => Effect.runPromise(snapshotQuery.getShellSnapshot()),
      readEvents: () =>
        Effect.runPromise(
          Stream.runCollect(engine.readEvents(0)).pipe(Effect.map((chunk) => Array.from(chunk))),
        ),
      emit: provider.emit,
      setProviderSession: provider.setSession,
      compactThread: provider.compactThread,
      abortSettlements,
      drain,
      runEffect,
    };
  }

  it("drops terminal events from a replaced runtime generation", async () => {
    const harness = await createHarness();
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-current-runtime");
    const currentRuntimeSessionId = RuntimeSessionId.make("runtime-current");
    const staleRuntimeSessionId = RuntimeSessionId.make("runtime-stale");
    const runningAt = "2026-07-31T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-seed-current-runtime"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeSessionId: currentRuntimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: null,
          lastError: null,
          updatedAt: runningAt,
        },
        createdAt: runningAt,
      }),
    );

    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-stale-runtime-completed"),
      provider: ProviderDriverKind.make("codex"),
      runtimeSessionId: staleRuntimeSessionId,
      threadId,
      turnId,
      createdAt: "2026-07-31T00:00:01.000Z",
      payload: { state: "completed" },
    });
    await harness.drain();
    const snapshot = await harness.readModel();
    const thread = snapshot.threads.find((entry) => entry.id === threadId);
    expect(thread).toBeDefined();
    if (!thread) throw new Error("Expected seeded runtime thread");
    expect(thread.session).toMatchObject({
      status: "running",
      runtimeSessionId: currentRuntimeSessionId,
      activeTurnId: turnId,
    });

    const events = await harness.readEvents();
    expect(
      events.some(
        (event) =>
          event.type === "thread.session-set" &&
          String(event.commandId).includes("evt-stale-runtime-completed"),
      ),
    ).toBe(false);
  });

  it("hard-drops replacement runtime events while starting if a previous runtimeSessionId remains projected", async () => {
    const harness = await createHarness({ serverSettings: { enableLegacyTokenStreaming: true } });
    const threadId = asThreadId("thread-1");
    const oldRuntimeSessionId = RuntimeSessionId.make("runtime-old-pinned");
    const newRuntimeSessionId = RuntimeSessionId.make("runtime-new-dropped");
    const startingAt = "2026-07-31T00:01:30.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-seed-starting-pinned-old-runtime"),
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId: oldRuntimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: startingAt,
        },
        createdAt: startingAt,
      }),
    );

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-pinned-drop-turn-started"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      runtimeSessionId: newRuntimeSessionId,
      threadId,
      turnId: asTurnId("turn-should-drop"),
      createdAt: "2026-07-31T00:01:31.000Z",
      payload: {},
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-pinned-drop-assistant-delta"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      runtimeSessionId: newRuntimeSessionId,
      threadId,
      turnId: asTurnId("turn-should-drop"),
      itemId: asItemId("item-should-drop"),
      createdAt: "2026-07-31T00:01:32.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "must not project while old runtime is pinned",
      },
    });
    await harness.drain();
    const snapshot = await harness.readModel();
    const thread = snapshot.threads.find((entry) => entry.id === threadId);
    expect(thread).toBeDefined();
    if (!thread) throw new Error("Expected pinned runtime thread");
    expect(thread.session).toMatchObject({
      status: "starting",
      runtimeSessionId: oldRuntimeSessionId,
      activeTurnId: null,
    });
    expect(
      thread.messages.some((message) =>
        message.text.includes("must not project while old runtime is pinned"),
      ),
    ).toBe(false);
  });

  it("adopts a replacement runtime generation while starting when projected runtimeSessionId is null", async () => {
    const harness = await createHarness({ serverSettings: { enableLegacyTokenStreaming: true } });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-replacement-runtime");
    const newRuntimeSessionId = RuntimeSessionId.make("runtime-new");
    const startingAt = "2026-07-31T00:02:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-seed-starting-null-runtime"),
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: "claudeAgent",
          providerInstanceId: ProviderInstanceId.make("claudeAgent"),
          runtimeSessionId: null,
          runtimeMode: "approval-required",
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: startingAt,
        },
        createdAt: startingAt,
      }),
    );

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-replacement-turn-started"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      runtimeSessionId: newRuntimeSessionId,
      threadId,
      turnId,
      createdAt: "2026-07-31T00:02:01.000Z",
      payload: {},
    });

    await waitForThread(
      harness.readModel,
      (entry) =>
        entry.session?.status === "running" &&
        entry.session.runtimeSessionId === newRuntimeSessionId &&
        entry.session.activeTurnId === turnId,
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-replacement-assistant-delta"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      runtimeSessionId: newRuntimeSessionId,
      threadId,
      turnId,
      itemId: asItemId("item-replacement-assistant"),
      createdAt: "2026-07-31T00:02:02.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "hello after provider switch",
      },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.role === "assistant" && message.text.includes("hello after provider switch"),
      ),
    );
    expect(thread.session).toMatchObject({
      status: "running",
      runtimeSessionId: newRuntimeSessionId,
      activeTurnId: turnId,
      providerName: "claudeAgent",
    });
  });

  it("drops stale runtime events while starting once a replacement generation is bound", async () => {
    const harness = await createHarness({ serverSettings: { enableLegacyTokenStreaming: true } });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-bound-runtime");
    const boundRuntimeSessionId = RuntimeSessionId.make("runtime-bound");
    const staleRuntimeSessionId = RuntimeSessionId.make("runtime-stale");
    const startingAt = "2026-07-31T00:03:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-seed-starting-bound-runtime"),
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: "claudeAgent",
          providerInstanceId: ProviderInstanceId.make("claudeAgent"),
          runtimeSessionId: boundRuntimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: startingAt,
        },
        createdAt: startingAt,
      }),
    );

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-stale-turn-started-while-starting"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId: staleRuntimeSessionId,
      threadId,
      turnId: asTurnId("turn-stale"),
      createdAt: "2026-07-31T00:03:01.000Z",
      payload: {},
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-stale-assistant-delta-while-starting"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId: staleRuntimeSessionId,
      threadId,
      turnId: asTurnId("turn-stale"),
      itemId: asItemId("item-stale-assistant"),
      createdAt: "2026-07-31T00:03:02.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "stale generation must not project",
      },
    });
    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-bound-turn-started-while-starting"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      runtimeSessionId: boundRuntimeSessionId,
      threadId,
      turnId,
      createdAt: "2026-07-31T00:03:03.000Z",
      payload: {},
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-bound-assistant-delta-while-starting"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      runtimeSessionId: boundRuntimeSessionId,
      threadId,
      turnId,
      itemId: asItemId("item-bound-assistant"),
      createdAt: "2026-07-31T00:03:04.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "bound generation projects",
      },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.role === "assistant" && message.text.includes("bound generation projects"),
      ),
    );
    expect(thread.session).toMatchObject({
      status: "running",
      runtimeSessionId: boundRuntimeSessionId,
      activeTurnId: turnId,
      providerName: "claudeAgent",
    });
    expect(
      thread.messages.some((message) => message.text.includes("stale generation must not project")),
    ).toBe(false);

    const events = await harness.readEvents();
    expect(
      events.some(
        (event) =>
          event.type === "thread.session-set" &&
          String(event.commandId).includes("evt-stale-turn-started-while-starting"),
      ),
    ).toBe(false);
  });

  it("finalizes buffered output and settles an exact abort terminal cooperatively", async () => {
    const harness = await createHarness({
      serverSettings: { enableLegacyTokenStreaming: false },
    });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-cooperative-abort");
    const runtimeSessionId = RuntimeSessionId.make("runtime-cooperative-abort");
    const requestedAt = "2026-07-31T00:01:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-seed-cooperative-abort"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: {
            runtimeSessionId,
            targetTurnId: turnId,
            phase: "interrupting",
            requestedAt,
            forceAt: "2026-07-31T00:01:05.000Z",
          },
          lastError: null,
          updatedAt: requestedAt,
        },
        createdAt: requestedAt,
      }),
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-cooperative-assistant-delta"),
      provider: ProviderDriverKind.make("codex"),
      runtimeSessionId,
      threadId,
      turnId,
      itemId: asItemId("item-cooperative-assistant"),
      createdAt: "2026-07-31T00:01:01.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "Partial answer before the provider stopped.",
      },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-cooperative-reasoning-delta"),
      provider: ProviderDriverKind.make("codex"),
      runtimeSessionId,
      threadId,
      turnId,
      itemId: asItemId("item-cooperative-reasoning"),
      createdAt: "2026-07-31T00:01:02.000Z",
      payload: {
        streamKind: "reasoning_text",
        delta: "Buffered reasoning before abort.",
      },
    });
    harness.emit({
      type: "turn.aborted",
      eventId: asEventId("evt-cooperative-turn-aborted"),
      provider: ProviderDriverKind.make("codex"),
      runtimeSessionId,
      threadId,
      turnId,
      createdAt: "2026-07-31T00:01:03.000Z",
      payload: { reason: "interrupted" },
    });

    const thread = await waitForThread(
      harness.readModel,
      (entry) =>
        entry.messages.some(
          (message) =>
            message.id === "assistant:item-cooperative-assistant" &&
            message.text === "Partial answer before the provider stopped." &&
            !message.streaming,
        ) &&
        entry.activities.some(
          (activity) =>
            activity.kind === "reasoning.text" &&
            (activity.payload as Record<string, unknown>).text ===
              "Buffered reasoning before abort.",
        ),
    );
    const reasoningActivity = thread.activities.find(
      (activity) => activity.kind === "reasoning.text",
    );
    if (!reasoningActivity) {
      throw new Error("Expected buffered reasoning activity.");
    }
    expect((reasoningActivity.payload as Record<string, unknown>).flushReason).toBe(
      "thread.turn-abort-settled",
    );
    expect(harness.abortSettlements).toEqual([
      {
        threadId,
        runtimeSessionId,
        turnId,
        settledAt: "2026-07-31T00:01:03.000Z",
      },
    ]);
  });

  it("finalizes buffered output when a forced abort settles without a runtime terminal", async () => {
    const harness = await createHarness({
      serverSettings: { enableLegacyTokenStreaming: false },
    });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-forced-abort");
    const runtimeSessionId = RuntimeSessionId.make("runtime-forced-abort");
    const requestedAt = "2026-07-31T00:02:00.000Z";
    const settledAt = "2026-07-31T00:02:05.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-seed-forced-abort"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: {
            runtimeSessionId,
            targetTurnId: turnId,
            phase: "force-stopping",
            requestedAt,
            forceAt: settledAt,
          },
          lastError: null,
          updatedAt: requestedAt,
        },
        createdAt: requestedAt,
      }),
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-forced-assistant-delta"),
      provider: ProviderDriverKind.make("codex"),
      runtimeSessionId,
      threadId,
      turnId,
      itemId: asItemId("item-forced-assistant"),
      createdAt: "2026-07-31T00:02:01.000Z",
      payload: {
        streamKind: "assistant_text",
        delta: "Partial output before force-stop.",
      },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-forced-command-delta"),
      provider: ProviderDriverKind.make("codex"),
      runtimeSessionId,
      threadId,
      turnId,
      itemId: asItemId("item-forced-command"),
      createdAt: "2026-07-31T00:02:02.000Z",
      payload: {
        streamKind: "command_output",
        delta: "partial command output",
      },
    });
    await harness.drain();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.abort.settle",
        commandId: CommandId.make("cmd-settle-forced-abort"),
        threadId,
        runtimeSessionId,
        turnId,
        outcome: "force-terminated",
        settledAt,
        createdAt: settledAt,
      }),
    );

    const thread = await waitForThread(
      harness.readModel,
      (entry) =>
        entry.session?.status === "stopped" &&
        entry.messages.some(
          (message) =>
            message.id === "assistant:item-forced-assistant" &&
            message.text === "Partial output before force-stop." &&
            !message.streaming,
        ) &&
        entry.activities.some(
          (activity) =>
            activity.kind === "stream.command-output" &&
            (activity.payload as Record<string, unknown>).text === "partial command output",
        ),
    );
    expect(thread.session).toMatchObject({
      status: "stopped",
      runtimeSessionId: null,
      activeTurnId: null,
      abortState: null,
    });
    const commandOutputActivity = thread.activities.find(
      (activity) => activity.kind === "stream.command-output",
    );
    if (!commandOutputActivity) {
      throw new Error("Expected buffered command output activity.");
    }
    expect((commandOutputActivity.payload as Record<string, unknown>).flushReason).toBe(
      "thread.turn-abort-settled",
    );
    expect(harness.abortSettlements).toEqual([]);
  });

  it("accumulates complete provider reasoning and flushes it when the item completes", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-reasoning-delta-1"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex-personal"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-reasoning"),
      itemId: asItemId("item-reasoning"),
      providerRefs: { providerTurnId: "provider-turn-7", providerItemId: "provider-item-8" },
      payload: {
        streamKind: "reasoning_text",
        contentIndex: 2,
        delta: "Inspect the full ",
      },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-reasoning-delta-2"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex-personal"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-reasoning"),
      itemId: asItemId("item-reasoning"),
      providerRefs: { providerTurnId: "provider-turn-7", providerItemId: "provider-item-8" },
      payload: {
        streamKind: "reasoning_text",
        contentIndex: 2,
        delta: "payload with secret=dummy-secret.",
      },
    });
    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-reasoning-completed"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex-personal"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-reasoning"),
      itemId: asItemId("item-reasoning"),
      providerRefs: { providerTurnId: "provider-turn-7", providerItemId: "provider-item-8" },
      payload: { itemType: "reasoning", status: "completed" },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.activities.some((activity) => activity.kind === "reasoning.text"),
    );
    const activity = thread.activities.find((entry) => entry.kind === "reasoning.text");
    const payload = activity?.payload as Record<string, unknown> | undefined;

    expect(payload?.text).toBe("Inspect the full payload with secret=dummy-secret.");
    expect(payload?.streamKind).toBe("reasoning_text");
    expect(payload?.contentIndex).toBe(2);
    expect(payload?.provider).toBe("codex");
    expect(payload?.providerInstanceId).toBe("codex-personal");
    expect(payload?.itemId).toBe("item-reasoning");
    expect(payload?.providerRefs).toEqual({
      providerTurnId: "provider-turn-7",
      providerItemId: "provider-item-8",
    });
  });

  it("flushes non-assistant output on interruption without truncating it", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const output = `${"x".repeat(70_000)}\nfinished`;

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-command-output"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-interrupted-output"),
      itemId: asItemId("item-command-output"),
      payload: { streamKind: "command_output", delta: output },
    });
    harness.emit({
      type: "turn.aborted",
      eventId: asEventId("evt-turn-output-aborted"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-interrupted-output"),
      payload: { reason: "interrupted" },
    });

    const thread = await waitForThread(
      harness.readModel,
      (entry) =>
        entry.activities.filter((activity) => activity.kind === "stream.command-output").length >=
        2,
    );
    const persisted = thread.activities
      .filter((activity) => activity.kind === "stream.command-output")
      .toSorted((left, right) => {
        const leftPayload = left.payload as Record<string, unknown>;
        const rightPayload = right.payload as Record<string, unknown>;
        return Number(leftPayload.segmentIndex) - Number(rightPayload.segmentIndex);
      })
      .map((activity) => (activity.payload as Record<string, unknown>).text)
      .join("");

    expect(persisted).toBe(output);
  });

  it("buffers assistant deltas by default until completion", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-turn-started-buffered"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered"),
    });
    await waitForThread(
      harness.readModel,
      (thread) =>
        thread.session?.status === "running" && thread.session?.activeTurnId === "turn-buffered",
    );

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-message-delta-buffered"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered"),
      itemId: asItemId("item-buffered"),
      payload: {
        streamKind: "assistant_text",
        delta: "buffer me",
      },
    });

    await harness.drain();
    const midReadModel = await harness.readModel();
    const midThread = midReadModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(
      midThread?.messages.some(
        (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-buffered",
      ),
    ).toBe(false);

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-message-completed-buffered"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-buffered"),
      itemId: asItemId("item-buffered"),
      payload: {
        itemType: "assistant_message",
        status: "completed",
      },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.messages.some(
        (message: ProviderRuntimeTestMessage) =>
          message.id === "assistant:item-buffered" && !message.streaming,
      ),
    );
    const message = thread.messages.find(
      (entry: ProviderRuntimeTestMessage) => entry.id === "assistant:item-buffered",
    );
    expect(message?.text).toBe("buffer me");
    expect(message?.streaming).toBe(false);
  });

  it("does not project provider diff checkpoints when project checkpoints are disabled", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.dispatch({
      type: "project.meta.update",
      commandId: CommandId.make("cmd-provider-project-checkpoints-disable"),
      projectId: asProjectId("project-1"),
      checkpointsEnabled: false,
    });

    harness.emit({
      type: "turn.diff.updated",
      eventId: asEventId("evt-turn-diff-updated-checkpoints-disabled"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-checkpoints-disabled"),
      itemId: asItemId("item-checkpoints-disabled"),
      payload: {
        unifiedDiff: "diff --git a/file.txt b/file.txt\n+hello\n",
      },
    });
    await harness.drain();

    const snapshot = await harness.readModel();
    const thread = snapshot.threads.find((entry) => entry.id === asThreadId("thread-1"));
    expect(thread?.checkpoints).toEqual([]);
  });

  it("compacts at 50 percent only after the entire subagent group settles", async () => {
    const harness = await createHarness({ manualCompaction: true });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-milestone-compaction");
    const runtimeSessionId = RuntimeSessionId.make("runtime-milestone-compaction");
    const subagentId = asSubagentId("codex:milestone-child");
    const startedAt = "2026-01-01T00:01:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-compaction-running"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: null,
          lastError: null,
          updatedAt: startedAt,
        },
        createdAt: startedAt,
      }),
    );
    harness.setProviderSession({
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "running",
      runtimeMode: "approval-required",
      threadId,
      runtimeSessionId,
      activeTurnId: turnId,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    harness.emit({
      type: "thread.token-usage.updated",
      eventId: asEventId("evt-compaction-usage"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: startedAt,
      threadId,
      payload: {
        usage: {
          usedTokens: 60_000,
          maxTokens: 100_000,
          inputTokens: 55_000,
          cachedInputTokens: 40_000,
          outputTokens: 5_000,
          reasoningOutputTokens: 1_000,
          compactsAutomatically: true,
        },
      },
    });
    harness.emit({
      type: "subagent.state.changed",
      eventId: asEventId("evt-compaction-child-running"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: startedAt,
      threadId,
      subagentId,
      payload: { subagentId, state: "running" },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-compaction-root-completed"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: "2026-01-01T00:01:01.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();
    expect(harness.compactThread).not.toHaveBeenCalled();

    harness.emit({
      type: "subagent.state.changed",
      eventId: asEventId("evt-compaction-child-completed"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: "2026-01-01T00:01:02.000Z",
      threadId,
      subagentId,
      payload: { subagentId, state: "completed" },
    });
    await harness.drain();
    expect(harness.compactThread).toHaveBeenCalledTimes(1);
    expect(harness.compactThread).toHaveBeenCalledWith(threadId, runtimeSessionId);
  });

  it("does not compact a completed root turn while an approval is pending", async () => {
    const harness = await createHarness({ manualCompaction: true });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-pending-approval-compaction");
    const runtimeSessionId = RuntimeSessionId.make("runtime-pending-approval-compaction");
    const startedAt = "2026-01-01T00:01:30.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-pending-approval-compaction-running"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: null,
          lastError: null,
          updatedAt: startedAt,
        },
        createdAt: startedAt,
      }),
    );
    harness.setProviderSession({
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "running",
      runtimeMode: "approval-required",
      threadId,
      runtimeSessionId,
      activeTurnId: turnId,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    harness.emit({
      type: "thread.token-usage.updated",
      eventId: asEventId("evt-pending-approval-compaction-usage"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: startedAt,
      threadId,
      payload: { usage: { usedTokens: 60_000, maxTokens: 100_000 } },
    });
    harness.emit({
      type: "request.opened",
      eventId: asEventId("evt-pending-approval-compaction-request"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: startedAt,
      threadId,
      turnId,
      requestId: ApprovalRequestId.make("req-pending-approval-compaction"),
      payload: {
        requestType: "command_execution_approval",
        detail: "pwd",
      },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-pending-approval-compaction-completed"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: "2026-01-01T00:01:31.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();

    expect(harness.compactThread).not.toHaveBeenCalled();
  });

  it("keeps a completed turn usable when milestone compaction fails", async () => {
    const compactFailure = new ProviderAdapterRequestError({
      provider: "codex",
      method: "thread/compact/start",
      detail: "injected compact failure",
    });
    const harness = await createHarness({
      manualCompaction: true,
      compactThreadEffect: () => Effect.fail(compactFailure),
    });
    const threadId = asThreadId("thread-1");
    const turnId = asTurnId("turn-failed-compaction");
    const runtimeSessionId = RuntimeSessionId.make("runtime-failed-compaction");
    const startedAt = "2026-01-01T00:02:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-failed-compaction-running"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: null,
          lastError: null,
          updatedAt: startedAt,
        },
        createdAt: startedAt,
      }),
    );
    harness.setProviderSession({
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      status: "running",
      runtimeMode: "approval-required",
      threadId,
      runtimeSessionId,
      activeTurnId: turnId,
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    harness.emit({
      type: "thread.token-usage.updated",
      eventId: asEventId("evt-failed-compaction-usage"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: startedAt,
      threadId,
      payload: { usage: { usedTokens: 50_000, maxTokens: 100_000 } },
    });
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-failed-compaction-completed"),
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId,
      createdAt: "2026-01-01T00:02:01.000Z",
      threadId,
      turnId,
      payload: { state: "completed" },
    });
    await harness.drain();

    expect(harness.compactThread).toHaveBeenCalledTimes(1);
    const thread = (await harness.readModel()).threads.find((entry) => entry.id === threadId);
    expect(thread?.session).toMatchObject({ status: "ready", activeTurnId: null });
  });

  it("titles task completion from persisted activities after the description cache is swept", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "task.progress",
      eventId: asEventId("evt-swept-task-progress"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-swept-task"),
      payload: {
        taskId: "swept-task-1",
        description: "Watch round-3 CI and bots",
        summary: "Polling CI checks.",
      },
    });

    await waitForThread(harness.readModel, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) =>
          activity.id === "task-progress:thread-1:swept-task-1",
      ),
    );

    // session.exited sweeps the in-memory description cache; the completion
    // that follows must recover the name from persisted activities.
    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-swept-task-session-exited"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      payload: {},
    });

    harness.emit({
      type: "task.completed",
      eventId: asEventId("evt-swept-task-completed"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-swept-task"),
      payload: {
        taskId: "swept-task-1",
        status: "completed",
        summary: "CI is green.",
      },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.activities.some(
        (activity: ProviderRuntimeTestActivity) => activity.id === "evt-swept-task-completed",
      ),
    );

    const completed = thread.activities.find(
      (activity: ProviderRuntimeTestActivity) => activity.id === "evt-swept-task-completed",
    );
    const completedPayload =
      completed?.payload && typeof completed.payload === "object"
        ? (completed.payload as Record<string, unknown>)
        : undefined;

    expect(completedPayload?.title).toBe("Watch round-3 CI and bots");
  });

  it("projects complete deterministic subagent summaries with stable display-name fallbacks", async () => {
    const harness = await createHarness();
    const discoveredAt = "2026-07-30T10:00:00.000Z";
    const cases: ReadonlyArray<{
      id: SubagentId;
      providerThreadId: string;
      agentPath?: string;
      nickname?: string;
      role?: string;
      expectedName: string;
    }> = [
      {
        id: asSubagentId("codex:provider-nickname"),
        providerThreadId: "provider-nickname",
        agentPath: "/root/path-name",
        nickname: "preferred-name",
        role: "reviewer",
        expectedName: "preferred-name",
      },
      {
        id: asSubagentId("codex:provider-path"),
        providerThreadId: "provider-path",
        agentPath: "/root/path-name",
        role: "reviewer",
        expectedName: "path-name",
      },
      {
        id: asSubagentId("codex:provider-role"),
        providerThreadId: "provider-role",
        role: "reviewer",
        expectedName: "reviewer",
      },
      {
        id: asSubagentId("codex:provider-id"),
        providerThreadId: "provider-id",
        expectedName: "Agent codex:pr",
      },
    ] as const;

    for (const [index, entry] of cases.entries()) {
      harness.emit({
        type: "subagent.discovered",
        eventId: asEventId(`evt-subagent-discovered-${index}`),
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        createdAt: discoveredAt,
        threadId: asThreadId("thread-1"),
        subagentId: entry.id,
        payload: {
          subagentId: entry.id,
          providerThreadId: entry.providerThreadId,
          ...(entry.agentPath !== undefined ? { agentPath: entry.agentPath } : {}),
          ...(entry.nickname !== undefined ? { nickname: entry.nickname } : {}),
          ...(entry.role !== undefined ? { role: entry.role } : {}),
          ...(index === 0
            ? { model: "gpt-5.6", reasoningEffort: "xhigh", serviceTier: "priority" }
            : {}),
        },
      });
    }

    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.subagents.length === cases.length,
    );
    const upserted = (await harness.readEvents()).filter(
      (event) => event.type === "thread.subagent-upserted",
    );
    expect(upserted).toHaveLength(cases.length);
    for (const event of upserted) {
      if (event.type !== "thread.subagent-upserted") continue;
      expect(event.payload.subagent).toMatchObject({
        origin: "provider-native",
        providerInstanceId: "codex-work",
        providerDriver: "codex",
      });
    }

    for (const entry of cases) {
      expect(thread.subagents.find((agent) => agent.id === entry.id)).toMatchObject({
        id: entry.id,
        origin: "provider-native",
        providerInstanceId: "codex-work",
        providerDriver: "codex",
        providerThreadId: entry.providerThreadId,
        parentId: null,
        path: entry.agentPath ?? null,
        name: entry.expectedName,
        nickname: entry.nickname ?? null,
        role: entry.role ?? null,
        task: null,
        model: entry === cases[0] ? "gpt-5.6" : null,
        reasoningEffort: entry === cases[0] ? "xhigh" : null,
        ...(entry === cases[0] ? { serviceTier: "priority" } : {}),
        depth: entry.agentPath ? 1 : 0,
        status: "starting",
        statusMessage: null,
        latestProgress: null,
        latestTurn: null,
        startedAt: discoveredAt,
        updatedAt: discoveredAt,
        completedAt: null,
      });
    }
  });

  it("upserts a placeholder before discovery and applies subagent state without changing root lifecycle", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:provider-late-discovery");
    const waitingAt = "2026-07-30T10:01:00.000Z";

    harness.emit({
      type: "subagent.state.changed",
      eventId: asEventId("evt-subagent-state-before-discovery"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: waitingAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: {
        subagentId,
        state: "waiting",
        statusMessage: "Waiting for another agent",
      },
    });

    let thread = await waitForThread(harness.readModel, (entry) =>
      entry.subagents.some(
        (agent) => agent.id === subagentId && agent.latestProgress?.kind === "state.waiting",
      ),
    );
    expect(thread.subagents.find((agent) => agent.id === subagentId)).toMatchObject({
      id: subagentId,
      providerThreadId: subagentId,
      name: "Agent codex:pr",
      status: "waiting",
      statusMessage: "Waiting for another agent",
      latestProgress: {
        kind: "state.waiting",
        summary: "Waiting for another agent",
        detail: null,
        createdAt: waitingAt,
      },
    });
    expect(thread.session).toMatchObject({ status: "ready", activeTurnId: null });
    expect(thread.latestTurn).toBeNull();

    harness.emit({
      type: "subagent.discovered",
      eventId: asEventId("evt-subagent-discovered-after-state"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-30T10:01:01.000Z",
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: {
        subagentId,
        providerThreadId: "provider-late-discovery",
        agentPath: "/root/late-worker",
        nickname: "late-worker",
        depth: 1,
      },
    });

    thread = await waitForThread(harness.readModel, (entry) =>
      entry.subagents.some((agent) => agent.id === subagentId && agent.nickname === "late-worker"),
    );
    expect(thread.subagents.find((agent) => agent.id === subagentId)).toMatchObject({
      providerThreadId: "provider-late-discovery",
      name: "late-worker",
      nickname: "late-worker",
      status: "waiting",
      statusMessage: "Waiting for another agent",
    });

    const events = await harness.readEvents();
    const upsertIndex = events.findIndex(
      (
        event,
      ): event is Extract<OrchestrationEvent, { readonly type: "thread.subagent-upserted" }> =>
        event.type === "thread.subagent-upserted" && event.payload.subagent.id === subagentId,
    );
    const stateIndex = events.findIndex(
      (
        event,
      ): event is Extract<OrchestrationEvent, { readonly type: "thread.subagent-state-set" }> =>
        event.type === "thread.subagent-state-set" && event.payload.subagentId === subagentId,
    );
    expect(upsertIndex).toBeGreaterThanOrEqual(0);
    expect(stateIndex).toBeGreaterThan(upsertIndex);
  });

  it("keeps background liveness synchronized with authoritative subagent state", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:provider-background-child");
    const runningAt = "2026-07-30T10:01:05.000Z";
    const completedAt = "2026-07-30T10:01:06.000Z";

    harness.emit({
      type: "subagent.discovered",
      eventId: asEventId("evt-background-child-discovered"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: runningAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: {
        subagentId,
        providerThreadId: "provider-background-child",
        agentPath: "/root/background-child",
      },
    });
    harness.emit({
      type: "subagent.state.changed",
      eventId: asEventId("evt-background-child-running"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: runningAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: { subagentId, state: "running" },
    });
    harness.emit({
      type: "task.started",
      eventId: asEventId("evt-background-child-legacy-task-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: runningAt,
      threadId: asThreadId("thread-1"),
      payload: { taskId: "provider-background-child" },
    });

    await harness.drain();
    let thread = (await harness.readModel()).threads.find((entry) => entry.id === "thread-1");
    let shell = (await harness.readShell()).threads.find((entry) => entry.id === "thread-1");
    expect(thread?.subagents.find((subagent) => subagent.id === subagentId)?.status).toBe(
      "running",
    );
    expect(shell?.backgroundLiveness).toBe("working");

    harness.emit({
      type: "subagent.state.changed",
      eventId: asEventId("evt-background-child-completed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: completedAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: { subagentId, state: "completed" },
    });

    await harness.drain();
    thread = (await harness.readModel()).threads.find((entry) => entry.id === "thread-1");
    shell = (await harness.readShell()).threads.find((entry) => entry.id === "thread-1");
    expect(thread?.subagents.find((subagent) => subagent.id === subagentId)?.status).toBe(
      "completed",
    );
    expect(shell?.backgroundLiveness).toBeNull();
    expect(thread?.session).toMatchObject({ status: "ready", activeTurnId: null });

    // Codex can deliver a late compatibility activity after the authoritative
    // child status has already settled. It must not resurrect only the shell
    // liveness registry while the canonical agent remains completed.
    harness.emit({
      type: "task.updated",
      eventId: asEventId("evt-background-child-late-legacy-running"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-30T10:01:07.000Z",
      threadId: asThreadId("thread-1"),
      payload: { taskId: "provider-background-child", status: "running" },
    });

    await harness.drain();
    thread = (await harness.readModel()).threads.find((entry) => entry.id === "thread-1");
    shell = (await harness.readShell()).threads.find((entry) => entry.id === "thread-1");
    expect(thread?.subagents.find((subagent) => subagent.id === subagentId)?.status).toBe(
      "completed",
    );
    expect(shell?.backgroundLiveness).toBeNull();
  });

  it("uses a child turn completion as authoritative lifecycle state", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:provider-terminal-turn");
    const childTurnId = asTurnId("child-terminal-turn");
    const runningAt = "2026-07-30T10:01:10.000Z";
    const completedAt = "2026-07-30T10:01:20.000Z";

    harness.emit({
      type: "subagent.state.changed",
      eventId: asEventId("evt-child-running-before-terminal-turn"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: runningAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: {
        subagentId,
        state: "running",
      },
    });
    await waitForThread(harness.readModel, (entry) =>
      entry.subagents.some((agent) => agent.id === subagentId && agent.status === "running"),
    );
    await harness.drain();
    expect(
      (await harness.readShell()).threads.find((entry) => entry.id === "thread-1")
        ?.backgroundLiveness,
    ).toBe("working");

    // Providers normally emit a companion subagent.state.changed event. The
    // child turn itself is still authoritative when that notification is lost.
    harness.emit({
      type: "turn.completed",
      eventId: asEventId("evt-child-terminal-turn"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: completedAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: childTurnId,
      payload: { state: "completed" },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.subagents.some(
        (agent) => agent.id === subagentId && agent.latestTurn?.state === "completed",
      ),
    );
    expect(thread.subagents.find((agent) => agent.id === subagentId)).toMatchObject({
      status: "completed",
      statusMessage: null,
      latestProgress: {
        kind: "state.completed",
        summary: "Completed",
        detail: null,
        createdAt: completedAt,
      },
      latestTurn: {
        turnId: childTurnId,
        state: "completed",
        completedAt,
      },
      completedAt,
    });
    await harness.drain();
    expect(
      (await harness.readShell()).threads.find((entry) => entry.id === "thread-1")
        ?.backgroundLiveness,
    ).toBeNull();
    expect(thread.session).toMatchObject({ status: "ready", activeTurnId: null });
  });

  it("interrupts active child turns when their root provider session exits", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:provider-session-exit-child");
    const childTurnId = asTurnId("child-turn-before-session-exit");
    const runningAt = "2026-07-30T10:01:30.000Z";
    const exitedAt = "2026-07-30T10:01:40.000Z";

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-child-turn-before-session-exit"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: runningAt,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: childTurnId,
      payload: {},
    });
    await waitForThread(harness.readModel, (entry) =>
      entry.subagents.some(
        (agent) => agent.id === subagentId && agent.latestTurn?.state === "running",
      ),
    );

    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-root-session-exited-with-active-child"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: exitedAt,
      threadId: asThreadId("thread-1"),
      payload: { reason: "Provider process exited" },
    });

    const thread = await waitForThread(
      harness.readModel,
      (entry) => entry.session?.status === "stopped",
    );
    expect(thread.subagents.find((agent) => agent.id === subagentId)).toMatchObject({
      status: "interrupted",
      statusMessage: null,
      latestProgress: {
        kind: "state.interrupted",
        summary: "Interrupted",
        detail: null,
        createdAt: exitedAt,
      },
      latestTurn: {
        turnId: childTurnId,
        state: "interrupted",
        completedAt: exitedAt,
      },
      completedAt: exitedAt,
    });
  });

  it("flushes and releases child stream buffers when the root provider session exits", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:buffered-child");
    const childTurnId = asTurnId("child-buffered-turn");
    const childItemId = asItemId("child-buffered-item");
    const now = "2026-07-30T10:01:50.000Z";

    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-child-buffered-reasoning"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: childTurnId,
      itemId: childItemId,
      payload: {
        streamKind: "reasoning_text",
        delta: "Buffered child reasoning before the provider disappeared.",
      },
    });
    await harness.drain();
    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-root-exit-flushes-child-buffer"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      payload: { reason: "Provider process exited" },
    });
    await harness.drain();

    const activitiesAfterExit = (await harness.readEvents()).filter(
      (
        event,
      ): event is Extract<OrchestrationEvent, { readonly type: "thread.activity-appended" }> =>
        event.type === "thread.activity-appended" &&
        event.payload.subagentId === subagentId &&
        event.payload.activity.kind === "reasoning.text",
    );
    expect(activitiesAfterExit).toHaveLength(1);
    expect(activitiesAfterExit[0]?.payload.activity.payload).toMatchObject({
      text: "Buffered child reasoning before the provider disappeared.",
      flushReason: "session.exited",
    });

    harness.emit({
      type: "item.completed",
      eventId: asEventId("evt-late-child-buffer-completion"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: childTurnId,
      itemId: childItemId,
      payload: { itemType: "reasoning", status: "completed" },
    });
    await harness.drain();

    const activitiesAfterLateCompletion = (await harness.readEvents()).filter(
      (
        event,
      ): event is Extract<OrchestrationEvent, { readonly type: "thread.activity-appended" }> =>
        event.type === "thread.activity-appended" &&
        event.payload.subagentId === subagentId &&
        event.payload.activity.kind === "reasoning.text",
    );
    expect(activitiesAfterLateCompletion).toHaveLength(1);
  });

  it("routes child assistant, plan, and activity events to namespaced subagent commands", async () => {
    const harness = await createHarness();
    const subagentA = asSubagentId("codex:provider-agent-a");
    const subagentB = asSubagentId("codex:provider-agent-b");
    const now = "2026-07-30T10:02:00.000Z";

    for (const [index, subagentId] of [subagentA, subagentB].entries()) {
      harness.emit({
        type: "content.delta",
        eventId: asEventId(`evt-child-assistant-delta-${index}`),
        provider: ProviderDriverKind.make("codex"),
        createdAt: now,
        threadId: asThreadId("thread-1"),
        subagentId,
        turnId: asTurnId("shared-turn"),
        itemId: asItemId("shared-item"),
        payload: {
          streamKind: "assistant_text",
          delta: `child-${index}`,
        },
      });
      harness.emit({
        type: "item.completed",
        eventId: asEventId(`evt-child-assistant-completed-${index}`),
        provider: ProviderDriverKind.make("codex"),
        createdAt: now,
        threadId: asThreadId("thread-1"),
        subagentId,
        turnId: asTurnId("shared-turn"),
        itemId: asItemId("shared-item"),
        payload: {
          itemType: "assistant_message",
          status: "completed",
        },
      });
    }

    harness.emit({
      type: "turn.proposed.delta",
      eventId: asEventId("evt-child-plan-delta"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId: subagentA,
      turnId: asTurnId("shared-turn"),
      payload: { delta: "# Child plan" },
    });
    harness.emit({
      type: "turn.proposed.completed",
      eventId: asEventId("evt-child-plan-completed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId: subagentA,
      turnId: asTurnId("shared-turn"),
      payload: { planMarkdown: "# Child plan" },
    });
    harness.emit({
      type: "item.started",
      eventId: asEventId("evt-child-command-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId: subagentA,
      turnId: asTurnId("shared-turn"),
      itemId: asItemId("shared-command"),
      payload: {
        itemType: "command_execution",
        title: "Run tests",
      },
    });

    await harness.drain();
    const thread = await waitForThread(harness.readModel, (entry) => entry.subagents.length === 2);
    expect(thread.messages).toEqual([]);
    expect(thread.proposedPlans).toEqual([]);
    expect(thread.activities).toEqual([]);
    expect(thread.session).toMatchObject({ status: "ready", activeTurnId: null });
    expect(thread.latestTurn).toBeNull();

    const events = await harness.readEvents();
    const childMessages = events.filter(
      (event): event is Extract<OrchestrationEvent, { readonly type: "thread.message-sent" }> =>
        event.type === "thread.message-sent" &&
        (event.payload.subagentId === subagentA || event.payload.subagentId === subagentB),
    );
    const agentAMessageIds = childMessages
      .filter((event) => event.payload.subagentId === subagentA)
      .map((event) => event.payload.messageId);
    const agentBMessageIds = childMessages
      .filter((event) => event.payload.subagentId === subagentB)
      .map((event) => event.payload.messageId);
    expect(agentAMessageIds.length).toBeGreaterThan(0);
    expect(agentBMessageIds.length).toBeGreaterThan(0);
    expect(new Set(agentAMessageIds)).not.toEqual(new Set(agentBMessageIds));
    expect(agentAMessageIds.every((id) => id.includes(String(subagentA)))).toBe(true);
    expect(agentBMessageIds.every((id) => id.includes(String(subagentB)))).toBe(true);

    const childPlan = events.find(
      (
        event,
      ): event is Extract<OrchestrationEvent, { readonly type: "thread.proposed-plan-upserted" }> =>
        event.type === "thread.proposed-plan-upserted" && event.payload.subagentId === subagentA,
    );
    expect(childPlan?.payload.proposedPlan.id).toContain(String(subagentA));

    const childActivity = events.find(
      (
        event,
      ): event is Extract<OrchestrationEvent, { readonly type: "thread.activity-appended" }> =>
        event.type === "thread.activity-appended" &&
        event.payload.subagentId === subagentA &&
        event.payload.activity.kind === "tool.started",
    );
    expect(childActivity?.payload.activity.id).toContain(String(subagentA));
  });

  it("mirrors child approval interactions to root while preserving child activity origin", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:provider-approval-agent");
    const now = "2026-07-30T10:03:00.000Z";

    harness.emit({
      type: "request.opened",
      eventId: asEventId("evt-child-approval-opened"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: asTurnId("child-turn"),
      requestId: ApprovalRequestId.make("child-request"),
      payload: {
        requestType: "command_execution_approval",
        detail: "Run the focused tests",
      },
    });
    harness.emit({
      type: "user-input.requested",
      eventId: asEventId("evt-child-input-requested"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: asTurnId("child-turn"),
      requestId: ApprovalRequestId.make("child-input"),
      payload: {
        questions: [
          {
            id: "choice",
            header: "Choice",
            question: "Continue?",
            options: [{ label: "Yes", description: "Continue the task" }],
          },
        ],
      },
    });

    await harness.drain();
    const thread = await waitForThread(
      harness.readModel,
      (entry) =>
        entry.activities.some((activity) => activity.id === "evt-child-approval-opened") &&
        entry.activities.some((activity) => activity.id === "evt-child-input-requested"),
    );
    expect(thread.activities.map((activity) => activity.kind)).toEqual(
      expect.arrayContaining(["approval.requested", "user-input.requested"]),
    );

    const events = await harness.readEvents();
    for (const activityId of ["evt-child-approval-opened", "evt-child-input-requested"]) {
      const mirrored = events.filter(
        (
          event,
        ): event is Extract<OrchestrationEvent, { readonly type: "thread.activity-appended" }> =>
          event.type === "thread.activity-appended" &&
          String(event.payload.activity.id).includes(activityId),
      );
      expect(mirrored.some((event) => event.payload.subagentId === undefined)).toBe(true);
      expect(mirrored.some((event) => event.payload.subagentId === subagentId)).toBe(true);
    }
  });

  it("updates subagent progress from state and item lifecycle but not content deltas", async () => {
    const harness = await createHarness();
    const subagentId = asSubagentId("codex:provider-progress-agent");
    const now = "2026-07-30T10:04:00.000Z";

    harness.emit({
      type: "subagent.discovered",
      eventId: asEventId("evt-progress-agent-discovered"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId,
      payload: {
        subagentId,
        providerThreadId: "provider-progress-agent",
      },
    });
    harness.emit({
      type: "content.delta",
      eventId: asEventId("evt-progress-content-delta"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: asTurnId("progress-turn"),
      itemId: asItemId("progress-item"),
      payload: {
        streamKind: "reasoning_summary_text",
        delta: "Inspecting files",
      },
    });
    await harness.drain();

    let events = await harness.readEvents();
    expect(
      events.filter(
        (
          event,
        ): event is Extract<
          OrchestrationEvent,
          { readonly type: "thread.subagent-progress-set" }
        > =>
          event.type === "thread.subagent-progress-set" && event.payload.subagentId === subagentId,
      ),
    ).toHaveLength(0);

    harness.emit({
      type: "item.started",
      eventId: asEventId("evt-progress-command-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-30T10:04:01.000Z",
      threadId: asThreadId("thread-1"),
      subagentId,
      turnId: asTurnId("progress-turn"),
      itemId: asItemId("progress-command"),
      payload: {
        itemType: "command_execution",
        title: "Run typecheck",
        detail: "vp run typecheck",
      },
    });

    const thread = await waitForThread(harness.readModel, (entry) =>
      entry.subagents.some(
        (agent) => agent.id === subagentId && agent.latestProgress?.kind === "tool.started",
      ),
    );
    expect(thread.subagents.find((agent) => agent.id === subagentId)?.latestProgress).toEqual({
      kind: "tool.started",
      summary: "Run typecheck started",
      detail: "vp run typecheck",
      createdAt: "2026-07-30T10:04:01.000Z",
    });

    events = await harness.readEvents();
    expect(
      events.filter(
        (
          event,
        ): event is Extract<
          OrchestrationEvent,
          { readonly type: "thread.subagent-progress-set" }
        > =>
          event.type === "thread.subagent-progress-set" && event.payload.subagentId === subagentId,
      ),
    ).toHaveLength(1);
  });
});
