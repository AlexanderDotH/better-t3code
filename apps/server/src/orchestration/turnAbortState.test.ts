import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const threadId = ThreadId.make("thread-abort-state");
const turnId = TurnId.make("turn-abort-state");
const runtimeSessionId = RuntimeSessionId.make("runtime-abort-state");
const startedAt = "2026-07-30T12:00:00.000Z";
const requestedAt = "2026-07-30T12:00:01.000Z";
const settledAt = "2026-07-30T12:00:03.000Z";

const event = (
  sequence: number,
  type: OrchestrationEvent["type"],
  payload: unknown,
): OrchestrationEvent =>
  ({
    sequence,
    eventId: EventId.make(`event-abort-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    type,
    occurredAt: sequence === 3 ? settledAt : startedAt,
    commandId: CommandId.make(`command-abort-${sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload,
  }) as OrchestrationEvent;

const seedRunningAbort = Effect.gen(function* () {
  const created = yield* projectEvent(
    createEmptyReadModel(startedAt),
    event(1, "thread.created", {
      threadId,
      projectId: ProjectId.make("project-abort-state"),
      title: "Abort state",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-codex",
      },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: startedAt,
      updatedAt: startedAt,
    }),
  );
  return yield* projectEvent(
    created,
    event(2, "thread.session-set", {
      threadId,
      session: {
        threadId,
        status: "running",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeSessionId,
        runtimeMode: "full-access",
        activeTurnId: turnId,
        abortState: {
          runtimeSessionId,
          targetTurnId: turnId,
          phase: "interrupting",
          requestedAt,
          forceAt: "2026-07-30T12:00:06.000Z",
        },
        lastError: null,
        updatedAt: requestedAt,
      },
    }),
  );
});

it.layer(NodeServices.layer)("turn abort orchestration state", (it) => {
  it.effect("decides an authoritative settlement only for the exact runtime and turn", () =>
    Effect.gen(function* () {
      const readModel = yield* seedRunningAbort;
      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.abort.settle",
          commandId: CommandId.make("command-settle"),
          threadId,
          runtimeSessionId,
          turnId,
          outcome: "cooperative",
          settledAt,
          createdAt: settledAt,
        },
        readModel,
      });
      expect(Array.isArray(decided)).toBe(false);
      if (!("type" in decided)) return;
      expect(decided.type).toBe("thread.turn-abort-settled");
      expect(decided.payload).toMatchObject({
        threadId,
        runtimeSessionId,
        turnId,
        outcome: "cooperative",
      });

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "thread.turn.abort.settle",
            commandId: CommandId.make("command-settle-stale"),
            threadId,
            runtimeSessionId: RuntimeSessionId.make("runtime-replaced"),
            turnId,
            outcome: "force-terminated",
            settledAt,
            createdAt: settledAt,
          },
          readModel,
        }),
      );
      expect(error.message).toContain("does not match its active runtime and turn");
    }),
  );

  it.effect("clears abort state and keeps the runtime resumable after cooperative settlement", () =>
    Effect.gen(function* () {
      const readModel = yield* seedRunningAbort;
      const settled = yield* projectEvent(
        readModel,
        event(3, "thread.turn-abort-settled", {
          threadId,
          runtimeSessionId,
          turnId,
          outcome: "cooperative",
          settledAt,
        }),
      );
      expect(settled.threads[0]?.session).toMatchObject({
        status: "ready",
        runtimeSessionId,
        activeTurnId: null,
        abortState: null,
      });
    }),
  );

  it.effect("stops the session after a matching forced settlement and ignores stale ones", () =>
    Effect.gen(function* () {
      const readModel = yield* seedRunningAbort;
      const stale = yield* projectEvent(
        readModel,
        event(3, "thread.turn-abort-settled", {
          threadId,
          runtimeSessionId: RuntimeSessionId.make("runtime-replaced"),
          turnId,
          outcome: "force-terminated",
          settledAt,
        }),
      );
      expect(stale.threads[0]?.session?.abortState).not.toBeNull();

      const settled = yield* projectEvent(
        readModel,
        event(3, "thread.turn-abort-settled", {
          threadId,
          runtimeSessionId,
          turnId,
          outcome: "force-terminated",
          settledAt,
        }),
      );
      expect(settled.threads[0]?.session).toMatchObject({
        status: "stopped",
        runtimeSessionId: null,
        activeTurnId: null,
        abortState: null,
      });
    }),
  );
});
