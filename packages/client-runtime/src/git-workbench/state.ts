import {
  WS_METHODS,
  type EnvironmentId,
  type GitQueuedWorkflow,
  type GitUndoSnapshot,
  type GitWorkbenchSnapshot,
  type GitWorkbenchStreamEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { runStream, subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
  createRuntimeCommand,
  runStreamInEnvironment,
} from "../state/runtime.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "../state/vcsCommandScheduler.ts";
import {
  applyGitWorkbenchStreamEvent,
  emptyGitWorkbenchProjection,
  type GitWorkbenchProjection,
} from "./projection.ts";
import {
  applyGitWorkbenchOperationProgress,
  beginGitWorkbenchOperationProgress,
  idleGitWorkbenchOperationProgress,
  type GitWorkbenchOperationProgress,
} from "./operationProgress.ts";
import { gitWorkbenchRepositoryKey, type GitWorkbenchRepositoryScope } from "./keys.ts";

const LIVE_IDLE_TTL_MS = 15_000;
const CHANGES_IDLE_TTL_MS = 15_000;
const INSIGHTS_STALE_TIME_MS = 5 * 60_000;
const INSIGHTS_IDLE_TTL_MS = 10 * 60_000;
const HISTORY_STALE_TIME_MS = 30_000;
const HISTORY_IDLE_TTL_MS = 5 * 60_000;
const IMMUTABLE_STALE_TIME_MS = 30 * 60_000;
const IMMUTABLE_IDLE_TTL_MS = 10 * 60_000;
const UNDO_STALE_TIME_MS = 5_000;
const UNDO_IDLE_TTL_MS = 30_000;

export type GitWorkbenchLiveProjection = GitWorkbenchProjection<
  GitWorkbenchSnapshot,
  GitQueuedWorkflow,
  GitUndoSnapshot
>;

type GitWorkbenchOperationTarget = {
  readonly environmentId: EnvironmentId;
  readonly input: EnvironmentRpcInput<typeof WS_METHODS.gitRunWorkbenchOperation>;
};

const operationProgressAtoms = Atom.family((key: string) =>
  Atom.make<GitWorkbenchOperationProgress>(idleGitWorkbenchOperationProgress()).pipe(
    Atom.withLabel(`environment-data:git-workbench:operation-progress:${key}`),
  ),
);

export function gitWorkbenchOperationProgressAtom(scope: GitWorkbenchRepositoryScope) {
  return operationProgressAtoms(gitWorkbenchRepositoryKey(scope));
}

export function resetGitWorkbenchOperationProgress(
  registry: AtomRegistry.AtomRegistry,
  scope: GitWorkbenchRepositoryScope,
): void {
  registry.set(gitWorkbenchOperationProgressAtom(scope), idleGitWorkbenchOperationProgress());
}

function normalizeRpcInput<Input>(input: Input): Input {
  if (Array.isArray(input)) {
    return input.map(normalizeRpcInput) as Input;
  }
  if (input === null || typeof input !== "object") {
    return input;
  }

  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeRpcInput(value)]),
  ) as Input;
}

function normalizeQueryTarget<Input>(target: {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}) {
  return {
    environmentId: target.environmentId,
    input: normalizeRpcInput(target.input),
  };
}

