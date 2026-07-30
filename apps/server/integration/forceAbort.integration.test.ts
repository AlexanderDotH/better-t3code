// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const PROVIDER = ProviderDriverKind.make("codex");
const PROVIDER_INSTANCE_ID = ProviderInstanceId.make("codex");
const PROJECT_ID = ProjectId.make("project-force-abort");
const THREAD_ID = ThreadId.make("thread-force-abort");
const PARTIAL_TEXT = "Partial assistant content survives force abort.";
const REPLACEMENT_TEXT = "Replacement runtime response.";
const STALE_TEXT = "STALE_OLD_RUNTIME_CONTENT";
const CURRENT_BARRIER_TEXT = "CURRENT_RUNTIME_BARRIER";

const createdAt = (seconds: number): string =>
  `2026-07-31T10:00:${String(seconds).padStart(2, "0")}.000Z`;

const withHarness = <A, E>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E>,
) =>
  Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({
      provider: PROVIDER,
    }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));

const seedThread = (harness: OrchestrationIntegrationHarness) =>
  Effect.gen(function* () {
    yield* harness.engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("cmd-force-abort-project"),
      projectId: PROJECT_ID,
      title: "Force Abort Integration",
      workspaceRoot: harness.workspaceDir,
      defaultModelSelection: {
        instanceId: PROVIDER_INSTANCE_ID,
        model: DEFAULT_MODEL,
      },
      createdAt: createdAt(0),
    });
    yield* harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-force-abort-thread"),
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
      title: "Force Abort Thread",
      modelSelection: {
        instanceId: PROVIDER_INSTANCE_ID,
        model: DEFAULT_MODEL,
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: harness.workspaceDir,
      createdAt: createdAt(1),
    });
  });

const startTurn = (
  harness: OrchestrationIntegrationHarness,
  input: {
    readonly commandId: string;
    readonly messageId: string;
    readonly text: string;
    readonly createdAt: string;
  },
) =>
  harness.engine.dispatch({
    type: "thread.turn.start",
    commandId: CommandId.make(input.commandId),
    threadId: THREAD_ID,
    message: {
      messageId: MessageId.make(input.messageId),
      role: "user",
      text: input.text,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "full-access",
    createdAt: input.createdAt,
  });

const assistantText = (thread: OrchestrationThread): string =>
  thread.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.text)
    .join("");

const waitForSync = <A>(
  read: () => A,
  predicate: (value: A) => boolean,
): Effect.Effect<A, never> => {
  const retrySignal = "force_abort_integration_retry";
  return Effect.sync(read).pipe(
    Effect.filterOrFail(predicate, () => retrySignal),
    Effect.retry({
      schedule: Schedule.spaced("1 millis"),
      times: 1_000,
      while: (error) => error === retrySignal,
    }),
    Effect.orDie,
  );
};

