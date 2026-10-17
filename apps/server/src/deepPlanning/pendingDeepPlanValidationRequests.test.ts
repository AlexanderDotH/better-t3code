import {
  CommandId,
  DeepPlanRunId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  OrchestrationCommandReceiptRepository,
  type OrchestrationCommandReceipt,
} from "../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  ProjectionTurnRepository,
  type ProjectionPendingTurnStart,
} from "../persistence/Services/ProjectionTurns.ts";
import { deepPlanApprovalKey } from "./deepPlanDecision.ts";
import { finalValidationRequestId } from "./DeepPlanValidationReactor.ts";
import {
  canDispatchDeepPlanValidationRequest,
  pendingDeepPlanValidationRequests,
} from "./pendingDeepPlanValidationRequests.ts";

const createdAt = "2026-10-16T10:00:00.000Z";
const ownerId = ThreadId.make("pending-validation-owner");
const targetId = ThreadId.make("pending-validation-implementation");
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const plan = {
  schemaVersion: 1 as const,
  version: 1,
  goal: "Keep final validation durable",
  scope: ["Recover queued validation"],
  decisions: [],
  affectedAreas: ["Provider orchestration"],
  steps: [
    {
      id: "restore",
      title: "Restore the request",
      description: "Recover one pending validation request",
      dependencies: [],
      acceptanceCriteria: [
        {
          id: "stable",
          description: "Preserve the request identity",
          checkMethod: "Replay the persisted event",
        },
      ],
    },
  ],
  finalValidation: {
    description: "Validate the recovered workflow",
    checkMethod: "Run the focused checks",
  },
};
const runBase: DeepPlanRun = {
  id: DeepPlanRunId.make("pending-validation-run"),
  threadId: ownerId,
  phase: "validating",
  revision: 8,
  plan,
  approvalKey: deepPlanApprovalKey(plan),
  approval: {
    planVersion: 1,
    approvalKey: deepPlanApprovalKey(plan),
    approvedAt: createdAt,
    approvedBy: "user",
    implementation: model,
    implementationThreadId: targetId,
    implementerId: `thread:${targetId}`,
  },
  sources: [],
  sourceCoverage: [],
  stepStates: [
    {
      stepId: "restore",
      status: "verified",
      evidence: [{ kind: "test", summary: "Step check passed", createdAt }],
      updatedAt: createdAt,
    },
  ],
  finalValidation: {
    status: "inProgress",
    evidence: [],
    attempt: 2,
    requestId: null,
    turnId: null,
    updatedAt: createdAt,
  },
  procedureAdjustments: [],
  operations: [],
  createdAt,
  updatedAt: createdAt,
  pauseReason: null,
};
const requestId = finalValidationRequestId(runBase);
const run: DeepPlanRun = { ...runBase, finalValidation: { ...runBase.finalValidation, requestId } };

function thread(id: ThreadId, overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id,
    projectId: ProjectId.make("pending-validation-project"),
    title: id,
    modelSelection: model,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: null,
    deepPlan: run,
    ...overrides,
  };
}

const pending: ProjectionPendingTurnStart = {
  threadId: targetId,
  messageId: MessageId.make(requestId + ":message"),
  sourceProposedPlanThreadId: null,
  sourceProposedPlanId: null,
  requestedAt: createdAt,
};
const receipt: OrchestrationCommandReceipt = {
  commandId: CommandId.make(requestId),
  aggregateKind: "thread",
  aggregateId: targetId,
  acceptedAt: createdAt,
  resultSequence: 42,
  status: "accepted",
  error: null,
};
const event: Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }> = {
  type: "thread.turn-start-requested",
  eventId: EventId.make("pending-validation-event"),
  sequence: 42,
  aggregateKind: "thread",
  aggregateId: targetId,
  occurredAt: createdAt,
  commandId: CommandId.make(requestId),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  payload: {
    threadId: targetId,
    messageId: pending.messageId,
    modelSelection: model,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt,
  },
};

function fixture(
  options: {
    readonly threads?: ReadonlyArray<OrchestrationThread>;
    readonly pending?: ProjectionPendingTurnStart | null;
    readonly receipt?: OrchestrationCommandReceipt | null;
    readonly event?: OrchestrationEvent;
  } = {},
) {
  const pendingValue = options.pending === undefined ? pending : options.pending;
  const receiptValue = options.receipt === undefined ? receipt : options.receipt;
  const readModel: OrchestrationReadModel = {
    snapshotSequence: 42,
    projects: [],
    threads: options.threads ?? [thread(ownerId), thread(targetId)],
    updatedAt: createdAt,
  };
  const reads: Array<{
    readonly threadId: ThreadId;
    readonly fromSequenceExclusive: number;
    readonly toSequenceInclusive: number;
    readonly limit?: number;
  }> = [];
  const receiptRequests: CommandId[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(OrchestrationCommandReceiptRepository)({
      getByCommandId: (input) =>
        Effect.sync(() => {
          receiptRequests.push(input.commandId);
          return Option.fromNullishOr(receiptValue);
        }),
    }),
    Layer.mock(ProjectionTurnRepository)({
      getPendingTurnStartByThreadId: () => Effect.succeed(Option.fromNullishOr(pendingValue)),
    }),
  );
  const recover = Effect.gen(function* () {
    return yield* pendingDeepPlanValidationRequests({
      readModel,
      receipts: yield* OrchestrationCommandReceiptRepository,
      turns: yield* ProjectionTurnRepository,
      engine: {
        readThreadEvents: (input) => {
          reads.push(input);
          return Stream.fromIterable([options.event ?? event]);
        },
      },
    });
  }).pipe(Effect.provide(dependencies));
  return { recover, reads, receiptRequests };
}

