import {
  setupTransportTest,
  transportTestState,
  scope,
  threadId,
  useGitStackedAction,
} from "./sourceControlActions.transport.fixture";
import { RegistryContext } from "@effect/atom-react";
import type { GitRunStackedActionInput } from "@t3tools/contracts";
import { createVcsActionTransportId } from "@t3tools/client-runtime/state/vcs";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";
import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

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
  registry = await setupTransportTest();
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
