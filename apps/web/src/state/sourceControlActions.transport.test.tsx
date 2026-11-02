import {
  setupTransportTest,
  deferStackedResponse,
  transportTestState,
  scope,
  threadId,
  useGitStackedAction,
} from "./sourceControlActions.transport.fixture";
import { RegistryContext } from "@effect/atom-react";
import { it as effectIt } from "@effect/vitest";
import type { GitRunStackedActionInput } from "@t3tools/contracts";
import { createVcsActionTransportId } from "@t3tools/client-runtime/state/vcs";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { commitResult, vcsStatus } from "../components/git-workbench/gitCommitTestFixtures";
import { resolveQuickAction } from "../components/GitActionsControl.logic";

const testState = transportTestState();

let latest: ReturnType<typeof useGitStackedAction>;
let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer | undefined;
function Probe() {
  const action = useGitStackedAction(scope);
  useLayoutEffect(() => {
    latest = action;
  }, [action]);
  return null;
}
beforeEach(async () => {
  registry = await setupTransportTest({
    status: vcsStatus({ hasPrimaryRemote: false, hasUpstream: false }),
  });
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <Probe />
      </RegistryContext.Provider>,
    );
  });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  registry.dispose();
});

describe("useGitStackedAction commit selection transport", () => {
  effectIt.effect(
    "loads the configured checkout through the runtime before selecting commit preparation",
    () =>
      Effect.gen(function* () {
        const { vcsEnvironment } = yield* Effect.promise(() => import("./vcs"));
        const atom = vcsEnvironment.status({
          environmentId: scope.environmentId,
          input: { cwd: scope.cwd },
        });
        const status = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* AtomRegistry.mount(registry, atom);
            return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: false });
          }),
        );
        expect(status).toEqual(vcsStatus({ hasPrimaryRemote: false, hasUpstream: false }));
        expect(resolveQuickAction(status, false, false, false)).toEqual({
          label: "Commit",
          disabled: false,
          kind: "run_action",
          action: "commit",
        });
      }),
  );

  it("observes the runtime request before releasing its terminal result", async () => {
    using response = deferStackedResponse();
    const actionId = "held-commit-response";
    let pending!: ReturnType<typeof latest.run>;
    await act(() => {
      pending = latest.run({
        actionId,
        action: "commit",
        commitSelection: { mode: "staged" },
        threadId,
      });
    });
    await act(async () => {
      expect(await response.received).toEqual({
        actionId: createVcsActionTransportId(scope, actionId),
        cwd: scope.cwd,
        action: "commit",
        commitSelection: { mode: "staged" },
        threadId,
      });
    });
    expect(latest.isPending).toBe(true);

    const result = commitResult();
    await act(async () => {
      response.complete(result);
      const completed = await pending;
      expect(AsyncResult.isSuccess(completed)).toBe(true);
      if (completed._tag === "Success") expect(completed.value).toEqual(result);
    });
    expect(latest.isPending).toBe(false);
  });

  it("commits the staged index after refreshing the real workbench command", async () => {
    const { gitWorkbenchEnvironment } = await import("./gitWorkbench");
    const actionId = "after-workbench-refresh";
    const commitMessage = "  A deliberate subject\n\nBody with details.  ";
    await act(async () => {
      const refreshed = await runAtomCommand(registry, gitWorkbenchEnvironment.refresh, {
        environmentId: scope.environmentId,
        input: { cwd: scope.cwd },
      });
      expect(refreshed._tag).toBe("Success");
      const committed = await latest.run({
        actionId,
        action: "commit",
        commitMessage,
        commitSelection: { mode: "staged" },
        threadId,
      });
      expect(committed._tag).toBe("Success");
    });

    expect(testState.refreshInputs).toEqual([{ cwd: scope.cwd }]);
    expect(testState.rpcInputs).toEqual([
      {
        actionId: createVcsActionTransportId(scope, actionId),
        cwd: scope.cwd,
        action: "commit",
        commitMessage,
        commitSelection: { mode: "staged" },
        threadId,
      },
    ]);
  });

  it.each([
    { name: "legacy omission", input: {} },
    { name: "legacy paths", input: { filePaths: ["src/legacy.ts"] } },
    { name: "staged changes", input: { commitSelection: { mode: "staged" } } },
    { name: "all changes", input: { commitSelection: { mode: "all" } } },
    {
      name: "selected paths",
      input: {
        commitSelection: { mode: "paths", paths: ["src/one.ts", "src/renamed file.ts"] },
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: {
      commitSelection?: GitRunStackedActionInput["commitSelection"];
      filePaths?: string[];
    };
  }>)("preserves $name through the runtime RPC", async ({ name, input }) => {
    const actionId = `commit-selection-${name}`;
    let succeeded = false;
    await act(async () => {
      succeeded = AsyncResult.isSuccess(
        await latest.run({
          actionId,
          action: "commit_push",
          commitMessage: "Chosen changes",
          featureBranch: true,
          threadId,
          ...input,
        }),
      );
    });

    expect(succeeded).toBe(true);
    expect(testState.rpcInputs).toEqual([
      {
        actionId: createVcsActionTransportId(scope, actionId),
        cwd: scope.cwd,
        action: "commit_push",
        commitMessage: "Chosen changes",
        featureBranch: true,
        threadId,
        ...input,
      },
    ]);
  });
});
