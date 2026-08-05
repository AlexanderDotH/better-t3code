import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import Migration0042 from "../persistence/Migrations/042_GitWorkbenchState.ts";
import {
  GitWorkbenchQueueRepository,
  GitWorkbenchQueueRepositoryLive,
} from "./GitWorkbenchQueueRepository.ts";
import type { GitWorkbenchQueuedWorkflow } from "./GitWorkbenchQueueModel.ts";

const migratedSqlite = Layer.effectDiscard(Migration0042).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(GitWorkbenchQueueRepositoryLive.pipe(Layer.provideMerge(migratedSqlite)));

function queued(
  id: string,
  overrides: Partial<GitWorkbenchQueuedWorkflow> = {},
): GitWorkbenchQueuedWorkflow {
  return {
    id,
    scope: { environmentId: "environment-1", worktreeRoot: "/workspace/project" },
    threadId: "thread-1",
    turnId: "turn-1",
    status: "waiting_for_turn",
    revision: 1,
    workflow: {
      kind: "advanced_operation",
      action: { kind: "cherry_pick", commitOid: "a".repeat(40) },
    },
    preconditions: {
      stateToken: "state-1",
      headOid: "b".repeat(40),
      refName: "refs/heads/main",
      indexToken: "index-1",
      worktreeToken: "worktree-1",
      operationState: null,
      remoteOid: null,
      selectionPatchToken: null,
    },
    needsReviewReasons: [],
    lastError: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    ...overrides,
  };
}

layer("GitWorkbenchQueueRepository", (it) => {
  it.effect("atomically replaces the only workflow for one worktree", () =>
    Effect.gen(function* () {
      const repository = yield* GitWorkbenchQueueRepository;
      yield* repository.replace(queued("queue-1"));
      yield* repository.replace(
        queued("queue-2", {
          workflow: {
            kind: "delivery",
            stage: { mode: "all" },
            commitMessage: "Ship it",
            push: true,
            createPullRequest: true,
          },
        }),
      );

      const persisted = yield* repository.get({
        environmentId: "environment-1",
        worktreeRoot: "/workspace/project",
      });
      expect(Option.getOrThrow(persisted)).toMatchObject({
        id: "queue-2",
        workflow: { kind: "delivery", stage: { mode: "all" } },
      });
    }),
  );

  it.effect("uses the revision as an optimistic concurrency guard", () =>
    Effect.gen(function* () {
      const repository = yield* GitWorkbenchQueueRepository;
      const initial = queued("queue-revision", {
        scope: { environmentId: "environment-1", worktreeRoot: "/workspace/revision" },
      });
      yield* repository.replace(initial);

      const updated = { ...initial, status: "ready" as const, revision: 2 };
      const accepted = yield* repository.saveExpected(updated, 1);
      const stale = yield* repository.saveExpected(
        { ...updated, status: "running", revision: 3 },
        1,
      );

      expect(Option.getOrThrow(accepted).status).toBe("ready");
      expect(Option.isNone(stale)).toBe(true);
    }),
  );

  it.effect("finds waiting turns and recoverable startup states", () =>
    Effect.gen(function* () {
      const repository = yield* GitWorkbenchQueueRepository;
      yield* repository.replace(
        queued("queue-waiting", {
          scope: { environmentId: "environment-1", worktreeRoot: "/workspace/waiting" },
        }),
      );
      yield* repository.replace(
        queued("queue-ready", {
          scope: { environmentId: "environment-1", worktreeRoot: "/workspace/ready" },
          status: "ready",
          turnId: null,
        }),
      );
      yield* repository.replace(
        queued("queue-review", {
          scope: { environmentId: "environment-1", worktreeRoot: "/workspace/review" },
          status: "needs_review",
        }),
      );

      const waiting = yield* repository.listWaitingForTurn("thread-1", "turn-1");
      const recoverable = yield* repository.listRecoverable();

      expect(waiting.map(({ id }) => id)).toContain("queue-waiting");
      expect(recoverable.map(({ id }) => id)).toEqual(
        expect.arrayContaining(["queue-waiting", "queue-ready"]),
      );
      expect(recoverable.map(({ id }) => id)).not.toContain("queue-review");
    }),
  );

  it.effect("removes only the expected revision", () =>
    Effect.gen(function* () {
      const repository = yield* GitWorkbenchQueueRepository;
      const workflow = queued("queue-remove", {
        scope: { environmentId: "environment-1", worktreeRoot: "/workspace/remove" },
      });
      yield* repository.replace(workflow);

      expect(yield* repository.removeExpected(workflow.scope, 2)).toBe(false);
      expect(yield* repository.removeExpected(workflow.scope, 1)).toBe(true);
      expect(Option.isNone(yield* repository.get(workflow.scope))).toBe(true);
    }),
  );
});
