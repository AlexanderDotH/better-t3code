import { expect, it } from "@effect/vitest";
import {
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  TurnId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import {
  ProviderService,
  type ProviderAbortTarget,
  type ProviderTransientSessionTarget,
} from "../../provider/Services/ProviderService.ts";
import { makeProjectIndexGenerator } from "../integration/ProjectIndexGeneration.ts";
import {
  projectIndexWorkerSelection,
  resolveProjectIndexModel,
} from "../integration/ProjectIndexModel.ts";
import type { ProjectIndexGenerationInput } from "../runtime/ProjectIndexingBridge.ts";

const now = "2026-09-20T12:00:00.000Z";
const selection: ModelSelection = {
  instanceId: ProviderInstanceId.make("review-instance"),
  model: "synthetic-model",
};
const provider: ServerProvider = {
  instanceId: selection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: now,
  fetchWorkers: { maxRecommendedWorkers: 2, commandExecutionPolicy: "deny" },
  models: [
    {
      slug: selection.model,
      name: "Synthetic model",
      isCustom: true,
      capabilities: { contextWindow: { defaultTokens: 128_000, maxTokens: 1_000_000 } },
    },
  ],
  slashCommands: [],
  skills: [],
};
const input: ProjectIndexGenerationInput = {
  workspaceRoot: "/synthetic-workspace",
  scope: {
    scopeId: "synthetic-scope",
    projectId: ProjectId.make("synthetic-project"),
    workspaceFingerprint: "synthetic-workspace",
  },
  modelSelection: selection,
  prompt: "Synthetic evidence only.",
  responseSchema: { type: "object" },
  purpose: "review",
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 1_000,
};

type TestEvent = {
  readonly type: ProviderRuntimeEvent["type"];
  readonly payload: unknown;
  readonly requestId?: string;
};
const completion: TestEvent = { type: "turn.completed", payload: { state: "completed" } };
const textEvent = (text: string): TestEvent => ({
  type: "content.delta",
  payload: { streamKind: "assistant_text", delta: text },
});
const unused = () => Effect.die("Unexpected provider operation during explicit review");
const decodeProviderEvent = Schema.decodeUnknownEffect(ProviderRuntimeEvent);
const decodeProviderTurn = Schema.decodeEffect(ProviderSendTurnInput);

const makeHarness = Effect.fn("ProjectIndexGenerationAcceptance.makeHarness")(function* (
  options: {
    readonly earlyEvents?: ReadonlyArray<TestEvent>;
    readonly events?: ReadonlyArray<TestEvent>;
    readonly stopFails?: boolean;
    readonly onSend?: (
      target: ProviderTransientSessionTarget,
      publish: (target: ProviderTransientSessionTarget, event: TestEvent) => Effect.Effect<void>,
    ) => Effect.Effect<void>;
  } = {},
) {
  const bus = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
  const sessions = new Map<string, ProviderTransientSessionTarget>();
  const started: Array<Parameters<ProviderService["Service"]["startTransientSession"]>> = [];
  const sent: ProviderSendTurnInput[] = [];
  const interrupted: ProviderAbortTarget[] = [];
  const stopped: ProviderTransientSessionTarget[] = [];
  const forced: ProviderAbortTarget[] = [];
  const responses: Parameters<ProviderService["Service"]["respondToRequest"]>[0][] = [];
  let subscribed = false;
  let eventId = 0;
  let generation = 0;
  const crypto = Crypto.make({
    randomBytes: (size) => new Uint8Array(size).fill(++generation),
    digest: (_algorithm, data) => Effect.succeed(data),
  });
  const publish = Effect.fn("ProjectIndexGenerationAcceptance.publish")(function* (
    target: ProviderTransientSessionTarget,
    event: TestEvent,
  ) {
    const decoded = yield* decodeProviderEvent({
      ...target,
      eventId: `synthetic-event-${++eventId}`,
      provider: provider.driver,
      createdAt: now,
      turnId: "synthetic-turn",
      ...event,
    }).pipe(Effect.orDie);
    yield* PubSub.publish(bus, decoded);
  });
  const service = ProviderService.of({
    subscribeEvents: Effect.gen(function* () {
      const queue = yield* PubSub.subscribe(bus);
      subscribed = true;
      return Stream.fromSubscription(queue);
    }),
    startTransientSession: (threadId, request, sessionOptions) =>
      Effect.gen(function* () {
        expect(subscribed).toBe(true);
        started.push([threadId, request, sessionOptions]);
        const target = {
          threadId,
          runtimeSessionId: request.runtimeSessionId!,
          providerInstanceId: request.providerInstanceId!,
        };
        sessions.set(threadId, target);
        for (const event of options.earlyEvents ?? []) yield* publish(target, event);
        return {
          provider: provider.driver,
          ...target,
          runtimeMode: request.runtimeMode,
          status: "ready" as const,
          createdAt: now,
          updatedAt: now,
        };
      }),
    sendTurn: (request) =>
      Effect.gen(function* () {
        const validated = yield* decodeProviderTurn(request).pipe(Effect.orDie);
        sent.push(validated);
        const target = sessions.get(request.threadId)!;
        yield* publish(target, { type: "turn.started", payload: { model: selection.model } });
        if (options.onSend) yield* options.onSend(target, publish);
        else
          for (const event of options.events ?? [textEvent('{"ok":true}'), completion])
            yield* publish(target, event);
        return { threadId: request.threadId, turnId: TurnId.make("synthetic-turn") };
      }),
    interruptAbortTarget: (target) =>
      Effect.sync(() => {
        interrupted.push(target);
      }),
    stopTransientSession: (target) =>
      Effect.gen(function* () {
        stopped.push(target);
        if (options.stopFails)
          return yield* new ProviderAdapterRequestError({
            provider: "synthetic",
            method: "stop",
            detail: "Synthetic cleanup failure",
          });
      }),
    forceStopAbortTarget: (target) =>
      Effect.sync(() => {
        forced.push(target);
        return { outcome: "terminated" as const, mechanism: "runtime-close" as const };
      }),
    respondToRequest: (request) =>
      Effect.sync(() => {
        responses.push(request);
      }),
    startSession: unused,
    forkSession: unused,
    compactThread: unused,
    interruptTurn: unused,
    resolveAbortTarget: unused,
    isAbortTargetCurrent: unused,
    respondToUserInput: unused,
    stopSession: unused,
    listSessions: unused,
    getCapabilities: unused,
    getInstanceInfo: unused,
    assertConversationRollbackSupported: unused,
    rollbackConversation: unused,
    uploadFeedback: unused,
    streamEvents: Stream.empty,
  });
  const registry = ProviderRegistry.of({
    getProviders: Effect.succeed([provider]),
    refresh: unused,
    refreshInstance: unused,
    refreshWorkspaceSnapshot: unused,
    getProviderMaintenanceCapabilitiesForInstance: unused,
    setProviderMaintenanceActionState: unused,
    streamChanges: Stream.empty,
  });
  const generate = yield* makeProjectIndexGenerator.pipe(
    Effect.provideService(ProviderService, service),
    Effect.provideService(ProviderRegistry, registry),
    Effect.provideService(Crypto.Crypto, crypto),
  );
  return { generate, publish, started, sent, interrupted, stopped, forced, responses };
});

it("selects the exact instance/model, uses its advertised capacity, and never falls back", () => {
  const other = { ...provider, instanceId: ProviderInstanceId.make("other-instance") };
  expect(resolveProjectIndexModel([other, provider], selection).provider.instanceId).toBe(
    selection.instanceId,
  );
  expect(resolveProjectIndexModel([provider], selection).contextWindowTokens).toBe(1_000_000);
  expect(() => resolveProjectIndexModel([other], selection)).toThrow();
  expect(() =>
    resolveProjectIndexModel([provider], { ...selection, model: "missing-model" }),
  ).toThrow();
  expect(() =>
    resolveProjectIndexModel(
      [{ ...provider, models: [{ ...provider.models[0]!, capabilities: null }] }],
      selection,
    ),
  ).toThrow("context capacity");
  expect(() =>
    resolveProjectIndexModel([provider], {
      ...selection,
      options: [{ id: "contextWindow", value: "2m" }],
    }),
  ).toThrow("exceeds");
  const worker = projectIndexWorkerSelection(
    provider,
    { ...selection, options: [{ id: "reasoningEffort", value: "high" }] },
    1_000_000,
  );
  expect(worker).toEqual({
    ...selection,
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "contextWindow", value: "1000000" },
    ],
  });
});

