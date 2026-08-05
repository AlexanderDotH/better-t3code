import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import Migration0042 from "../persistence/Migrations/042_GitWorkbenchState.ts";
import type {
  GitWorkbenchObservedState,
  GitWorkbenchQueuePreconditions,
  GitWorkbenchQueueScope,
  GitWorkbenchQueueWorkflow,
  GitWorkbenchQueuedWorkflow,
} from "./GitWorkbenchQueueModel.ts";
import {
  GitWorkbenchQueueRepository,
  GitWorkbenchQueueRepositoryLive,
} from "./GitWorkbenchQueueRepository.ts";
import {
  GitWorkbenchQueue,
  GitWorkbenchQueueLive,
  GitWorkbenchQueueRuntime,
  GitWorkbenchQueueRuntimeError,
  type GitWorkbenchQueueRuntimeShape,
} from "./GitWorkbenchQueueService.ts";

const scope: GitWorkbenchQueueScope = {
  environmentId: "environment-1",
  worktreeRoot: "/workspace/project",
};

const preconditions: GitWorkbenchQueuePreconditions = {
  stateToken: "state-1",
  headOid: "a".repeat(40),
  refName: "refs/heads/main",
  indexToken: "index-1",
  worktreeToken: "worktree-1",
  operationState: null,
  remoteOid: "b".repeat(40),
  selectionPatchToken: "patch-1",
};

const observed: GitWorkbenchObservedState = {
  ...scope,
  ...preconditions,
  hasConflicts: false,
};

const selectionDelivery: GitWorkbenchQueueWorkflow = {
  kind: "delivery",
  stage: { mode: "paths", paths: ["selection-1"] },
  push: true,
  createPullRequest: false,
};

interface RuntimeHarness {
  readonly layer: Layer.Layer<GitWorkbenchQueueRuntime>;
  readonly executed: Array<string>;
  setObserved(next: GitWorkbenchObservedState): void;
  setTurnQuiesced(value: boolean): void;
  failExecution(detail: string | null): void;
}

function runtimeHarness(): RuntimeHarness {
  let currentObserved = observed;
  let turnQuiesced = false;
  let executionFailure: string | null = null;
  const executed: Array<string> = [];
  const service: GitWorkbenchQueueRuntimeShape = {
    inspect: (workflow) => Effect.succeed({ ...currentObserved, ...workflow.scope }),
    isTurnQuiesced: () => Effect.succeed(turnQuiesced),
    execute: (workflow) => {
      if (executionFailure !== null) {
        return Effect.fail(
          new GitWorkbenchQueueRuntimeError({
            operation: "execute",
            detail: executionFailure,
          }),
        );
      }
      executed.push(workflow.id);
      return Effect.void;
    },
  };
  return {
    layer: Layer.succeed(GitWorkbenchQueueRuntime, service),
    executed,
    setObserved: (next) => {
      currentObserved = next;
    },
    setTurnQuiesced: (value) => {
      turnQuiesced = value;
    },
    failExecution: (detail) => {
      executionFailure = detail;
    },
  };
}

function queueLayer(runtime: RuntimeHarness) {
  const migratedSqlite = Layer.effectDiscard(Migration0042).pipe(
    Layer.provideMerge(NodeSqliteClient.layerMemory()),
  );
  const repository = GitWorkbenchQueueRepositoryLive.pipe(Layer.provideMerge(migratedSqlite));
  return GitWorkbenchQueueLive.pipe(Layer.provideMerge(repository), Layer.provide(runtime.layer));
}

