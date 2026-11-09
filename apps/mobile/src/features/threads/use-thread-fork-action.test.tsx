import * as Cause from "effect/Cause";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  PlanId,
  ProviderInstanceId,
  ThreadId,
  type ThreadForkBoundary,
} from "@t3tools/contracts";

const fixture = vi.hoisted(() => ({
  supported: true,
  canOperate: true,
  draft: {} as Record<string, unknown>,
  settings: { defaultThreadEnvMode: "worktree", newWorktreesStartFromOrigin: true },
  readStatus: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fork: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  select: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => undefined }));
vi.mock("../../components/ui/Dialog", () => ({ alert: fixture.alert }));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "fork-thread" }));
vi.mock("../workspace/useSelectWorkspaceDetail", () => ({
  useSelectWorkspaceDetail: () => fixture.select,
}));
vi.mock("./threadForkNavigation", () => ({ waitForThreadShellReady: async () => true }));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: () => ({ settings: fixture.settings }),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteEnvironmentRuntime: () => ({
    connectionState: "connected",
    serverConfig: {
      environment: { capabilities: { threadForking: fixture.supported } },
      settings: {},
    },
  }),
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => fixture.canOperate }));
vi.mock("../../state/threads", () => ({
  threadEnvironment: { fork: "fork" },
  environmentThreadShells: { threadShellAtom: () => "thread-shell" },
}));
vi.mock("../../state/projects", () => ({
  projectEnvironment: { readFile: () => "read-file" },
  environmentProjects: { projectAtom: () => "project" },
}));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { refreshStatus: "refresh-status" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "fork" ? fixture.fork : fixture.readStatus),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => fixture.draft,
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    get: (atom: string) =>
      atom === "project"
        ? { id: "project", workspaceRoot: "/repo" }
        : {
            id: "source-thread",
            projectId: "project",
            modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
          },
  },
}));

import { useThreadForkAction } from "./use-thread-fork-action";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("source-thread");
const messageBoundary: ThreadForkBoundary = {
  kind: "message",
  messageId: MessageId.make("message"),
};

async function forkAction() {
  const current: { value: ReturnType<typeof useThreadForkAction> } = { value: null };
  function Probe() {
    const action = useThreadForkAction({ environmentId, threadId });
    useLayoutEffect(() => {
      current.value = action;
    }, [action]);
    return null;
  }
  const renderer = createRoot(document.createElement("div"));
  await act(() => {
    renderer.render(<Probe />);
  });
  onTestFinished(async () => {
    await act(() => renderer.unmount());
  });
  return current;
}

beforeEach(() => {
  fixture.supported = true;
  fixture.canOperate = true;
  fixture.draft = {};
  fixture.readStatus.mockReset();
  fixture.readStatus.mockResolvedValue({
    _tag: "Success",
    value: { isRepo: true, refName: "main" },
  });
  fixture.fork.mockReset();
  fixture.fork.mockResolvedValue({ _tag: "Success" });
  fixture.select.mockReset();
  fixture.alert.mockReset();
});

describe("mobile fork at a boundary", () => {
  it("is offered only when the server and the session allow it", async () => {
    fixture.supported = false;
    expect((await forkAction()).value).toBeNull();
    fixture.supported = true;
    fixture.canOperate = false;
    expect((await forkAction()).value).toBeNull();
    fixture.canOperate = true;
    expect((await forkAction()).value).not.toBeNull();
  });

  it("forks a plan into the project's worktree default with the composer's choices", async () => {
    const selection = { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" };
    fixture.draft = { modelSelection: selection, composerMode: "plan" };
    const planId = PlanId.make("plan");
    const action = await forkAction();
    await act(async () => action.value?.onFork({ kind: "proposed-plan", planId }));
    expect(fixture.fork).toHaveBeenCalledWith({
      environmentId,
      input: {
        threadId: "fork-thread",
        sourceThreadId: threadId,
        boundary: { kind: "proposed-plan", planId },
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "plan",
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          startFromOrigin: true,
          runSetupScript: true,
        },
        creationSource: "mobile",
        createdAt: expect.any(String),
      },
    });
    expect(fixture.select).toHaveBeenCalledWith({
      name: "Thread",
      params: { environmentId, threadId: "fork-thread" },
    });
  });

  it("waits for a base branch before forking into a new worktree", async () => {
    fixture.readStatus.mockResolvedValue({
      _tag: "Success",
      value: { isRepo: true, refName: null },
    });
    const action = await forkAction();
    await act(async () => action.value?.onFork(messageBoundary));
    expect(fixture.fork).not.toHaveBeenCalled();
    expect(fixture.select).not.toHaveBeenCalled();
    expect(fixture.alert).toHaveBeenCalledWith(
      "mobile.thread.forkFailed",
      "mobile.thread.forkBaseBranchPending",
    );
  });

  it("runs one fork at a time, stays on the thread after a rejection, and allows another", async () => {
    let settle!: (result: unknown) => void;
    fixture.readStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    fixture.fork.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Boundary is gone")),
    });
    const action = await forkAction();
    await act(async () => {
      action.value?.onFork(messageBoundary);
      action.value?.onFork(messageBoundary);
    });
    expect(fixture.readStatus).toHaveBeenCalledTimes(1);
    expect(action.value).toMatchObject({
      disabled: true,
      pendingBoundaryKey: "message:message",
    });

    await act(async () => settle({ _tag: "Success", value: { isRepo: true, refName: "main" } }));
    expect(fixture.select).not.toHaveBeenCalled();
    expect(fixture.alert).toHaveBeenCalledWith("mobile.thread.forkFailed", "Boundary is gone");
    expect(action.value).toMatchObject({ disabled: false, pendingBoundaryKey: null });

    await act(async () => action.value?.onFork(messageBoundary));
    expect(fixture.fork).toHaveBeenCalledTimes(2);
    expect(fixture.select).toHaveBeenCalledTimes(1);
  });
});
