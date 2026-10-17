// @vitest-environment jsdom

import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { subscribeGitActionsControl, type GitCommitOutcome } from "../gitActionsControlBus";
import { GitCommitComposer, type GitCommitComposerProps } from "./GitCommitComposer";
import { commitResult, deferredResult } from "./gitCommitTestFixtures";
import {
  EMPTY_GIT_COMMIT_DRAFT,
  gitCommitDraftKey,
  useGitCommitDraftStore,
} from "./gitCommitDraftStore";

type ControlRequest = Parameters<Parameters<typeof subscribeGitActionsControl>[0]>[0];
type CommitRequest = Extract<ControlRequest, { intent: "execute-commit" }>;
const environmentId = EnvironmentId.make("composer-environment");
const otherEnvironmentId = EnvironmentId.make("other-environment");
const scope = { environmentId, cwd: "/repo" };
const executeCommit = vi.fn<(request: CommitRequest) => Promise<GitCommitOutcome>>();
const queueCommit = vi.fn<GitCommitComposerProps["onQueueCommit"]>();
const settled = vi.fn();
let root: Root;
let container: HTMLDivElement;
let unsubscribe: () => void;
let intents: string[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  useGitCommitDraftStore.getState().clear();
  executeCommit.mockResolvedValue({ status: "success", result: commitResult() });
  queueCommit.mockResolvedValue({ status: "queued" });
  intents = [];
  unsubscribe = subscribeGitActionsControl((request) => {
    if (request.intent !== "execute-commit") {
      intents.push(request.intent);
      return;
    }
    if (request.claim()) void executeCommit(request).then(request.complete);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  unsubscribe();
  await act(() => root.unmount());
  container.remove();
  useGitCommitDraftStore.getState().clear();
  vi.unstubAllGlobals();
});

async function renderComposer(overrides: Partial<GitCommitComposerProps> = {}) {
  await act(() => {
    root.render(
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
  });
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
  const button = container.querySelector<HTMLButtonElement>(`[data-git-commit-action="${value}"]`);
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

describe("Git commit drafts", () => {
  it("separates environments at the same cwd and repositories in the same environment", () => {
    const store = useGitCommitDraftStore.getState();
    const first = gitCommitDraftKey(environmentId, "/repo");
    const second = gitCommitDraftKey(otherEnvironmentId, "/repo");
    const third = gitCommitDraftKey(environmentId, "/other");
    store.update(first, { mode: "manual", message: "First" });
    store.update(second, { mode: "manual", message: "Second" });
    store.update(third, { message: "Third" });
    expect(useGitCommitDraftStore.getState().drafts.get(first)?.message).toBe("First");
    expect(useGitCommitDraftStore.getState().drafts.get(second)?.message).toBe("Second");
    expect(useGitCommitDraftStore.getState().drafts.get(third)?.message).toBe("Third");
  });

  it.each([
    { status: "failure", message: "hook failed" },
    { status: "cancelled" },
    { status: "queued" },
    { status: "blocked", reason: "changed" },
    { status: "success", result: commitResult({ commit: { status: "skipped_no_changes" } }) },
  ] satisfies ReadonlyArray<GitCommitOutcome>)(
    "retains the submitted manual draft after $status",
    (outcome) => {
      const key = gitCommitDraftKey(environmentId, "/repo");
      const store = useGitCommitDraftStore.getState();
      store.update(key, { mode: "manual", message: "Keep this message" });
      const ticket = store.begin(key)!;
      expect(store.begin(key)).toBeNull();
      store.settle(key, ticket, outcome);
      expect(useGitCommitDraftStore.getState().drafts.get(key)).toMatchObject({
        message: "Keep this message",
        mode: "manual",
        pending: null,
        outcome,
      });
    },
  );

  it("clears only a successfully created manual submission at the same version", () => {
    const key = gitCommitDraftKey(environmentId, "/repo");
    const store = useGitCommitDraftStore.getState();
    store.update(key, { mode: "manual", message: "Submitted" });
    const ticket = store.begin(key)!;
    store.settle(key, ticket, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.message).toBe("");

    store.update(key, { message: "Submitted again" });
    const older = store.begin(key)!;
    store.update(key, { message: "A newer edit" });
    store.update(key, { message: "Submitted again" });
    store.settle(key, older, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.message).toBe("Submitted again");
  });

  it("preserves saved manual text when an automatic submission succeeds", () => {
    const key = gitCommitDraftKey(environmentId, "/repo");
    const store = useGitCommitDraftStore.getState();
    store.update(key, { message: "Saved for later", mode: "automatic" });
    const ticket = store.begin(key)!;
    store.settle(key, ticket, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.message).toBe("Saved for later");
  });

  it("ignores duplicate and cleared submission completions", () => {
    const key = gitCommitDraftKey(environmentId, "/repo");
    const store = useGitCommitDraftStore.getState();
    store.update(key, { message: "First", mode: "manual" });
    const first = store.begin(key)!;
    store.settle(key, first, { status: "cancelled" });
    const second = store.begin(key)!;
    store.settle(key, first, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.pending).toBe(second);
    store.clear();
    store.settle(key, second, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.size).toBe(0);
    expect(EMPTY_GIT_COMMIT_DRAFT.message).toBe("");
  });
});

describe("GitCommitComposer", () => {
  it("settles the old environment without erasing the new environment draft", async () => {
    const completion = deferredResult<GitCommitOutcome>();
    executeCommit.mockReturnValue(completion.promise);
    await renderComposer();
    await chooseMode("manual");
    await writeMessage("Environment A submission");
    await submit();

    await renderComposer({ environmentId: otherEnvironmentId });
    await chooseMode("manual");
    await writeMessage("Environment B newer draft");
    await act(async () => {
      completion.resolve({ status: "success", result: commitResult() });
      await completion.promise;
    });
    expect(message().value).toBe("Environment B newer draft");
    await renderComposer();
    expect(message().value).toBe("");
    await renderComposer({ environmentId: otherEnvironmentId });
    expect(message().value).toBe("Environment B newer draft");
  });
  it("uses explicit automatic mode and staged-only selection without mutating on entry", async () => {
    await renderComposer();
    expect(mode("automatic").checked).toBe(true);
    expect(message().disabled).toBe(true);
    expect(executeCommit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("2");
    await submit();
    expect(executeCommit).toHaveBeenCalledOnce();
    expect(executeCommit.mock.calls[0]![0]).toMatchObject({
      ...scope,
      expectedStateToken: "state-1",
      commitSelection: { mode: "staged" },
    });
    expect(executeCommit.mock.calls[0]![0]).not.toHaveProperty("commitMessage");
    expect(intents).toEqual([]);
  });

  it("passes manual text verbatim and keeps automatic generation an explicit choice", async () => {
    await renderComposer();
    await chooseMode("manual");
    expect(action("commit").disabled).toBe(true);
    const text = "  Subject with spacing\n\nBody with detail.  ";
    await writeMessage(text);
    await submit();
    expect(executeCommit.mock.calls[0]![0].commitMessage).toBe(text);
    expect(message().value).toBe("");
    expect(action("commit").disabled).toBe(true);

    await writeMessage("Preserve this manual draft");
    await chooseMode("automatic");
    await submit();
    expect(executeCommit.mock.calls[1]![0]).not.toHaveProperty("commitMessage");
    await chooseMode("manual");
    expect(message().value).toBe("Preserve this manual draft");
  });

  it("restores drafts across environment changes and unmounts", async () => {
    await renderComposer();
    await chooseMode("manual");
    await writeMessage("Environment A");
    await renderComposer({ environmentId: otherEnvironmentId });
    expect(mode("automatic").checked).toBe(true);
    await chooseMode("manual");
    await writeMessage("Environment B");
    await act(() => root.render(null));
    await renderComposer();
    expect(message().value).toBe("Environment A");
    await renderComposer({ environmentId: otherEnvironmentId });
    expect(message().value).toBe("Environment B");
    expect(executeCommit).not.toHaveBeenCalled();
  });

  it("keeps typing and focus stable across status rerenders and a delayed completion", async () => {
    const completion = deferredResult<GitCommitOutcome>();
    executeCommit.mockReturnValue(completion.promise);
    await renderComposer();
    await chooseMode("manual");
    await writeMessage("Submitted text");
    await submit();
    const textarea = message();
    expect(textarea.disabled).toBe(false);
    await writeMessage("A newer draft");
    textarea.setSelectionRange(3, 3);
    await renderComposer({ stateToken: "state-2", stagedCount: 3 });
    expect(message()).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(3);
    await act(async () => {
      completion.resolve({ status: "success", result: commitResult() });
      await completion.promise;
    });
    expect(message().value).toBe("A newer draft");
    expect(document.activeElement).toBe(textarea);
  });

  it.each([
    { status: "failure", message: "pre-commit hook failed" },
    { status: "cancelled" },
    { status: "success", result: commitResult({ commit: { status: "skipped_no_changes" } }) },
  ] satisfies ReadonlyArray<GitCommitOutcome>)(
    "keeps the draft after $status and permits retry",
    async (outcome) => {
      executeCommit.mockResolvedValueOnce(outcome);
      await renderComposer();
      await chooseMode("manual");
      await writeMessage("Retry this message");
      await submit();
      expect(message().value).toBe("Retry this message");
      expect(action("commit").disabled).toBe(false);
      if (outcome.status === "failure") expect(container.textContent).toContain(outcome.message);
      await submit();
      expect(executeCommit).toHaveBeenCalledTimes(2);
      expect(message().value).toBe("");
    },
  );

  it("submits once on a double click while allowing edits during pending work", async () => {
    const completion = deferredResult<GitCommitOutcome>();
    executeCommit.mockReturnValue(completion.promise);
    await renderComposer();
    await chooseMode("manual");
    await writeMessage("One submission");
    const button = action("commit");
    await act(() => {
      button.click();
      button.click();
    });
    expect(executeCommit).toHaveBeenCalledOnce();
    expect(action("commit").disabled).toBe(true);
    await writeMessage("Edited while pending");
    await act(async () => {
      completion.resolve({ status: "failure", message: "Try again" });
      await completion.promise;
    });
    expect(message().value).toBe("Edited while pending");
    expect(action("commit").disabled).toBe(false);
  });

  it.each([{ stagedCount: 0 }, { blocked: true }, { hasQueuedWorkflow: true }])(
    "blocks submission for $0",
    async (overrides) => {
      await renderComposer(overrides);
      expect(action("commit").disabled).toBe(true);
      expect(action("new-branch").disabled).toBe(true);
      await act(() => {
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(executeCommit).not.toHaveBeenCalled();
      expect(queueCommit).not.toHaveBeenCalled();
    },
  );

  it("queues exactly once during a turn and keeps the manual draft", async () => {
    const completion = deferredResult<GitCommitOutcome>();
    queueCommit.mockReturnValue(completion.promise);
    await renderComposer({ activeTurn: true });
    await chooseMode("manual");
    await writeMessage("  Queue this\n\nBody  ");
    expect(container.querySelector('[data-git-commit-action="new-branch"]')).toBeNull();
    const button = action("queue");
    await act(() => {
      button.click();
      button.click();
    });
    expect(queueCommit).toHaveBeenCalledExactlyOnceWith({
      commitMessage: "  Queue this\n\nBody  ",
    });
    expect(executeCommit).not.toHaveBeenCalled();
    await act(async () => {
      completion.resolve({ status: "queued" });
      await completion.promise;
    });
    expect(message().value).toBe("  Queue this\n\nBody  ");
  });

  it("requests a branch commit and leaves push/PR actions explicit after creation", async () => {
    await renderComposer({
      changeRequest: { label: "Create PR", enabled: true, openExisting: false },
    });
    await submit("new-branch");
    expect(executeCommit.mock.calls[0]![0]).toMatchObject({
      featureBranch: true,
      commitSelection: { mode: "staged" },
    });
    expect(intents).toEqual([]);
    await submit("push");
    await submit("request");
    expect(intents).toEqual(["push", "create-pull-request"]);
  });
});
