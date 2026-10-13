import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  CommandId,
  EventId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  RuntimeRequestId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationSubagentDetail,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSessionStartInput,
  type ThreadReplyStartRequestedPayload,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as Liveness from "../orchestration/ThreadBackgroundLiveness.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import { MessageReplyCoordinator, MessageReplyCoordinatorLive } from "./MessageReplyCoordinator.ts";

const threadId = ThreadId.make("main");
const instanceId = ProviderInstanceId.make("codex-local");
const driver = ProviderDriverKind.make("codex");
const createdAt = "2026-10-13T10:00:00.000Z";
const selection = {
  instanceId,
  model: "gpt-6.1-sol",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
  ],
};
const source: OrchestrationMessage = {
  id: MessageId.make("source"),
  role: "assistant",
  text: "The server streams updates over the existing connection.",
  turnId: TurnId.make("main-turn"),
  streaming: false,
  createdAt,
  updatedAt: createdAt,
};
const start = (id: string, topic = id): ThreadReplyStartRequestedPayload => ({
  commandId: CommandId.make(`command-${id}`),
  threadId,
  replyTopicId: SubagentId.make(`topic-${topic}`),
  replyTo: { messageId: source.id, role: "assistant", text: source.text },
  message: {
    messageId: MessageId.make(`user-${id}`),
    role: "user",
    text: `Explain ${id}`,
    attachments: [],
  },
  createdAt,
});

