import {
  ApprovalRequestId,
  CommandId,
  UserInputRequestedPayload,
  EventId,
  MessageId,
  type IsoDateTime,
  type MessageReplyReference,
  type OrchestrationMessage,
  type OrchestrationSubagentDetail,
  type ProviderRuntimeEvent,
  type SubagentId,
  type ThreadId,
  type ThreadReplyApprovalResponseRequestedPayload,
  type ThreadReplyInterruptRequestedPayload,
  type ThreadReplyRetryRequestedPayload,
  type ThreadReplyStartRequestedPayload,
  type ThreadReplyUserInputDismissRequestedPayload,
  type ThreadReplyUserInputResponseRequestedPayload,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { findOpenPendingInteractions } from "../orchestration/pendingInteractionLifecycle.ts";
import { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import { buildMessageReplyHandoff, formatMessageReplyAnswers } from "./MessageReplyPrompt.ts";
import { makeMessageReplyProjection } from "./MessageReplyProjection.ts";
import {
  makeActiveMessageReply,
  type ActiveMessageReply,
  type MessageReplyJob,
  type MessageReplyOutcome,
  type MessageReplyTopicState,
} from "./MessageReplyState.ts";
import { makeMessageReplyTransport } from "./MessageReplyTransport.ts";
import { makeMessageReplySummary } from "./MessageReplySummary.ts";

const TRANSCRIPT_FLUSH_CHARS = 2_048;
const MAIN_CONTEXT_MESSAGE_LIMIT = 32;
const TRANSCRIPT_FLUSH_INTERVAL = Duration.millis(400);
const RECOVERY_DETAIL =
  "The server restarted before this reply completed. Retry to continue this topic.";

export class MessageReplyError extends Schema.TaggedError<MessageReplyError>()(
  "MessageReplyError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

export interface MessageReplyCoordinatorShape {
  readonly handleStart: (
    input: ThreadReplyStartRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly interrupt: (
    input: ThreadReplyInterruptRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly retry: (
    input: ThreadReplyRetryRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly respondApproval: (
    input: ThreadReplyApprovalResponseRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly respondUserInput: (
    input: ThreadReplyUserInputResponseRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly dismissUserInput: (
    input: ThreadReplyUserInputDismissRequestedPayload,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly cancelThread: (threadId: ThreadId) => Effect.Effect<void, MessageReplyError>;
  readonly recoverThread: (
    threadId: ThreadId,
    throughSequence?: number,
  ) => Effect.Effect<void, MessageReplyError>;
  readonly hasActiveTopic: (threadId: ThreadId) => boolean;
  readonly awaitIdle: (threadId: ThreadId) => Effect.Effect<void>;
}

export class MessageReplyCoordinator extends Context.Service<
  MessageReplyCoordinator,
  MessageReplyCoordinatorShape
>()("t3/messageReplies/MessageReplyCoordinator") {}

const isMessageReplyError = Schema.is(MessageReplyError);
const decodeUserInput = Schema.decodeUnknownOption(UserInputRequestedPayload);
const publicError = (error: unknown) =>
  isMessageReplyError(error)
    ? error
    : new MessageReplyError({
        detail: error instanceof Error ? error.message : String(error),
      });

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const providerService = yield* ProviderService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const query = yield* ProjectionSnapshotQuery;
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const resourceGovernor = Option.getOrUndefined(
    yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
  );
  const transport = makeMessageReplyTransport({
    providerService,
    ...(resourceGovernor ? { resourceGovernor } : {}),
  });
  const projection = makeMessageReplyProjection({
    generation: yield* crypto.randomUUIDv4,
    orchestrationEngine,
    threadBackgroundLiveness,
  });
  const scope = yield* Effect.acquireRelease(Scope.make(), (value) =>
    Scope.close(value, Exit.void),
  );
  const mutex = yield* Semaphore.make(1);
  const topics = new Map<SubagentId, MessageReplyTopicState>();
  const runs = new Map<ThreadId, ActiveMessageReply>();
  const idleWaiters = new Map<ThreadId, Set<Deferred.Deferred<void>>>();
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const hasActiveTopic = (threadId: ThreadId) =>
    Array.from(topics.values()).some(
      (topic) => topic.parentThreadId === threadId && topic.draining,
    );

  const signalIdle = Effect.fnUntraced(function* (threadId: ThreadId) {
    if (hasActiveTopic(threadId)) return;
    for (const waiter of idleWaiters.get(threadId) ?? [])
      yield* Deferred.succeed(waiter, undefined);
    idleWaiters.delete(threadId);
  });

  const parent = Effect.fn("MessageReplyCoordinator.parent")(function* (threadId: ThreadId) {
    const [threadOption, workspaceOption] = yield* Effect.all([
      query.getThreadShellById(threadId),
      query.getThreadCheckpointContext(threadId),
    ]);
    const thread = Option.getOrUndefined(threadOption);
    const workspace = Option.getOrUndefined(workspaceOption);
    if (!thread || !workspace || thread.archivedAt) {
      return yield* new MessageReplyError({
        detail: "This thread is no longer available for replies.",
      });
    }
    return { thread, workspacePath: workspace.worktreePath ?? workspace.workspaceRoot };
  });

  const loadTopic = Effect.fn("MessageReplyCoordinator.loadTopic")(function* (
    threadId: ThreadId,
    topicId: SubagentId,
  ) {
    const active = topics.get(topicId);
    if (active) {
      if (active.parentThreadId !== threadId)
        return yield* new MessageReplyError({ detail: "Reply topic belongs to another thread." });
      return active;
    }
    const detail = Option.getOrUndefined(
      yield* query.getSubagentDetailSnapshot(threadId, topicId, { activityLimit: 1 }),
    )?.subagent;
    if (!detail?.messageReply) return undefined;
    const { messages, activities: _activities, proposedPlans: _plans, ...summary } = detail;
    return {
      parentThreadId: threadId,
      id: topicId,
      providerDriver: detail.providerDriver,
      summary: { ...summary, messageReply: detail.messageReply },
      messages: [...messages],
      jobs: [],
      commands: new Set(
        detail.messageReply.lastCommandId ? [detail.messageReply.lastCommandId] : [],
      ),
      active: null,
      draining: false,
      cancelled: false,
    } satisfies MessageReplyTopicState;
  });

  const newTopic = Effect.fn("MessageReplyCoordinator.newTopic")(function* (
    input: ThreadReplyStartRequestedPayload,
  ) {
    const resolved = yield* parent(input.threadId);
    const info = yield* providerService
      .getInstanceInfo(resolved.thread.modelSelection.instanceId)
      .pipe(Effect.option);
    const summary = makeMessageReplySummary({
      thread: resolved.thread,
      workspacePath: resolved.workspacePath,
      input,
      providerDriver: Option.isSome(info) ? info.value.driverKind : null,
    });
    return {
      parentThreadId: input.threadId,
      id: input.replyTopicId,
      providerDriver: summary.providerDriver,
      summary,
      messages: [],
      jobs: [],
      commands: new Set(),
      active: null,
      draining: false,
      cancelled: false,
    } satisfies MessageReplyTopicState;
  });

  const resolveInteraction = (
    topic: MessageReplyTopicState,
    requestId: ApprovalRequestId,
    kind: "approval" | "user-input",
    createdAt: IsoDateTime,
    suffix: string,
  ) =>
    projection.activity(topic, {
      id: EventId.make(`reply:${topic.id}:${kind}:${requestId}:${suffix}`),
      kind: `${kind}.resolved`,
      tone: "info",
      summary: kind === "approval" ? "Reply approval resolved" : "Reply question resolved",
      payload: { requestId },
      turnId: topic.active?.turnId ?? null,
      createdAt,
    });

  const finish = Effect.fn("MessageReplyCoordinator.finish")(function* (
    run: ActiveMessageReply,
    outcome: MessageReplyOutcome,
  ) {
    if (run.settled) return;
    run.settled = true;
    const completedAt = yield* nowIso;
    yield* projection.complete(run, completedAt);
    for (const requestId of run.approvals) {
      yield* resolveInteraction(run.topic, requestId, "approval", completedAt, run.job.commandId);
    }
    for (const [requestId, request] of run.userInputs) {
      if (request.payload.responseMode !== "message") {
        yield* resolveInteraction(
          run.topic,
          requestId,
          "user-input",
          completedAt,
          run.job.commandId,
        );
      }
    }
    yield* projection.summary(run.topic, {
      ...run.topic.summary,
      status: outcome.status,
      statusMessage: outcome.detail ?? null,
      latestTurn: run.turnId
        ? {
            turnId: run.turnId,
            state: outcome.status,
            requestedAt: run.job.message.createdAt,
            startedAt: run.startedAt,
            completedAt,
            assistantMessageId: run.assistantProjected ? run.assistantMessageId : null,
          }
        : null,
      updatedAt: completedAt,
      completedAt,
    });
  });

  const execute = Effect.fn("MessageReplyCoordinator.execute")(function* (run: ActiveMessageReply) {
    yield* parent(run.topic.parentThreadId);
    const mainMessages = yield* query.getRecentThreadMessages(
      run.topic.parentThreadId,
      MAIN_CONTEXT_MESSAGE_LIMIT,
    );
    const providerInfo = yield* providerService.getInstanceInfo(
      run.topic.summary.messageReply.modelSelection.instanceId,
    );
    run.topic.providerDriver = providerInfo.driverKind;
    if (run.topic.summary.providerDriver !== providerInfo.driverKind) {
      yield* projection.summary(run.topic, {
        ...run.topic.summary,
        providerDriver: providerInfo.driverKind,
      });
    }
    const pendingMessages = new Set([
      run.job.message.id,
      ...run.topic.jobs.map((job) => job.message.id),
    ]);
    const reference = run.job.message.replyTo ?? run.topic.summary.messageReply.replyTo;
    const rootReference = run.topic.summary.messageReply.replyTo;
    const sourceMessages = (yield* Effect.forEach([reference, rootReference], (replyTo) =>
      Effect.gen(function* () {
        const messages = replyTo.replyTopicId === run.topic.id ? run.topic.messages : mainMessages;
        const source = messages.find((message) => message.id === replyTo.messageId);
        if (source) return [source];
        if (replyTo.replyTopicId) return [];
        const exact = Option.getOrUndefined(
          yield* query.getTurnStartMessage({
            threadId: run.topic.parentThreadId,
            messageId: replyTo.messageId,
          }),
        );
        return exact ? [exact.message] : [];
      }),
    )).flat();
    const handoff = buildMessageReplyHandoff({
      replyTo: reference,
      rootReplyTo: rootReference,
      sourceMessages,
      currentMessage: run.job.message,
      mainMessages,
      topicMessages: run.topic.messages.filter((message) => !pendingMessages.has(message.id)),
    });
    if (run.cancelled || !(yield* transport.awaitAdmission(run))) {
      return {
        status: "interrupted" as const,
        detail: "Reply stopped before its session started.",
      };
    }
    if (run.cancelled) return { status: "interrupted" as const };
    run.sessionStarted = true;
    const session = yield* transport.start(run);
    if (session.runtimeSessionId !== run.runtimeSessionId) {
      return {
        status: "error" as const,
        detail: "Reply runtime returned a different session generation.",
      };
    }
    if (run.cancelled) return { status: "interrupted" as const };
    const sent = yield* transport.send(run, handoff);
    run.turnId ??= sent.turnId;
    if (!(yield* Deferred.isDone(run.terminal))) {
      yield* projection.summary(run.topic, {
        ...run.topic.summary,
        status:
          run.approvals.size > 0 ||
          Array.from(run.userInputs.values()).some(
            (request) => request.payload.responseMode !== "message",
          )
            ? "waiting"
            : "running",
        latestTurn: {
          turnId: run.turnId,
          state: "running",
          requestedAt: run.job.message.createdAt,
          startedAt: run.startedAt,
          completedAt: null,
          assistantMessageId: run.assistantProjected ? run.assistantMessageId : null,
        },
        updatedAt: yield* nowIso,
      });
    }
    return yield* Deferred.await(run.terminal);
  });

  const drain = Effect.fn("MessageReplyCoordinator.drain")(function* (
    topic: MessageReplyTopicState,
  ) {
    try {
      while (topic.jobs.length > 0 && !topic.cancelled) {
        const job = topic.jobs.shift()!;
        const run = yield* makeActiveMessageReply(
          topic,
          job,
          yield* crypto.randomUUIDv4,
          yield* nowIso,
        );
        topic.active = run;
        runs.set(run.syntheticThreadId, run);
        const outcome = yield* Effect.gen(function* () {
          yield* projection.summary(topic, {
            ...topic.summary,
            messageReply: {
              ...topic.summary.messageReply,
              lastCommandId: job.commandId,
              lastUserMessageId: job.message.id,
            },
            status: "starting",
            statusMessage: null,
            latestTurn: null,
            completedAt: null,
            updatedAt: run.startedAt,
          });
          return yield* execute(run);
        }).pipe(
          Effect.raceFirst(Deferred.await(run.abort)),
          Effect.catchCause((cause) =>
            Effect.succeed({
              status:
                Cause.hasInterruptsOnly(cause) || run.cancelled
                  ? ("interrupted" as const)
                  : ("error" as const),
              detail: Cause.pretty(cause),
            }),
          ),
        );
        yield* finish(run, outcome).pipe(
          Effect.ensuring(transport.cleanup(run)),
          Effect.ensuring(
            Effect.sync(() => {
              runs.delete(run.syntheticThreadId);
              topic.active = null;
            }),
          ),
          Effect.ensuring(Deferred.succeed(run.finished, undefined).pipe(Effect.asVoid)),
        );
      }
    } finally {
      topic.draining = false;
      topics.delete(topic.id);
      yield* signalIdle(topic.parentThreadId);
    }
  });

  const schedule = Effect.fn("MessageReplyCoordinator.schedule")(function* (
    topic: MessageReplyTopicState,
    job: MessageReplyJob,
  ) {
    topic.jobs.push(job);
    topics.set(topic.id, topic);
    if (topic.draining) return;
    topic.draining = true;
    yield* drain(topic).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Reply topic execution failed", {
          replyTopicId: topic.id,
          cause: Cause.pretty(cause),
        }),
      ),
      Effect.forkIn(scope),
    );
  });

  const prepareStart = Effect.fn("MessageReplyCoordinator.prepareStart")(function* (
    input: ThreadReplyStartRequestedPayload,
    recovering = false,
  ) {
    yield* parent(input.threadId);
    const topic =
      (yield* loadTopic(input.threadId, input.replyTopicId)) ?? (yield* newTopic(input));
    if (topic.messages.some((message) => message.id === input.message.messageId)) return;
    const message: OrchestrationMessage = {
      id: input.message.messageId,
      role: "user",
      text: input.message.text,
      attachments: input.message.attachments,
      ...(input.message.context ? { context: input.message.context } : {}),
      replyTo: input.replyTo,
      replyTopicId: input.replyTopicId,
      turnId: null,
      streaming: false,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    yield* projection.summary(topic, {
      ...topic.summary,
      messageReply: {
        ...topic.summary.messageReply,
        lastCommandId: input.commandId,
        lastUserMessageId: message.id,
      },
      status: recovering ? "interrupted" : topic.draining ? topic.summary.status : "starting",
      statusMessage: recovering ? RECOVERY_DETAIL : null,
      updatedAt: input.createdAt,
      completedAt: recovering ? input.createdAt : null,
    });
    yield* projection.importMessage(topic, message);
    topic.commands.add(input.commandId);
    if (!recovering) yield* schedule(topic, { commandId: input.commandId, message });
  });

  const handleStart: MessageReplyCoordinatorShape["handleStart"] = (input) =>
    mutex.withPermit(prepareStart(input)).pipe(Effect.mapError(publicError));

  const cancelTopic = Effect.fn("MessageReplyCoordinator.cancelTopic")(function* (
    topic: MessageReplyTopicState,
  ) {
    topic.cancelled = true;
    topic.jobs.length = 0;
    const run = topic.active;
    if (!run) return;
    run.cancelled = true;
    yield* transport.interrupt(run);
    yield* Deferred.succeed(run.abort, { status: "interrupted", detail: "Reply stopped." });
    yield* Deferred.await(run.finished);
  });

  const interrupt: MessageReplyCoordinatorShape["interrupt"] = (input) =>
    Effect.gen(function* () {
      const topic = topics.get(input.replyTopicId);
      if (!topic || topic.parentThreadId !== input.threadId) return;
      yield* cancelTopic(topic);
    }).pipe(Effect.mapError(publicError));

  const retry: MessageReplyCoordinatorShape["retry"] = (input) =>
    mutex
      .withPermit(
        Effect.gen(function* () {
          yield* parent(input.threadId);
          const topic = yield* loadTopic(input.threadId, input.replyTopicId);
          if (!topic)
            return yield* new MessageReplyError({ detail: "This reply topic is unavailable." });
          if (topic.commands.has(input.commandId)) return;
          if (topic.draining)
            return yield* new MessageReplyError({
              detail: "Stop the active reply before retrying it.",
            });
          const message = topic.messages.findLast((candidate) => candidate.role === "user");
          if (!message)
            return yield* new MessageReplyError({
              detail: "This reply has no user message to retry.",
            });
          yield* projection.summary(topic, {
            ...topic.summary,
            messageReply: {
              ...topic.summary.messageReply,
              lastCommandId: input.commandId,
              lastUserMessageId: message.id,
            },
            status: "starting",
            statusMessage: null,
            updatedAt: input.createdAt,
            completedAt: null,
          });
          topic.commands.add(input.commandId);
          yield* schedule(topic, { commandId: input.commandId, message });
        }),
      )
      .pipe(Effect.mapError(publicError));

  const ownedRun = (threadId: ThreadId, topicId: SubagentId) => {
    const topic = topics.get(topicId);
    return topic?.parentThreadId === threadId && topic.active && !topic.active.settled
      ? topic.active
      : undefined;
  };

  const updateWaitingStatus = (run: ActiveMessageReply, updatedAt: IsoDateTime) => {
    if (run.settled) return Effect.void;
    const waiting =
      run.approvals.size > 0 ||
      Array.from(run.userInputs.values()).some(
        (request) => request.payload.responseMode !== "message",
      );
    const status = waiting ? "waiting" : "running";
    return run.topic.summary.status === status
      ? Effect.void
      : projection.summary(run.topic, { ...run.topic.summary, status, updatedAt });
  };

  const respondApproval: MessageReplyCoordinatorShape["respondApproval"] = (input) =>
    mutex
      .withPermit(
        Effect.gen(function* () {
          const run = ownedRun(input.threadId, input.replyTopicId);
          if (!run?.approvals.has(input.requestId))
            return yield* new MessageReplyError({
              detail: "This reply approval is no longer pending.",
            });
          yield* providerService.respondToRequest({
            threadId: run.syntheticThreadId,
            requestId: input.requestId,
            decision: input.decision,
          });
          run.approvals.delete(input.requestId);
          yield* updateWaitingStatus(run, input.createdAt);
          yield* resolveInteraction(
            run.topic,
            input.requestId,
            "approval",
            input.createdAt,
            input.commandId,
          );
        }),
      )
      .pipe(Effect.mapError(publicError));

  const pendingMessageQuestion = (
    detail: OrchestrationSubagentDetail,
    requestId: ApprovalRequestId,
  ) => {
    for (let index = detail.activities.length - 1; index >= 0; index -= 1) {
      const activity = detail.activities[index]!;
      if (!Predicate.isObject(activity.payload) || activity.payload.requestId !== requestId)
        continue;
      if (activity.kind === "user-input.resolved") return undefined;
      if (activity.kind === "user-input.requested")
        return activity.payload.responseMode === "message" ? activity : undefined;
    }
    return undefined;
  };

  const respondUserInput: MessageReplyCoordinatorShape["respondUserInput"] = (input) =>
    mutex
      .withPermit(
        Effect.gen(function* () {
          const run = ownedRun(input.threadId, input.replyTopicId);
          const request = run?.userInputs.get(input.requestId);
          if (run && request && request.payload.responseMode !== "message") {
            yield* providerService.respondToUserInput({
              threadId: run.syntheticThreadId,
              requestId: input.requestId,
              answers: input.answers,
              ...(input.attachmentsByQuestionId
                ? { attachmentsByQuestionId: input.attachmentsByQuestionId }
                : {}),
            });
            run.userInputs.delete(input.requestId);
            yield* projection.importMessage(run.topic, {
              id: MessageId.make(`reply:${input.replyTopicId}:answer:${input.commandId}`),
              role: "user",
              text: formatMessageReplyAnswers(input.answers, request.payload.questions),
              attachments: Object.values(input.attachmentsByQuestionId ?? {}).flat(),
              replyTopicId: input.replyTopicId,
              replyTo: run.assistantProjected
                ? {
                    messageId: run.assistantMessageId,
                    role: "assistant",
                    text: run.assistantText,
                    replyTopicId: input.replyTopicId,
                  }
                : run.topic.summary.messageReply.replyTo,
              turnId: run.turnId,
              streaming: false,
              createdAt: input.createdAt,
              updatedAt: input.createdAt,
            });
            yield* updateWaitingStatus(run, input.createdAt);
            yield* resolveInteraction(
              run.topic,
              input.requestId,
              "user-input",
              input.createdAt,
              input.commandId,
            );
            return;
          }
          const detail = Option.getOrUndefined(
            yield* query.getSubagentDetailById(input.threadId, input.replyTopicId),
          );
          const question = detail ? pendingMessageQuestion(detail, input.requestId) : undefined;
          if (!detail?.messageReply || !question)
            return yield* new MessageReplyError({
              detail: "This reply question is no longer pending.",
            });
          const parsedQuestion = Option.getOrUndefined(decodeUserInput(question.payload));
          if (!parsedQuestion)
            return yield* new MessageReplyError({ detail: "The saved reply question is invalid." });
          const messageId = MessageId.make(`reply:${input.replyTopicId}:answer:${input.commandId}`);
          const latestAssistant = detail.messages.findLast(
            (message) => message.role === "assistant",
          );
          const replyTo: MessageReplyReference = latestAssistant
            ? {
                messageId: latestAssistant.id,
                role: "assistant",
                text: latestAssistant.text,
                replyTopicId: input.replyTopicId,
              }
            : detail.messageReply.replyTo;
          yield* prepareStart({
            commandId: input.commandId,
            threadId: input.threadId,
            replyTopicId: input.replyTopicId,
            replyTo,
            message: {
              messageId,
              role: "user",
              text: formatMessageReplyAnswers(input.answers, parsedQuestion.questions),
              attachments: Object.values(input.attachmentsByQuestionId ?? {}).flat(),
            },
            createdAt: input.createdAt,
          });
          const topic = yield* loadTopic(input.threadId, input.replyTopicId);
          if (topic)
            yield* resolveInteraction(
              topic,
              input.requestId,
              "user-input",
              input.createdAt,
              input.commandId,
            );
        }),
      )
      .pipe(Effect.mapError(publicError));

  const dismissUserInput: MessageReplyCoordinatorShape["dismissUserInput"] = (input) =>
    mutex
      .withPermit(
        Effect.gen(function* () {
          const detail = Option.getOrUndefined(
            yield* query.getSubagentDetailById(input.threadId, input.replyTopicId),
          );
          if (!detail || !pendingMessageQuestion(detail, input.requestId))
            return yield* new MessageReplyError({
              detail: "Only an asynchronous reply question can be dismissed.",
            });
          const topic = yield* loadTopic(input.threadId, input.replyTopicId);
          if (topic)
            yield* resolveInteraction(
              topic,
              input.requestId,
              "user-input",
              input.createdAt,
              input.commandId,
            );
        }),
      )
      .pipe(Effect.mapError(publicError));

  const handleEvent = Effect.fn("MessageReplyCoordinator.handleEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const run = runs.get(event.threadId);
    if (
      !run ||
      run.settled ||
      event.runtimeSessionId !== run.runtimeSessionId ||
      (event.providerInstanceId !== undefined &&
        event.providerInstanceId !== run.topic.summary.messageReply.modelSelection.instanceId) ||
      (event.turnId !== undefined && run.turnId !== null && event.turnId !== run.turnId)
    )
      return;
    if (event.type === "turn.started" && event.turnId) {
      run.turnId = event.turnId;
      yield* projection.summary(run.topic, {
        ...run.topic.summary,
        status: "running",
        latestTurn: {
          turnId: event.turnId,
          state: "running",
          requestedAt: run.job.message.createdAt,
          startedAt: event.createdAt,
          completedAt: null,
          assistantMessageId: run.assistantProjected ? run.assistantMessageId : null,
        },
        updatedAt: event.createdAt,
      });
    }
    if (event.type === "thread.started" && event.payload.providerThreadId) {
      yield* projection.summary(run.topic, {
        ...run.topic.summary,
        providerThreadId: event.payload.providerThreadId,
        updatedAt: event.createdAt,
      });
    }
    if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
      const item = event.itemId ?? "assistant";
      const separator = !run.itemText.has(item) && run.assistantText.length > 0 ? "\n\n" : "";
      run.itemText.set(item, (run.itemText.get(item) ?? "") + event.payload.delta);
      run.assistantText += separator + event.payload.delta;
      run.transcriptBuffer += separator + event.payload.delta;
      if (!run.assistantProjected || run.transcriptBuffer.length >= TRANSCRIPT_FLUSH_CHARS) {
        yield* projection.flush(run, event.createdAt);
      } else if (!run.flushScheduled) {
        run.flushScheduled = true;
        yield* Effect.gen(function* () {
          yield* Effect.sleep(TRANSCRIPT_FLUSH_INTERVAL);
          if (!run.settled) yield* projection.flush(run, yield* nowIso);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              run.flushScheduled = false;
            }),
          ),
          Effect.catchCause((cause) =>
            Deferred.succeed(run.terminal, { status: "error", detail: Cause.pretty(cause) }),
          ),
          Effect.forkIn(scope),
        );
      }
    }
    if (event.type === "item.completed" && event.payload.itemType === "assistant_message") {
      const text =
        event.payload.detail ??
        (Predicate.isObject(event.payload.data) && typeof event.payload.data.text === "string"
          ? event.payload.data.text
          : undefined);
      if (text) {
        const previous = run.itemText.get(event.itemId ?? "assistant") ?? "";
        const missing =
          previous.length > 0 && text.startsWith(previous)
            ? text.slice(previous.length)
            : previous.length > 0 && previous.endsWith(text)
              ? ""
              : `${run.assistantText.length > 0 ? "\n\n" : ""}${text}`;
        run.assistantText += missing;
        run.transcriptBuffer += missing;
        run.itemText.set(event.itemId ?? "assistant", text);
        yield* projection.flush(run, event.createdAt);
      }
    }
    if (
      event.type === "request.opened" &&
      event.requestId &&
      event.payload.requestType !== "tool_user_input"
    )
      run.approvals.add(ApprovalRequestId.make(event.requestId));
    if (event.type === "request.resolved" && event.requestId)
      run.approvals.delete(ApprovalRequestId.make(event.requestId));
    if (event.type === "user-input.requested" && event.requestId)
      run.userInputs.set(ApprovalRequestId.make(event.requestId), event);
    if (event.type === "user-input.resolved" && event.requestId)
      run.userInputs.delete(ApprovalRequestId.make(event.requestId));
    yield* projection.runtimeActivity(run, event);
    if (
      event.type === "request.opened" ||
      (event.type === "user-input.requested" && event.payload.responseMode !== "message")
    ) {
      yield* projection.flush(run, event.createdAt);
      yield* updateWaitingStatus(run, event.createdAt);
    }
    if (event.type === "request.resolved" || event.type === "user-input.resolved") {
      yield* updateWaitingStatus(run, event.createdAt);
    }
    let outcome: MessageReplyOutcome | undefined;
    if (event.type === "turn.completed")
      outcome = {
        status:
          event.payload.state === "completed"
            ? "completed"
            : event.payload.state === "interrupted" || event.payload.state === "cancelled"
              ? "interrupted"
              : "error",
        ...(event.payload.errorMessage ? { detail: event.payload.errorMessage } : {}),
      };
    if (event.type === "turn.aborted")
      outcome = {
        status: "interrupted",
        ...(event.payload.reason ? { detail: event.payload.reason } : {}),
      };
    if (event.type === "session.exited")
      outcome = {
        status: "error",
        detail: event.payload.reason ?? "Reply provider session exited.",
      };
    if (event.type === "session.state.changed" && event.payload.state === "error")
      outcome = {
        status: "error",
        detail: event.payload.reason ?? "Reply provider session failed.",
      };
    if (outcome) yield* Deferred.succeed(run.terminal, outcome);
  });

  const events = providerService.subscribeEvents
    ? yield* providerService.subscribeEvents
    : providerService.streamEvents;
  yield* Stream.runForEach(events, (event) =>
    handleEvent(event).pipe(
      Effect.catchCause((cause) => {
        const run = runs.get(event.threadId);
        return run
          ? Deferred.succeed(run.terminal, { status: "error", detail: Cause.pretty(cause) }).pipe(
              Effect.asVoid,
            )
          : Effect.logWarning("Reply event handling failed", { cause: Cause.pretty(cause) });
      }),
    ),
  ).pipe(Effect.forkIn(scope));

  const cancelThread: MessageReplyCoordinatorShape["cancelThread"] = (threadId) =>
    Effect.forEach(
      Array.from(topics.values()).filter((topic) => topic.parentThreadId === threadId),
      cancelTopic,
      { concurrency: "unbounded", discard: true },
    ).pipe(Effect.mapError(publicError));

  const recoverUserResponse = Effect.fn("MessageReplyCoordinator.recoverUserResponse")(function* (
    input: ThreadReplyUserInputResponseRequestedPayload,
  ) {
    const detail = Option.getOrUndefined(
      yield* query.getSubagentDetailById(input.threadId, input.replyTopicId),
    );
    if (!detail?.messageReply) return;
    const messageId = MessageId.make(`reply:${input.replyTopicId}:answer:${input.commandId}`);
    if (detail.messages.some((message) => message.id === messageId)) return;
    const request = detail.activities.findLast(
      (activity) =>
        activity.kind === "user-input.requested" &&
        Predicate.isObject(activity.payload) &&
        activity.payload.requestId === input.requestId,
    );
    const parsed = request ? Option.getOrUndefined(decodeUserInput(request.payload)) : undefined;
    const assistant = detail.messages.findLast((message) => message.role === "assistant");
    yield* prepareStart(
      {
        commandId: input.commandId,
        threadId: input.threadId,
        replyTopicId: input.replyTopicId,
        replyTo: assistant
          ? {
              messageId: assistant.id,
              role: "assistant",
              text: assistant.text,
              replyTopicId: input.replyTopicId,
            }
          : detail.messageReply.replyTo,
        message: {
          messageId,
          role: "user",
          text: formatMessageReplyAnswers(input.answers, parsed?.questions ?? []),
          attachments: Object.values(input.attachmentsByQuestionId ?? {}).flat(),
        },
        createdAt: input.createdAt,
      },
      true,
    );
    const topic = yield* loadTopic(input.threadId, input.replyTopicId);
    if (topic)
      yield* resolveInteraction(
        topic,
        input.requestId,
        "user-input",
        input.createdAt,
        input.commandId,
      );
  });

  const recoverThread: MessageReplyCoordinatorShape["recoverThread"] = (
    threadId,
    throughSequence,
  ) =>
    mutex
      .withPermit(
        Effect.gen(function* () {
          if (hasActiveTopic(threadId)) return;
          const thread = Option.getOrUndefined(yield* query.getThreadDetailById(threadId));
          if (!thread || thread.deletedAt || thread.archivedAt) return;
          const head = throughSequence ?? (yield* orchestrationEngine.latestSequence);
          const events = yield* query.getMessageReplyRequestEvents(threadId, head);
          const latestTurns = new Map<SubagentId, (typeof events)[number]>();
          const knownMessages = new Map<SubagentId, Set<MessageId>>();
          for (const event of events) {
            if (event.type === "thread.reply-start-requested") {
              let messageIds = knownMessages.get(event.payload.replyTopicId);
              if (!messageIds) {
                const detail = Option.getOrUndefined(
                  yield* query.getSubagentDetailById(threadId, event.payload.replyTopicId),
                );
                messageIds = new Set(detail?.messages.map((message) => message.id) ?? []);
                knownMessages.set(event.payload.replyTopicId, messageIds);
              }
              if (!messageIds.has(event.payload.message.messageId)) {
                yield* prepareStart(event.payload, true);
                messageIds.add(event.payload.message.messageId);
              }
              latestTurns.set(event.payload.replyTopicId, event);
            }
            if (event.type === "thread.reply-retry-requested")
              latestTurns.set(event.payload.replyTopicId, event);
            if (event.type === "thread.reply-user-input-response-requested") {
              yield* recoverUserResponse(event.payload);
              latestTurns.set(event.payload.replyTopicId, event);
            }
            if (event.type === "thread.reply-user-input-dismiss-requested") {
              const topic = yield* loadTopic(threadId, event.payload.replyTopicId);
              if (topic)
                yield* resolveInteraction(
                  topic,
                  event.payload.requestId,
                  "user-input",
                  event.payload.createdAt,
                  event.payload.commandId,
                );
            }
          }
          for (const event of latestTurns.values()) {
            if (event.type !== "thread.reply-retry-requested") continue;
            const topic = yield* loadTopic(threadId, event.payload.replyTopicId);
            if (!topic || topic.summary.messageReply.lastCommandId === event.payload.commandId)
              continue;
            yield* projection.summary(topic, {
              ...topic.summary,
              messageReply: {
                ...topic.summary.messageReply,
                lastCommandId: event.payload.commandId,
              },
              status: "interrupted",
              statusMessage: RECOVERY_DETAIL,
              updatedAt: yield* nowIso,
              completedAt: yield* nowIso,
            });
          }
          const current = Option.getOrUndefined(yield* query.getThreadDetailById(threadId));
          for (const summary of current?.subagents ?? []) {
            if (!summary.messageReply) continue;
            const topic = yield* loadTopic(threadId, summary.id);
            const detail = Option.getOrUndefined(
              yield* query.getSubagentDetailById(threadId, summary.id),
            );
            if (!topic || !detail) continue;
            const pending = findOpenPendingInteractions({ activities: detail.activities });
            const nativeQuestions = pending.userInputs.filter((request) => {
              const opened = detail.activities.find(
                (activity) => activity.id === request.requestActivityId,
              );
              return (
                !opened ||
                !Predicate.isObject(opened.payload) ||
                opened.payload.responseMode !== "message"
              );
            });
            const streaming = topic.messages.some((message) => message.streaming);
            if (
              !["starting", "running", "waiting"].includes(summary.status) &&
              !streaming &&
              pending.approvals.length === 0 &&
              nativeQuestions.length === 0
            )
              continue;
            const recoveredAt = yield* nowIso;
            for (const request of pending.approvals) {
              yield* resolveInteraction(
                topic,
                request.requestId,
                "approval",
                recoveredAt,
                "recovery",
              );
            }
            for (const request of nativeQuestions) {
              yield* resolveInteraction(
                topic,
                request.requestId,
                "user-input",
                recoveredAt,
                "recovery",
              );
            }
            for (const message of topic.messages) {
              if (!message.streaming || message.role !== "assistant") continue;
              yield* orchestrationEngine.dispatch({
                type: "thread.message.assistant.complete",
                commandId: CommandId.make(yield* crypto.randomUUIDv4),
                threadId,
                subagentId: topic.id,
                messageId: message.id,
                replyTopicId: topic.id,
                ...(message.replyTo ? { replyTo: message.replyTo } : {}),
                ...(message.turnId ? { turnId: message.turnId } : {}),
                createdAt: recoveredAt,
              });
            }
            yield* projection.summary(topic, {
              ...topic.summary,
              status: "interrupted",
              statusMessage: RECOVERY_DETAIL,
              latestTurn: topic.summary.latestTurn
                ? { ...topic.summary.latestTurn, state: "interrupted", completedAt: recoveredAt }
                : null,
              completedAt: recoveredAt,
              updatedAt: recoveredAt,
            });
          }
        }),
      )
      .pipe(Effect.mapError(publicError));

  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      Array.from(topics.values()),
      (topic) =>
        Effect.gen(function* () {
          topic.cancelled = true;
          topic.jobs.length = 0;
          const run = topic.active;
          if (!run) return;
          run.cancelled = true;
          yield* transport.interrupt(run);
          yield* Deferred.succeed(run.abort, {
            status: "interrupted",
            detail: "The server is shutting down. Retry to continue this topic.",
          });
          yield* transport.cleanup(run);
        }),
      { concurrency: "unbounded", discard: true },
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Reply shutdown cleanup failed", { cause: Cause.pretty(cause) }),
      ),
    ),
  );

  return MessageReplyCoordinator.of({
    handleStart,
    interrupt,
    retry,
    respondApproval,
    respondUserInput,
    dismissUserInput,
    cancelThread,
    recoverThread,
    hasActiveTopic,
    awaitIdle: (threadId) =>
      Effect.gen(function* () {
        if (!hasActiveTopic(threadId)) return;
        const waiter = yield* Deferred.make<void>();
        if (!hasActiveTopic(threadId)) return;
        const waiters = idleWaiters.get(threadId) ?? new Set();
        waiters.add(waiter);
        idleWaiters.set(threadId, waiters);
        yield* Deferred.await(waiter);
      }),
  });
});

export const MessageReplyCoordinatorLive = Layer.effect(MessageReplyCoordinator, make);
