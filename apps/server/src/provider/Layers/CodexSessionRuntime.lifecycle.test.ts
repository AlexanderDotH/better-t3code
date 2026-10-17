import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId, type ProviderEvent } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as EffectCodexSchema from "effect-codex-app-server/schema";
import wireFixture from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";

const encodeScenario = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      rootThreadId: Schema.String,
      notifications: Schema.Array(Schema.Unknown),
      holdTurnOpen: Schema.optionalKey(Schema.Boolean),
      failTransportOnRead: Schema.optionalKey(Schema.Boolean),
      replyAfterTurnCompleted: Schema.optionalKey(Schema.Boolean),
      holdCompaction: Schema.optionalKey(Schema.Boolean),
      failCompaction: Schema.optionalKey(Schema.Boolean),
      legacyCompaction: Schema.optionalKey(Schema.Boolean),
      failInterruptFor: Schema.optionalKey(Schema.String),
      compactBeforeFirstTurn: Schema.optionalKey(Schema.Boolean),
      compactOnFirstInput: Schema.optionalKey(Schema.Boolean),
      completeCompactionBeforeRejection: Schema.optionalKey(Schema.Boolean),
      recordTurnRequests: Schema.optionalKey(Schema.Boolean),
      turnStartError: Schema.optionalKey(Schema.String),
      contextFullOnFirstTurn: Schema.optionalKey(
        Schema.Literals(["notification", "request", "usage"]),
      ),
      turnIds: Schema.Array(Schema.String),
    }),
  ),
);

const decodeTurnRequests = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.fromJsonString(
      EffectCodexSchema.V2TurnStartParams.pipe(
        Schema.fieldsAssign({
          collaborationMode: Schema.optionalKey(
            EffectCodexSchema.V2TurnStartParams__CollaborationMode,
          ),
          additionalContext: Schema.optionalKey(
            Schema.Record(
              Schema.String,
              EffectCodexSchema.V2TurnStartParams__AdditionalContextEntry,
            ),
          ),
        }),
      ),
    ),
  ),
);

const makeRuntime = Effect.fn("makeCodexLifecycleTestRuntime")(function* (scenario: {
  holdTurnOpen?: boolean;
  failTransportOnRead?: boolean;
  replyAfterTurnCompleted?: boolean;
  holdCompaction?: boolean;
  failCompaction?: boolean;
  legacyCompaction?: boolean;
  failInterruptFor?: string;
  compactBeforeFirstTurn?: boolean;
  compactOnFirstInput?: boolean;
  completeCompactionBeforeRejection?: boolean;
  recordTurnRequests?: boolean;
  turnStartError?: string;
  contextFullOnFirstTurn?: "notification" | "request" | "usage";
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-lifecycle-" });
  const scenarioPath = path.join(directory, "scenario.json");
  yield* fs.writeFileString(
    scenarioPath,
    encodeScenario({
      rootThreadId: wireFixture.rootThreadId,
      notifications: [],
      turnIds: ["context-turn-1", "context-turn-2", "context-turn-3"],
      ...scenario,
    }),
  );
  const peerPath = path.join(
    import.meta.dirname,
    "../testFixtures",
    HostProcessPlatform.defaultValue() === "win32"
      ? "codexCollabMockPeer.cmd"
      : "codexCollabMockPeer.sh",
  );
  const runtime = yield* makeCodexSessionRuntime({
    threadId: ThreadId.make(path.basename(directory)),
    binaryPath: peerPath,
    cwd: directory,
    runtimeMode: "full-access",
    environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scenarioPath },
  });
  const readTurnRequests = fs
    .readFileString(`${scenarioPath}.turnRequests`)
    .pipe(Effect.flatMap((text) => decodeTurnRequests(text.trim().split("\n"))));
  return { ...runtime, readTurnRequests };
});

const observeContextEvents = Effect.fnUntraced(function* (
  runtime: Effect.Success<ReturnType<typeof makeRuntime>>,
) {
  const compacting = yield* Deferred.make<void>();
  const firstCompleted = yield* Deferred.make<void>();
  const secondCompleted = yield* Deferred.make<void>();
  const requestResolved = yield* Deferred.make<void>();
  const events: ProviderEvent[] = [];
  yield* runtime.events.pipe(
    Stream.runForEach((event) => {
      events.push(event);
      if (event.method === "item/started") return Deferred.succeed(compacting, undefined);
      if (event.method === "serverRequest/resolved")
        return Deferred.succeed(requestResolved, undefined);
      if (event.method === "turn/completed" && event.turnId === "context-turn-1")
        return Deferred.succeed(firstCompleted, undefined);
      if (event.method === "turn/completed" && event.turnId === "context-turn-2")
        return Deferred.succeed(secondCompleted, undefined);
      return Effect.void;
    }),
    Effect.forkScoped({ startImmediately: true }),
  );
  return { compacting, firstCompleted, secondCompleted, requestResolved, events };
});

