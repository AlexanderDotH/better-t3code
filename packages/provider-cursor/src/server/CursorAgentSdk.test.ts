import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderSessionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import { vi } from "vite-plus/test";

import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as CursorAgentSdk from "./CursorAgentSdk.ts";
import * as CursorSdk from "./CursorSdk.ts";

const cursorSdkMock = vi.hoisted(() => {
  const closeExecutionOrder: Array<string> = [];
  const runOperations: Array<string> = [];
  let agentCloseFailure: unknown;
  let staleRunActive = false;
  const runWait = vi.fn(async () => ({
    id: "run-cursor-agent-sdk-test",
    requestId: "request-cursor-agent-sdk-test",
    status: "finished",
    result: "ok",
    model: { id: "default" },
    durationMs: 1,
  }));
  const runCancel = vi.fn(async () => {});
  const summaryWait = vi.fn(async () => ({
    id: "run-cursor-summary-test",
    requestId: "request-cursor-summary-test",
    status: "finished",
    result: "Summary of the conversation so far",
    model: { id: "default" },
    durationMs: 1,
  }));
  const summaryCancel = vi.fn(async () => {});
  const summarize = vi.fn(async () => ({
    id: "run-cursor-summary-test",
    agentId: "agent-cursor-agent-sdk-test",
    wait: summaryWait,
    cancel: summaryCancel,
  }));
  const agentClose = vi.fn(() => {
    closeExecutionOrder.push("sdk:agent.close");
    if (agentCloseFailure !== undefined) {
      throw agentCloseFailure;
    }
  });
  const send = vi.fn(
    async (
      _message: unknown,
      options: { readonly onDelta?: (input: { readonly update: unknown }) => Promise<void> },
    ) => {
      runOperations.push("run.start");
      if (staleRunActive) {
        throw new Error("Agent agent-cursor-agent-sdk-test already has active run");
      }
      await options.onDelta?.({
        update: {
          type: "assistant-message-chunk",
          text: "hello",
        },
      });
      return {
        id: "run-cursor-agent-sdk-test",
        agentId: "agent-cursor-agent-sdk-test",
        wait: runWait,
        cancel: runCancel,
      };
    },
  );
  const create = vi.fn(async () => ({
    agentId: "agent-cursor-agent-sdk-test",
    send,
    summarize,
    close: agentClose,
  }));
  const resume = vi.fn(async () => ({
    agentId: "agent-cursor-agent-sdk-test",
    send,
    summarize,
    close: agentClose,
  }));
  const listRuns = vi.fn(async () => {
    runOperations.push("agent.listRuns");
    return {
      items: staleRunActive ? [{ id: "run-stale", status: "running" }] : [],
    };
  });
  const cancelRun = vi.fn(async () => {
    runOperations.push("agent.cancelRun");
    staleRunActive = false;
  });

  return {
    agentClose,
    cancelRun,
    closeExecutionOrder,
    create,
    listRuns,
    resume,
    runOperations,
    runCancel,
    runWait,
    send,
    summarize,
    summaryWait,
    summaryCancel,
    setAgentCloseFailure: (failure: unknown) => {
      agentCloseFailure = failure;
    },
    setStaleRunActive: (active: boolean) => {
      staleRunActive = active;
    },
  };
});

vi.mock("./sdk.ts", () => ({
  loadCursorSdk: () => ({
    Agent: {
      create: cursorSdkMock.create,
      resume: cursorSdkMock.resume,
      listRuns: cursorSdkMock.listRuns,
      cancelRun: cursorSdkMock.cancelRun,
      messages: {
        list: vi.fn(async () => []),
      },
    },
    createAgentPlatform: vi.fn(),
  }),
  loadCursorSqlite: () => ({ SqliteLocalAgentStore: { open: vi.fn() } }),
}));

const layerTest = CursorAgentSdk.layer.pipe(
  Layer.provide(
    Layer.succeed(ProviderEventLoggers.ProviderEventLoggers, {
      native: {
        filePath: "cursor-agent-sdk-test.log",
        write: (event: unknown) =>
          Effect.sync(() => {
            if (
              typeof event === "object" &&
              event !== null &&
              Reflect.get(Reflect.get(event, "event"), "payload")?.type === "agent.close"
            ) {
              cursorSdkMock.closeExecutionOrder.push("protocol:agent.close");
            }
          }),
        close: () => Effect.void,
      },
      canonical: undefined,
    }),
  ),
  Layer.provide(CursorSdk.layer),
  Layer.provide(NodeServices.layer),
);

const openSummarySession = Effect.fnUntraced(function* () {
  const runner = yield* CursorAgentSdk.CursorAgentSdkRunner;
  return yield* runner.open({
    operation: "create",
    options: { model: { id: "default" }, mode: "agent" },
    threadId: ThreadId.make("cursor-summary-thread"),
    providerSessionId: ProviderSessionId.make("cursor-summary-session"),
  });
});

