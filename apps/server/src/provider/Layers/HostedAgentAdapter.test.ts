import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import { makeCursorSdkAdapter } from "./CursorSdkAdapter.ts";
import { makeGeminiAdapter } from "./GeminiAdapter.ts";
import {
  makeHostedAgentAdapter,
  type HostedAgentDelta,
  type HostedAgentRuntime,
} from "./HostedAgentAdapter.ts";
import { makeHyperagentAdapter } from "./HyperagentAdapter.ts";

const PROVIDER = ProviderDriverKind.make("syntheticHosted");
const INSTANCE_ID = ProviderInstanceId.make("syntheticHostedMain");
const FORCE_STOP_RUNTIME_SESSION_ID = RuntimeSessionId.make("hosted-force-stop-runtime");
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

function startRunningSession(runtime: HostedAgentRuntime, threadId: ThreadId) {
  return Effect.gen(function* () {
    const adapter = yield* makeHostedAgentAdapter(runtime);
    yield* adapter.startSession({
      provider: PROVIDER,
      providerInstanceId: INSTANCE_ID,
      threadId,
      runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId, input: "keep working" });
    return adapter;
  });
}

it.effect("stamps every hosted runtime event with the originating runtime session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threadId = asThreadId("thread-hosted-runtime-origin");
      const adapter = yield* makeHostedAgentAdapter({
        provider: PROVIDER,
        instanceId: INSTANCE_ID,
        runTurn: async () => ({ text: "done" }),
      });
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.take(4),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "finish" });

      const events = Array.from(yield* Fiber.join(eventsFiber).pipe(Effect.timeout("1 second")));
      NodeAssert.deepEqual(
        events.map((event) => event.type),
        ["session.started", "turn.started", "item.completed", "turn.completed"],
      );
      NodeAssert.equal(
        events.every((event) => event.runtimeSessionId === FORCE_STOP_RUNTIME_SESSION_ID),
        true,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("force-stops a hosted request locally when no remote cancellation exists", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threadId = asThreadId("thread-hosted-force-local");
      let activeSignal: AbortSignal | undefined;
      let emitLateDelta: ((delta: HostedAgentDelta) => void) | undefined;
      let observedContentDeltas = 0;
      let notifyStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const adapter = yield* startRunningSession(
        {
          provider: PROVIDER,
          instanceId: INSTANCE_ID,
          runTurn: (input) => {
            activeSignal = input.signal;
            emitLateDelta = input.emit;
            notifyStarted?.();
            return new Promise(() => {});
          },
        },
        threadId,
      );
      yield* Effect.promise(() => started);
      const lateEventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "content.delta"),
        Stream.runForEach(() =>
          Effect.sync(() => {
            observedContentDeltas += 1;
          }),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      const result = yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID);

      NodeAssert.deepEqual(result, {
        outcome: "detached",
        mechanism: "local-detach",
        detail:
          "The local hosted-agent request was aborted and detached, but this provider does not expose a verifiable remote hard-stop API.",
      });
      NodeAssert.equal(activeSignal?.aborted, true);
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
      emitLateDelta?.({ kind: "text", text: "late provider output" });
      yield* Effect.yieldNow;
      NodeAssert.equal(observedContentDeltas, 0);
      yield* Fiber.interrupt(lateEventsFiber);
      NodeAssert.deepEqual(
        yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID),
        {
          outcome: "terminated",
          mechanism: "already-stopped",
        },
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("uses a hosted provider's remote force-stop primitive after aborting local work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threadId = asThreadId("thread-hosted-force-remote");
      let activeSignal: AbortSignal | undefined;
      let signalWasAbortedBeforeRemoteStop = false;
      let notifyStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const adapter = yield* startRunningSession(
        {
          provider: PROVIDER,
          instanceId: INSTANCE_ID,
          runTurn: (input) => {
            activeSignal = input.signal;
            notifyStarted?.();
            return new Promise(() => {});
          },
          forceStopSession: async () => {
            signalWasAbortedBeforeRemoteStop = activeSignal?.aborted === true;
            return {
              outcome: "terminated",
              mechanism: "runtime-close",
            };
          },
        },
        threadId,
      );
      yield* Effect.promise(() => started);

      const result = yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID);

      NodeAssert.deepEqual(result, {
        outcome: "terminated",
        mechanism: "runtime-close",
      });
      NodeAssert.equal(signalWasAbortedBeforeRemoteStop, true);
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("reports that remote work may continue when hosted force-stop is not confirmed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threadId = asThreadId("thread-hosted-force-remote-failed");
      const adapter = yield* makeHostedAgentAdapter({
        provider: PROVIDER,
        instanceId: INSTANCE_ID,
        runTurn: async () => ({ text: "" }),
        forceStopSession: async () => {
          throw new Error("remote cancellation failed");
        },
      });
      yield* adapter.startSession({
        provider: PROVIDER,
        providerInstanceId: INSTANCE_ID,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      NodeAssert.deepEqual(
        yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID),
        {
          outcome: "detached",
          mechanism: "local-detach",
          detail:
            "The local hosted-agent request was aborted and detached. The provider's remote hard-stop request failed or was not confirmed within 1 second, so remote execution may continue.",
        },
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("reports an uninitialized Cursor SDK runtime as already stopped", () => {
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-cursor-sdk-force-stop-",
  }).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.scoped(
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("cursorSdkForceStop");
      const threadId = asThreadId("thread-cursor-sdk-force-stop");
      const adapter = yield* makeCursorSdkAdapter(
        {
          enabled: true,
          apiKey: "",
          apiEndpoint: "",
          manualModelIds: [],
          customModels: [],
        },
        { instanceId },
      );
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("cursorSdk"),
        providerInstanceId: instanceId,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      NodeAssert.deepEqual(
        yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID),
        {
          outcome: "terminated",
          mechanism: "already-stopped",
        },
      );
      NodeAssert.equal(yield* adapter.hasSession(threadId), false);
    }).pipe(Effect.provide(testLayer)),
  );
});

