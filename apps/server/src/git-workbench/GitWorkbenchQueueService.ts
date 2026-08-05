import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { TurnProcessingQuiescedReceipt } from "../orchestration/Services/RuntimeReceiptBus.ts";
import {
  GitWorkbenchQueueScope,
  revalidateQueuedWorkflow,
  type GitWorkbenchObservedState,
  type GitWorkbenchQueuePreconditions,
  type GitWorkbenchQueueScope as QueueScope,
  type GitWorkbenchQueueWorkflow as QueueWorkflow,
  type GitWorkbenchQueuedWorkflow as QueuedWorkflow,
} from "./GitWorkbenchQueueModel.ts";
import {
  GitWorkbenchQueueRepository,
  type GitWorkbenchQueueRepositoryError,
} from "./GitWorkbenchQueueRepository.ts";

export class GitWorkbenchQueueRuntimeError extends Schema.TaggedErrorClass<GitWorkbenchQueueRuntimeError>()(
  "GitWorkbenchQueueRuntimeError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface GitWorkbenchQueueRuntimeShape {
  readonly inspect: (
    workflow: QueuedWorkflow,
  ) => Effect.Effect<GitWorkbenchObservedState, GitWorkbenchQueueRuntimeError>;
  readonly execute: (
    workflow: QueuedWorkflow,
  ) => Effect.Effect<void, GitWorkbenchQueueRuntimeError>;
  readonly isTurnQuiesced: (
    threadId: string,
    turnId: string,
  ) => Effect.Effect<boolean, GitWorkbenchQueueRuntimeError>;
}

export class GitWorkbenchQueueRuntime extends Context.Service<
  GitWorkbenchQueueRuntime,
  GitWorkbenchQueueRuntimeShape
>()("t3/git-workbench/GitWorkbenchQueueService/GitWorkbenchQueueRuntime") {}

export class GitWorkbenchQueueNotFoundError extends Schema.TaggedErrorClass<GitWorkbenchQueueNotFoundError>()(
  "GitWorkbenchQueueNotFoundError",
  { scope: GitWorkbenchQueueScope },
) {
  override get message(): string {
    return "No queued Git workflow exists for this worktree.";
  }
}

export class GitWorkbenchQueueRevisionConflictError extends Schema.TaggedErrorClass<GitWorkbenchQueueRevisionConflictError>()(
  "GitWorkbenchQueueRevisionConflictError",
  {
    scope: GitWorkbenchQueueScope,
    expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    actualRevision: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  },
) {
  override get message(): string {
    return "The queued Git workflow changed on another client.";
  }
}

export class GitWorkbenchQueueAlreadyExistsError extends Schema.TaggedErrorClass<GitWorkbenchQueueAlreadyExistsError>()(
  "GitWorkbenchQueueAlreadyExistsError",
  {
    scope: GitWorkbenchQueueScope,
    workflowId: Schema.NonEmptyString,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  },
) {
  override get message(): string {
    return "A queued Git workflow already exists for this worktree.";
  }
}

