import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DeepPlanRunId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2RuntimeRequest,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as DelegatedWorkerGuards from "./DelegatedWorkerGuards.ts";

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const providerSessionId = ProviderSessionId.make("guards-session");
const adapter = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process is needed"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  NodeServices.layer,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "delegated-worker-guards" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);
const layerGuards = DelegatedWorkerGuards.layer.pipe(
  Layer.provideMerge(
    ServerSettings.layerTest({
      betterT3Environment: { flags: { "agent.generalSubagents": true } },
    }),
  ),
  Layer.provideMerge(layerTest),
);

const startParent = Effect.fn("DelegatedWorkerGuardsTest.startParent")(function* (name: string) {
  const orchestrator = yield* OrchestratorV2;
  const threadId = ThreadId.make(`${name}:parent`);
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`${name}:create`),
    threadId,
    projectId: ProjectId.make("guards-project"),
    title: "Parent",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(`${name}:start`),
    threadId,
    messageId: MessageId.make(`${name}:message`),
    text: "Do the work",
    attachments: [],
    createdBy: "user",
    creationSource: "web",
    dispatchMode: { type: "start_immediately" },
  });
  const run = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!;
  return { threadId, run };
});

type DelegationMarker = Partial<
  Pick<
    Extract<OrchestrationV2Command, { readonly type: "delegated_task.request" }>,
    "generalSubagent" | "fetchWorker" | "deepPlanExecution"
  >
>;

const delegate = Effect.fn("DelegatedWorkerGuardsTest.delegate")(function* (
  parent: Effect.Success<ReturnType<typeof startParent>>,
  name: string,
  marker: DelegationMarker,
) {
  const orchestrator = yield* OrchestratorV2;
  const result = yield* orchestrator.dispatch({
    type: "delegated_task.request",
    commandId: CommandId.make(`${name}:delegate`),
    parentThreadId: parent.threadId,
    parentRunId: parent.run.id,
    parentNodeId: parent.run.rootNodeId!,
    task: `Task ${name}`,
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdBy: "agent",
    creationSource: "server",
    ...marker,
  });
  const task = result.storedEvents.flatMap(({ event }) =>
    event.type === "subagent.updated" ? [event.payload] : [],
  )[0]!;
  return { taskId: task.id, threadId: task.childThreadId! };
});

const openRequest = Effect.fn("DelegatedWorkerGuardsTest.openRequest")(function* (
  threadId: ThreadId,
  name: string,
  kind: OrchestrationV2RuntimeRequest["kind"],
) {
  const events = yield* EventSinkV2;
  const now = yield* DateTime.now;
  const [stored] = yield* events.write({
    events: [
      {
        id: EventId.make(`${name}:request`),
        type: "runtime-request.updated",
        threadId,
        nodeId: NodeId.make(`${name}:node`),
        occurredAt: now,
        payload: {
          id: RuntimeRequestId.make(name),
          nodeId: NodeId.make(`${name}:node`),
          providerTurnId: null,
          nativeRequestRef: null,
          kind,
          status: "pending",
          responseCapability: { type: "live", providerSessionId },
          createdAt: now,
          resolvedAt: null,
        },
      },
    ],
  });
  return stored!;
});

const attachSession = Effect.fn("DelegatedWorkerGuardsTest.attachSession")(function* (
  threadId: ThreadId,
) {
  const events = yield* EventSinkV2;
  const now = yield* DateTime.now;
  yield* events.write({
    events: [
      {
        id: EventId.make(`${threadId}:session`),
        type: "provider-session.attached",
        threadId,
        driver,
        providerInstanceId: instanceId,
        occurredAt: now,
        payload: {
          id: providerSessionId,
          driver,
          providerInstanceId: instanceId,
          status: "running",
          cwd: "/repo",
          model: modelSelection.model,
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        },
      },
    ],
  });
});

const decisionFor = (requestId: string) =>
  Effect.gen(function* () {
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const effects = yield* outbox.listByCommandId(
      CommandId.make(`delegated-worker-policy:${requestId}`),
    );
    return effects.flatMap(({ request }) =>
      request.type === "runtime-request.respond" ? [request.decision] : [],
    );
  });

const childRunStatus = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* OrchestratorV2;
    return (yield* orchestrator.getThreadProjection(threadId)).runs[0]?.status;
  });

const assertRunning = (threadId: ThreadId) =>
  Effect.map(childRunStatus(threadId), (status) =>
    assert.isTrue(status === "starting" || status === "running", String(status)),
  );

const assertStopped = (threadId: ThreadId) =>
  Effect.map(childRunStatus(threadId), (status) =>
    assert.isTrue(status === "interrupted" || status === "cancelled", String(status)),
  );

