import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";
import { toRootThreadStreamItem } from "./threadStreamRouting.ts";

const now = "2026-09-14T10:00:00.000Z";
const threadId = ThreadId.make("edit-thread");
const messageId = MessageId.make("edited-message");
const turnId = TurnId.make("completed-turn");
function thread(role: "user" | "assistant"): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project"),
    title: "Edit",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    settledAt: null,
    latestTurn: {
      turnId,
      state: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      assistantMessageId: messageId,
    },
    messages: [
      {
        id: messageId,
        role,
        text: "Original",
        turnId,
        streaming: false,
        createdAt: now,
        updatedAt: now,
        attachments: [
          {
            type: "image",
            id: "image-1",
            name: "diagram.png",
            mimeType: "image/png",
            sizeBytes: 10,
          },
        ],
      },
      {
        id: MessageId.make("later-message"),
        role: "assistant",
        text: "Later reply",
        turnId,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    proposedPlans: [],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: null,
  };
}
const command = {
  type: "thread.message.edit" as const,
  commandId: CommandId.make("edit-command"),
  threadId,
  messageId,
  expectedText: "Original",
  text: "Corrected",
  createdAt: now,
};
function model(value: OrchestrationThread): OrchestrationReadModel {
  return { snapshotSequence: 0, projects: [], threads: [value], updatedAt: now };
}

it.layer(NodeServices.layer)("message editing", (it) => {
  for (const role of ["user", "assistant"] as const) {
    it.effect(
      `persists the ${role} edit, preserves later messages and requests a real provider turn`,
      () =>
        Effect.gen(function* () {
          const original = thread(role);
          let state = model(original);
          const result = yield* decideOrchestrationCommand({ command, readModel: state });
          const events = Array.isArray(result) ? result : [result];
          expect(events.map((event) => event.type)).toEqual([
            "thread.message-edited",
            "thread.message-sent",
            "thread.turn-start-requested",
          ]);
          for (const event of events) {
            const committed = { ...event, sequence: state.snapshotSequence + 1 };
            state = yield* projectEvent(state, committed);
            if (event.type === "thread.message-edited")
              expect(toRootThreadStreamItem(committed).kind).toBe("event");
          }
          const messages = state.threads[0]!.messages;
          expect(messages[0]).toEqual({ ...original.messages[0], text: "Corrected" });
          expect(messages[1]).toEqual(original.messages[1]);
          expect(messages[2]?.text).toContain("user-authored correction");
          expect(messages[2]?.text).toContain("Corrected");
          expect(messages[2]?.role).toBe("user");
          expect(messages[2]?.attachments).toEqual(original.messages[0]?.attachments);
          expect(events.at(-1)).toMatchObject({ payload: { messageId: messages[2]?.id } });
          expect(state.threads[0]?.latestTurn).toEqual(original.latestTurn);
        }),
    );
  }
  it.effect("rejects stale text, unknown messages and edits during a turn", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { ...command, expectedText: "Outdated" },
        { ...command, messageId: MessageId.make("unknown") },
      ]) {
        const error = yield* decideOrchestrationCommand({
          command: invalid,
          readModel: model(thread("user")),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
      const busy = thread("assistant");
      const error = yield* decideOrchestrationCommand({
        command,
        readModel: model({ ...busy, latestTurn: { ...busy.latestTurn!, state: "running" } }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
