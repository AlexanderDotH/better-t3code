import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type {
  ProviderAdapterCapabilities,
  ProviderForceStopResult,
} from "../src/provider/Services/ProviderAdapter.ts";
import { BUILT_IN_DRIVERS } from "../src/provider/builtInDrivers.ts";
import {
  makeTestProviderAdapterHarness,
  type TestTurnResponse,
} from "./TestProviderAdapter.integration.ts";

interface ProviderContractCase {
  readonly label: string;
  readonly provider: ProviderDriverKind;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly forceStopResult: ProviderForceStopResult;
}

const PROVIDER_CASES: ReadonlyArray<ProviderContractCase> = [
  {
    label: "Codex",
    provider: ProviderDriverKind.make("codex"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "nativeConfig" },
    forceStopResult: { outcome: "terminated", mechanism: "process-tree" },
  },
  {
    label: "ChatGPT Subscription",
    provider: ProviderDriverKind.make("chatgpt"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    forceStopResult: { outcome: "terminated", mechanism: "runtime-close" },
  },
  {
    label: "OpenRouter",
    provider: ProviderDriverKind.make("openrouter"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    forceStopResult: { outcome: "terminated", mechanism: "runtime-close" },
  },
  {
    label: "OpenAI Responses",
    provider: ProviderDriverKind.make("openai"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    forceStopResult: { outcome: "terminated", mechanism: "runtime-close" },
  },
  {
    label: "Claude",
    provider: ProviderDriverKind.make("claudeAgent"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    forceStopResult: { outcome: "terminated", mechanism: "runtime-close" },
  },
  {
    label: "Cursor",
    provider: ProviderDriverKind.make("cursor"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    forceStopResult: { outcome: "terminated", mechanism: "process-tree" },
  },
  {
    label: "Grok",
    provider: ProviderDriverKind.make("grok"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "unsupported" },
    forceStopResult: { outcome: "terminated", mechanism: "process-tree" },
  },
  {
    label: "OpenCode",
    provider: ProviderDriverKind.make("opencode"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "sessionConfig" },
    forceStopResult: {
      outcome: "detached",
      mechanism: "local-detach",
      detail: "Mocked externally managed OpenCode runtime detached locally.",
    },
  },
  {
    label: "Gemini",
    provider: ProviderDriverKind.make("gemini"),
    capabilities: { sessionModelSwitch: "in-session", mcp: "unsupported" },
    forceStopResult: { outcome: "terminated", mechanism: "runtime-close" },
  },
];

const CREATED_AT = "2026-08-22T00:00:00.000Z";

it.effect("covers every built-in provider driver", () =>
  Effect.sync(() => {
    assert.deepEqual(
      PROVIDER_CASES.map(({ provider }) => provider),
      BUILT_IN_DRIVERS.map(({ driverKind }) => driverKind),
    );
  }),
);

function turnResponse(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
): TestTurnResponse {
  const event = (suffix: string) => ({
    eventId: EventId.make(`contract-${provider}-${suffix}`),
    provider,
    createdAt: CREATED_AT,
    threadId: String(threadId),
    turnId: "fixture-turn",
  });

  return {
    events: [
      { type: "turn.started", ...event("turn-started"), payload: {} },
      {
        type: "content.delta",
        ...event("content"),
        payload: { streamKind: "assistant_text", delta: `${provider} response` },
      },
      {
        type: "item.started",
        ...event("tool-started"),
        payload: { itemType: "command_execution", title: "Mock command" },
      },
      {
        type: "item.completed",
        ...event("tool-completed"),
        payload: { itemType: "command_execution", status: "completed" },
      },
      {
        type: "request.opened",
        ...event("request-opened"),
        requestId,
        payload: { requestType: "command_execution_approval" },
      },
      {
        type: "request.resolved",
        ...event("request-resolved"),
        requestId,
        payload: { requestType: "command_execution_approval", decision: "accept" },
      },
      {
        type: "turn.completed",
        ...event("turn-completed"),
        payload: { state: "completed" },
      },
    ],
  };
}

for (const providerCase of PROVIDER_CASES) {
  it.effect(`${providerCase.label} mock satisfies the complete adapter interaction contract`, () =>
    Effect.gen(function* () {
      const harness = yield* makeTestProviderAdapterHarness({
        provider: providerCase.provider,
        capabilities: providerCase.capabilities,
        forceStopResult: providerCase.forceStopResult,
      });
      const adapter = harness.adapter;
      const threadId = ThreadId.make(`contract-${providerCase.provider}`);
      const runtimeSessionId = RuntimeSessionId.make(`runtime-${providerCase.provider}`);
      const providerInstanceId = ProviderInstanceId.make(String(providerCase.provider));
      const requestId = ApprovalRequestId.make(`approval-${providerCase.provider}`);

      const session = yield* adapter.startSession({
        threadId,
        runtimeSessionId,
        provider: providerCase.provider,
        providerInstanceId,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      assert.deepEqual(adapter.capabilities, providerCase.capabilities);
      assert.equal(session.provider, providerCase.provider);
      assert.equal(session.providerInstanceId, providerInstanceId);
      assert.equal(session.runtimeSessionId, runtimeSessionId);
      assert.equal(yield* adapter.hasSession(threadId), true);
      assert.deepEqual(yield* adapter.listSessions(), [session]);

      if (providerCase.capabilities.mcp === "unsupported") {
        assert.equal(adapter.mcpRuntime, undefined);
      } else {
        assert.ok(adapter.mcpRuntime);
        const target = { providerInstanceId, threadId, runtimeSessionId };
        assert.deepEqual(yield* adapter.mcpRuntime.getSnapshot(target), []);
        const applyConfiguration = adapter.mcpRuntime.applyConfiguration;
        assert.ok(applyConfiguration);
        assert.equal(yield* applyConfiguration(target), undefined);
      }

      const response = turnResponse(providerCase.provider, threadId, requestId);
      yield* harness.queueTurnResponse(threadId, response);
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "Exercise every shared provider interaction",
        attachments: [],
      });
      const events = Array.from(
        yield* Stream.runCollect(Stream.take(adapter.streamEvents, response.events.length)),
      );

      assert.deepEqual(
        events.map((event) => event.type),
        [
          "turn.started",
          "content.delta",
          "item.started",
          "item.completed",
          "request.opened",
          "request.resolved",
          "turn.completed",
        ],
      );
      assert.equal(
        events.every((event) => event.provider === providerCase.provider),
        true,
      );
      assert.equal(
        events.every((event) => event.runtimeSessionId === runtimeSessionId),
        true,
      );

      const snapshot = yield* adapter.readThread(threadId);
      assert.equal(snapshot.turns.length, 1);
      assert.equal(snapshot.turns[0]?.id, turn.turnId);

      yield* adapter.interruptTurn(threadId, turn.turnId, RuntimeSessionId.make("stale-runtime"));
      assert.deepEqual(harness.getInterruptCalls(threadId), []);
      yield* adapter.interruptTurn(threadId, turn.turnId, runtimeSessionId);
      assert.deepEqual(harness.getInterruptCalls(threadId), [turn.turnId]);

      yield* adapter.respondToRequest(threadId, requestId, "acceptForSession");
      assert.deepEqual(harness.getApprovalResponses(threadId), [
        { threadId, requestId, decision: "acceptForSession" },
      ]);

      const answers = { environment: "staging", confirmed: true };
      yield* adapter.respondToUserInput(threadId, requestId, answers);
      assert.deepEqual(harness.getUserInputResponses(threadId), [{ threadId, requestId, answers }]);

      const rolledBack = yield* adapter.rollbackThread(threadId, 1);
      assert.deepEqual(rolledBack.turns, []);
      assert.deepEqual(harness.getRollbackCalls(threadId), [1]);

      assert.deepEqual(
        yield* adapter.forceStopSession(threadId, RuntimeSessionId.make("stale-runtime")),
        { outcome: "terminated", mechanism: "already-stopped" },
      );
      assert.equal(yield* adapter.hasSession(threadId), true);
      assert.deepEqual(
        yield* adapter.forceStopSession(threadId, runtimeSessionId),
        providerCase.forceStopResult,
      );
      assert.equal(yield* adapter.hasSession(threadId), false);

      const restarted = yield* adapter.startSession({
        threadId,
        provider: providerCase.provider,
        runtimeMode: "full-access",
      });
      yield* adapter.stopSession(restarted.threadId);
      assert.equal(yield* adapter.hasSession(threadId), false);

      yield* adapter.startSession({
        threadId: ThreadId.make(`stop-all-a-${providerCase.provider}`),
        provider: providerCase.provider,
        runtimeMode: "full-access",
      });
      yield* adapter.startSession({
        threadId: ThreadId.make(`stop-all-b-${providerCase.provider}`),
        provider: providerCase.provider,
        runtimeMode: "full-access",
      });
      yield* adapter.stopAll();
      assert.deepEqual(yield* adapter.listSessions(), []);
    }),
  );

  it.effect(`${providerCase.label} mock returns typed failures for invalid interactions`, () =>
    Effect.gen(function* () {
      const harness = yield* makeTestProviderAdapterHarness({ provider: providerCase.provider });
      const adapter = harness.adapter;
      const missingThreadId = ThreadId.make(`missing-${providerCase.provider}`);

      const wrongProvider = ProviderDriverKind.make(
        providerCase.provider === "codex" ? "claudeAgent" : "codex",
      );
      const wrongProviderError = yield* adapter
        .startSession({
          threadId: ThreadId.make(`wrong-provider-${providerCase.provider}`),
          provider: wrongProvider,
          runtimeMode: "full-access",
        })
        .pipe(Effect.flip);
      assert.equal(wrongProviderError._tag, "ProviderAdapterValidationError");

      const sendError = yield* adapter
        .sendTurn({ threadId: missingThreadId, input: "missing", attachments: [] })
        .pipe(Effect.flip);
      assert.equal(sendError._tag, "ProviderAdapterSessionNotFoundError");
      const interruptError = yield* adapter.interruptTurn(missingThreadId).pipe(Effect.flip);
      assert.equal(interruptError._tag, "ProviderAdapterSessionNotFoundError");
      const approvalError = yield* adapter
        .respondToRequest(missingThreadId, ApprovalRequestId.make("missing-approval"), "decline")
        .pipe(Effect.flip);
      assert.equal(approvalError._tag, "ProviderAdapterSessionNotFoundError");
      const userInputError = yield* adapter
        .respondToUserInput(missingThreadId, ApprovalRequestId.make("missing-user-input"), {})
        .pipe(Effect.flip);
      assert.equal(userInputError._tag, "ProviderAdapterSessionNotFoundError");
      const readError = yield* adapter.readThread(missingThreadId).pipe(Effect.flip);
      assert.equal(readError._tag, "ProviderAdapterSessionNotFoundError");
      const rollbackMissingError = yield* adapter
        .rollbackThread(missingThreadId, 0)
        .pipe(Effect.flip);
      assert.equal(rollbackMissingError._tag, "ProviderAdapterSessionNotFoundError");

      assert.deepEqual(
        yield* adapter.forceStopSession(missingThreadId, RuntimeSessionId.make("missing-runtime")),
        { outcome: "terminated", mechanism: "already-stopped" },
      );
      yield* adapter.stopSession(missingThreadId);

      const session = yield* adapter.startSession({
        threadId: ThreadId.make(`invalid-turn-${providerCase.provider}`),
        provider: providerCase.provider,
        runtimeMode: "full-access",
      });
      const missingResponseError = yield* adapter
        .sendTurn({ threadId: session.threadId, input: "not queued", attachments: [] })
        .pipe(Effect.flip);
      assert.equal(missingResponseError._tag, "ProviderAdapterValidationError");
      const invalidRollbackError = yield* adapter
        .rollbackThread(session.threadId, -1)
        .pipe(Effect.flip);
      assert.equal(invalidRollbackError._tag, "ProviderAdapterValidationError");
    }),
  );
}