it.effect("answers worker approvals itself and stops a worker that asks a question", () =>
  Effect.gen(function* () {
    const guards = yield* DelegatedWorkerGuards.DelegatedWorkerGuards;
    const parent = yield* startParent("approvals");
    const general = yield* delegate(parent, "approvals-general", { generalSubagent: true });
    const asking = yield* delegate(parent, "approvals-asking", { generalSubagent: true });
    const fetch = yield* delegate(parent, "approvals-fetch", {
      fetchWorker: { commandExecutionPolicy: "deny" },
    });
    const plain = yield* delegate(parent, "approvals-plain", {});
    for (const threadId of [general.threadId, fetch.threadId, plain.threadId])
      yield* attachSession(threadId);
    for (const [threadId, name, kind, expected] of [
      [general.threadId, "general-read", "file-read", ["accept"]],
      [general.threadId, "general-command", "command", ["decline"]],
      [general.threadId, "general-tool", "dynamic_tool_call", []],
      [fetch.threadId, "fetch-read", "file-read", ["accept"]],
      [fetch.threadId, "fetch-change", "file-change", ["decline"]],
      [plain.threadId, "plain-command", "command", []],
    ] as const) {
      yield* guards.handle(yield* openRequest(threadId, name, kind));
      assert.deepEqual(yield* decisionFor(name), [...expected], name);
    }
    yield* guards.handle(yield* openRequest(asking.threadId, "asking-question", "user_input"));
    yield* assertStopped(asking.threadId);
    yield* assertRunning(general.threadId);
    yield* guards.handle(yield* openRequest(plain.threadId, "plain-question", "user_input"));
    yield* assertRunning(plain.threadId);
  }).pipe(Effect.provide(layerGuards)),
);

it.effect("stops general agents silently with their parent turn, but not for a restart", () =>
  Effect.gen(function* () {
    const events = yield* EventSinkV2;
    const guards = yield* DelegatedWorkerGuards.DelegatedWorkerGuards;
    const orchestrator = yield* OrchestratorV2;
    const parent = yield* startParent("turn-end");
    const general = yield* delegate(parent, "turn-end-general", { generalSubagent: true });
    const plain = yield* delegate(parent, "turn-end-plain", {});
    const now = yield* DateTime.now;
    const ended = (status: "cancelled" | "completed", id: string, commandId?: CommandId) =>
      events.write({
        ...(commandId === undefined ? {} : { commandId }),
        events: [
          {
            id: EventId.make(id),
            type: "run.updated",
            threadId: parent.threadId,
            runId: parent.run.id,
            occurredAt: now,
            payload: { ...parent.run, status, completedAt: now },
          },
        ],
      });
    const [restarted] = yield* ended(
      "cancelled",
      "turn-end-restart",
      CommandId.make("command:runtime-reconcile:shutdown:turn-end:now"),
    );
    yield* guards.handle(restarted!);
    yield* assertRunning(general.threadId);
    const [completed] = yield* ended("completed", "turn-end-completed");
    yield* guards.handle(completed!);
    yield* assertStopped(general.threadId);
    yield* assertRunning(plain.threadId);
    const { subagents } = yield* orchestrator.getThreadRecords(parent.threadId, ["subagents"]);
    assert.equal(
      subagents.find((task) => task.id === general.taskId)?.completionDelivery?.state,
      "disposed",
    );
    assert.isUndefined(subagents.find((task) => task.id === plain.taskId)?.completionDelivery);
  }).pipe(Effect.provide(layerGuards)),
);

it.effect("stops a general agent at its deadline without blocking the child's other effects", () =>
  Effect.gen(function* () {
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const parent = yield* startParent("deadline");
    const general = yield* delegate(parent, "deadline-general", { generalSubagent: true });
    const claimed: Array<string> = [];
    while (true) {
      const effect = yield* outbox.claimNext({ workerId: "holds-turn-starts" });
      if (Option.isNone(effect)) break;
      claimed.push(effect.value.request.type);
    }
    assert.deepEqual(claimed.toSorted(), ["provider-turn.start", "provider-turn.start"]);
    yield* TestClock.adjust("29 minutes");
    assert.equal(yield* worker.drain(), 0);
    yield* assertRunning(general.threadId);
    yield* TestClock.adjust("1 minute");
    assert.isAbove(yield* worker.drain(), 0);
    yield* assertStopped(general.threadId);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("stops general agents when the feature is disabled and keeps Deep Plan analysis", () =>
  Effect.gen(function* () {
    const orchestrator = yield* OrchestratorV2;
    const guards = yield* DelegatedWorkerGuards.DelegatedWorkerGuards;
    const parent = yield* startParent("disabled");
    const deepPlanRunId = DeepPlanRunId.make("disabled-plan");
    yield* orchestrator.dispatch({
      type: "thread.deep-plan.start",
      commandId: CommandId.make("disabled-plan-start"),
      threadId: parent.threadId,
      runId: deepPlanRunId,
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
    const general = yield* delegate(parent, "disabled-general", { generalSubagent: true });
    const analysis = yield* delegate(parent, "disabled-analysis", {
      generalSubagent: true,
      deepPlanExecution: {
        runId: deepPlanRunId,
        runThreadId: parent.threadId,
        approvedPlanVersion: null,
        phase: "planning",
        readOnly: true,
        sourceAnalysis: { workerThreadId: parent.threadId, sourceIds: [] },
        modelSelection,
      },
    });
    const plain = yield* delegate(parent, "disabled-plain", {});
    yield* guards.stopDisabledGeneralSubagents;
    yield* assertStopped(general.threadId);
    yield* assertRunning(analysis.threadId);
    yield* assertRunning(plain.threadId);
  }).pipe(Effect.provide(layerGuards)),
);