function createInput(
  overrides: {
    readonly scope?: GitWorkbenchQueueScope;
    readonly turnId?: string | null;
    readonly workflow?: GitWorkbenchQueueWorkflow;
    readonly preconditions?: GitWorkbenchQueuePreconditions;
    readonly workflowId?: string;
    readonly replaceExisting?: boolean;
  } = {},
) {
  return {
    scope: overrides.scope ?? scope,
    threadId: "thread-1",
    turnId: overrides.turnId === undefined ? "turn-1" : overrides.turnId,
    workflow: overrides.workflow ?? selectionDelivery,
    preconditions: overrides.preconditions ?? preconditions,
    ...(overrides.workflowId === undefined ? {} : { workflowId: overrides.workflowId }),
    ...(overrides.replaceExisting === undefined
      ? {}
      : { replaceExisting: overrides.replaceExisting }),
  };
}

it.effect("creates, replaces, and broadcasts one workflow per worktree to every client", () => {
  const runtime = runtimeHarness();
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    const firstClient = yield* queue.subscribe(scope);
    const secondClient = yield* queue.subscribe(scope);

    const first = yield* queue.createOrReplace(createInput());
    const firstEvents = yield* Effect.all([
      Stream.runHead(firstClient.changes),
      Stream.runHead(secondClient.changes),
    ]);
    const replacement = yield* queue.createOrReplace(
      createInput({
        replaceExisting: true,
        workflow: {
          kind: "delivery",
          stage: { mode: "all" },
          commitMessage: "Ship final changes",
          push: true,
          createPullRequest: true,
        },
      }),
    );

    expect(firstClient.latest).toBeNull();
    expect(firstEvents.every(Option.isSome)).toBe(true);
    expect(replacement.id).not.toBe(first.id);
    expect(replacement.workflow).toMatchObject({ kind: "delivery", stage: { mode: "all" } });
    expect(Option.getOrNull(yield* queue.get(scope))?.id).toBe(replacement.id);
  }).pipe(Effect.provide(queueLayer(runtime)), Effect.scoped);
});

it.effect("requires an explicit replacement decision for an occupied worktree", () => {
  const runtime = runtimeHarness();
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    const existing = yield* queue.createOrReplace(createInput());
    const conflict = yield* queue.createOrReplace(createInput()).pipe(Effect.flip);

    expect(conflict._tag).toBe("GitWorkbenchQueueAlreadyExistsError");
    expect(Option.getOrNull(yield* queue.get(scope))?.id).toBe(existing.id);
  }).pipe(Effect.provide(queueLayer(runtime)));
});

it.effect("edits the plan with refreshed preconditions and rejects stale revisions", () => {
  const runtime = runtimeHarness();
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    const initial = yield* queue.createOrReplace(createInput());
    const edited = yield* queue.edit({
      scope,
      workflowId: initial.id,
      expectedRevision: initial.revision,
      preconditions: { ...preconditions, headOid: "d".repeat(40) },
      workflow: {
        kind: "delivery",
        stage: { mode: "all" },
        commitMessage: "Use the final diff",
        push: false,
        createPullRequest: false,
      },
    });
    const conflict = yield* queue
      .edit({
        scope,
        workflowId: initial.id,
        expectedRevision: initial.revision,
        preconditions,
        workflow: selectionDelivery,
      })
      .pipe(Effect.flip);

    expect(edited.preconditions.headOid).toBe("d".repeat(40));
    expect(edited.revision).toBe(initial.revision + 1);
    expect(conflict._tag).toBe("GitWorkbenchQueueRevisionConflictError");
  }).pipe(Effect.provide(queueLayer(runtime)));
});

it.effect("cancels only the revision the user reviewed", () => {
  const runtime = runtimeHarness();
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    const initial = yield* queue.createOrReplace(createInput());
    const edited = yield* queue.edit({
      scope,
      workflowId: initial.id,
      expectedRevision: initial.revision,
      preconditions,
      workflow: {
        kind: "delivery",
        stage: { mode: "all" },
        push: false,
        createPullRequest: false,
      },
    });
    const staleCancel = yield* queue
      .cancel({ scope, workflowId: initial.id, expectedRevision: initial.revision })
      .pipe(Effect.flip);

    expect(staleCancel._tag).toBe("GitWorkbenchQueueRevisionConflictError");
    yield* queue.cancel({ scope, workflowId: edited.id, expectedRevision: edited.revision });
    expect(Option.isNone(yield* queue.get(scope))).toBe(true);
  }).pipe(Effect.provide(queueLayer(runtime)));
});

