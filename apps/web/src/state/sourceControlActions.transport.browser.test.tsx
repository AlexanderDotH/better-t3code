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
import { expect, it } from "vite-plus/test";
import { act, render } from "../../test/render";
import { GitCommitComposer } from "../components/git-workbench/GitCommitComposer";
import {
  gitCommitDraftKey,
  useGitCommitDraftStore,
} from "../components/git-workbench/gitCommitDraftStore";
import { commitResult, deferredResult } from "../components/git-workbench/gitCommitTestFixtures";
import { TooltipProvider } from "../components/ui/tooltip";

const testState = transportTestState();

it("submits the actual composer through the actual control and web hook to the runtime RPC", async () => {
  const settled = deferredResult<void>();
  const registry = await setupTransportTest();
  testState.stackedResult = commitResult();
  using _registry = { [Symbol.dispose]: () => registry.dispose() };
  using response = deferStackedResponse();
  const _draftCleanup = { [Symbol.dispose]: () => useGitCommitDraftStore.getState().clear() };
  useGitCommitDraftStore.getState().clear();
  using _draft = _draftCleanup;
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <TooltipProvider>
        <GitActionsControl gitCwd={scope.cwd} activeThreadRef={{ environmentId, threadId }} />
        <GitCommitComposer
          {...scope}
          stateToken="state-1"
          stagedCount={1}
          partialStagedCount={1}
          blocked={false}
          activeTurn={false}
          hasQueuedWorkflow={false}
          focusRequest={0}
          pushAvailable={false}
          onQueueCommit={async () => ({ status: "queued" })}
          onSettled={() => settled.resolve()}
        />
      </TooltipProvider>
    </RegistryContext.Provider>,
  );
  const container = screen.container;
  await expect
    .element(screen.getByRole("button", { name: "Commit, push & PR", exact: true }))
    .not.toBeDisabled();
  expect(testState.rpcInputs).toEqual([]);
  expect(testState.refreshInputs).toEqual([]);
  const manual = container.querySelector<HTMLInputElement>('[data-git-commit-mode="manual"]')!;
  await act(() => manual.click());
  const textarea = container.querySelector<HTMLTextAreaElement>("[data-git-commit-message]")!;
  const commitMessage = "  A deliberate subject\n\nBody with details.  ";
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      commitMessage,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = container.querySelector<HTMLButtonElement>('[data-git-commit-action="commit"]')!;
  await expect.element(button).not.toBeDisabled();
  await act(() => button.click());
  const observed = await Promise.race([
    response.received.then((input) => ({ status: "request" as const, input })),
    settled.promise.then(() => ({
      status: "settled" as const,
      outcome: useGitCommitDraftStore
        .getState()
        .drafts.get(gitCommitDraftKey(environmentId, scope.cwd))?.outcome,
    })),
  ]);
  expect(observed).toMatchObject({ status: "request" });

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