it.effect("preserves synchronous startup output and source larger than the composer limit", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({
      earlyEvents: [textEvent('{"early":')],
      events: [textEvent("true}"), completion],
    });
    const prompt = "source evidence\n"
      .repeat(Math.ceil(PROVIDER_SEND_TURN_MAX_INPUT_CHARS / 10))
      .trimEnd();
    const result = yield* harness.generate({ ...input, prompt });
    expect(result).toEqual({ text: '{"early":true}' });
    expect(result).not.toHaveProperty("inputTokens");
    expect(result).not.toHaveProperty("outputTokens");
    expect(harness.sent[0]!.transcriptHandoff?.text).toBe(prompt);
    expect(harness.sent[0]!.input!.length).toBeLessThan(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    expect(harness.started[0]![1]).toMatchObject({
      providerInstanceId: selection.instanceId,
      purpose: "fetch-worker",
      sandboxMode: "read-only",
      projectMemoryMode: "off",
      freshSession: true,
    });
    expect(harness.started[0]![2]).toEqual({ mcpMode: "none" });
    expect(harness.stopped).toHaveLength(1);
    expect(harness.interrupted).toHaveLength(0);
  }),
);

const forbiddenEvents: ReadonlyArray<TestEvent> = [
  {
    type: "request.opened",
    requestId: "synthetic-approval",
    payload: { requestType: "command_execution_approval" },
  },
  {
    type: "files.persisted",
    payload: { files: [{ filename: "src/changed.ts", fileId: "synthetic-file" }] },
  },
  {
    type: "subagent.discovered",
    payload: { subagentId: "synthetic-child", providerThreadId: "synthetic-provider-child" },
  },
  { type: "user-input.requested", payload: { questions: [] } },
  ...[
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "dynamic_tool_call",
    "collab_agent_tool_call",
    "web_search",
    "image_view",
    "context_compaction",
  ].map((itemType): TestEvent => ({ type: "item.started", payload: { itemType } })),
  {
    type: "model.rerouted",
    payload: { fromModel: selection.model, toModel: "another-model", reason: "Synthetic reroute" },
  },
  { type: "turn.started", payload: { model: "another-model" } },
];

