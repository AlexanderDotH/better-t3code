import {
  CommandId,
  EventId,
  type IsoDateTime,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import { runtimeEventToActivities } from "../orchestration/Layers/ProviderRuntimeIngestion.ts";
import type { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import type {
  ActiveMessageReply,
  MessageReplySummary,
  MessageReplyTopicState,
} from "./MessageReplyState.ts";

export function makeMessageReplyProjection(dependencies: {
  readonly generation: string;
  readonly orchestrationEngine: OrchestrationEngineService["Service"];
  readonly threadBackgroundLiveness: ThreadBackgroundLivenessService["Service"];
}) {
  const { orchestrationEngine, threadBackgroundLiveness } = dependencies;
  let sequence = 0;
  const commandId = (topic: MessageReplyTopicState, operation: string) =>
    CommandId.make(
      `server:reply:${dependencies.generation}:${topic.id}:${operation}:${++sequence}`,
    );

  const summary = Effect.fn("MessageReplyProjection.summary")(function* (
    topic: MessageReplyTopicState,
    next: MessageReplySummary,
  ) {
    topic.summary = next;
    yield* orchestrationEngine.dispatch({
      type: "thread.subagent.upsert",
      commandId: commandId(topic, `${next.messageReply.lastCommandId ?? "recovery"}:summary`),
      threadId: topic.parentThreadId,
      subagent: next,
      createdAt: next.updatedAt,
    });
    threadBackgroundLiveness.recordAuthoritativeSubagentLiveness({
      threadId: topic.parentThreadId,
      taskId: topic.id,
      active: next.status === "starting" || next.status === "running" || next.status === "waiting",
    });
  });

  const importMessage = Effect.fn("MessageReplyProjection.importMessage")(function* (
    topic: MessageReplyTopicState,
    message: OrchestrationMessage,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.message.import",
      commandId: CommandId.make(`server:reply:${topic.id}:import:${message.id}`),
      threadId: topic.parentThreadId,
      subagentId: topic.id,
      message,
    });
    if (!topic.messages.some((existing) => existing.id === message.id))
      topic.messages.push(message);
  });

  const flushTranscript = Effect.fn("MessageReplyProjection.flush")(function* (
    run: ActiveMessageReply,
    createdAt: IsoDateTime,
  ) {
    if (run.transcriptBuffer.length === 0) return;
    if (!run.assistantProjected) {
      yield* importMessage(run.topic, {
        id: run.assistantMessageId,
        role: "assistant",
        text: "",
        turnId: run.turnId,
        streaming: true,
        createdAt: run.startedAt,
        updatedAt: createdAt,
        replyTopicId: run.topic.id,
        replyTo: run.replyTo,
      });
      run.assistantProjected = true;
    }
    const delta = run.transcriptBuffer;
    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.delta",
      commandId: commandId(run.topic, `${run.job.commandId}:delta`),
      threadId: run.topic.parentThreadId,
      subagentId: run.topic.id,
      messageId: run.assistantMessageId,
      replyTopicId: run.topic.id,
      replyTo: run.replyTo,
      delta,
      ...(run.turnId ? { turnId: run.turnId } : {}),
      createdAt,
    });
    run.transcriptBuffer = run.transcriptBuffer.slice(delta.length);
  });

  const flush = (run: ActiveMessageReply, createdAt: IsoDateTime) =>
    run.flushLock.withPermit(flushTranscript(run, createdAt));

  const complete = Effect.fn("MessageReplyProjection.complete")(function* (
    run: ActiveMessageReply,
    createdAt: IsoDateTime,
  ) {
    yield* flush(run, createdAt);
    if (!run.assistantProjected) return;
    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: commandId(run.topic, `${run.job.commandId}:complete`),
      threadId: run.topic.parentThreadId,
      subagentId: run.topic.id,
      messageId: run.assistantMessageId,
      replyTopicId: run.topic.id,
      replyTo: run.replyTo,
      ...(run.turnId ? { turnId: run.turnId } : {}),
      createdAt,
    });
    const index = run.topic.messages.findIndex((message) => message.id === run.assistantMessageId);
    const message = run.topic.messages[index];
    if (message)
      run.topic.messages[index] = {
        ...message,
        text: run.assistantText,
        streaming: false,
        turnId: run.turnId,
        updatedAt: createdAt,
      };
  });

  const activity = (
    topic: MessageReplyTopicState,
    value: OrchestrationThreadActivity,
    revision = value.id,
  ) =>
    orchestrationEngine
      .dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`server:reply:${topic.id}:activity:${revision}`),
        threadId: topic.parentThreadId,
        subagentId: topic.id,
        activity: {
          ...value,
          replyTopicId: topic.id,
          payload: {
            ...(Predicate.isObject(value.payload) ? value.payload : {}),
            replyTopicId: topic.id,
          },
        },
        createdAt: value.createdAt,
      })
      .pipe(Effect.asVoid);

  const runtimeActivity = (run: ActiveMessageReply, event: ProviderRuntimeEvent) =>
    Effect.forEach(
      runtimeEventToActivities(event),
      (value) =>
        activity(
          run.topic,
          {
            ...value,
            id: EventId.make(`reply:${run.topic.id}:${value.id}`),
          },
          EventId.make(`${event.eventId}:${value.id}`),
        ),
      { concurrency: 1, discard: true },
    );

  return { summary, importMessage, flush, complete, activity, runtimeActivity };
}