it.effect("detaches Gemini HTTP sessions because Gemini has no hard-stop endpoint", () => {
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-gemini-force-stop-",
  }).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.scoped(
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("geminiForceStop");
      const threadId = asThreadId("thread-gemini-force-stop");
      const adapter = yield* makeGeminiAdapter(
        {
          enabled: true,
          apiKey: "",
          customModels: [],
        },
        {},
        { instanceId },
      );
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("gemini"),
        providerInstanceId: instanceId,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      const result = yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID);

      NodeAssert.equal(result.outcome, "detached");
      NodeAssert.equal(result.mechanism, "local-detach");
      NodeAssert.match(result.detail, /does not expose a verifiable remote hard-stop API/);
    }).pipe(Effect.provide(testLayer)),
  );
});

it.effect("detaches Hyperagent sessions because Hyperagent has no remote cancellation API", () => {
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-hyperagent-force-stop-",
  }).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.scoped(
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("hyperagentForceStop");
      const threadId = asThreadId("thread-hyperagent-force-stop");
      const adapter = yield* makeHyperagentAdapter(
        {
          enabled: true,
          sessionCookie: "",
          baseUrl: "https://hyperagent.com",
          model: "sonnet-latest",
          fastMode: false,
          customModels: [],
        },
        { instanceId },
      );
      yield* adapter.startSession({
        provider: ProviderDriverKind.make("hyperagent"),
        providerInstanceId: instanceId,
        threadId,
        runtimeSessionId: FORCE_STOP_RUNTIME_SESSION_ID,
        runtimeMode: "full-access",
      });

      const result = yield* adapter.forceStopSession(threadId, FORCE_STOP_RUNTIME_SESSION_ID);

      NodeAssert.equal(result.outcome, "detached");
      NodeAssert.equal(result.mechanism, "local-detach");
      NodeAssert.match(result.detail, /does not expose a verifiable remote hard-stop API/);
    }).pipe(Effect.provide(testLayer)),
  );
});
