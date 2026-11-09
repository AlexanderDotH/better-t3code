import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnItemId,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { isActiveRun } from "../orchestration-v2/CommandPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";

const ACTIVITY_PREVIEW_CHARS = 240;

type Delivery = {
  readonly threadId: ThreadId;
  readonly request: Extract<
    EffectOutbox.OrchestrationEffectRequestV2,
    { type: "project-agent.message.deliver" }
  >;
};

export class ProjectAgentMessageDeliveryError extends Schema.TaggedError<ProjectAgentMessageDeliveryError>()(
  "ProjectAgentMessageDeliveryError",
  { threadId: ThreadId, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not deliver project coordination to thread ${this.threadId}.`;
  }
}

export class ProjectAgentMessageDelivery extends Context.Service<
  ProjectAgentMessageDelivery,
  { readonly execute: (input: Delivery) => Effect.Effect<void, ProjectAgentMessageDeliveryError> }
>()("t3/projectAgent/ProjectAgentMessageDelivery") {}

const make = Effect.gen(function* () {
  const orchestration = yield* Orchestrator.OrchestratorV2;
  const events = yield* EventSink.EventSinkV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const execute = Effect.fn("ProjectAgentMessageDelivery.execute")(
    function* ({ threadId, request }: Delivery) {
      const shell = yield* orchestration.getThreadShell(threadId);
      if (shell === null || shell.projectId !== request.projectId || shell.deletedAt !== null)
        return;
      const occurredAt = DateTime.makeUnsafe(request.sentAt);
      const noticeId = `project-agent-notice:${request.messageId}:${threadId}:${request.direction}`;
      const summary =
        request.direction === "sent"
          ? `Sent ${request.kind} to ${request.recipientCount} project agent${request.recipientCount === 1 ? "" : "s"}`
          : `Received ${request.kind} from ${request.senderTitle}`;
      yield* events.commitCommand({
        commandId: CommandId.make(noticeId),
        threadId,
        commandType: "project-agent.message.deliver",
        acceptedAt: occurredAt,
        events: [
          {
            id: EventId.make(noticeId),
            threadId,
            type: "turn-item.updated",
            occurredAt,
            payload: {
              type: "notification",
              id: TurnItemId.make(noticeId),
              threadId,
              runId: shell.activeRunId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 0,
              status: "completed",
              title: null,
              startedAt: occurredAt,
              completedAt: occurredAt,
              updatedAt: occurredAt,
              source: { kind: "system" },
              outcome: "updated",
              summary,
              detail: request.body.slice(0, ACTIVITY_PREVIEW_CHARS),
            },
          },
        ],
        effects: [],
      });
      const wake = request.wake;
      if (request.direction !== "received" || wake === undefined) return;
      const current = yield* settings.getSettings;
      if (!resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.projectCoordination"))
        return;

      const stillIdle = Effect.gen(function* () {
        const target = yield* orchestration.getThreadShell(threadId);
        if (
          target === null ||
          target.projectId !== request.projectId ||
          target.archivedAt !== null ||
          target.deletedAt !== null ||
          target.activeRunId !== null ||
          target.latestRunId !== wake.latestRunId
        )
          return false;
        const records = yield* orchestration.getThreadRecords(threadId, [
          "runs",
          "runtimeRequests",
        ]);
        return (
          !records.runs.some((run) => isActiveRun(run) || run.status === "queued") &&
          !records.runtimeRequests.some((runtimeRequest) => runtimeRequest.status === "pending")
        );
      });
      if (!(yield* stillIdle)) return;
      yield* orchestration
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`project-agent-wake:${request.messageId}:${threadId}`),
          messageId: MessageId.make(`project-agent-wake:${request.messageId}:${threadId}`),
          threadId,
          senderThreadId: request.senderThreadId,
          text: [
            `Project agent ${request.senderTitle} (${request.senderThreadId}) sent you a ${request.kind} message while this chat was idle:`,
            request.body,
            "Handle the message, reply with project_agent_send when useful, and acknowledge it through project_agent_inbox after processing it.",
          ].join("\n\n"),
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          idleGuard: { latestRunId: wake.latestRunId },
          createdBy: "agent",
          creationSource: "server",
        })
        .pipe(
          Effect.catch((cause) =>
            stillIdle.pipe(Effect.flatMap((idle) => (idle ? Effect.fail(cause) : Effect.void))),
          ),
        );
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) => new ProjectAgentMessageDeliveryError({ threadId: input.threadId, cause }),
        ),
      ),
  );
  return ProjectAgentMessageDelivery.of({ execute });
});

export const layer = Layer.effect(ProjectAgentMessageDelivery, make);