const makeHarness = Effect.fnUntraced(function* (
  options: {
    readonly failSend?: boolean;
    readonly synchronousCompletion?: boolean;
    readonly blockAdmission?: boolean;
    readonly blockStart?: boolean;
    readonly persistedEvents?: ReadonlyArray<OrchestrationEvent>;
  } = {},
) {
  const providerEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sent = yield* Queue.unbounded<ProviderSendTurnInput>();
  const observed = yield* Queue.unbounded<OrchestrationCommand>();
  const admissionRequested = yield* Deferred.make<void>();
  const admissionAllowed = yield* Deferred.make<boolean>();
  const sessionStarting = yield* Deferred.make<void>();
  const sessionStartInterrupted = yield* Deferred.make<void>();
  const starts: ProviderSessionStartInput[] = [];
  const sends: ProviderSendTurnInput[] = [];
  const interrupts: Parameters<ProviderServiceShape["interruptAbortTarget"]>[0][] = [];
  const stops: Parameters<ProviderServiceShape["stopTransientSession"]>[0][] = [];
  const approvals: Parameters<ProviderServiceShape["respondToRequest"]>[0][] = [];
  const answers: Parameters<ProviderServiceShape["respondToUserInput"]>[0][] = [];
  const admissions: ResourceProtection.SubagentAdmissionRequest[] = [];
  const releases: ThreadId[] = [];
  const commands: OrchestrationCommand[] = [];
  const details = new Map<SubagentId, OrchestrationSubagentDetail>();
  const sessions = new Map<ThreadId, ProviderSessionStartInput>();
  const mainMessages: OrchestrationMessage[] = [source];
  let commandSequence = 0;
  let eventSequence = 0;

  const event = (
    input: ProviderSendTurnInput,
    body: Pick<ProviderRuntimeEvent, "type" | "payload">,
  ) =>
    ({
      eventId: EventId.make(`event-${++eventSequence}`),
      provider: driver,
      providerInstanceId: instanceId,
      threadId: input.threadId,
      runtimeSessionId: sessions.get(input.threadId)!.runtimeSessionId!,
      turnId: TurnId.make(`turn-${input.threadId}`),
      createdAt,
      ...body,
    }) as ProviderRuntimeEvent;
  const publish = (value: ProviderRuntimeEvent) =>
    PubSub.publish(providerEvents, value).pipe(Effect.asVoid);
  const complete = (input: ProviderSendTurnInput) =>
    publish(event(input, { type: "turn.completed", payload: { state: "completed" } }));

  const provider: Partial<ProviderServiceShape> = {
    subscribeEvents: PubSub.subscribe(providerEvents).pipe(Effect.map(Stream.fromSubscription)),
    streamEvents: Stream.fromPubSub(providerEvents),
    getInstanceInfo: () =>
      Effect.succeed({
        instanceId,
        driverKind: driver,
        displayName: "Codex",
        enabled: true,
        continuationIdentity: { driverKind: driver, continuationKey: "codex" },
      }),
    startTransientSession: (id, input) =>
      Effect.gen(function* () {
        starts.push(input);
        sessions.set(id, input);
        yield* Deferred.succeed(sessionStarting, undefined);
        if (options.blockStart)
          return yield* Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(sessionStartInterrupted, undefined)),
          );
        return {
          provider: driver,
          providerInstanceId: instanceId,
          threadId: id,
          runtimeSessionId: input.runtimeSessionId!,
          status: "ready" as const,
          runtimeMode: input.runtimeMode,
          cwd: input.cwd,
          model: input.modelSelection?.model,
          createdAt,
          updatedAt: createdAt,
        };
      }),
    sendTurn: (input) =>
      Effect.gen(function* () {
        sends.push(input);
        yield* Queue.offer(sent, input);
        if (options.failSend) return yield* Effect.die("send failed");
        if (options.synchronousCompletion) {
          yield* publish(
            event(input, {
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "A normal answer." },
            }),
          );
          yield* complete(input);
        }
        return { threadId: input.threadId, turnId: TurnId.make(`turn-${input.threadId}`) };
      }),
    interruptAbortTarget: (target) =>
      Effect.sync(() => {
        interrupts.push(target);
      }),
    forceStopAbortTarget: () =>
      Effect.succeed({ outcome: "terminated" as const, mechanism: "runtime-close" as const }),
    stopTransientSession: (target) =>
      Effect.sync(() => {
        stops.push(target);
      }),
    respondToRequest: (input) =>
      Effect.sync(() => {
        approvals.push(input);
      }),
    respondToUserInput: (input) =>
      Effect.sync(() => {
        answers.push(input);
      }),
  };
  const dispatch = (command: OrchestrationCommand) =>
    Effect.gen(function* () {
      commands.push(command);
      if (command.type === "thread.subagent.upsert") {
        const previous = details.get(command.subagent.id);
        details.set(command.subagent.id, {
          ...command.subagent,
          messages: previous?.messages ?? [],
          activities: previous?.activities ?? [],
          proposedPlans: [],
        });
      }
      if ("subagentId" in command && command.subagentId) {
        const detail = details.get(command.subagentId)!;
        if (command.type === "thread.message.import") {
          const messages = [
            ...detail.messages.filter((message) => message.id !== command.message.id),
            command.message,
          ];
          details.set(command.subagentId, { ...detail, messages });
        }
        if (command.type === "thread.message.assistant.delta") {
          details.set(command.subagentId, {
            ...detail,
            messages: detail.messages.map((message) =>
              message.id === command.messageId
                ? { ...message, text: message.text + command.delta }
                : message,
            ),
          });
        }
        if (command.type === "thread.message.assistant.complete") {
          details.set(command.subagentId, {
            ...detail,
            messages: detail.messages.map((message) =>
              message.id === command.messageId ? { ...message, streaming: false } : message,
            ),
          });
        }
        if (command.type === "thread.activity.append") {
          details.set(command.subagentId, {
            ...detail,
            activities: [...detail.activities, command.activity],
          });
        }
      }
      yield* Queue.offer(observed, command);
      return { sequence: ++commandSequence };
    });
  const parentThread = () =>
    ({
      id: threadId,
      projectId: "project",
      modelSelection: selection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      session: { status: "running", activeTurnId: "main-turn" },
      archivedAt: null,
      deletedAt: null,
      messages: mainMessages,
      activities: [],
      subagents: Array.from(details.values()),
    }) as unknown as OrchestrationThread;
  const governor = Layer.mock(ResourceProtection.SubagentResourceGovernor, {
    awaitAdmission: (request) =>
      Effect.gen(function* () {
        admissions.push(request);
        yield* Deferred.succeed(admissionRequested, undefined);
        return options.blockAdmission ? yield* Deferred.await(admissionAllowed) : true;
      }),
    cancelThread: (id) =>
      Effect.gen(function* () {
        releases.push(id);
        if (options.blockAdmission) yield* Deferred.succeed(admissionAllowed, false);
      }),
  });
  const layer = MessageReplyCoordinatorLive.pipe(
    Layer.provide(Layer.mock(ProviderService, provider)),
    Layer.provide(
      Layer.mock(OrchestrationEngineService, {
        dispatch,
        latestSequence: Effect.succeed(options.persistedEvents?.length ?? 0),
        readThreadEvents: (input) =>
          Stream.fromIterable(
            (options.persistedEvents ?? []).filter(
              (value) => value.sequence > input.fromSequenceExclusive,
            ),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery, {
        getThreadDetailById: () => Effect.succeedSome(parentThread()),
        getThreadShellById: () =>
          Effect.succeedSome(parentThread() as unknown as OrchestrationThreadShell),
        getRecentThreadMessages: (_threadId, limit) => Effect.succeed(mainMessages.slice(-limit)),
        getSubagentDetailSnapshot: (_threadId, id) =>
          Effect.succeed(
            Option.map(Option.fromNullishOr(details.get(id)), (subagent) => ({
              snapshotSequence: commandSequence,
              threadId,
              subagent,
            })),
          ),
        getMessageReplyRequestEvents: (_threadId, head) =>
          Effect.succeed((options.persistedEvents ?? []).filter((event) => event.sequence <= head)),
        getThreadCheckpointContext: () =>
          Effect.succeedSome({
            threadId,
            projectId: parentThread().projectId,
            workspaceRoot: "/workspace",
            worktreePath: "/workspace/worktree",
            checkpointsEnabled: true,
            checkpoints: [],
          }),
        getSubagentDetailById: (_threadId, id) =>
          Effect.succeed(Option.fromNullishOr(details.get(id))),
      }),
    ),
    Layer.provide(Layer.succeed(Liveness.ThreadBackgroundLivenessService, Liveness.make())),
    Layer.provide(governor),
    Layer.provide(NodeServices.layer),
  );
  const waitForCommand = Effect.fnUntraced(function* (
    predicate: (command: OrchestrationCommand) => boolean,
  ) {
    while (true) {
      const command = yield* Queue.take(observed);
      if (predicate(command)) return command;
    }
  });
  return {
    layer,
    starts,
    sends,
    interrupts,
    stops,
    approvals,
    answers,
    admissions,
    releases,
    commands,
    details,
    mainMessages,
    event,
    publish,
    complete,
    waitForCommand,
    admissionRequested,
    sessionStarting,
    sessionStartInterrupted,
    nextSend: Queue.take(sent),
  };
});

