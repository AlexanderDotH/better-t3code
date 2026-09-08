import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import {
  GitCommandError,
  type GitWorkbenchOperationAction as ContractGitWorkbenchOperationAction,
  type GitWorkbenchOperationKind,
  type GitWorkbenchOperationResult as ContractGitWorkbenchOperationResult,
  type GitWorkbenchOperationState as ContractGitWorkbenchOperationState,
  type GitWorkbenchRunOperationInput as ContractGitWorkbenchRunOperationInput,
} from "@t3tools/contracts";

import {
  GitRebaseControlledEditor,
  GitRebaseControlledEditorError,
} from "./GitRebaseControlledEditor.ts";
import {
  renderGitRebasePlan,
  validateGitRebasePlan,
  validateGitRebasePlanTopology,
  type GitRebaseGraphCommit,
  type GitRebasePlanIssue,
} from "./GitRebasePlan.ts";
import { GitWorkbenchUndoError, GitWorkbenchUndoService } from "./GitWorkbenchUndoService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export interface GitWorkbenchOperationState {
  readonly stateToken: string;
  readonly headOid: string | null;
  readonly refName: string | null;
  readonly operation: ContractGitWorkbenchOperationState;
  readonly hasWorkingTreeChanges: boolean;
  readonly truncated?: boolean;
}

export type GitWorkbenchOperationAction = ContractGitWorkbenchOperationAction;
export type GitWorkbenchRunOperationInput = ContractGitWorkbenchRunOperationInput;
export type GitWorkbenchOperationResult = ContractGitWorkbenchOperationResult;

export interface GitWorkbenchOperationCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated?: boolean;
}