export class GitWorkbenchQueueInvalidTransitionError extends Schema.TaggedErrorClass<GitWorkbenchQueueInvalidTransitionError>()(
  "GitWorkbenchQueueInvalidTransitionError",
  {
    scope: GitWorkbenchQueueScope,
    status: Schema.String,
    action: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot ${this.action} a Git workflow while it is ${this.status}.`;
  }
}

export type GitWorkbenchQueueError =
  | GitWorkbenchQueueRepositoryError
  | GitWorkbenchQueueRuntimeError
  | GitWorkbenchQueueNotFoundError
  | GitWorkbenchQueueRevisionConflictError
  | GitWorkbenchQueueAlreadyExistsError
  | GitWorkbenchQueueInvalidTransitionError;

export interface GitWorkbenchQueueCreateInput {
  readonly scope: QueueScope;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly workflow: QueueWorkflow;
  readonly preconditions: GitWorkbenchQueuePreconditions;
  readonly workflowId?: string;
  readonly replaceExisting?: boolean;
}

export interface GitWorkbenchQueueEditInput {
  readonly scope: QueueScope;
  readonly workflowId: string;
  readonly expectedRevision: number;
  readonly workflow: QueueWorkflow;
  readonly preconditions: GitWorkbenchQueuePreconditions;
}

export interface GitWorkbenchQueueCancelInput {
  readonly scope: QueueScope;
  readonly workflowId: string;
  readonly expectedRevision: number;
}

export type GitWorkbenchQueueEvent =
  | { readonly _tag: "upserted"; readonly workflow: QueuedWorkflow }
  | {
      readonly _tag: "removed";
      readonly scope: QueueScope;
      readonly workflowId: string;
      readonly revision: number;
    };

export interface GitWorkbenchQueueSubscription {
  readonly latest: QueuedWorkflow | null;
  readonly changes: Stream.Stream<GitWorkbenchQueueEvent>;
}

export interface GitWorkbenchQueueShape {
  readonly createOrReplace: (
    input: GitWorkbenchQueueCreateInput,
  ) => Effect.Effect<QueuedWorkflow, GitWorkbenchQueueError>;
  readonly edit: (
    input: GitWorkbenchQueueEditInput,
  ) => Effect.Effect<QueuedWorkflow, GitWorkbenchQueueError>;
  readonly cancel: (
    input: GitWorkbenchQueueCancelInput,
  ) => Effect.Effect<QueuedWorkflow, GitWorkbenchQueueError>;
  readonly get: (
    scope: QueueScope,
  ) => Effect.Effect<Option.Option<QueuedWorkflow>, GitWorkbenchQueueRepositoryError>;
  readonly subscribe: (
    scope: QueueScope,
  ) => Effect.Effect<GitWorkbenchQueueSubscription, GitWorkbenchQueueRepositoryError, Scope.Scope>;
  readonly drain: (scope: QueueScope) => Effect.Effect<void, GitWorkbenchQueueError>;
  readonly handleQuiescence: (
    event: TurnProcessingQuiescedReceipt,
  ) => Effect.Effect<void, GitWorkbenchQueueError>;
  readonly recover: () => Effect.Effect<void, GitWorkbenchQueueError>;
}

export class GitWorkbenchQueue extends Context.Service<GitWorkbenchQueue, GitWorkbenchQueueShape>()(
  "t3/git-workbench/GitWorkbenchQueueService/GitWorkbenchQueue",
) {}

function sameScope(left: QueueScope, right: QueueScope): boolean {
  return left.environmentId === right.environmentId && left.worktreeRoot === right.worktreeRoot;
}

const make = Effect.gen(function* () {
  const repository = yield* GitWorkbenchQueueRepository;
  const runtime = yield* GitWorkbenchQueueRuntime;
  const mutex = yield* Semaphore.make(1);
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<GitWorkbenchQueueEvent>(),
    PubSub.shutdown,
  );

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const publishUpsert = (workflow: QueuedWorkflow) =>
    PubSub.publish(changes, { _tag: "upserted", workflow }).pipe(Effect.asVoid);

  const publishRemoved = (workflow: QueuedWorkflow) =>
    PubSub.publish(changes, {
      _tag: "removed",
      scope: workflow.scope,
      workflowId: workflow.id,
      revision: workflow.revision + 1,
    }).pipe(Effect.asVoid);

  const revisionConflict = Effect.fn("GitWorkbenchQueue.revisionConflict")(function* (
    scope: QueueScope,
    expectedRevision: number,
  ) {
    const latest = yield* repository.get(scope);
    return new GitWorkbenchQueueRevisionConflictError({
      scope,
      expectedRevision,
      actualRevision: Option.match(latest, {
        onNone: () => null,
        onSome: ({ revision }) => revision,
      }),
    });
  });

  const getRequiredExpected = Effect.fn("GitWorkbenchQueue.getRequiredExpected")(function* (
    scope: QueueScope,
    workflowId: string,
    expectedRevision: number,
  ) {
    const current = yield* repository.get(scope);
    if (Option.isNone(current)) {
      return yield* new GitWorkbenchQueueNotFoundError({ scope });
    }
    if (current.value.id !== workflowId || current.value.revision !== expectedRevision) {
      const error = yield* revisionConflict(scope, expectedRevision);
      return yield* error;
    }
    return current.value;
  });

  const saveTransition = Effect.fn("GitWorkbenchQueue.saveTransition")(function* (
    current: QueuedWorkflow,
    patch: Pick<QueuedWorkflow, "status" | "needsReviewReasons" | "lastError">,
  ) {
    const updatedAt = yield* nowIso;
    const next: QueuedWorkflow = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt,
    };
    const saved = yield* repository.saveExpected(next, current.revision);
    if (Option.isNone(saved)) {
      const error = yield* revisionConflict(current.scope, current.revision);
      return yield* error;
    }
    yield* publishUpsert(saved.value);
    return saved.value;
  });

  const createOrReplace: GitWorkbenchQueueShape["createOrReplace"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const existing = yield* repository.get(input.scope);
        if (Option.isSome(existing) && existing.value.status === "running") {
          return yield* new GitWorkbenchQueueInvalidTransitionError({
            scope: input.scope,
            status: existing.value.status,
            action: "replace",
          });
        }
        if (Option.isSome(existing) && input.replaceExisting !== true) {
          return yield* new GitWorkbenchQueueAlreadyExistsError({
            scope: input.scope,
            workflowId: existing.value.id,
            revision: existing.value.revision,
          });
        }
        const timestamp = yield* nowIso;
        const workflow: QueuedWorkflow = {
          id: input.workflowId ?? NodeCrypto.randomUUID(),
          scope: input.scope,
          threadId: input.threadId,
          turnId: input.turnId,
          status: input.turnId === null ? "ready" : "waiting_for_turn",
          revision: Option.match(existing, {
            onNone: () => 1,
            onSome: ({ revision }) => revision + 1,
          }),
          workflow: input.workflow,
          preconditions: input.preconditions,
          needsReviewReasons: [],
          lastError: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const persisted = yield* repository.replace(workflow);
        yield* publishUpsert(persisted);
        return persisted;
      }),
    );

  const edit: GitWorkbenchQueueShape["edit"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getRequiredExpected(
          input.scope,
          input.workflowId,
          input.expectedRevision,
        );
        if (current.status === "running") {
          return yield* new GitWorkbenchQueueInvalidTransitionError({
            scope: input.scope,
            status: current.status,
            action: "edit",
          });
        }
        const updatedAt = yield* nowIso;
        const next: QueuedWorkflow = {
          ...current,
          workflow: input.workflow,
          preconditions: input.preconditions,
          status: current.status === "waiting_for_turn" ? "waiting_for_turn" : "ready",
          revision: current.revision + 1,
          needsReviewReasons: [],
          lastError: null,
          updatedAt,
        };
        const persisted = yield* repository.saveExpected(next, current.revision);
        if (Option.isNone(persisted)) {
          const error = yield* revisionConflict(input.scope, input.expectedRevision);
          return yield* error;
        }
        yield* publishUpsert(persisted.value);
        return persisted.value;
      }),
    );

  const cancel: GitWorkbenchQueueShape["cancel"] = (input) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* getRequiredExpected(
          input.scope,
          input.workflowId,
          input.expectedRevision,
        );
        if (current.status === "running") {
          return yield* new GitWorkbenchQueueInvalidTransitionError({
            scope: input.scope,
            status: current.status,
            action: "cancel",
          });
        }
        const removed = yield* repository.removeExpected(input.scope, current.revision);
        if (!removed) {
          const error = yield* revisionConflict(input.scope, input.expectedRevision);
          return yield* error;
        }
        yield* publishRemoved(current);
        return current;
      }),
    );

  const get: GitWorkbenchQueueShape["get"] = repository.get;

  const subscribe: GitWorkbenchQueueShape["subscribe"] = (scope) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const latest = yield* repository.get(scope);
        const subscription = yield* PubSub.subscribe(changes);
        return {
          latest: Option.getOrNull(latest),
          changes: Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => {
              const eventScope = event._tag === "upserted" ? event.workflow.scope : event.scope;
              return sameScope(scope, eventScope);
            }),
          ),
        } satisfies GitWorkbenchQueueSubscription;
      }),
    );

  const persistRuntimeFailure = Effect.fn("GitWorkbenchQueue.persistRuntimeFailure")(function* (
    current: QueuedWorkflow,
    error: GitWorkbenchQueueRuntimeError,
  ) {
    yield* saveTransition(current, {
      status: "failed",
      needsReviewReasons: [],
      lastError: error.detail,
    }).pipe(Effect.catchTag("GitWorkbenchQueueRevisionConflictError", () => Effect.void));
  });

  const drain: GitWorkbenchQueueShape["drain"] = Effect.fn("GitWorkbenchQueue.drain")(
    function* (scope) {
      const currentOption = yield* repository.get(scope);
      if (Option.isNone(currentOption) || currentOption.value.status !== "ready") return;
      const current = currentOption.value;
      const observed = yield* runtime
        .inspect(current)
        .pipe(Effect.catch((error) => persistRuntimeFailure(current, error).pipe(Effect.as(null))));
      if (observed === null) return;

      const validation = revalidateQueuedWorkflow(current, observed);
      if (validation._tag === "needs_review") {
        yield* saveTransition(current, {
          status: "needs_review",
          needsReviewReasons: validation.reasons,
          lastError: null,
        }).pipe(Effect.catchTag("GitWorkbenchQueueRevisionConflictError", () => Effect.void));
        return;
      }

      const running = yield* saveTransition(current, {
        status: "running",
        needsReviewReasons: [],
        lastError: null,
      }).pipe(
        Effect.catchTag("GitWorkbenchQueueRevisionConflictError", () => Effect.succeed(null)),
      );
      if (running === null) return;

      const executionError = yield* runtime.execute(running).pipe(
        Effect.matchEffect({
          onFailure: Effect.succeed,
          onSuccess: () => Effect.succeed(null),
        }),
      );
      if (executionError !== null) {
        yield* persistRuntimeFailure(running, executionError);
        return;
      }

      const removed = yield* repository.removeExpected(running.scope, running.revision);
      if (removed) yield* publishRemoved(running);
    },
  );

  const promoteReady = Effect.fn("GitWorkbenchQueue.promoteReady")(function* (
    current: QueuedWorkflow,
  ) {
    return yield* saveTransition(current, {
      status: "ready",
      needsReviewReasons: [],
      lastError: null,
    }).pipe(Effect.catchTag("GitWorkbenchQueueRevisionConflictError", () => Effect.succeed(null)));
  });

  const handleQuiescence: GitWorkbenchQueueShape["handleQuiescence"] = Effect.fn(
    "GitWorkbenchQueue.handleQuiescence",
  )(function* (event) {
    const waiting = yield* repository.listWaitingForTurn(event.threadId, event.turnId);
    yield* Effect.forEach(
      waiting,
      (workflow) =>
        Effect.gen(function* () {
          const ready = yield* promoteReady(workflow);
          if (ready !== null) yield* drain(ready.scope);
        }),
      { concurrency: 4, discard: true },
    );
  });

  const recoverOne = Effect.fn("GitWorkbenchQueue.recoverOne")(function* (
    workflow: QueuedWorkflow,
  ) {
    if (workflow.status === "running") {
      yield* saveTransition(workflow, {
        status: "needs_review",
        needsReviewReasons: ["server_restarted_during_execution"],
        lastError: null,
      }).pipe(Effect.catchTag("GitWorkbenchQueueRevisionConflictError", () => Effect.void));
      return;
    }
    if (workflow.status === "ready") {
      yield* drain(workflow.scope);
      return;
    }
    if (workflow.turnId === null) {
      const ready = yield* promoteReady(workflow);
      if (ready !== null) yield* drain(ready.scope);
      return;
    }
    const quiesced = yield* runtime.isTurnQuiesced(workflow.threadId, workflow.turnId);
    if (!quiesced) return;
    const ready = yield* promoteReady(workflow);
    if (ready !== null) yield* drain(ready.scope);
  });

  const recover: GitWorkbenchQueueShape["recover"] = Effect.fn("GitWorkbenchQueue.recover")(
    function* () {
      const recoverable = yield* repository.listRecoverable();
      yield* Effect.forEach(recoverable, recoverOne, { concurrency: 4, discard: true });
    },
  );

  return GitWorkbenchQueue.of({
    createOrReplace,
    edit,
    cancel,
    get,
    subscribe,
    drain,
    handleQuiescence,
    recover,
  });
});

export const GitWorkbenchQueueLive = Layer.effect(GitWorkbenchQueue, make);
