// @vitest-environment jsdom

import {
  EnvironmentId,
  ThreadId,
  type GitWorkbenchSnapshot,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  status: null as VcsStatusResult | null,
  snapshot: null as GitWorkbenchSnapshot | null,
  serverThread: null as { id: ThreadId; branch: string } | null,
  busy: false,
  refreshWorkbench: vi.fn(),
  runStackedAction: vi.fn(),
  pull: vi.fn(),
  init: vi.fn(),
  publish: vi.fn(),
  updateMetadata: vi.fn(),
  refreshStatus: vi.fn(),
  setDraftThreadContext: vi.fn(),
  navigate: vi.fn(),
  openLink: vi.fn(),
  openPrLink: vi.fn(),
  openInEditor: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => testState.navigate,
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: { readonly kind: string } | null) => ({
    data: query?.kind === "status" ? testState.status : null,
    error: null,
    isPending: false,
    refresh: testState.refreshStatus,
  }),
}));
vi.mock("~/state/vcs", () => ({
  vcsEnvironment: {
    status: (target: unknown) => ({ kind: "status", target }),
    refreshStatus: "refreshStatus",
  },
}));
vi.mock("~/state/server", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const config = Atom.make({
    environment: { capabilities: { gitWorkbenchVersion: 1 } },
    availableEditors: [],
  });
  return { serverEnvironment: { configValueAtom: () => config } };
});
vi.mock("~/state/gitWorkbench", () => ({
  gitWorkbenchEnvironment: {
    availability: (target: unknown) => ({ kind: "availability", target }),
    refresh: "refreshWorkbench",
  },
}));
vi.mock("~/state/sourceControl", () => ({
  sourceControlEnvironment: {
    discovery: (target: unknown) => ({ kind: "discovery", target }),
  },
}));
vi.mock("~/state/threads", () => ({
  threadEnvironment: { updateMetadata: "updateMetadata" },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "updateMetadata"
      ? testState.updateMetadata
      : command === "refreshWorkbench"
        ? testState.refreshWorkbench
        : testState.refreshStatus,
}));
vi.mock("~/state/entities", () => ({
  useThreadShell: () => testState.serverThread,
}));
vi.mock("~/composerDraftStore", () => {
  const store = {
    getDraftSession: () => null,
    getDraftThreadByRef: () => null,
    setDraftThreadContext: testState.setDraftThreadContext,
  };
  return {
    useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store),
  };
});
vi.mock("~/lib/sourceControlActions", () => {
  const idleAction = (run: typeof testState.runStackedAction) => ({
    isPending: false,
    error: null,
    run,
    resetError: vi.fn(),
  });
  return {
    useGitStackedAction: () => idleAction(testState.runStackedAction),
    useVcsPullAction: () => idleAction(testState.pull),
    useVcsInitAction: () => idleAction(testState.init),
    useSourceControlPublishRepositoryAction: () => idleAction(testState.publish),
    useSourceControlActionRunning: () => testState.busy,
  };
});
vi.mock("~/editorPreferences", () => ({
  useOpenInPreferredEditor: () => testState.openInEditor,
}));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => testState.openLink }));
vi.mock("~/lib/openPullRequestLink", () => ({ useOpenPrLink: () => testState.openPrLink }));
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: vi.fn(() => "toast"), update: vi.fn(), close: vi.fn() },
  stackedThreadToast: (toast: unknown) => toast,
}));

import { setInterfaceLocaleRuntime } from "../interfaceLanguageRuntime";
import GitActionsControl from "./GitActionsControl";
import {
  requestGitActionsControl,
  requestGitCommit,
  type GitActionsControlIntent,
  type GitCommitOutcome,
  type GitCommitRequestInput,
} from "./gitActionsControlBus";
import {
  commitResult,
  deferredResult,
  workbenchSnapshot,
} from "./git-workbench/gitCommitTestFixtures";
import {
  subscribeGitWorkbenchEntry,
  type GitWorkbenchEntryRequest,
} from "./git-workbench/gitWorkbenchEntryBus";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { TooltipProvider } from "./ui/tooltip";

const environmentId = EnvironmentId.make("git-control-environment");
const scope = { environmentId, cwd: "/repo" };
const activeThreadRef = { environmentId, threadId: ThreadId.make("git-control-thread") };
const unsubscribeEntries: Array<() => void> = [];
const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
let container: HTMLDivElement;
let root: Root;

type CommitEntryPoint =
  | "toolbar"
  | "commit menu"
  | "menu quick"
  | "quick"
  | "commit-staged"
  | "stage-all-and-commit";

