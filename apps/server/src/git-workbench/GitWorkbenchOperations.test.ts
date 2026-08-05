import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import {
  GitWorkbenchOperationCommandError,
  GitWorkbenchOperationConflict,
  GitWorkbenchOperations,
  GitWorkbenchOperationsDriver,
  GitWorkbenchOperationStateReader,
  layer,
  type GitWorkbenchOperationState,
} from "./GitWorkbenchOperations.ts";
import { GitRebaseControlledEditor } from "./GitRebaseControlledEditor.ts";
import { GitWorkbenchUndoService } from "./GitWorkbenchUndoService.ts";

const HEAD = "a".repeat(40);
const TARGET = "b".repeat(40);
const REMOTE = "c".repeat(40);

const idleState: GitWorkbenchOperationState = {
  stateToken: "state-1",
  headOid: HEAD,
  refName: "main",
  operation: { kind: "none" },
  hasWorkingTreeChanges: false,
};

function makeLayer(input?: {
  readonly run?: GitWorkbenchOperationsDriver["Service"]["run"];
  readonly read?: GitWorkbenchOperationStateReader["Service"]["read"];
  readonly capture?: GitWorkbenchUndoService["Service"]["capture"];
  readonly runWithPlan?: GitRebaseControlledEditor["Service"]["runWithPlan"];
}) {
  return layer.pipe(
    Layer.provide(
      Layer.succeed(
        GitWorkbenchOperationsDriver,
        GitWorkbenchOperationsDriver.of({
          run:
            input?.run ??
            (() =>
              Effect.succeed({
                exitCode: 0,
                stdout: "",
                stderr: "",
              })),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        GitWorkbenchOperationStateReader,
        GitWorkbenchOperationStateReader.of({
          read: input?.read ?? (() => Effect.succeed(idleState)),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        GitWorkbenchUndoService,
        GitWorkbenchUndoService.of({
          capture:
            input?.capture ??
            ((captureInput) =>
              Effect.succeed({
                id: "undo-1",
                cwd: captureInput.cwd,
                worktreeRoot: captureInput.cwd,
                reason: captureInput.reason,
                createdAt: 0,
                expiresAt: 1,
                headRef: "refs/heads/main",
                headOid: HEAD,
                indexTreeOid: TARGET,
                worktreeCommitOid: TARGET,
                refNamespace: "refs/t3/workbench-undo/undo-1",
                capturedStateToken: null,
              })),
          list: () => Effect.succeed([]),
          restore: () => Effect.void,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        GitRebaseControlledEditor,
        GitRebaseControlledEditor.of({
          runWithPlan:
            input?.runWithPlan ??
            ((_, run) => run({ GIT_SEQUENCE_EDITOR: "/safe/editor", GIT_EDITOR: "/safe/noop" })),
        }),
      ),
    ),
  );
}

describe("GitWorkbenchOperations", () => {
  it.effect("creates a branch only after matching the repository state token", () => {
    const run = vi.fn((_input) => Effect.succeed({ exitCode: 0 as const, stdout: "", stderr: "" }));

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const result = yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: { kind: "create_branch", name: "feature/deck", startPoint: TARGET },
      });

      assert.equal(result.status, "succeeded");
      expect(run).toHaveBeenCalledWith({
        operation: "GitWorkbenchOperations.create_branch",
        cwd: "/repo",
        args: ["branch", "--no-track", "feature/deck", TARGET],
        allowNonZeroExit: true,
      });
    }).pipe(Effect.provide(makeLayer({ run })));
  });

  it.effect("rejects stale state before invoking Git", () => {
    const run = vi.fn();

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const error = yield* operations
        .run({
          cwd: "/repo",
          expectedStateToken: "stale",
          action: { kind: "switch_branch", refName: "feature/deck" },
        })
        .pipe(Effect.flip);

      assert(error instanceof GitWorkbenchOperationConflict);
      assert.equal(error.reason, "stale_state");
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(makeLayer({ run })));
  });

  it.effect("rejects typed operations when repository status is truncated", () => {
    const run = vi.fn();

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const error = yield* operations
        .run({
          cwd: "/repo",
          expectedStateToken: "state-1",
          action: { kind: "reset", mode: "hard", targetOid: TARGET },
        })
        .pipe(Effect.flip);

      assert.equal(error._tag, "GitWorkbenchOperationInputError");
      assert.match(error.detail, /status is truncated/i);
      expect(run).not.toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        makeLayer({ run, read: () => Effect.succeed({ ...idleState, truncated: true }) }),
      ),
    );
  });

  it.effect("captures an undo snapshot before a hard reset", () => {
    const calls: string[] = [];
    const capture = vi.fn(() =>
      Effect.sync(() => calls.push("snapshot")).pipe(
        Effect.as({
          id: "undo-1",
          cwd: "/repo",
          worktreeRoot: "/repo",
          reason: "before_hard_reset" as const,
          createdAt: 0,
          expiresAt: 1,
          headRef: "refs/heads/main",
          headOid: HEAD,
          indexTreeOid: TARGET,
          worktreeCommitOid: TARGET,
          refNamespace: "refs/t3/workbench-undo/undo-1",
          capturedStateToken: "state-1",
        }),
      ),
    );
    const run = vi.fn(() =>
      Effect.sync(() => calls.push("git")).pipe(
        Effect.as({ exitCode: 0 as const, stdout: "", stderr: "" }),
      ),
    );

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: { kind: "reset", mode: "hard", targetOid: TARGET },
      });

      assert.deepStrictEqual(calls, ["snapshot", "git"]);
      expect(capture).toHaveBeenCalledWith({
        cwd: "/repo",
        reason: "before_hard_reset",
        capturedStateToken: "state-1",
      });
    }).pipe(Effect.provide(makeLayer({ capture, run })));
  });

  it.effect("uses a validated controlled editor for a merge-preserving interactive rebase", () => {
    const run = vi.fn((input: { readonly operation: string }) => {
      const stdout = input.operation.endsWith(".resolve")
        ? REMOTE
        : input.operation.endsWith(".graph")
          ? `${HEAD} ${REMOTE}\n${TARGET} ${REMOTE} ${HEAD}\n`
          : "";
      return Effect.succeed({ exitCode: 0 as const, stdout, stderr: "" });
    });
    const runWithPlan = vi.fn((plan, execute) =>
      execute({ GIT_SEQUENCE_EDITOR: "/tmp/editor", GIT_EDITOR: "/tmp/noop" }),
    );

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: {
          kind: "interactive_rebase",
          upstreamRef: "refs/heads/main",
          plan: [
            { kind: "label", name: "onto" },
            { kind: "pick", oid: HEAD },
            { kind: "label", name: "feature-tip" },
            { kind: "reset", label: "onto" },
            { kind: "merge", label: "feature-tip", originalOid: TARGET, messageMode: "reuse" },
          ],
        },
      });

      expect(runWithPlan).toHaveBeenCalledTimes(1);
      expect(runWithPlan.mock.calls[0]?.[0].todo).toContain(`merge -C ${TARGET} feature-tip`);
      expect(run).toHaveBeenCalledWith({
        operation: "GitWorkbenchOperations.interactive_rebase",
        cwd: "/repo",
        args: ["rebase", "--rebase-merges", "--interactive", "refs/heads/main"],
        allowNonZeroExit: true,
        env: { GIT_SEQUENCE_EDITOR: "/tmp/editor", GIT_EDITOR: "/tmp/noop" },
      });
    }).pipe(Effect.provide(makeLayer({ run, runWithPlan })));
  });

  it.effect("reports a cherry-pick conflict instead of flattening the command failure", () => {
    let reads = 0;
    const read = () =>
      Effect.sync(() => {
        reads += 1;
        return reads === 1
          ? idleState
          : {
              ...idleState,
              operation: { kind: "cherry-pick" as const, conflictingPaths: ["file.txt"] },
            };
      });

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const result = yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: { kind: "cherry_pick", commitOid: TARGET },
      });

      assert.equal(result.status, "conflicts");
      assert.equal(result.operation.kind, "cherry-pick");
    }).pipe(
      Effect.provide(
        makeLayer({
          read,
          run: () => Effect.succeed({ exitCode: 1, stdout: "", stderr: "conflict" }),
        }),
      ),
    );
  });

  it.effect("continues a resolved merge but never exposes merge skip", () => {
    const read = vi.fn(() =>
      Effect.succeed({ ...idleState, operation: { kind: "merge" as const } }),
    );
    const run = vi.fn(() => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }));

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: { kind: "continue", operation: "merge" },
      });

      expect(run).toHaveBeenCalledWith({
        operation: "GitWorkbenchOperations.continue",
        cwd: "/repo",
        args: ["merge", "--continue"],
        allowNonZeroExit: true,
      });
    }).pipe(Effect.provide(makeLayer({ read, run })));
  });

  it.effect("fails a non-conflict Git error with structured diagnostics", () =>
    Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const error = yield* operations
        .run({
          cwd: "/repo",
          expectedStateToken: "state-1",
          action: { kind: "revert", commitOid: TARGET },
        })
        .pipe(Effect.flip);

      assert(error instanceof GitWorkbenchOperationCommandError);
      assert.equal(error.exitCode, 128);
    }).pipe(
      Effect.provide(
        makeLayer({
          run: () => Effect.succeed({ exitCode: 128, stdout: "", stderr: "bad revision" }),
        }),
      ),
    ),
  );

  it.effect("pushes rewritten history with an exact lease and never raw force", () => {
    const run = vi.fn((_input) => Effect.succeed({ exitCode: 0 as const, stdout: "", stderr: "" }));

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: {
          kind: "force_with_lease",
          remote: "origin",
          branch: "feature/deck",
          expectedRemoteOid: REMOTE,
        },
      });

      const args = run.mock.calls[0]?.[0].args;
      expect(args).toEqual([
        "push",
        "origin",
        "HEAD:refs/heads/feature/deck",
        `--force-with-lease=refs/heads/feature/deck:${REMOTE}`,
      ]);
      expect(args).not.toContain("--force");
    }).pipe(Effect.provide(makeLayer({ run })));
  });

  it.effect("maps the remaining typed actions to fixed argument vectors", () => {
    const cases = [
      {
        action: { kind: "switch_branch", refName: "feature/deck" } as const,
        args: ["switch", "feature/deck"],
      },
      {
        action: { kind: "reset", mode: "soft", targetOid: TARGET } as const,
        args: ["reset", "--soft", TARGET],
      },
      {
        action: { kind: "reset", mode: "mixed", targetOid: TARGET } as const,
        args: ["reset", "--mixed", TARGET],
      },
      {
        action: { kind: "revert", commitOid: TARGET } as const,
        args: ["revert", "--no-edit", TARGET],
      },
      {
        action: { kind: "cherry_pick", commitOid: TARGET } as const,
        args: ["cherry-pick", TARGET],
      },
      {
        action: { kind: "guided_rebase", ontoRef: "refs/heads/main" } as const,
        args: ["rebase", "--rebase-merges", "refs/heads/main"],
      },
    ];
    const run = vi.fn(() => Effect.succeed({ exitCode: 0 as const, stdout: "", stderr: "" }));

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      for (const testCase of cases) {
        yield* operations.run({
          cwd: "/repo",
          expectedStateToken: "state-1",
          action: testCase.action,
        });
      }

      expect(run.mock.calls.map(([input]) => input.args)).toEqual(
        cases.map((testCase) => testCase.args),
      );
    }).pipe(Effect.provide(makeLayer({ run })));
  });

  it.effect("only permits continue, skip, and abort for the active matching operation", () => {
    const cases = [
      { kind: "continue", operation: "rebase" },
      { kind: "skip", operation: "cherry-pick" },
      { kind: "abort", operation: "revert" },
    ] as const;

    return Effect.forEach(
      cases,
      (testCase) => {
        let reads = 0;
        const run = vi.fn(() => Effect.succeed({ exitCode: 0 as const, stdout: "", stderr: "" }));
        const read = () =>
          Effect.sync(() => {
            reads += 1;
            return reads === 1
              ? { ...idleState, operation: { kind: testCase.operation } }
              : idleState;
          });

        return Effect.gen(function* () {
          const operations = yield* GitWorkbenchOperations;
          yield* operations.run({
            cwd: "/repo",
            expectedStateToken: "state-1",
            action: testCase,
          });
          expect(run).toHaveBeenCalledWith({
            operation: `GitWorkbenchOperations.${testCase.kind}`,
            cwd: "/repo",
            args: [testCase.operation, `--${testCase.kind}`],
            allowNonZeroExit: true,
          });
        }).pipe(Effect.provide(makeLayer({ read, run })));
      },
      { discard: true },
    );
  });

  it.effect("blocks a new operation while a repository operation is active", () => {
    const run = vi.fn();
    const read = () => Effect.succeed({ ...idleState, operation: { kind: "rebase" as const } });

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const error = yield* operations
        .run({
          cwd: "/repo",
          expectedStateToken: "state-1",
          action: { kind: "switch_branch", refName: "feature/deck" },
        })
        .pipe(Effect.flip);

      assert(error instanceof GitWorkbenchOperationConflict);
      assert.equal(error.reason, "active_operation");
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(makeLayer({ read, run })));
  });

  it.effect("captures dirty state before switching branches", () => {
    const capture = vi.fn((input) =>
      Effect.succeed({
        id: "undo-switch",
        cwd: input.cwd,
        worktreeRoot: input.cwd,
        reason: input.reason,
        createdAt: 0,
        expiresAt: 1,
        headRef: "refs/heads/main",
        headOid: HEAD,
        indexTreeOid: TARGET,
        worktreeCommitOid: TARGET,
        refNamespace: "refs/t3/workbench-undo/undo-switch",
        capturedStateToken: input.capturedStateToken ?? null,
      }),
    );
    const read = () => Effect.succeed({ ...idleState, hasWorkingTreeChanges: true });

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      yield* operations.run({
        cwd: "/repo",
        expectedStateToken: "state-1",
        action: { kind: "switch_branch", refName: "feature/deck" },
      });

      expect(capture).toHaveBeenCalledWith({
        cwd: "/repo",
        reason: "before_branch_switch",
        capturedStateToken: "state-1",
      });
    }).pipe(Effect.provide(makeLayer({ capture, read })));
  });

  it.effect("rejects an invalid interactive plan before creating a snapshot", () => {
    const capture = vi.fn();
    const run = vi.fn();

    return Effect.gen(function* () {
      const operations = yield* GitWorkbenchOperations;
      const error = yield* operations
        .run({
          cwd: "/repo",
          expectedStateToken: "state-1",
          action: {
            kind: "interactive_rebase",
            upstreamRef: "refs/heads/main",
            plan: [{ kind: "reset", label: "missing" }],
          },
        })
        .pipe(Effect.flip);

      assert.equal(error._tag, "GitWorkbenchRebasePlanError");
      expect(capture).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(makeLayer({ capture, run })));
  });

  it.effect("serializes simultaneous mutations for the same worktree", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let inFlight = 0;
      let peak = 0;
      let callCount = 0;
      const run: GitWorkbenchOperationsDriver["Service"]["run"] = () =>
        Effect.gen(function* () {
          callCount += 1;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          if (callCount === 1) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }
          inFlight -= 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        });

      const program = Effect.gen(function* () {
        const operations = yield* GitWorkbenchOperations;
        const first = yield* Effect.forkChild(
          operations.run({
            cwd: "/repo",
            expectedStateToken: "state-1",
            action: { kind: "create_branch", name: "one", startPoint: TARGET },
          }),
        );
        yield* Deferred.await(entered);
        const second = yield* Effect.forkChild(
          operations.run({
            cwd: "/repo",
            expectedStateToken: "state-1",
            action: { kind: "create_branch", name: "two", startPoint: TARGET },
          }),
        );
        yield* Effect.yieldNow;
        assert.equal(peak, 1);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        assert.equal(peak, 1);
      });

      yield* program.pipe(Effect.provide(makeLayer({ run })));
    }),
  );
});