describe("message reply execution", () => {
  it.effect(
    "runs topics concurrently with the full inherited model and keeps them alive after the main turn finishes",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          yield* service.handleStart(start("first"));
          const first = yield* h.nextSend;
          yield* service.handleStart(start("second"));
          const second = yield* h.nextSend;
          expect(first.threadId).not.toBe(second.threadId);
          expect(
            h.starts.map((value) => [value.modelSelection, value.runtimeMode, value.cwd]),
          ).toEqual([
            [selection, "approval-required", "/workspace/worktree"],
            [selection, "approval-required", "/workspace/worktree"],
          ]);
          yield* h.publish({
            ...h.event(first, { type: "turn.completed", payload: { state: "completed" } }),
            threadId,
            runtimeSessionId: RuntimeSessionId.make("main-runtime"),
            turnId: TurnId.make("main-turn"),
          });
          yield* h.publish(
            h.event(first, {
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "First reply." },
            }),
          );
          yield* h.waitForCommand((command) => command.type === "thread.message.assistant.delta");
          expect(h.interrupts).toEqual([]);
          expect(h.stops).toEqual([]);
          expect(service.hasActiveTopic(threadId)).toBe(true);
          yield* h.complete(first);
          yield* h.complete(second);
          yield* service.awaitIdle(threadId);
          expect(
            h.details
              .get(start("first").replyTopicId)
              ?.messages.find((message) => message.role === "assistant")?.text,
          ).toBe("First reply.");
          expect(h.details.get(start("first").replyTopicId)?.status).toBe("completed");
          expect(h.details.get(start("second").replyTopicId)?.status).toBe("completed");
          expect(
            h.commands.filter(
              (command) => "subagentId" in command && command.subagentId === undefined,
            ),
          ).toEqual([]);
        }).pipe(Effect.provide(h.layer));
      }),
  );

  it.effect(
    "deduplicates repeated sends before and after completion and catches synchronous output",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ synchronousCompletion: true });
        yield* Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          const request = start("same");
          yield* Effect.all([service.handleStart(request), service.handleStart(request)], {
            concurrency: "unbounded",
          });
          yield* service.awaitIdle(threadId);
          yield* service.handleStart(request);
          expect(h.sends).toHaveLength(1);
          const detail = h.details.get(request.replyTopicId)!;
          expect(detail.messages.map((message) => [message.role, message.text])).toEqual([
            ["user", "Explain same"],
            ["assistant", "A normal answer."],
          ]);
          expect(
            detail.messages.every((message) => message.replyTopicId === request.replyTopicId),
          ).toBe(true);
          expect(detail.messages[0]?.replyTo).toEqual(request.replyTo);
          expect(detail.messages[1]?.replyTo).toEqual({
            messageId: request.message.messageId,
            replyTopicId: request.replyTopicId,
            role: "user",
            text: request.message.text,
          });
        }).pipe(Effect.provide(h.layer));
      }),
  );

  it.effect(
    "queues followups with the previous answer and fresh main context without truncating the new input",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          yield* service.handleStart(start("one"));
          const first = yield* h.nextSend;
          const fullText = "Current request must survive. ".repeat(5_000);
          yield* service.handleStart({
            ...start("two", "one"),
            message: { ...start("two").message, text: fullText },
          });
          h.mainMessages.push({
            ...source,
            id: MessageId.make("new-main"),
            text: "The main task now has a new result.",
          });
          yield* h.publish(
            h.event(first, {
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "Earlier reply answer." },
            }),
          );
          yield* h.complete(first);
          const second = yield* h.nextSend;
          expect(second.input).toBe(fullText);
          expect(second.transcriptHandoff?.text).toContain("Earlier reply answer.");
          expect(second.transcriptHandoff?.text).toContain("The main task now has a new result.");
          expect(second.modelSelection).toEqual(selection);
          expect(second.threadId).not.toBe(first.threadId);
          yield* h.complete(second);
          yield* service.awaitIdle(threadId);
          expect(h.admissions).toHaveLength(2);
          expect(h.releases).toContain(first.threadId);
        }).pipe(Effect.provide(h.layer));
      }),
  );

  it.effect("routes approvals and questions to their owning runtime and exposes their topic", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        const firstRequest = start("one");
        yield* service.handleStart(firstRequest);
        const first = yield* h.nextSend;
        yield* service.handleStart(start("two"));
        const second = yield* h.nextSend;
        const approvalId = ApprovalRequestId.make("permission");
        yield* h.publish({
          ...h.event(first, {
            type: "request.opened",
            payload: { requestType: "command_execution_approval" },
          }),
          requestId: RuntimeRequestId.make(approvalId),
        });
        yield* h.waitForCommand(
          (command) =>
            command.type === "thread.activity.append" &&
            command.activity.kind === "approval.requested",
        );
        expect(h.approvals).toEqual([]);
        const wrong = yield* service
          .respondApproval({
            ...start("wrong", "two"),
            requestId: approvalId,
            decision: "accept",
          })
          .pipe(Effect.exit);
        expect(Exit.isFailure(wrong)).toBe(true);
        yield* service.respondApproval({
          ...firstRequest,
          requestId: approvalId,
          decision: "decline",
        });
        expect(h.approvals[0]?.threadId).toBe(first.threadId);
        const questionId = ApprovalRequestId.make("question");
        yield* h.publish({
          ...h.event(first, {
            type: "user-input.requested",
            payload: {
              questions: [{ id: "q", header: "Choice", question: "Which path?", options: [] }],
            },
          }),
          requestId: RuntimeRequestId.make(questionId),
        });
        yield* h.waitForCommand(
          (command) =>
            command.type === "thread.activity.append" &&
            command.activity.kind === "user-input.requested",
        );
        yield* service.respondUserInput({
          ...firstRequest,
          requestId: questionId,
          answers: { q: { answers: ["Continue"] } },
        });
        expect(h.answers[0]?.threadId).toBe(first.threadId);
        expect(
          h.details
            .get(firstRequest.replyTopicId)
            ?.messages.some((message) => message.text === "Which path?\nContinue"),
        ).toBe(true);
        expect(h.details.get(firstRequest.replyTopicId)?.status).toBe("running");
        expect(
          h.details
            .get(firstRequest.replyTopicId)
            ?.activities.every((activity) => activity.replyTopicId === firstRequest.replyTopicId),
        ).toBe(true);
        yield* h.complete(first);
        yield* h.complete(second);
        yield* service.awaitIdle(threadId);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect(
    "interrupts one exact runtime and retries it without stale output touching the new attempt",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness();
        yield* Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          const request = start("stop");
          yield* service.handleStart(request);
          const first = yield* h.nextSend;
          yield* service.handleStart(start("other"));
          const other = yield* h.nextSend;
          yield* service.interrupt(request);
          expect(h.interrupts.map((target) => target.threadId)).toEqual([first.threadId]);
          expect(h.details.get(request.replyTopicId)?.status).toBe("interrupted");
          yield* service.retry({ ...request, commandId: CommandId.make("retry") });
          const retried = yield* h.nextSend;
          yield* h.publish(
            h.event(first, {
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "Stale output." },
            }),
          );
          yield* h.publish(
            h.event(retried, {
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "Fresh output." },
            }),
          );
          yield* h.complete(retried);
          yield* h.complete(other);
          yield* service.awaitIdle(threadId);
          expect(
            h.details
              .get(request.replyTopicId)
              ?.messages.map((message) => message.text)
              .join(""),
          ).not.toContain("Stale output.");
          expect(h.sends).toHaveLength(3);
        }).pipe(Effect.provide(h.layer));
      }),
  );

  it.effect("cancels queued resource admission without ever starting a provider", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ blockAdmission: true });
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        const request = start("waiting");
        yield* service.handleStart(request);
        yield* Deferred.await(h.admissionRequested);
        yield* service.interrupt(request);
        expect(h.starts).toEqual([]);
        expect(h.sends).toEqual([]);
        expect(h.details.get(request.replyTopicId)?.status).toBe("interrupted");
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("persists failures as a retryable topic and cleans only its runtime", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ failSend: true });
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        yield* service.handleStart(start("failed"));
        yield* service.awaitIdle(threadId);
        expect(h.details.get(start("failed").replyTopicId)?.status).toBe("error");
        expect(h.details.get(start("failed").replyTopicId)?.statusMessage).toContain("send failed");
        expect(h.stops).toHaveLength(1);
        expect(h.stops[0]?.threadId).not.toBe(threadId);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("flushes a short reply before provider completion", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        yield* service.handleStart(start("stream"));
        const sent = yield* h.nextSend;
        yield* h.publish(
          h.event(sent, {
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "First" },
          }),
        );
        yield* h.waitForCommand((command) => command.type === "thread.message.assistant.delta");
        yield* h.publish(
          h.event(sent, {
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: " second" },
          }),
        );
        yield* TestClock.adjust("400 millis");
        yield* h.waitForCommand(
          (command) =>
            command.type === "thread.message.assistant.delta" && command.delta === " second",
        );
        yield* h.complete(sent);
        yield* service.awaitIdle(threadId);
        expect(
          h.details
            .get(start("stream").replyTopicId)
            ?.messages.find((message) => message.role === "assistant")?.text,
        ).toBe("First second");
      }).pipe(Effect.provide(h.layer));
    }),
  );
});

