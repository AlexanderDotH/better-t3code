import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { subscribeGitActionsControl, type GitCommitOutcome } from "../gitActionsControlBus";
import { GitCommitComposer, type GitCommitComposerProps } from "./GitCommitComposer";
import { commitResult, deferredResult } from "./gitCommitTestFixtures";
import { useGitCommitDraftStore } from "./gitCommitDraftStore";

type ControlRequest = Parameters<Parameters<typeof subscribeGitActionsControl>[0]>[0];
type CommitRequest = Extract<ControlRequest, { intent: "execute-commit" }>;
const environmentId = EnvironmentId.make("composer-environment");
const otherEnvironmentId = EnvironmentId.make("other-environment");
const scope = { environmentId, cwd: "/repo" };

async function setupComposer() {
  const resources = new AsyncDisposableStack();
  const executeCommit = vi.fn<(request: CommitRequest) => Promise<GitCommitOutcome>>();
  const queueCommit = vi.fn<GitCommitComposerProps["onQueueCommit"]>();
  const settled = vi.fn();
  const intents: string[] = [];
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  useGitCommitDraftStore.getState().clear();
  resources.defer(() => useGitCommitDraftStore.getState().clear());
  executeCommit.mockResolvedValue({ status: "success", result: commitResult() });
  queueCommit.mockResolvedValue({ status: "queued" });
  const unsubscribe = subscribeGitActionsControl((request) => {
    if (request.intent !== "execute-commit") {
      intents.push(request.intent);
      return;
    }
    if (request.claim()) void executeCommit(request).then(request.complete);
  });
  resources.defer(unsubscribe);
  try {
    const screen = resources.use(await render(null, { router: false }));
    const container = screen.container;
    async function renderComposer(overrides: Partial<GitCommitComposerProps> = {}) {
      await screen.rerender(
        <GitCommitComposer
          {...scope}
          stateToken="state-1"
          stagedCount={2}
          partialStagedCount={1}
          blocked={false}
          activeTurn={false}
          hasQueuedWorkflow={false}
          focusRequest={0}
          pushAvailable
          onQueueCommit={queueCommit}
          onSettled={settled}
          {...overrides}
        />,
      );
    }

    function message() {
      const textarea = container.querySelector<HTMLTextAreaElement>("[data-git-commit-message]");
      if (!textarea) throw new Error("The commit message field is missing.");
      return textarea;
    }

    function mode(value: "manual" | "automatic") {
      const radio = container.querySelector<HTMLInputElement>(`[data-git-commit-mode="${value}"]`);
      if (!radio) throw new Error(`The ${value} message option is missing.`);
      return radio;
    }

    function action(value: string) {
      const button = container.querySelector<HTMLButtonElement>(
        `[data-git-commit-action="${value}"]`,
      );
      if (!button) throw new Error(`The ${value} action is missing.`);
      return button;
    }

    async function chooseMode(value: "manual" | "automatic") {
      await act(() => mode(value).click());
    }

    async function writeMessage(value: string) {
      const textarea = message();
      await act(() => {
        textarea.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (!setter) throw new Error("The native textarea setter is missing.");
        setter.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    async function submit(value = "commit") {
      await act(() => action(value).click());
    }

    return {
      screen,
      container,
      executeCommit,
      queueCommit,
      settled,
      intents,
      render: renderComposer,
      message,
      mode,
      action,
      chooseMode,
      writeMessage,
      submit,
      async [Symbol.asyncDispose]() {
        await resources.disposeAsync();
      },
    };
  } catch (error) {
    await resources.disposeAsync();
    throw error;
  }
}

describe("GitCommitComposer", () => {
  it("settles the old environment without erasing the new environment draft", async () => {
    await using composer = await setupComposer();
    const completion = deferredResult<GitCommitOutcome>();
    composer.executeCommit.mockReturnValue(completion.promise);
    await composer.render();
    await composer.chooseMode("manual");
    await composer.writeMessage("Environment A submission");
    await composer.submit();

    await composer.render({ environmentId: otherEnvironmentId });
    await composer.chooseMode("manual");
    await composer.writeMessage("Environment B newer draft");
    await act(async () => {
      completion.resolve({ status: "success", result: commitResult() });
      await completion.promise;
    });
    expect(composer.message().value).toBe("Environment B newer draft");
    await composer.render();
    expect(composer.message().value).toBe("");
    await composer.render({ environmentId: otherEnvironmentId });
    expect(composer.message().value).toBe("Environment B newer draft");
  });
  it("uses explicit automatic mode and staged-only selection without mutating on entry", async () => {
    await using composer = await setupComposer();
    await composer.render();
    expect(composer.mode("automatic").checked).toBe(true);
    expect(composer.message().disabled).toBe(true);
    expect(composer.executeCommit).not.toHaveBeenCalled();
    expect(composer.container.textContent).toContain("2");
    await composer.submit();
    expect(composer.executeCommit).toHaveBeenCalledOnce();
    expect(composer.executeCommit.mock.calls[0]![0]).toMatchObject({
      ...scope,
      expectedStateToken: "state-1",
      commitSelection: { mode: "staged" },
    });
    expect(composer.executeCommit.mock.calls[0]![0]).not.toHaveProperty("commitMessage");
    expect(composer.intents).toEqual([]);
  });

  it("passes manual text verbatim and keeps automatic generation an explicit choice", async () => {
    await using composer = await setupComposer();
    await composer.render();
    await composer.chooseMode("manual");
    expect(composer.action("commit").disabled).toBe(true);
    const text = "  Subject with spacing\n\nBody with detail.  ";
    await composer.writeMessage(text);
    await composer.submit();
    expect(composer.executeCommit.mock.calls[0]![0].commitMessage).toBe(text);
    expect(composer.message().value).toBe("");
    expect(composer.action("commit").disabled).toBe(true);

    await composer.writeMessage("Preserve this manual draft");
    await composer.chooseMode("automatic");
    await composer.submit();
    expect(composer.executeCommit.mock.calls[1]![0]).not.toHaveProperty("commitMessage");
    await composer.chooseMode("manual");
    expect(composer.message().value).toBe("Preserve this manual draft");
  });

  it("restores drafts across environment changes and unmounts", async () => {
    await using composer = await setupComposer();
    await composer.render();
    await composer.chooseMode("manual");
    await composer.writeMessage("Environment A");
    await composer.render({ environmentId: otherEnvironmentId });
    expect(composer.mode("automatic").checked).toBe(true);
    await composer.chooseMode("manual");
    await composer.writeMessage("Environment B");
    await act(() => composer.screen.rerender(null));
    await composer.render();
    expect(composer.message().value).toBe("Environment A");
    await composer.render({ environmentId: otherEnvironmentId });
    expect(composer.message().value).toBe("Environment B");
    expect(composer.executeCommit).not.toHaveBeenCalled();
  });

  it("keeps typing and focus stable across status rerenders and a delayed completion", async () => {
    await using composer = await setupComposer();
    const completion = deferredResult<GitCommitOutcome>();
    composer.executeCommit.mockReturnValue(completion.promise);
    await composer.render();
    await composer.chooseMode("manual");
    await composer.writeMessage("Submitted text");
    await composer.submit();
    const textarea = composer.message();
    expect(textarea.disabled).toBe(false);
    await composer.writeMessage("A newer draft");
    textarea.setSelectionRange(3, 3);
    await composer.render({ stateToken: "state-2", stagedCount: 3 });
    expect(composer.message()).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(3);
    await act(async () => {
      completion.resolve({ status: "success", result: commitResult() });
      await completion.promise;
    });
    expect(composer.message().value).toBe("A newer draft");
    expect(document.activeElement).toBe(textarea);
  });

  it.each([
    { status: "failure", message: "pre-commit hook failed" },
    { status: "cancelled" },
    { status: "success", result: commitResult({ commit: { status: "skipped_no_changes" } }) },
  ] satisfies ReadonlyArray<GitCommitOutcome>)(
    "keeps the draft after $status and permits retry",
    async (outcome) => {
      await using composer = await setupComposer();
      composer.executeCommit.mockResolvedValueOnce(outcome);
      await composer.render();
      await composer.chooseMode("manual");
      await composer.writeMessage("Retry this message");
      await composer.submit();
      expect(composer.message().value).toBe("Retry this message");
      expect(composer.action("commit").disabled).toBe(false);
      if (outcome.status === "failure")
        expect(composer.container.textContent).toContain(outcome.message);
      await composer.submit();
      expect(composer.executeCommit).toHaveBeenCalledTimes(2);
      expect(composer.message().value).toBe("");
    },
  );

  it("submits once on a double click while allowing edits during pending work", async () => {
    await using composer = await setupComposer();
    const completion = deferredResult<GitCommitOutcome>();
    composer.executeCommit.mockReturnValue(completion.promise);
    await composer.render();
    await composer.chooseMode("manual");
    await composer.writeMessage("One submission");
    const button = composer.action("commit");
    await act(() => {
      button.click();
      button.click();
    });
    expect(composer.executeCommit).toHaveBeenCalledOnce();
    expect(composer.action("commit").disabled).toBe(true);
    await composer.writeMessage("Edited while pending");
    await act(async () => {
      completion.resolve({ status: "failure", message: "Try again" });
      await completion.promise;
    });
    expect(composer.message().value).toBe("Edited while pending");
    expect(composer.action("commit").disabled).toBe(false);
  });

  it.each([{ stagedCount: 0 }, { blocked: true }, { hasQueuedWorkflow: true }])(
    "blocks submission for $0",
    async (overrides) => {
      await using composer = await setupComposer();
      await composer.render(overrides);
      expect(composer.action("commit").disabled).toBe(true);
      expect(composer.action("new-branch").disabled).toBe(true);
      await act(() => {
        composer.container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(composer.executeCommit).not.toHaveBeenCalled();
      expect(composer.queueCommit).not.toHaveBeenCalled();
    },
  );

  it("queues exactly once during a turn and keeps the manual draft", async () => {
    await using composer = await setupComposer();
    const completion = deferredResult<GitCommitOutcome>();
    composer.queueCommit.mockReturnValue(completion.promise);
    await composer.render({ activeTurn: true });
    await composer.chooseMode("manual");
    await composer.writeMessage("  Queue this\n\nBody  ");
    expect(composer.container.querySelector('[data-git-commit-action="new-branch"]')).toBeNull();
    const button = composer.action("queue");
    await act(() => {
      button.click();
      button.click();
    });
    expect(composer.queueCommit).toHaveBeenCalledExactlyOnceWith({
      commitMessage: "  Queue this\n\nBody  ",
    });
    expect(composer.executeCommit).not.toHaveBeenCalled();
    await act(async () => {
      completion.resolve({ status: "queued" });
      await completion.promise;
    });
    expect(composer.message().value).toBe("  Queue this\n\nBody  ");
  });

  it("requests a branch commit and leaves push/PR actions explicit after creation", async () => {
    await using composer = await setupComposer();
    await composer.render({
      changeRequest: { label: "Create PR", enabled: true, openExisting: false },
    });
    await composer.submit("new-branch");
    expect(composer.executeCommit.mock.calls[0]![0]).toMatchObject({
      featureBranch: true,
      commitSelection: { mode: "staged" },
    });
    expect(composer.intents).toEqual([]);
    await composer.submit("push");
    await composer.submit("request");
    expect(composer.intents).toEqual(["push", "create-pull-request"]);
  });
});
