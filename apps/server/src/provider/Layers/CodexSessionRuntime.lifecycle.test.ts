import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId, type ProviderEvent } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
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
    }),
  ),
);

const makeRuntime = Effect.fn("makeCodexLifecycleTestRuntime")(function* (scenario: {
  holdTurnOpen?: boolean;
  failTransportOnRead?: boolean;
  replyAfterTurnCompleted?: boolean;
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
  return yield* makeCodexSessionRuntime({
    threadId: ThreadId.make("codex-lifecycle"),
    binaryPath: peerPath,
    cwd: directory,
    runtimeMode: "full-access",
    environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scenarioPath },
  });
});

describe("Codex session lifecycle", () => {
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