describe("Codex session lifecycle", () => {
  for (const legacyCompaction of [false, true]) {
    it.effect(
      `keeps manual compaction in the background until ${legacyCompaction ? "legacy" : "item/turn"} completion`,
      () =>
        Effect.gen(function* () {
          const runtime = yield* makeRuntime({ holdCompaction: true, legacyCompaction });
          const observed = yield* observeContextEvents(runtime);
          yield* runtime.start();
          const compact = yield* runtime.compactThread.pipe(
            Effect.forkChild({ startImmediately: true }),
          );
          yield* Deferred.await(observed.compacting);
          assert.equal((yield* runtime.getSession).status, "ready");
          assert.isUndefined((yield* runtime.getSession).activeTurnId);
          yield* runtime.interruptTurn();
          const next = yield* runtime
            .sendTurn({ input: "send after compaction" })
            .pipe(Effect.forkChild({ startImmediately: true }));
          assert.isUndefined(compact.pollUnsafe());
          assert.isUndefined(next.pollUnsafe());
          yield* runtime.readThread;
          yield* Fiber.join(compact);
          yield* Fiber.join(next);
          yield* Deferred.await(observed.firstCompleted);
          assert.equal(
            observed.events.filter((event) => event.method === "turn/started").length,
            1,
          );
          assert.isFalse(observed.events.some((event) => event.method === "error"));
          yield* runtime.close;
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("detaches a stopped turn while its automatic compaction finishes", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({ compactBeforeFirstTurn: true });
      const observed = yield* observeContextEvents(runtime);
      yield* runtime.start();
      const first = yield* runtime.sendTurn({ input: "first" });
      yield* Deferred.await(observed.compacting);
      yield* runtime.interruptTurn(first.turnId);
      yield* runtime.interruptTurn(first.turnId);
      assert.equal((yield* runtime.getSession).status, "ready");
      assert.isUndefined((yield* runtime.getSession).activeTurnId);
      const next = yield* runtime
        .sendTurn({ input: "second" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      assert.isUndefined(next.pollUnsafe());
      yield* runtime.readThread;
      yield* Fiber.join(next);
      yield* Deferred.await(observed.secondCompleted);
      assert.equal(observed.events.filter((event) => event.method === "turn/aborted").length, 1);
      assert.isFalse(observed.events.some((event) => event.method === "error"));
      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("resumes once after Stop and compaction while another thread keeps working", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({
        compactBeforeFirstTurn: true,
        recordTurnRequests: true,
      });
      const other = yield* makeRuntime({ recordTurnRequests: true });
      const observed = yield* observeContextEvents(runtime);
      const otherObserved = yield* observeContextEvents(other);
      yield* runtime.start();
      yield* other.start();
      const first = yield* runtime.sendTurn({ input: "existing turn" });
      yield* Deferred.await(observed.compacting);
      yield* runtime.interruptTurn(first.turnId);
      yield* runtime.interruptTurn(first.turnId);
      assert.equal((yield* runtime.getSession).status, "ready");
      assert.isUndefined((yield* runtime.getSession).activeTurnId);
      const next = yield* runtime
        .sendTurn({ input: "accepted next message" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* other.sendTurn({ input: "independent thread" });
      yield* Deferred.await(otherObserved.firstCompleted);
      assert.isUndefined(next.pollUnsafe());
      assert.equal((yield* runtime.readTurnRequests).length, 1);
      yield* runtime.readThread;
      yield* Fiber.join(next);
      yield* Deferred.await(observed.secondCompleted);
      const requests = yield* runtime.readTurnRequests;
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[1]?.input, [{ type: "text", text: "accepted next message" }]);
      assert.equal(observed.events.filter((event) => event.method === "turn/aborted").length, 1);
      assert.equal(observed.events.filter((event) => event.method === "turn/started").length, 2);
      assert.isFalse(observed.events.some((event) => event.method === "error"));
      assert.equal((yield* runtime.getSession).status, "ready");
      yield* other.close;
      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  for (const stopped of [false, true]) {
    it.effect(
      `rejects waiting input when ${stopped ? "stopped automatic" : "manual"} compaction fails`,
      () =>
        Effect.gen(function* () {
          const runtime = yield* makeRuntime({
            failCompaction: true,
            ...(stopped ? { compactBeforeFirstTurn: true } : { holdCompaction: true }),
          });
          const observed = yield* observeContextEvents(runtime);
          yield* runtime.start();
          const compact = stopped
            ? undefined
            : yield* runtime.compactThread.pipe(
                Effect.exit,
                Effect.forkChild({ startImmediately: true }),
              );
          if (stopped) yield* runtime.sendTurn({ input: "existing turn" });
          yield* Deferred.await(observed.compacting);
          if (stopped) yield* runtime.interruptTurn();
          const sending = yield* runtime
            .sendTurn({ input: "waiting input" })
            .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }));
          yield* runtime.readThread;
          const result = yield* Fiber.join(sending);
          assert.isTrue(Exit.isFailure(result));
          if (Exit.isFailure(result))
            assert.match(Cause.pretty(result.cause), /Compaction fixture failed/);
          if (compact) assert.isTrue(Exit.isFailure(yield* Fiber.join(compact)));
          assert.equal(
            observed.events.filter((event) => event.method === "turn/started").length,
            stopped ? 1 : 0,
          );
          yield* runtime.close;
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("releases waiting input when the detached turn interrupt fails", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({
        compactBeforeFirstTurn: true,
        failInterruptFor: wireFixture.rootThreadId,
      });
      const observed = yield* observeContextEvents(runtime);
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "existing turn" });
      yield* Deferred.await(observed.compacting);
      yield* runtime.interruptTurn();
      const sending = yield* runtime
        .sendTurn({ input: "waiting input" })
        .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }));
      yield* runtime.readThread;
      yield* Deferred.await(observed.requestResolved);
      assert.equal(sending.pollUnsafe()?._tag, "Success");
      const result = yield* Fiber.join(sending);
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) assert.match(Cause.pretty(result.cause), /thread already closed/);
      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  for (const reason of ["notification", "usage"] as const) {
    it.effect(`compacts before the next message after context exhaustion (${reason})`, () =>
      Effect.gen(function* () {
        const runtime = yield* makeRuntime({ contextFullOnFirstTurn: reason });
        const observed = yield* observeContextEvents(runtime);
        yield* runtime.start();
        yield* runtime.sendTurn({ input: "fill context" });
        yield* Deferred.await(observed.firstCompleted);
        assert.equal((yield* runtime.getSession).status, "ready");
        assert.isUndefined((yield* runtime.getSession).lastError);
        assert.isFalse(observed.events.some((event) => event.method === "item/started"));
        yield* runtime.sendTurn({ input: "continue" });
        yield* Deferred.await(observed.secondCompleted);
        assert.isTrue(observed.events.some((event) => event.method === "item/started"));
        assert.isFalse(observed.events.some((event) => event.method === "error"));
        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  for (const completeCompactionBeforeRejection of [false, true]) {
    it.effect(
      `retries a Compact conflict with completion ${completeCompactionBeforeRejection ? "before" : "after"} rejection`,
      () =>
        Effect.gen(function* () {
          const runtime = yield* makeRuntime({
            compactOnFirstInput: true,
            completeCompactionBeforeRejection,
            recordTurnRequests: true,
          });
          const observed = yield* observeContextEvents(runtime);
          yield* runtime.start();
          const sending = yield* runtime
            .sendTurn({ input: "continue" })
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* Deferred.await(observed.compacting);
          if (!completeCompactionBeforeRejection) {
            assert.isUndefined(sending.pollUnsafe());
            yield* runtime.readThread;
          }
          yield* Fiber.join(sending);
          const requests = yield* runtime.readTurnRequests;
          assert.equal(requests.length, 2);
          assert.deepEqual(requests[1], requests[0]);
          yield* Deferred.await(observed.firstCompleted);
          assert.isFalse(observed.events.some((event) => event.method === "error"));
          yield* runtime.close;
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("compacts and retries an input rejected for a full context", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({
        contextFullOnFirstTurn: "request",
        recordTurnRequests: true,
      });
      const observed = yield* observeContextEvents(runtime);
      yield* runtime.start();
      yield* runtime.sendTurn({
        input: "continue",
        attachments: [{ type: "localImage", path: "/tmp/context-fixture.png" }],
        model: "gpt-6.1-sol",
        effort: "high",
        serviceTier: "priority",
        interactionMode: "plan",
      });
      yield* Deferred.await(observed.firstCompleted);
      const requests = yield* runtime.readTurnRequests;
      assert.equal(requests.length, 2);
      assert.deepEqual(requests[1], requests[0]);
      assert.equal(requests[0]?.model, "gpt-6.1-sol");
      assert.equal(requests[0]?.effort, "high");
      assert.equal(requests[0]?.serviceTier, "priority");
      assert.equal(requests[0]?.collaborationMode?.mode, "plan");
      assert.deepEqual(requests[0]?.input, [
        { type: "text", text: "continue" },
        { type: "localImage", path: "/tmp/context-fixture.png" },
      ]);
      assert.isTrue(Object.keys(requests[0]?.additionalContext ?? {}).length > 0);
      assert.isTrue(observed.events.some((event) => event.method === "item/started"));
      assert.isFalse(observed.events.some((event) => event.method === "error"));
      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  for (const turnStartError of [
    "Your input exceeds the context window of this model.",
    "Authentication failed.",
  ]) {
    it.effect(`bounds retries and preserves a real rejection: ${turnStartError}`, () =>
      Effect.gen(function* () {
        const runtime = yield* makeRuntime({ turnStartError, recordTurnRequests: true });
        const observed = yield* observeContextEvents(runtime);
        yield* runtime.start();
        const error = yield* Effect.flip(runtime.sendTurn({ input: "retain this input" }));
        assert.include(error.message, turnStartError);
        const requests = yield* runtime.readTurnRequests;
        const contextFull = turnStartError.startsWith("Your input");
        assert.equal(requests.length, contextFull ? 2 : 1);
        if (contextFull) assert.deepEqual(requests[1], requests[0]);
        assert.equal(
          observed.events.filter((event) => event.method === "item/started").length,
          contextFull ? 1 : 0,
        );
        assert.isFalse(observed.events.some((event) => event.method === "turn/started"));
        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  for (const termination of ["close", "transport failure"] as const) {
    it.effect(`releases messages waiting for compaction on ${termination}`, () =>
      Effect.gen(function* () {
        const runtime = yield* makeRuntime({
          holdCompaction: true,
          failTransportOnRead: termination === "transport failure",
        });
        const observed = yield* observeContextEvents(runtime);
        yield* runtime.start();
        const compact = yield* runtime.compactThread.pipe(
          Effect.exit,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Deferred.await(observed.compacting);
        const next = yield* runtime
          .sendTurn({ input: "pending" })
          .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }));
        if (termination === "close") yield* runtime.close;
        else {
          assert.isTrue(Exit.isFailure(yield* Effect.exit(runtime.readThread)));
        }
        assert.isTrue(Exit.isFailure(yield* Fiber.join(compact)));
        assert.isTrue(Exit.isFailure(yield* Fiber.join(next)));
        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }

  it.effect("settles a running session when its protocol breaks but the process stays alive", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({ holdTurnOpen: true, failTransportOnRead: true });
      const started = yield* Deferred.make<ProviderEvent>();
      const failed = yield* Deferred.make<ProviderEvent>();
      yield* runtime.events.pipe(
        Stream.runForEach((event) => {
          if (event.method === "turn/started")
            return Deferred.succeed(started, event).pipe(Effect.asVoid);
          if (event.method === "session/error")
            return Deferred.succeed(failed, event).pipe(Effect.asVoid);
          return Effect.void;
        }),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* runtime.start();
      const turn = yield* runtime.sendTurn({ input: "keep working" });
      yield* Deferred.await(started);
      assert.equal((yield* runtime.getSession).status, "running");

      const read = yield* Effect.exit(runtime.readThread);
      assert.isTrue(Exit.isFailure(read));
      const failure = yield* Deferred.await(failed);
      assert.equal(failure.turnId, turn.turnId);
      const session = yield* runtime.getSession;
      assert.equal(session.status, "error");
      assert.isUndefined(session.activeTurnId);
      assert.isString(session.lastError);
      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not restore Working when a turn finishes before its start response arrives", () =>
    Effect.gen(function* () {
      const runtime = yield* makeRuntime({ replyAfterTurnCompleted: true });
      yield* runtime.start();
      yield* runtime.sendTurn({ input: "finish immediately" });
      const session = yield* runtime.getSession;
      assert.equal(session.status, "ready");
      assert.isUndefined(session.activeTurnId);
      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