it.effect("revalidates after quiescence, executes once, and removes a successful workflow", () => {
  const runtime = runtimeHarness();
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    const workflow = yield* queue.createOrReplace(createInput());

    yield* queue.handleQuiescence({
      type: "turn.processing.quiesced",
      threadId: "thread-1",
      turnId: "turn-1",
      checkpointTurnCount: 2,
      createdAt: "2026-08-02T10:05:00.000Z",
    });

    expect(runtime.executed).toEqual([workflow.id]);
    expect(Option.isNone(yield* queue.get(scope))).toBe(true);
  }).pipe(Effect.provide(queueLayer(runtime)));
});

it.effect("moves stale work to needs-review without silently executing a new target", () => {
  const runtime = runtimeHarness();
  runtime.setObserved({ ...observed, headOid: "c".repeat(40) });
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    yield* queue.createOrReplace(createInput());
    yield* queue.handleQuiescence({
      type: "turn.processing.quiesced",
      threadId: "thread-1",
      turnId: "turn-1",
      checkpointTurnCount: 2,
      createdAt: "2026-08-02T10:05:00.000Z",
    });

    const persisted = Option.getOrThrow(yield* queue.get(scope));
    expect(persisted.status).toBe("needs_review");
    expect(persisted.needsReviewReasons).toContain("head_changed");
    expect(runtime.executed).toEqual([]);
  }).pipe(Effect.provide(queueLayer(runtime)));
});

it.effect("persists execution failures instead of dropping the workflow", () => {
  const runtime = runtimeHarness();
  runtime.failExecution("push was rejected");
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    yield* queue.createOrReplace(createInput({ turnId: null }));
    yield* queue.drain(scope);

    const persisted = Option.getOrThrow(yield* queue.get(scope));
    expect(persisted.status).toBe("failed");
    expect(persisted.lastError).toBe("push was rejected");
  }).pipe(Effect.provide(queueLayer(runtime)));
});

it.effect("recovers ready and settled waiting work but pauses ambiguous running work", () => {
  const runtime = runtimeHarness();
  runtime.setTurnQuiesced(true);
  return Effect.gen(function* () {
    const queue = yield* GitWorkbenchQueue;
    const repository = yield* GitWorkbenchQueueRepository;
    const ready = yield* queue.createOrReplace(
      createInput({
        scope: { ...scope, worktreeRoot: "/workspace/ready" },
        turnId: null,
        preconditions: { ...preconditions, selectionPatchToken: null },
        workflow: {
          kind: "delivery",
          stage: { mode: "all" },
          push: false,
          createPullRequest: false,
        },
      }),
    );
    const waiting = yield* queue.createOrReplace(
      createInput({
        scope: { ...scope, worktreeRoot: "/workspace/waiting" },
        preconditions: { ...preconditions, selectionPatchToken: null },
        workflow: {
          kind: "delivery",
          stage: { mode: "all" },
          push: false,
          createPullRequest: false,
        },
      }),
    );
    const runningScope = { ...scope, worktreeRoot: "/workspace/running" };
    const running: GitWorkbenchQueuedWorkflow = {
      ...waiting,
      id: "running-workflow",
      scope: runningScope,
      status: "running",
    };
    yield* repository.replace(running);

    runtime.setObserved({ ...observed, worktreeRoot: "/workspace/ready" });
    yield* queue.recover();

    expect(runtime.executed).toContain(ready.id);
    const runningAfter = Option.getOrThrow(yield* queue.get(runningScope));
    expect(runningAfter.status).toBe("needs_review");
    expect(runningAfter.needsReviewReasons).toEqual(["server_restarted_during_execution"]);
  }).pipe(Effect.provide(queueLayer(runtime)));
});