beforeEach(() => {
  vi.clearAllMocks();
  testState.busy = false;
  testState.serverThread = { id: activeThreadRef.threadId, branch: "feature/test" };
  testState.snapshot = workbenchSnapshot();
  testState.refreshWorkbench.mockImplementation(async () =>
    AsyncResult.success(testState.snapshot),
  );
  testState.updateMetadata.mockResolvedValue(AsyncResult.success(undefined));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  testState.status = {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/test",
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [{ path: "src/example.ts", insertions: 2, deletions: 1 }],
      insertions: 2,
      deletions: 1,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
  };
  const unexpectedMutation = AsyncResult.failure(Cause.fail(new Error("Unexpected Git mutation")));
  for (const action of [
    testState.runStackedAction,
    testState.pull,
    testState.init,
    testState.publish,
  ]) {
    action.mockResolvedValue(unexpectedMutation);
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  for (const unsubscribe of unsubscribeEntries.splice(0)) unsubscribe();
  await act(() => root.unmount());
  container.remove();
  if (originalGetAnimations) {
    Object.defineProperty(Element.prototype, "getAnimations", originalGetAnimations);
  } else {
    Reflect.deleteProperty(Element.prototype, "getAnimations");
  }
  vi.unstubAllGlobals();
});

async function renderControl(overrides: Partial<ComponentProps<typeof GitActionsControl>> = {}) {
  const control = (
    <GitActionsControl gitCwd={scope.cwd} activeThreadRef={activeThreadRef} {...overrides} />
  );
  await act(() => {
    root.render(
      <TooltipProvider>
        {overrides.presentation === "menu" ? (
          <Menu defaultOpen>
            <MenuTrigger render={<button type="button">Git actions</button>} />
            <MenuPopup>{control}</MenuPopup>
          </Menu>
        ) : (
          control
        )}
      </TooltipProvider>,
    );
  });
}

function elementWithText(selector: string, text: string): HTMLElement {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Element not found: ${selector} with text "${text}"`);
  return element;
}

async function click(element: HTMLElement) {
  await act(() => {
    element.focus();
    element.click();
  });
}

async function activateCommit(entryPoint: CommitEntryPoint) {
  if (entryPoint === "toolbar") {
    await click(elementWithText("button", "Commit, push & PR"));
    return;
  }
  if (entryPoint === "commit menu") {
    const options = container.querySelector<HTMLElement>('button[aria-label="Git action options"]');
    if (!options) throw new Error("Git options button was not rendered.");
    await click(options);
    await click(elementWithText('[role="menuitem"]', "Commit"));
    return;
  }
  if (entryPoint === "menu quick") {
    await click(elementWithText('[role="menuitem"]', "Commit, push & PR"));
    return;
  }
  await act(() => {
    requestGitActionsControl({ ...scope, intent: entryPoint });
  });
}

function commitDialog() {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) =>
    dialog.textContent?.includes("Commit changes"),
  );
}

function expectNoGitMutation() {
  expect(testState.runStackedAction).not.toHaveBeenCalled();
  expect(testState.pull).not.toHaveBeenCalled();
  expect(testState.init).not.toHaveBeenCalled();
  expect(testState.publish).not.toHaveBeenCalled();
  expect(testState.updateMetadata).not.toHaveBeenCalled();
}

function listenForEntry(listener: (request: GitWorkbenchEntryRequest) => boolean) {
  unsubscribeEntries.push(subscribeGitWorkbenchEntry(listener));
}

describe("GitActionsControl commit entry", () => {
  it.each([
    "toolbar",
    "commit menu",
    "menu quick",
    "quick",
    "commit-staged",
    "stage-all-and-commit",
  ] satisfies ReadonlyArray<CommitEntryPoint>)(
    "requests the scoped form from $0 without committing",
    async (entryPoint) => {
      const enterWorkbench = vi.fn(() => true);
      listenForEntry(enterWorkbench);
      await renderControl(entryPoint === "menu quick" ? { presentation: "menu" } : {});

      await activateCommit(entryPoint);

      expect(enterWorkbench).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ ...scope, focusCommit: true }),
      );
      expect(commitDialog()).toBeUndefined();
      expectNoGitMutation();
    },
  );

  it.each([
    { entryPoint: "toolbar", listener: "absent" },
    { entryPoint: "commit menu", listener: "absent" },
    { entryPoint: "commit-staged", listener: "absent" },
    { entryPoint: "toolbar", listener: "rejected" },
    { entryPoint: "commit menu", listener: "rejected" },
    { entryPoint: "stage-all-and-commit", listener: "rejected" },
  ] satisfies ReadonlyArray<{
    entryPoint: CommitEntryPoint;
    listener: "absent" | "rejected";
  }>)(
    "opens the legacy dialog from $entryPoint when entry is $listener",
    async ({ entryPoint, listener }) => {
      const rejectEntry = vi.fn(() => false);
      if (listener === "rejected") listenForEntry(rejectEntry);
      await renderControl();

      await activateCommit(entryPoint);

      expect(commitDialog()).toBeDefined();
      expectNoGitMutation();
      if (listener === "rejected") expect(rejectEntry).toHaveBeenCalledOnce();
    },
  );

  it.each(["toolbar", "stage-all-and-commit"] satisfies ReadonlyArray<CommitEntryPoint>)(
    "consumes blocked entry from $0 without opening a fallback or committing",
    async (entryPoint) => {
      const blockedEntry = vi.fn(() => true);
      listenForEntry(blockedEntry);
      await renderControl();

      await activateCommit(entryPoint);

      expect(blockedEntry).toHaveBeenCalledOnce();
      expect(commitDialog()).toBeUndefined();
      expectNoGitMutation();
    },
  );

  it("filters bus requests by environment and cwd and follows the rendered scope", async () => {
    const enterWorkbench = vi.fn(() => true);
    listenForEntry(enterWorkbench);
    await renderControl();
    const otherEnvironmentId = EnvironmentId.make("other-environment");
    const sendCommit = (environmentId: EnvironmentId, cwd: string) =>
      requestGitActionsControl({
        environmentId,
        cwd,
        intent: "commit-staged" satisfies GitActionsControlIntent,
      });

    await act(() => {
      sendCommit(otherEnvironmentId, scope.cwd);
      sendCommit(environmentId, "/other-repo");
    });
    expect(enterWorkbench).not.toHaveBeenCalled();
    expect(commitDialog()).toBeUndefined();
    expectNoGitMutation();

    await renderControl({
      gitCwd: "/other-repo",
      activeThreadRef: { ...activeThreadRef, environmentId: otherEnvironmentId },
    });
    await act(() => sendCommit(environmentId, scope.cwd));
    expect(enterWorkbench).not.toHaveBeenCalled();

    await act(() => sendCommit(otherEnvironmentId, "/other-repo"));
    expect(enterWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        environmentId: otherEnvironmentId,
        cwd: "/other-repo",
        focusCommit: true,
      }),
    );
    expect(commitDialog()).toBeUndefined();
    expectNoGitMutation();
  });
});

function commitRequest(overrides: Partial<GitCommitRequestInput> = {}): GitCommitRequestInput {
  return {
    ...scope,
    expectedStateToken: "state-1",
    commitSelection: { mode: "staged" },
    ...overrides,
  };
}

async function executeTypedCommit(overrides: Partial<GitCommitRequestInput> = {}) {
  let outcome!: GitCommitOutcome;
  await act(async () => {
    outcome = await requestGitCommit(commitRequest(overrides));
  });
  return outcome;
}

describe("GitActionsControl typed commit execution", () => {
  it("refreshes before committing and retains manual text, staged selection, branch and thread metadata", async () => {
    const result = commitResult({ branch: { status: "created", name: "feature/created" } });
    testState.runStackedAction.mockResolvedValue(AsyncResult.success(result));
    await renderControl();
    const text = "  Subject\n\nBody remains verbatim.  ";

    const outcome = await executeTypedCommit({ commitMessage: text, featureBranch: true });

    expect(testState.refreshWorkbench).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: scope.cwd },
    });
    expect(testState.refreshWorkbench.mock.invocationCallOrder[0]).toBeLessThan(
      testState.runStackedAction.mock.invocationCallOrder[0]!,
    );
    expect(testState.runStackedAction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: "commit",
        commitMessage: text,
        commitSelection: { mode: "staged" },
        featureBranch: true,
        threadId: activeThreadRef.threadId,
      }),
    );
    expect(testState.runStackedAction.mock.calls[0]![0]).not.toHaveProperty("filePaths");
    expect(testState.updateMetadata).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: expect.objectContaining({
        threadId: activeThreadRef.threadId,
        branch: "feature/created",
      }),
    });
    expect(outcome).toEqual({ status: "success", result });
  });

  it.each([
    {
      label: "changed state",
      snapshot: workbenchSnapshot({ stateToken: "state-2" }),
      reason: "changed",
    },
    {
      label: "empty index",
      snapshot: workbenchSnapshot({ totals: { ...workbenchSnapshot().totals, staged: 0 } }),
      reason: "empty",
    },
    {
      label: "merge operation",
      snapshot: workbenchSnapshot({ operation: { kind: "merge" } }),
      reason: "operation",
    },
    {
      label: "conflicts",
      snapshot: workbenchSnapshot({ totals: { ...workbenchSnapshot().totals, conflicted: 1 } }),
      reason: "operation",
    },
    {
      label: "truncated state",
      snapshot: workbenchSnapshot({ truncated: true }),
      reason: "unavailable",
    },
    {
      label: "missing repository",
      snapshot: workbenchSnapshot({ isRepository: false }),
      reason: "unavailable",
    },
  ])("blocks $label after refresh", async ({ snapshot, reason }) => {
    testState.snapshot = snapshot;
    await renderControl();

    expect(await executeTypedCommit()).toEqual({ status: "blocked", reason });
    expect(testState.refreshWorkbench).toHaveBeenCalledOnce();
    expectNoGitMutation();
  });

  it.each([
    { status: "failure", message: "The Git refresh failed." },
    { status: "cancelled" },
  ] satisfies ReadonlyArray<GitCommitOutcome>)(
    "returns a refresh $status without committing",
    async (outcome) => {
      testState.refreshWorkbench.mockResolvedValue(
        outcome.status === "failure"
          ? AsyncResult.failure(Cause.fail(new Error(outcome.message)))
          : AsyncResult.failure(Cause.interrupt()),
      );
      await renderControl();
      expect(await executeTypedCommit()).toEqual(outcome);
      expectNoGitMutation();
    },
  );

  it("does not claim a different environment or cwd and blocks an already running action", async () => {
    await renderControl();
    expect(await executeTypedCommit({ environmentId: EnvironmentId.make("other") })).toEqual({
      status: "blocked",
      reason: "unavailable",
    });
    expect(await executeTypedCommit({ cwd: "/other" })).toEqual({
      status: "blocked",
      reason: "unavailable",
    });
    expect(testState.refreshWorkbench).not.toHaveBeenCalled();

    testState.busy = true;
    await renderControl();
    expect(await executeTypedCommit()).toEqual({ status: "blocked", reason: "busy" });
    expect(testState.refreshWorkbench).not.toHaveBeenCalled();
    expectNoGitMutation();
  });

  it.each(["environment", "cwd", "thread", "unmount"] as const)(
    "cancels when the rendered $0 changes before refresh completes",
    async (change) => {
      const started = deferredResult<void>();
      const refresh = deferredResult<unknown>();
      testState.refreshWorkbench.mockImplementation(() => {
        started.resolve();
        return refresh.promise;
      });
      await renderControl();
      let pending!: Promise<GitCommitOutcome>;
      await act(() => {
        pending = requestGitCommit(commitRequest());
      });
      await started.promise;
      if (change === "unmount") {
        await act(() => root.render(null));
      } else {
        await renderControl(
          change === "environment"
            ? {
                activeThreadRef: { ...activeThreadRef, environmentId: EnvironmentId.make("other") },
              }
            : change === "cwd"
              ? { gitCwd: "/other" }
              : {
                  activeThreadRef: { ...activeThreadRef, threadId: ThreadId.make("other-thread") },
                },
        );
      }
      let outcome!: GitCommitOutcome;
      await act(async () => {
        refresh.resolve(AsyncResult.success(workbenchSnapshot()));
        outcome = await pending;
      });
      expect(outcome).toEqual({ status: "cancelled" });
      expectNoGitMutation();
    },
  );

  it("claims duplicate submissions once while the first refresh is pending", async () => {
    const refresh = deferredResult<unknown>();
    testState.refreshWorkbench.mockReturnValue(refresh.promise);
    testState.runStackedAction.mockResolvedValue(AsyncResult.success(commitResult()));
    await renderControl();
    let first!: Promise<GitCommitOutcome>;
    await act(() => {
      first = requestGitCommit(commitRequest());
    });

    expect(await executeTypedCommit()).toEqual({ status: "blocked", reason: "busy" });
    expect(testState.refreshWorkbench).toHaveBeenCalledOnce();
    await act(async () => {
      refresh.resolve(AsyncResult.success(workbenchSnapshot()));
      await first;
    });
    expect(testState.runStackedAction).toHaveBeenCalledOnce();
  });
});