it.effect(
  "recovers one exact persisted request with its original command and message identity",
  () => {
    const test = fixture();
    return Effect.gen(function* () {
      const requests = yield* test.recover;
      expect(requests).toEqual([event]);
      expect(requests[0]).toBe(event);
      expect(test.receiptRequests).toEqual([CommandId.make(requestId)]);
      expect(test.reads).toEqual([
        { threadId: targetId, fromSequenceExclusive: 41, toSequenceInclusive: 42, limit: 1 },
      ]);
    });
  },
);

it.effect("skips an already consumed pending start", () => {
  const test = fixture({ pending: null });
  return Effect.gen(function* () {
    expect(yield* test.recover).toEqual([]);
    expect(test.reads).toEqual([]);
    expect(test.receiptRequests).toEqual([]);
  });
});

it.effect("does not recover an unrelated queued user message", () => {
  const test = fixture({
    pending: { ...pending, messageId: MessageId.make("ordinary-user-message") },
  });
  return Effect.gen(function* () {
    expect(yield* test.recover).toEqual([]);
    expect(test.reads).toEqual([]);
  });
});

it.effect("keeps paused validation paused even when its old request remains queued", () => {
  const paused = { ...run, phase: "paused" as const };
  const test = fixture({
    threads: [thread(ownerId, { deepPlan: paused }), thread(targetId, { deepPlan: paused })],
  });
  return Effect.gen(function* () {
    expect(yield* test.recover).toEqual([]);
    expect(test.reads).toEqual([]);
  });
});

for (const [name, changedReceipt] of [
  ["foreign aggregate", { ...receipt, aggregateId: ownerId }],
  ["rejected request", { ...receipt, status: "rejected" as const }],
] as const) {
  it.effect(`skips a ${name} receipt`, () => {
    const test = fixture({ receipt: changedReceipt });
    return Effect.gen(function* () {
      expect(yield* test.recover).toEqual([]);
      expect(test.reads).toEqual([]);
    });
  });
}

for (const [name, threads] of [
  ["deleted owner", [thread(ownerId, { deletedAt: createdAt }), thread(targetId)]],
  ["archived owner", [thread(ownerId, { archivedAt: createdAt }), thread(targetId)]],
  ["deleted implementation", [thread(ownerId), thread(targetId, { deletedAt: createdAt })]],
  ["archived implementation", [thread(ownerId), thread(targetId, { archivedAt: createdAt })]],
] as const) {
  it.effect(`does not revive a ${name}`, () => {
    const test = fixture({ threads });
    return Effect.gen(function* () {
      expect(yield* test.recover).toEqual([]);
      expect(test.reads).toEqual([]);
    });
  });
}

it.effect("rejects a receipt whose referenced event belongs to another request", () => {
  const test = fixture({
    event: { ...event, commandId: CommandId.make("another-validation-request") },
  });
  return Effect.gen(function* () {
    expect(yield* test.recover).toEqual([]);
  });
});

it("drops obsolete validation turns before they can run as ordinary work", () => {
  expect(canDispatchDeepPlanValidationRequest(event, run)).toBe(true);
  expect(canDispatchDeepPlanValidationRequest(event, null)).toBe(false);
  expect(canDispatchDeepPlanValidationRequest(event, { ...run, phase: "paused" })).toBe(false);
  expect(
    canDispatchDeepPlanValidationRequest(event, {
      ...run,
      phase: "awaitingApproval",
      approval: null,
    }),
  ).toBe(false);
  expect(
    canDispatchDeepPlanValidationRequest(event, {
      ...run,
      finalValidation: { ...run.finalValidation, requestId: "new-validation-attempt" },
    }),
  ).toBe(false);
  expect(
    canDispatchDeepPlanValidationRequest(event, {
      ...run,
      approval: { ...run.approval!, implementationThreadId: ownerId },
    }),
  ).toBe(false);
  const ordinary = {
    ...event,
    commandId: CommandId.make("ordinary-command"),
    payload: { ...event.payload, messageId: MessageId.make("ordinary-message") },
  };
  expect(canDispatchDeepPlanValidationRequest(ordinary, null)).toBe(true);
});
