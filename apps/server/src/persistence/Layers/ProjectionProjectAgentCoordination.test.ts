import { ProjectAgentMessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionProjectAgentCoordinationRepositoryLive } from "./ProjectionProjectAgentCoordination.ts";
import { ProjectionProjectAgentCoordinationRepository } from "../Services/ProjectionProjectAgentCoordination.ts";

const projectId = ProjectId.make("project-coordination-store");
const senderThreadId = ThreadId.make("thread-sender");
const recipientThreadId = ThreadId.make("thread-recipient");
const firstTurnId = TurnId.make("turn-first");
const now = "2026-08-09T18:00:00.000Z";

const TestLayer = ProjectionProjectAgentCoordinationRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

it.layer(TestLayer)("ProjectionProjectAgentCoordinationRepository", (it) => {
  it.effect("replaces claims atomically and fences delayed releases by turn", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectAgentCoordinationRepository;
      yield* repository.upsertClaim({
        projectId,
        threadId: senderThreadId,
        turnId: firstTurnId,
        summary: "Editing persistence",
        claims: [{ kind: "path", path: "apps/server/src/persistence" }],
        updatedAt: now,
      });

      yield* repository.releaseClaim({
        projectId,
        threadId: senderThreadId,
        expectedTurnId: TurnId.make("turn-stale"),
      });
      expect(yield* repository.listClaimsByProjectId(projectId)).toHaveLength(1);

      yield* repository.releaseClaim({
        projectId,
        threadId: senderThreadId,
        expectedTurnId: firstTurnId,
      });
      expect(yield* repository.listClaimsByProjectId(projectId)).toEqual([]);
    }),
  );

  it.effect("reads recipient inboxes and advances acknowledgements monotonically", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectAgentCoordinationRepository;
      for (const sequence of [11, 12]) {
        yield* repository.recordMessage({
          sequence,
          projectId,
          messageId: ProjectAgentMessageId.make(`message-${sequence}`),
          senderThreadId,
          recipientThreadIds: [recipientThreadId],
          kind: sequence === 11 ? "info" : "request",
          body: `message body ${sequence}`,
          createdAt: now,
        });
      }

      const initial = yield* repository.readInbox({
        projectId,
        threadId: recipientThreadId,
        limit: 1,
      });
      expect(initial.cursor).toBe(0);
      expect(initial.messages.map(({ sequence }) => sequence)).toEqual([11]);
      expect(initial.hasMore).toBe(true);

      yield* repository.acknowledgeInbox({
        projectId,
        threadId: recipientThreadId,
        acknowledgeThrough: 11,
        acknowledgedAt: now,
      });
      yield* repository.acknowledgeInbox({
        projectId,
        threadId: recipientThreadId,
        acknowledgeThrough: 5,
        acknowledgedAt: now,
      });

      const next = yield* repository.readInbox({
        projectId,
        threadId: recipientThreadId,
        limit: 20,
      });
      expect(next.cursor).toBe(11);
      expect(next.messages.map(({ sequence }) => sequence)).toEqual([12]);
      expect(next.hasMore).toBe(false);
      expect(yield* repository.listUnreadCountsByProjectId(projectId)).toEqual(
        new Map([[recipientThreadId, 1]]),
      );
    }),
  );

  it.effect("does not let a future acknowledgement hide later messages", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectAgentCoordinationRepository;
      const guardedProjectId = ProjectId.make("project-guarded-cursor");
      const guardedRecipientId = ThreadId.make("thread-guarded-recipient");

      yield* repository.recordMessage({
        sequence: 21,
        projectId: guardedProjectId,
        messageId: ProjectAgentMessageId.make("message-guarded-21"),
        senderThreadId,
        recipientThreadIds: [guardedRecipientId],
        kind: "info",
        body: "first guarded message",
        createdAt: now,
      });
      yield* repository.acknowledgeInbox({
        projectId: guardedProjectId,
        threadId: guardedRecipientId,
        acknowledgeThrough: 10_000,
        acknowledgedAt: now,
      });
      yield* repository.recordMessage({
        sequence: 22,
        projectId: guardedProjectId,
        messageId: ProjectAgentMessageId.make("message-guarded-22"),
        senderThreadId,
        recipientThreadIds: [guardedRecipientId],
        kind: "request",
        body: "later guarded message",
        createdAt: now,
      });

      const inbox = yield* repository.readInbox({
        projectId: guardedProjectId,
        threadId: guardedRecipientId,
        limit: 20,
      });
      expect(inbox.cursor).toBe(21);
      expect(inbox.messages.map(({ sequence }) => sequence)).toEqual([22]);
    }),
  );
});