it.live(
  "force-aborts one runtime at five seconds, preserves its transcript, and fences the replacement",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const adapter = harness.adapterHarness!;
        yield* seedThread(harness);
        yield* adapter.queueTurnResponseForNextSession({
          terminalEventBehavior: "omit",
          interruptBehavior: "never",
          events: [
            {
              type: "turn.started",
              eventId: EventId.make("evt-force-abort-turn-started"),
              provider: PROVIDER,
              createdAt: createdAt(2),
              threadId: THREAD_ID,
              turnId: "provider-turn-one",
            },
            {
              type: "message.delta",
              eventId: EventId.make("evt-force-abort-partial"),
              provider: PROVIDER,
              createdAt: createdAt(3),
              threadId: THREAD_ID,
              turnId: "provider-turn-one",
              delta: PARTIAL_TEXT,
            },
          ],
        });
        yield* startTurn(harness, {
          commandId: "cmd-force-abort-turn-one",
          messageId: "msg-force-abort-user-one",
          text: "Start work that will not stop cooperatively.",
          createdAt: createdAt(2),
        });

        const firstRunning = yield* harness.waitForThread(
          THREAD_ID,
          (thread) =>
            thread.session?.status === "running" &&
            thread.session.runtimeSessionId !== null &&
            thread.session.activeTurnId !== null,
          5_000,
        );
        const firstRuntimeSessionId = firstRunning.session!.runtimeSessionId!;
        const firstTurnId = firstRunning.session!.activeTurnId!;
        assert.equal(adapter.getSessionStartInputs()[0]?.runtimeSessionId, firstRuntimeSessionId);

        yield* harness.engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make("cmd-force-abort-interrupt-one"),
          threadId: THREAD_ID,
          turnId: firstTurnId,
          createdAt: createdAt(4),
        });
        yield* harness.engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make("cmd-force-abort-interrupt-duplicate"),
          threadId: THREAD_ID,
          turnId: firstTurnId,
          createdAt: createdAt(4),
        });

        yield* harness.waitForThread(
          THREAD_ID,
          (thread) =>
            thread.session?.abortState?.phase === "interrupting" &&
            thread.session.abortState.runtimeSessionId === firstRuntimeSessionId,
        );
        yield* waitForSync(
          () => adapter.getInterruptCalls(THREAD_ID).length,
          (count) => count === 1,
        );
        assert.equal(adapter.getForceStopCalls(THREAD_ID), 0);

        // The coordinator unit suite pins the exact 4,999/5,000ms boundary with
        // TestClock. Keep this full-stack assertion comfortably pre-boundary so
        // a loaded integration runner cannot make it flaky.
        yield* Effect.sleep("4500 millis");
        assert.equal(adapter.getForceStopCalls(THREAD_ID), 0);

        const stopped = yield* harness.waitForThread(THREAD_ID, (thread) => {
          const partialAssistant = thread.messages.find(
            (message) => message.role === "assistant" && message.text.includes(PARTIAL_TEXT),
          );
          return (
            thread.session?.status === "stopped" &&
            thread.session.runtimeSessionId === null &&
            thread.session.abortState === null &&
            partialAssistant?.streaming === false
          );
        });
        assert.equal(adapter.getInterruptCalls(THREAD_ID).length, 1);
        assert.equal(adapter.getForceStopCalls(THREAD_ID), 1);
        const partialAssistant = stopped.messages.find(
          (message) => message.role === "assistant" && message.text.includes(PARTIAL_TEXT),
        );

        yield* adapter.queueTurnResponseForNextSession({
          terminalEventBehavior: "omit",
          events: [
            {
              type: "turn.started",
              eventId: EventId.make("evt-force-abort-replacement-started"),
              provider: PROVIDER,
              createdAt: createdAt(6),
              threadId: THREAD_ID,
              turnId: "provider-turn-two",
            },
            {
              type: "message.delta",
              eventId: EventId.make("evt-force-abort-replacement-delta"),
              provider: PROVIDER,
              createdAt: createdAt(7),
              threadId: THREAD_ID,
              turnId: "provider-turn-two",
              delta: REPLACEMENT_TEXT,
            },
          ],
        });
        yield* startTurn(harness, {
          commandId: "cmd-force-abort-turn-two",
          messageId: "msg-force-abort-user-two",
          text: "Resume in a fresh runtime.",
          createdAt: createdAt(6),
        });

        const replacementRunning = yield* harness.waitForThread(
          THREAD_ID,
          (thread) =>
            thread.session?.status === "running" &&
            thread.session.runtimeSessionId !== null &&
            thread.session.runtimeSessionId !== firstRuntimeSessionId &&
            thread.session.activeTurnId !== null,
        );
        const replacementRuntimeSessionId = replacementRunning.session!.runtimeSessionId!;
        const replacementTurnId = replacementRunning.session!.activeTurnId!;
        assert.notEqual(replacementRuntimeSessionId, firstRuntimeSessionId);
        assert.equal(adapter.getStartCount(), 2);
        assert.equal(
          adapter.getSessionStartInputs()[1]?.runtimeSessionId,
          replacementRuntimeSessionId,
        );
        assert.deepEqual(adapter.getSessionStartInputs()[1]?.resumeCursor, {
          threadId: THREAD_ID,
          seed: 1,
        });

        yield* adapter.emitRuntimeEvent(
          {
            type: "message.delta",
            eventId: EventId.make("evt-force-abort-stale-delta"),
            provider: PROVIDER,
            createdAt: createdAt(8),
            threadId: THREAD_ID,
            turnId: replacementTurnId,
            delta: STALE_TEXT,
          },
          firstRuntimeSessionId,
        );
        yield* adapter.emitRuntimeEvent(
          {
            type: "message.delta",
            eventId: EventId.make("evt-force-abort-current-barrier"),
            provider: PROVIDER,
            createdAt: createdAt(9),
            threadId: THREAD_ID,
            turnId: replacementTurnId,
            delta: CURRENT_BARRIER_TEXT,
          },
          replacementRuntimeSessionId,
        );
        yield* adapter.emitRuntimeEvent(
          {
            type: "turn.completed",
            eventId: EventId.make("evt-force-abort-replacement-completed"),
            provider: PROVIDER,
            createdAt: createdAt(10),
            threadId: THREAD_ID,
            turnId: replacementTurnId,
            payload: {
              state: "completed",
            },
          },
          replacementRuntimeSessionId,
        );
        const replacementReady = yield* harness.waitForThread(
          THREAD_ID,
          (thread) =>
            thread.session?.status === "ready" &&
            thread.session.runtimeSessionId === replacementRuntimeSessionId &&
            thread.session.activeTurnId === null &&
            assistantText(thread).includes(CURRENT_BARRIER_TEXT),
        );
        assert.equal(assistantText(replacementReady).includes(STALE_TEXT), false);

        assert.equal(adapter.getForceStopCalls(THREAD_ID), 1);
        const finalThread = yield* harness.waitForThread(
          THREAD_ID,
          (thread) =>
            thread.session?.runtimeSessionId === replacementRuntimeSessionId &&
            thread.session.status === "ready",
        );
        assert.equal(finalThread.session?.runtimeSessionId, replacementRuntimeSessionId);
        assert.equal(assistantText(finalThread).includes(REPLACEMENT_TEXT), true);
        assert.equal(assistantText(finalThread).includes(STALE_TEXT), false);
        assert.equal(replacementReady.session?.runtimeSessionId, replacementRuntimeSessionId);
        assert.equal(partialAssistant?.streaming, false);
        assert.equal(assistantText(finalThread).includes(PARTIAL_TEXT), true);
      }),
    ),
);
