import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-07-12T10:00:00.000Z";

const seedReadModel = Effect.gen(function* () {
  const projectId = ProjectId.make("project-import");
  const threadId = ThreadId.make("thread-import");
  const withProject = yield* projectEvent(createEmptyReadModel(now), {
    sequence: 1,
    eventId: EventId.make("event-project-import"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: now,
    commandId: CommandId.make("server:import-project"),
    causationEventId: null,
    correlationId: CommandId.make("server:import-project"),
    metadata: {},
    payload: {
      projectId,
      title: "Imported project",
      workspaceRoot: "/tmp/imported",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  const readModel = yield* projectEvent(withProject, {
    sequence: 2,
    eventId: EventId.make("event-thread-import"),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.created",
    occurredAt: now,
    commandId: CommandId.make("server:import-thread"),
    causationEventId: null,
    correlationId: CommandId.make("server:import-thread"),
    metadata: {},
    payload: {
      threadId,
      projectId,
      title: "Imported chat",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return { readModel, threadId };
});

it.layer(NodeServices.layer)("thread message import", (it) => {
  it.effect("creates a completed message event without starting a provider turn", () =>
    Effect.gen(function* () {
      const { readModel, threadId } = yield* seedReadModel;
      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.message.import",
          commandId: CommandId.make("server:import-message"),
          threadId,
          message: {
            id: MessageId.make("message-import"),
            role: "user",
            text: "Imported prompt",
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      });

      expect(Array.isArray(decided)).toBe(false);
      const event = Array.isArray(decided) ? decided[0] : decided;
      expect(event?.type).toBe("thread.message-sent");
      if (event?.type !== "thread.message-sent") return;
      expect(event.payload).toMatchObject({
        threadId,
        messageId: MessageId.make("message-import"),
        role: "user",
        text: "Imported prompt",
        streaming: false,
      });
    }),
  );
});
