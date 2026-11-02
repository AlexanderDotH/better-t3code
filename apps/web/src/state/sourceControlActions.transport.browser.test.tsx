import {
  setupTransportTest,
  deferStackedResponse,
  transportTestState,
  scope,
  threadId,
  environmentId,
  GitActionsControl,
} from "./sourceControlActions.transport.fixture";
import { RegistryContext } from "@effect/atom-react";
import { AuthSourceControlWriteScope } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { expect, it } from "vite-plus/test";
import { act, render } from "../../test/render";
import { GitCommitComposer } from "../components/git-workbench/GitCommitComposer";
import {
  gitCommitDraftKey,
  useGitCommitDraftStore,
} from "../components/git-workbench/gitCommitDraftStore";
import {
  commitResult,
  deferredResult,
  vcsStatus,
} from "../components/git-workbench/gitCommitTestFixtures";
import { TooltipProvider } from "../components/ui/tooltip";
import { requestGitActionsControl } from "../components/gitActionsControlBus";
import { subscribeGitWorkbenchEntry } from "../components/git-workbench/gitWorkbenchEntryBus";

const testState = transportTestState();
let useEnvironmentScope: (typeof import("./session"))["useEnvironmentScope"];

function CommitPreparation({ onSettled }: { onSettled: () => void }) {
  const [preparing, setPreparing] = useState(false);
  const canWrite = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  useEffect(
    () =>
      subscribeGitWorkbenchEntry((request) => {
        if (request.environmentId !== environmentId || request.cwd !== scope.cwd) return false;
        setPreparing(true);
        return true;
      }),
    [],
  );
  return (
    <>
      <GitActionsControl gitCwd={scope.cwd} activeThreadRef={{ environmentId, threadId }} />
      {preparing ? (
        <GitCommitComposer
          {...scope}
          stateToken="state-1"
          stagedCount={1}
          partialStagedCount={1}
          blocked={!canWrite}
          activeTurn={false}
          hasQueuedWorkflow={false}
          focusRequest={0}
          pushAvailable={false}
          onQueueCommit={async () => ({ status: "queued" })}
          onSettled={onSettled}
        />
      ) : null}
    </>
  );
}

it("submits the actual composer through the actual control and web hook to the runtime RPC", async () => {
  const settled = deferredResult<void>();
  const registry = await setupTransportTest({
    status: vcsStatus({ hasPrimaryRemote: false, hasUpstream: false }),
  });
  testState.stackedResult = commitResult();
  using _registry = { [Symbol.dispose]: () => registry.reset() };
  const { appAtomRegistry } = await import("../rpc/atomRegistry");
  const { connectionAtomRuntime } = await import("../connection/runtime");
  const sessionModule = await import("./session");
  const { environmentSession, readEnvironmentScope } = sessionModule;
  useEnvironmentScope = sessionModule.useEnvironmentScope;
  const sessionAtom = environmentSession.sessionStateAtom(environmentId);
  expect(registry).toBe(appAtomRegistry);
  expect(connectionAtomRuntime).toBe(testState.runtime);
  expect(registry.get(sessionAtom)._tag).toBe("Success");
  expect(testState.sessionRequests).toContain("https://environment.example.test/api/auth/session");
  expect(readEnvironmentScope(environmentId, AuthSourceControlWriteScope)).toBe(true);
  using response = deferStackedResponse();
  const _draftCleanup = { [Symbol.dispose]: () => useGitCommitDraftStore.getState().clear() };
  useGitCommitDraftStore.getState().clear();
  using _draft = _draftCleanup;
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <TooltipProvider>
        <CommitPreparation onSettled={() => settled.resolve()} />
      </TooltipProvider>
    </RegistryContext.Provider>,
  );
  const container = screen.container;
  expect(registry).toBe(appAtomRegistry);
  expect(readEnvironmentScope(environmentId, AuthSourceControlWriteScope)).toBe(true);
  expect(container.querySelector("[data-git-commit-composer]")).toBeNull();
  await act(() => requestGitActionsControl({ ...scope, intent: "commit-staged" }));
  const preparation = screen.getByRole("form", { name: "Prepare commit", exact: true });
  await expect.element(preparation).toBeVisible();
  expect(testState.rpcInputs).toEqual([]);
  expect(testState.refreshInputs).toEqual([]);
  await preparation.getByRole("radio", { name: "Write a message", exact: true }).click();
  const message = preparation.getByRole("textbox", { name: "Commit message", exact: true });
  await expect.element(message).not.toBeDisabled();
  const textarea = container.querySelector<HTMLTextAreaElement>("[data-git-commit-message]")!;
  const commitMessage = "  A deliberate subject\n\nBody with details.  ";
  await message.fill(commitMessage);
  const button = preparation.getByRole("button", { name: "Commit staged changes", exact: true });
  await expect.element(button).not.toBeDisabled();
  expect(registry).toBe(appAtomRegistry);
  expect(
    readEnvironmentScope(environmentId, AuthSourceControlWriteScope),
    `Call-time source control grant before submission: ${JSON.stringify(registry.get(sessionAtom))}`,
  ).toBe(true);
  await button.click();
  const observed = await Promise.race([
    response.received.then((input) => ({ status: "request" as const, input })),
    settled.promise.then(() => ({
      status: "settled" as const,
      outcome: useGitCommitDraftStore
        .getState()
        .drafts.get(gitCommitDraftKey(environmentId, scope.cwd))?.outcome,
      permission: {
        environmentId,
        requiredScope: AuthSourceControlWriteScope,
        allowed: readEnvironmentScope(environmentId, AuthSourceControlWriteScope),
        sameRegistry: registry === appAtomRegistry,
        session: registry.get(sessionAtom),
      },
    })),
  ]);
  expect(
    observed.status,
    `Expected the runtime RPC request before settlement: ${JSON.stringify(observed)}`,
  ).toBe("request");

  expect(testState.refreshInputs).toEqual([{ cwd: scope.cwd }]);
  expect(testState.rpcInputs).toEqual([
    {
      actionId: expect.any(String),
      cwd: scope.cwd,
      action: "commit",
      commitMessage,
      commitSelection: { mode: "staged" },
      threadId,
    },
  ]);
  expect(textarea.value).toBe(commitMessage);
  await act(() => response.complete(testState.stackedResult!));
  await settled.promise;
  expect(
    useGitCommitDraftStore.getState().drafts.get(gitCommitDraftKey(environmentId, scope.cwd))
      ?.outcome,
  ).toEqual({ status: "success", result: testState.stackedResult });
  await expect.element(textarea).toHaveValue("");
  expect(testState.metadataInputs).toEqual([]);
});