for (const [index, event] of forbiddenEvents.entries()) {
  it.effect(
    `rejects forbidden review event ${index + 1}: ${event.type} ${JSON.stringify(event.payload)}`,
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          events: [event, textEvent('{"ok":true}'), completion],
        });
        const outcome = yield* harness.generate(input).pipe(Effect.exit);
        expect(Exit.isFailure(outcome)).toBe(true);
        expect(harness.stopped).toHaveLength(1);
        if (event.type === "request.opened") expect(harness.responses[0]?.decision).toBe("decline");
      }),
  );
}

it.effect("cancels only its exact generation and ignores late events from that generation", () =>
  Effect.gen(function* () {
    const sent = yield* Deferred.make<ProviderTransientSessionTarget>();
    let sendCount = 0;
    const harness = yield* makeHarness({
      onSend: (target, publish) =>
        Effect.gen(function* () {
          sendCount += 1;
          if (sendCount === 1) yield* Deferred.succeed(sent, target);
          else {
            const old = yield* Deferred.await(sent);
            yield* publish(old, textEvent("wrong generation"));
            yield* publish(old, completion);
            yield* publish(target, textEvent('{"generation":2}'));
            yield* publish(target, completion);
          }
        }),
    });
    const first = yield* harness.generate(input).pipe(Effect.forkScoped);
    const target = yield* Deferred.await(sent);
    yield* Fiber.interrupt(first);
    expect(harness.interrupted).toHaveLength(1);
    expect(harness.interrupted[0]).toMatchObject(target);
    expect(harness.stopped).toEqual([target]);
    expect((yield* harness.generate(input)).text).toBe('{"generation":2}');
    expect(harness.started[0]![1].runtimeSessionId).not.toBe(
      harness.started[1]![1].runtimeSessionId,
    );
  }),
);

it.effect("falls back to generation-fenced force cleanup when graceful cleanup fails", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness({ stopFails: true });
    yield* harness.generate(input);
    expect(harness.forced).toEqual([
      { ...harness.stopped[0], turnId: TurnId.make("synthetic-turn") },
    ]);
  }),
);