export interface GitWorkbenchOperationCommandInput {
  readonly operation: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowNonZeroExit: true;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

export class GitWorkbenchOperationsDriver extends Context.Service<
  GitWorkbenchOperationsDriver,
  {
    readonly run: (
      input: GitWorkbenchOperationCommandInput,
    ) => Effect.Effect<GitWorkbenchOperationCommandResult, GitCommandError>;
  }
>()("t3/git-workbench/GitWorkbenchOperations/GitWorkbenchOperationsDriver") {}

export class GitWorkbenchOperationStateReader extends Context.Service<
  GitWorkbenchOperationStateReader,
  {
    readonly read: (cwd: string) => Effect.Effect<GitWorkbenchOperationState, GitCommandError>;
  }
>()("t3/git-workbench/GitWorkbenchOperations/GitWorkbenchOperationStateReader") {}

export class GitWorkbenchOperationConflict extends Data.TaggedError(
  "GitWorkbenchOperationConflict",
)<{
  readonly reason: "active_operation" | "stale_state";
  readonly cwd: string;
  readonly expectedStateToken: string;
  readonly actualStateToken: string;
  readonly activeOperation: GitWorkbenchOperationKind;
}> {}

export class GitWorkbenchOperationInputError extends Data.TaggedError(
  "GitWorkbenchOperationInputError",
)<{
  readonly detail: string;
}> {}

export class GitWorkbenchRebasePlanError extends Data.TaggedError("GitWorkbenchRebasePlanError")<{
  readonly issues: readonly GitRebasePlanIssue[];
}> {}

export class GitWorkbenchOperationCommandError extends Data.TaggedError(
  "GitWorkbenchOperationCommandError",
)<{
  readonly operation: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly detail: string;
}> {}

export type GitWorkbenchOperationsError =
  | GitCommandError
  | GitRebaseControlledEditorError
  | GitWorkbenchOperationCommandError
  | GitWorkbenchOperationConflict
  | GitWorkbenchOperationInputError
  | GitWorkbenchRebasePlanError
  | GitWorkbenchUndoError;

export class GitWorkbenchOperations extends Context.Service<
  GitWorkbenchOperations,
  {
    readonly run: (
      input: GitWorkbenchRunOperationInput,
    ) => Effect.Effect<GitWorkbenchOperationResult, GitWorkbenchOperationsError>;
  }
>()("t3/git-workbench/GitWorkbenchOperations") {}

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const INTERACTIVE_REBASE_COMMIT_MAX = 2_000;
const INTERACTIVE_REBASE_GRAPH_MAX_BYTES = 512_000;

function ensureObjectId(
  value: string,
  field: string,
): Effect.Effect<void, GitWorkbenchOperationInputError> {
  if (FULL_OBJECT_ID.test(value)) return Effect.void;
  return Effect.fail(
    new GitWorkbenchOperationInputError({ detail: `${field} must be a full SHA.` }),
  );
}

function isSafeRef(value: string): boolean {
  return (
    SAFE_REF.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock")
  );
}

function ensureRef(
  value: string,
  field: string,
): Effect.Effect<void, GitWorkbenchOperationInputError> {
  if (FULL_OBJECT_ID.test(value) || isSafeRef(value)) return Effect.void;
  return Effect.fail(
    new GitWorkbenchOperationInputError({ detail: `${field} is not a safe Git ref.` }),
  );
}

function ensureRemote(value: string): Effect.Effect<void, GitWorkbenchOperationInputError> {
  if (SAFE_REMOTE.test(value)) return Effect.void;
  return Effect.fail(new GitWorkbenchOperationInputError({ detail: "Remote name is not safe." }));
}

function snapshotReason(action: GitWorkbenchOperationAction, state: GitWorkbenchOperationState) {
  switch (action.kind) {
    case "reset":
      if (action.mode === "mixed") return "before_mixed_reset" as const;
      return action.mode === "hard" ? ("before_hard_reset" as const) : null;
    case "revert":
      return "before_revert" as const;
    case "cherry_pick":
      return "before_cherry_pick" as const;
    case "guided_rebase":
      return "before_rebase" as const;
    case "interactive_rebase":
      return "before_rebase" as const;
    case "switch_branch":
      return state.hasWorkingTreeChanges ? ("before_branch_switch" as const) : null;
    default:
      return null;
  }
}

function validateAction(action: GitWorkbenchOperationAction) {
  switch (action.kind) {
    case "create_branch":
      return Effect.all(
        [
          ensureRef(action.name, "Branch name"),
          action.startPoint ? ensureRef(action.startPoint, "Start point") : Effect.void,
        ],
        { discard: true },
      );
    case "switch_branch":
      return ensureRef(action.refName, "Branch name");
    case "reset":
      return ensureObjectId(action.targetOid, "Reset target");
    case "revert":
    case "cherry_pick":
      return ensureObjectId(action.commitOid, "Commit object id");
    case "guided_rebase":
      return ensureRef(action.ontoRef, "Rebase target");
    case "interactive_rebase": {
      const validation = validateGitRebasePlan(action.plan);
      if (!validation.valid) {
        return Effect.fail(new GitWorkbenchRebasePlanError({ issues: validation.issues }));
      }
      return ensureRef(action.upstreamRef, "Rebase upstream");
    }
    case "force_with_lease":
      return Effect.all(
        [
          ensureRemote(action.remote),
          ensureRef(action.branch, "Branch name"),
          ensureObjectId(action.expectedRemoteOid, "Remote lease object id"),
        ],
        { discard: true },
      );
    case "continue":
    case "skip":
    case "abort":
      return Effect.void;
  }
}

function commandForAction(
  action: Exclude<GitWorkbenchOperationAction, { kind: "interactive_rebase" }>,
) {
  switch (action.kind) {
    case "create_branch":
      return [
        "branch",
        "--no-track",
        action.name,
        ...(action.startPoint ? [action.startPoint] : []),
      ];
    case "switch_branch":
      return ["switch", action.refName];
    case "reset":
      return ["reset", `--${action.mode}`, action.targetOid];
    case "revert":
      return ["revert", "--no-edit", action.commitOid];
    case "cherry_pick":
      return ["cherry-pick", action.commitOid];
    case "guided_rebase":
      return ["rebase", "--rebase-merges", action.ontoRef];
    case "continue":
    case "skip":
    case "abort":
      return [action.operation, `--${action.kind}`];
    case "force_with_lease": {
      const branchRef = `refs/heads/${action.branch}`;
      return [
        "push",
        action.remote,
        `HEAD:${branchRef}`,
        `--force-with-lease=${branchRef}:${action.expectedRemoteOid}`,
      ];
    }
  }
}

function operationName(action: GitWorkbenchOperationAction): string {
  return `GitWorkbenchOperations.${action.kind}`;
}

function isContinuation(
  action: GitWorkbenchOperationAction,
): action is Extract<GitWorkbenchOperationAction, { kind: "continue" | "skip" | "abort" }> {
  return action.kind === "continue" || action.kind === "skip" || action.kind === "abort";
}

function resultFromState(state: GitWorkbenchOperationState): GitWorkbenchOperationResult {
  const hasConflicts = (state.operation.conflictingPaths?.length ?? 0) > 0;
  return {
    status: hasConflicts
      ? "conflicts"
      : state.operation.kind !== "none"
        ? "needs_edit"
        : "succeeded",
    headOid: state.headOid,
    operation: state.operation,
  };
}

export const make = Effect.gen(function* () {
  const driver = yield* GitWorkbenchOperationsDriver;
  const stateReader = yield* GitWorkbenchOperationStateReader;
  const undo = yield* GitWorkbenchUndoService;
  const controlledEditor = yield* GitRebaseControlledEditor;
  const locks = new Map<string, Semaphore.Semaphore>();

  const lockFor = (cwd: string) => {
    const existing = locks.get(cwd);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    locks.set(cwd, created);
    return created;
  };

  const validateInteractiveTopology = Effect.fn(
    "GitWorkbenchOperations.validateInteractiveTopology",
  )(function* (
    input: GitWorkbenchRunOperationInput & {
      readonly action: Extract<
        GitWorkbenchOperationAction,
        { readonly kind: "interactive_rebase" }
      >;
    },
  ) {
    const resolved = yield* driver.run({
      operation: "GitWorkbenchOperations.interactive_rebase.resolve",
      cwd: input.cwd,
      args: ["rev-parse", "--verify", "--end-of-options", `${input.action.upstreamRef}^{commit}`],
      allowNonZeroExit: true,
      maxOutputBytes: 256,
      timeoutMs: 10_000,
    });
    const upstreamOid = resolved.stdout.trim();
    if (resolved.exitCode !== 0 || !FULL_OBJECT_ID.test(upstreamOid)) {
      return yield* new GitWorkbenchOperationInputError({
        detail: "Interactive rebase upstream no longer resolves to a commit.",
      });
    }

    const graphResult = yield* driver.run({
      operation: "GitWorkbenchOperations.interactive_rebase.graph",
      cwd: input.cwd,
      args: [
        "rev-list",
        "--reverse",
        "--topo-order",
        "--parents",
        `--max-count=${INTERACTIVE_REBASE_COMMIT_MAX + 1}`,
        `${upstreamOid}..HEAD`,
      ],
      allowNonZeroExit: true,
      maxOutputBytes: INTERACTIVE_REBASE_GRAPH_MAX_BYTES,
      timeoutMs: 20_000,
    });
    if (graphResult.exitCode !== 0) {
      return yield* new GitWorkbenchOperationCommandError({
        operation: "GitWorkbenchOperations.interactive_rebase.graph",
        cwd: input.cwd,
        exitCode: graphResult.exitCode,
        detail: graphResult.stderr.trim() || "The interactive rebase graph could not be refreshed.",
      });
    }
    const commits: GitRebaseGraphCommit[] = [];
    for (const line of graphResult.stdout.trim().split("\n").filter(Boolean)) {
      const [oid = "", ...parents] = line.trim().split(/\s+/u);
      if (!FULL_OBJECT_ID.test(oid) || parents.some((parent) => !FULL_OBJECT_ID.test(parent))) {
        return yield* new GitWorkbenchOperationInputError({
          detail: "Git returned a malformed interactive rebase graph.",
        });
      }
      commits.push({ oid, parents });
    }
    if (
      commits.length === 0 ||
      commits.length > INTERACTIVE_REBASE_COMMIT_MAX ||
      graphResult.stdoutTruncated === true
    ) {
      return yield* new GitWorkbenchOperationInputError({
        detail: `Interactive rebase is limited to ${INTERACTIVE_REBASE_COMMIT_MAX} commits.`,
      });
    }
    const topology = validateGitRebasePlanTopology(input.action.plan, commits, upstreamOid);
    if (!topology.valid) {
      return yield* new GitWorkbenchRebasePlanError({ issues: topology.issues });
    }
  });

  const runCommand = (input: GitWorkbenchRunOperationInput) => {
    const execute = (args: readonly string[], env?: NodeJS.ProcessEnv) =>
      driver.run({
        operation: operationName(input.action),
        cwd: input.cwd,
        args,
        allowNonZeroExit: true,
        ...(env ? { env } : {}),
      });

    const action = input.action;
    if (action.kind !== "interactive_rebase") {
      return execute(commandForAction(action));
    }

    const controlledPlan = {
      todo: renderGitRebasePlan(action.plan),
      rewordMessages: Object.fromEntries(
        action.plan.flatMap((node) =>
          node.kind === "reword" && node.message ? [[node.oid, node.message] as const] : [],
        ),
      ),
    };
    return controlledEditor.runWithPlan(controlledPlan, (env) =>
      execute(["rebase", "--rebase-merges", "--interactive", action.upstreamRef], { ...env }),
    );
  };

  const runUnlocked = Effect.fn("GitWorkbenchOperations.runUnlocked")(function* (
    input: GitWorkbenchRunOperationInput,
  ) {
    yield* validateAction(input.action);
    const before = yield* stateReader.read(input.cwd);

    if (before.stateToken !== input.expectedStateToken) {
      return yield* new GitWorkbenchOperationConflict({
        reason: "stale_state",
        cwd: input.cwd,
        expectedStateToken: input.expectedStateToken,
        actualStateToken: before.stateToken,
        activeOperation: before.operation.kind,
      });
    }

    if (before.truncated === true) {
      return yield* new GitWorkbenchOperationInputError({
        detail: "Repository status is truncated; refresh after reducing the pending change set.",
      });
    }

    if (before.operation.kind !== "none" && !isContinuation(input.action)) {
      return yield* new GitWorkbenchOperationConflict({
        reason: "active_operation",
        cwd: input.cwd,
        expectedStateToken: input.expectedStateToken,
        actualStateToken: before.stateToken,
        activeOperation: before.operation.kind,
      });
    }

    if (isContinuation(input.action) && before.operation.kind !== input.action.operation) {
      return yield* new GitWorkbenchOperationConflict({
        reason: "active_operation",
        cwd: input.cwd,
        expectedStateToken: input.expectedStateToken,
        actualStateToken: before.stateToken,
        activeOperation: before.operation.kind,
      });
    }

    if (input.action.kind === "interactive_rebase") {
      yield* validateInteractiveTopology({ ...input, action: input.action });
    }

    const reason = snapshotReason(input.action, before);
    if (reason) {
      yield* undo.capture({
        cwd: input.cwd,
        reason,
        capturedStateToken: input.expectedStateToken,
      });
    }

    const command = yield* runCommand(input);
    const after = yield* stateReader.read(input.cwd);
    const hasConflicts = (after.operation.conflictingPaths?.length ?? 0) > 0;
    if (command.exitCode !== 0 && !hasConflicts && after.operation.kind === "none") {
      return yield* new GitWorkbenchOperationCommandError({
        operation: operationName(input.action),
        cwd: input.cwd,
        exitCode: command.exitCode,
        detail: command.stderr.trim() || "Git operation failed.",
      });
    }
    return resultFromState(after);
  });

  return GitWorkbenchOperations.of({
    run: (input) => lockFor(input.cwd).withPermit(runUnlocked(input)),
  });
});

export const layer = Layer.effect(GitWorkbenchOperations, make);

export const driverLayer = Layer.effect(
  GitWorkbenchOperationsDriver,
  Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    return GitWorkbenchOperationsDriver.of({
      run: (input) =>
        git
          .execute({
            ...input,
            args: [...input.args],
          })
          .pipe(
            Effect.map((result) => ({
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              stdoutTruncated: result.stdoutTruncated,
            })),
          ),
    });
  }),
);