function requestedEvent(
  payload: ThreadReplyStartRequestedPayload,
  sequence: number,
): OrchestrationEvent {
  return {
    type: "thread.reply-start-requested",
    sequence,
    eventId: EventId.make(`requested-${sequence}`),
    aggregateKind: "thread",
    aggregateId: payload.threadId,
    occurredAt: payload.createdAt,
    commandId: payload.commandId,
    causationEventId: null,
    correlationId: payload.commandId,
    metadata: {},
    payload,
  };
}

describe("message reply recovery", () => {
  it.effect(
    "recovers a request persisted before its topic without executing and respects the startup boundary",
    () =>
      Effect.gen(function* () {
        const oldRequest = start("before-crash");
        const liveRequest = start("during-startup");
        const h = yield* makeHarness({
          persistedEvents: [requestedEvent(oldRequest, 1), requestedEvent(liveRequest, 2)],
        });
        yield* Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          yield* service.recoverThread(threadId, 1);
          expect(h.sends).toEqual([]);
          expect(h.details.get(oldRequest.replyTopicId)?.status).toBe("interrupted");
          expect(h.details.get(oldRequest.replyTopicId)?.messages[0]?.text).toBe(
            oldRequest.message.text,
          );
          expect(h.details.has(liveRequest.replyTopicId)).toBe(false);
          yield* service.handleStart(oldRequest);
          expect(h.sends).toEqual([]);
          yield* service.handleStart(liveRequest);
          const live = yield* h.nextSend;
          yield* h.complete(live);
          yield* service.awaitIdle(threadId);
          yield* service.retry({ ...oldRequest, commandId: CommandId.make("retry-after-crash") });
          const retried = yield* h.nextSend;
          expect(retried.input).toBe(oldRequest.message.text);
          yield* h.complete(retried);
          yield* service.awaitIdle(threadId);
        }).pipe(Effect.provide(h.layer));
      }),
  );

  it.effect(
    "settles stale streaming and native requests even if another startup worker already interrupted the topic",
    () =>
      Effect.gen(function* () {
        const request = start("stale");
        const h = yield* makeHarness({ persistedEvents: [requestedEvent(request, 1)] });
        yield* Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          yield* service.recoverThread(threadId, 1);
          const detail = h.details.get(request.replyTopicId)!;
          const staleMessage: OrchestrationMessage = {
            ...source,
            id: MessageId.make("stale-output"),
            text: "Partial",
            streaming: true,
            replyTopicId: request.replyTopicId,
            replyTo: request.replyTo,
          };
          h.details.set(request.replyTopicId, {
            ...detail,
            status: "interrupted",
            messages: [...detail.messages, staleMessage],
            activities: [
              {
                id: EventId.make("approval"),
                tone: "approval",
                kind: "approval.requested",
                summary: "Approval",
                payload: { requestId: "native-approval" },
                turnId: null,
                createdAt,
              },
              {
                id: EventId.make("native-question"),
                tone: "info",
                kind: "user-input.requested",
                summary: "Question",
                payload: { requestId: "native-question" },
                turnId: null,
                createdAt,
              },
              {
                id: EventId.make("async-question"),
                tone: "info",
                kind: "user-input.requested",
                summary: "Question",
                payload: { requestId: "async-question", responseMode: "message" },
                turnId: null,
                createdAt,
              },
            ],
          });
          yield* service.recoverThread(threadId, 1);
          const recovered = h.details.get(request.replyTopicId)!;
          expect(
            recovered.messages.find((message) => message.id === staleMessage.id)?.streaming,
          ).toBe(false);
          expect(
            recovered.activities
              .filter((activity) => activity.kind.endsWith(".resolved"))
              .map((activity) => activity.payload),
          ).toEqual([
            { requestId: "native-approval", replyTopicId: request.replyTopicId },
            { requestId: "native-question", replyTopicId: request.replyTopicId },
          ]);
          expect(h.sends).toEqual([]);
        }).pipe(Effect.provide(h.layer));
      }),
  );

  it.effect("answers asynchronous topic questions after the provider has completed", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        const request = start("async");
        yield* service.handleStart(request);
        const first = yield* h.nextSend;
        const questionId = ApprovalRequestId.make("async-question");
        yield* h.publish({
          ...h.event(first, {
            type: "user-input.requested",
            payload: {
              questions: [{ id: "q", header: "Choice", question: "Which path?", options: [] }],
              responseMode: "message",
            },
          }),
          requestId: RuntimeRequestId.make(questionId),
        });
        yield* h.waitForCommand(
          (command) =>
            command.type === "thread.activity.append" &&
            command.activity.kind === "user-input.requested",
        );
        yield* h.complete(first);
        yield* service.awaitIdle(threadId);
        yield* service.respondUserInput({
          ...request,
          commandId: CommandId.make("answer-async"),
          requestId: questionId,
          answers: { q: { answers: ["Chosen path"] } },
        });
        const followup = yield* h.nextSend;
        expect(followup.input).toContain("Chosen path");
        expect(h.answers).toEqual([]);
        yield* h.complete(followup);
        yield* service.awaitIdle(threadId);
        expect(
          h.details
            .get(request.replyTopicId)
            ?.activities.some((activity) => activity.kind === "user-input.resolved"),
        ).toBe(true);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("cancels a provider that is still starting without waiting for startup to finish", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ blockStart: true });
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        const request = start("starting");
        yield* service.handleStart(request);
        yield* Deferred.await(h.sessionStarting);
        yield* service.interrupt(request);
        yield* Deferred.await(h.sessionStartInterrupted);
        expect(h.sends).toEqual([]);
        expect(h.details.get(request.replyTopicId)?.status).toBe("interrupted");
        expect(h.stops[0]?.runtimeSessionId).toBe(h.starts[0]?.runtimeSessionId);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("cancels topic runtimes during service shutdown", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* MessageReplyCoordinator;
          yield* service.handleStart(start("shutdown"));
          yield* h.nextSend;
        }).pipe(Effect.provide(h.layer)),
      );
      expect(h.interrupts).toHaveLength(1);
      expect(h.stops.length).toBeGreaterThan(0);
      expect(h.stops.every((target) => target.threadId !== threadId)).toBe(true);
    }),
  );
});