describe("CursorAgentSdkRunner", () => {
  it.effect("delegates compaction to summarize without sending a prompt or send-time options", () =>
    Effect.gen(function* () {
      cursorSdkMock.send.mockClear();
      cursorSdkMock.summarize.mockClear();
      const session = yield* openSummarySession();
      const run = yield* session.send({
        message: "/compress",
        summarize: true,
        options: { mode: "plan", model: { id: "ignored-for-summary" } },
      });
      assert.deepStrictEqual(cursorSdkMock.summarize.mock.calls, [[]]);
      assert.strictEqual(cursorSdkMock.send.mock.calls.length, 0);
      assert.strictEqual(run.runId, "run-cursor-summary-test");
      assert.strictEqual((yield* run.wait).result, "Summary of the conversation so far");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("cancels the summarization run through its native SDK handle", () =>
    Effect.gen(function* () {
      cursorSdkMock.summaryCancel.mockClear();
      cursorSdkMock.runCancel.mockClear();
      const session = yield* openSummarySession();
      const run = yield* session.send({ message: "/compress", summarize: true });
      yield* run.cancel;
      assert.strictEqual(cursorSdkMock.summaryCancel.mock.calls.length, 1);
      assert.strictEqual(cursorSdkMock.runCancel.mock.calls.length, 0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect.each(["start", "wait"] as const)(
    "surfaces a summarization %s failure through the existing SDK error boundary",
    (stage) =>
      Effect.gen(function* () {
        const failure = new Error(`Summarization ${stage} failed`);
        const session = yield* openSummarySession();
        if (stage === "start") cursorSdkMock.summarize.mockRejectedValueOnce(failure);
        else cursorSdkMock.summaryWait.mockRejectedValueOnce(failure);
        const operation = Effect.gen(function* () {
          const run = yield* session.send({ message: "/compress", summarize: true });
          return yield* run.wait;
        });
        const error = yield* operation.pipe(Effect.flip);
        assert.instanceOf(error, CursorAgentSdk.CursorAgentSdkRunnerError);
        assert.strictEqual(error.method, `run.${stage}`);
        assert.strictEqual(error.cause, failure);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("constructs without loading and reports first-use load failures as runner errors", () =>
    Effect.gen(function* () {
      const failure = new Error("missing SDK chunk");
      const load = vi.fn(() => {
        throw failure;
      });
      const runner = yield* CursorAgentSdk.makeCursorAgentSdkRunner(() => undefined).pipe(
        Effect.provideService(CursorSdk.CursorSdk, {
          load,
          loadSqlite: () => {
            throw new Error("unused SQLite");
          },
        }),
      );
      assert.strictEqual(load.mock.calls.length, 0);
      const result = yield* runner
        .open({
          operation: "create",
          options: {},
          threadId: ThreadId.make("lazy-load"),
          providerSessionId: ProviderSessionId.make("lazy-load"),
        })
        .pipe(Effect.exit);
      assert(Exit.isFailure(result));
      assert.deepStrictEqual(
        Cause.squash(result.cause),
        new CursorAgentSdk.CursorAgentSdkRunnerError({
          method: "agent.create",
          cause: failure,
        }),
      );
      assert.strictEqual(load.mock.calls.length, 1);
    }),
  );

  it.effect("retries a resumed send after cancelling its abandoned local run", () =>
    Effect.gen(function* () {
      cursorSdkMock.runOperations.length = 0;
      cursorSdkMock.listRuns.mockClear();
      cursorSdkMock.cancelRun.mockClear();
      cursorSdkMock.setStaleRunActive(true);

      const runner = yield* CursorAgentSdk.CursorAgentSdkRunner;
      const session = yield* runner.open({
        operation: "resume",
        agentId: "agent-cursor-agent-sdk-test",
        options: { model: { id: "default" }, mode: "agent", local: { cwd: process.cwd() } },
        threadId: ThreadId.make("thread-cursor-agent-sdk-stale-run-test"),
        providerSessionId: ProviderSessionId.make(
          "provider-session-cursor-agent-sdk-stale-run-test",
        ),
      });
      assert.deepStrictEqual(cursorSdkMock.runOperations, []);
      const run = yield* session.send({ message: "continue" });
      yield* run.wait;

      assert.deepStrictEqual(cursorSdkMock.runOperations, [
        "run.start",
        "agent.listRuns",
        "agent.cancelRun",
        "run.start",
      ]);
      assert.deepStrictEqual(cursorSdkMock.listRuns.mock.calls[0], [
        "agent-cursor-agent-sdk-test",
        { runtime: "local", cwd: process.cwd(), limit: 1 },
      ]);
      assert.deepStrictEqual(cursorSdkMock.cancelRun.mock.calls[0], [
        "run-stale",
        {
          runtime: "local",
          cwd: process.cwd(),
        },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );
});