export function createGitWorkbenchEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const insights = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:insights",
    tag: WS_METHODS.gitGetRepositoryInsights,
    staleTimeMs: INSIGHTS_STALE_TIME_MS,
    idleTtlMs: INSIGHTS_IDLE_TTL_MS,
  });
  const history = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:history",
    tag: WS_METHODS.gitListHistory,
    staleTimeMs: HISTORY_STALE_TIME_MS,
    idleTtlMs: HISTORY_IDLE_TTL_MS,
  });
  const commitDetail = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:commit-detail",
    tag: WS_METHODS.gitGetCommitDetail,
    staleTimeMs: IMMUTABLE_STALE_TIME_MS,
    idleTtlMs: IMMUTABLE_IDLE_TTL_MS,
  });
  const commitFileDiff = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:commit-file-diff",
    tag: WS_METHODS.gitGetCommitFileDiff,
    staleTimeMs: IMMUTABLE_STALE_TIME_MS,
    idleTtlMs: IMMUTABLE_IDLE_TTL_MS,
  });
  const changesDiff = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:changes-diff",
    tag: WS_METHODS.gitGetChangesDiff,
    staleTimeMs: 0,
    idleTtlMs: CHANGES_IDLE_TTL_MS,
  });
  const interactiveRebasePlan = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:interactive-rebase-plan",
    tag: WS_METHODS.gitGetInteractiveRebasePlan,
    staleTimeMs: 0,
    idleTtlMs: CHANGES_IDLE_TTL_MS,
  });
  const undoSnapshots = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:undo-snapshots",
    tag: WS_METHODS.gitListUndoSnapshots,
    staleTimeMs: UNDO_STALE_TIME_MS,
    idleTtlMs: UNDO_IDLE_TTL_MS,
  });
  const sessionAccess = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:git-workbench:session-access",
    tag: WS_METHODS.serverProbe,
    staleTimeMs: 30_000,
    idleTtlMs: LIVE_IDLE_TTL_MS,
  });
  const runOperation = createRuntimeCommand(runtime, {
    label: "environment-data:git-workbench:run-operation",
    scheduler: vcsCommandScheduler,
    concurrency: vcsCommandConcurrency,
    execute: (target: GitWorkbenchOperationTarget, registry) => {
      const scope = {
        environmentId: target.environmentId,
        cwd: target.input.cwd,
      };
      const progressAtom = gitWorkbenchOperationProgressAtom(scope);
      registry.set(progressAtom, beginGitWorkbenchOperationProgress());
      return runStreamInEnvironment(
        target.environmentId,
        runStream(WS_METHODS.gitRunWorkbenchOperation, target.input),
      ).pipe(
        Stream.tap((event) =>
          Effect.sync(() => {
            registry.update(progressAtom, (current) =>
              applyGitWorkbenchOperationProgress(current, event),
            );
          }),
        ),
        Stream.runLast,
        Effect.map(Option.getOrUndefined),
        Effect.tapError(() =>
          Effect.sync(() => {
            registry.update(progressAtom, (current) =>
              current.status === "running" ? { ...current, status: "failed" as const } : current,
            );
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            registry.set(progressAtom, idleGitWorkbenchOperationProgress());
          }),
        ),
      );
    },
  });

  return {
    workbench: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:git-workbench:live",
      idleTtlMs: LIVE_IDLE_TTL_MS,
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.gitSubscribeWorkbench>) =>
        subscribe(WS_METHODS.gitSubscribeWorkbench, input).pipe(
          Stream.mapAccum(
            () =>
              emptyGitWorkbenchProjection<
                GitWorkbenchSnapshot,
                GitQueuedWorkflow,
                GitUndoSnapshot
              >(),
            (current, event: GitWorkbenchStreamEvent) => {
              const next = applyGitWorkbenchStreamEvent(current, event);
              return [next, [next]] as const;
            },
          ),
        ),
    }),
    insights: (target: Parameters<typeof insights>[0]) => insights(normalizeQueryTarget(target)),
    history: (target: Parameters<typeof history>[0]) => history(normalizeQueryTarget(target)),
    commitDetail: (target: Parameters<typeof commitDetail>[0]) =>
      commitDetail(normalizeQueryTarget(target)),
    commitFileDiff: (target: Parameters<typeof commitFileDiff>[0]) =>
      commitFileDiff(normalizeQueryTarget(target)),
    changesDiff: (target: Parameters<typeof changesDiff>[0]) =>
      changesDiff(normalizeQueryTarget(target)),
    interactiveRebasePlan: (target: Parameters<typeof interactiveRebasePlan>[0]) =>
      interactiveRebasePlan(normalizeQueryTarget(target)),
    undoSnapshots: (target: Parameters<typeof undoSnapshots>[0]) =>
      undoSnapshots(normalizeQueryTarget(target)),
    sessionAccess: (target: Parameters<typeof sessionAccess>[0]) =>
      sessionAccess(normalizeQueryTarget(target)),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-workbench:refresh",
      tag: WS_METHODS.gitRefreshWorkbench,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    applyChangeSelection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-workbench:apply-change-selection",
      tag: WS_METHODS.gitApplyChangeSelection,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    operationProgress: (scope: GitWorkbenchRepositoryScope) =>
      gitWorkbenchOperationProgressAtom(scope),
    runOperation,
    restoreUndoSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-workbench:restore-undo",
      tag: WS_METHODS.gitRestoreUndoSnapshot,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    createUndoSnapshot: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-workbench:create-undo",
      tag: WS_METHODS.gitCreateUndoSnapshot,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    upsertQueuedWorkflow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-workbench:upsert-queue",
      tag: WS_METHODS.gitUpsertQueuedWorkflow,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    cancelQueuedWorkflow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-workbench:cancel-queue",
      tag: WS_METHODS.gitCancelQueuedWorkflow,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