describe("reply transcript completeness", () => {
  it.effect("keeps final assistant items from providers that omit item ids", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness();
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        yield* service.handleStart(start("items"));
        const sent = yield* h.nextSend;
        yield* h.publish(
          h.event(sent, {
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "Working through the answer." },
          }),
        );
        yield* h.publish(
          h.event(sent, {
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              detail: "Working through the answer.",
            },
          }),
        );
        yield* h.publish(
          h.event(sent, {
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              detail: "Here is the final answer.",
            },
          }),
        );
        yield* h.complete(sent);
        yield* service.awaitIdle(threadId);
        expect(
          h.details
            .get(start("items").replyTopicId)
            ?.messages.find((message) => message.role === "assistant")?.text,
        ).toBe("Working through the answer.\n\nHere is the final answer.");
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("recovers an accepted question answer without sending it a second time", () =>
    Effect.gen(function* () {
      const request = start("answer-recovery");
      const response: OrchestrationEvent = {
        ...requestedEvent(request, 2),
        type: "thread.reply-user-input-response-requested",
        payload: {
          commandId: CommandId.make("saved-response"),
          threadId,
          replyTopicId: request.replyTopicId,
          requestId: ApprovalRequestId.make("question"),
          answers: { q: { answers: ["Preserved answer"] } },
          createdAt,
        },
      };
      const h = yield* makeHarness({ persistedEvents: [requestedEvent(request, 1), response] });
      yield* Effect.gen(function* () {
        const service = yield* MessageReplyCoordinator;
        yield* service.recoverThread(threadId, 2);
        const detail = h.details.get(request.replyTopicId)!;
        expect(detail.messages.at(-1)?.text).toContain("Preserved answer");
        expect(detail.status).toBe("interrupted");
        expect(h.sends).toEqual([]);
        yield* service.recoverThread(threadId, 2);
        expect(h.details.get(request.replyTopicId)?.messages).toHaveLength(2);
        yield* service.retry({ ...request, commandId: CommandId.make("retry-saved-answer") });
        const sent = yield* h.nextSend;
        expect(sent.input).toContain("Preserved answer");
        yield* h.complete(sent);
        yield* service.awaitIdle(threadId);
      }).pipe(Effect.provide(h.layer));
    }),
  );
});
