import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  fork: vi.fn(async () => ({ _tag: "Success", value: undefined })),
  refreshStatus: vi.fn(async () => ({
    _tag: "Success",
    value: { isRepo: true, refName: "main" },
  })),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useLayoutEffect: (effect: () => void) => effect(),
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(value: T) => [value, () => undefined],
}));
vi.mock("./useStableCallback", () => ({ useStableCallback: <T>(callback: T) => callback }));
vi.mock("../state/threads", () => ({ threadEnvironment: { fork: "fork" } }));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: { status: "status-stream", refreshStatus: "refresh-status" },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "fork" ? mocks.fork : mocks.refreshStatus),
}));
vi.mock("../components/ChatView.logic", () => ({
  waitForStartedServerThread: async () => true,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: async () => null,
}));
vi.mock("../lib/utils", () => ({ newThreadId: () => "fork-thread" }));

import { makeThreadFixture } from "../test-fixtures";
import { useThreadFork } from "./useThreadFork";

it.each([
  { folded: false, override: undefined, expectedMode: "worktree", pauseWithDraft: false },
  { folded: true, override: undefined, expectedMode: "local", pauseWithDraft: false },
  { folded: true, override: "local", expectedMode: "local", pauseWithDraft: false },
  { folded: true, override: "worktree", expectedMode: "worktree", pauseWithDraft: false },
  { folded: true, override: "local", expectedMode: "local", pauseWithDraft: true },
] as const)(
  "uses canonical fork defaults and snapshots draft choices before preparation: %j",
  async ({ folded, override, expectedMode, pauseWithDraft }) => {
    mocks.fork.mockClear();
    mocks.navigate.mockClear();
    mocks.refreshStatus.mockReset().mockResolvedValue({
      _tag: "Success",
      value: { isRepo: true, refName: "main" },
    });
    const environmentId = EnvironmentId.make("environment-1");
    const projectId = ProjectId.make("project-1");
    const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
    const draft: {
      modelSelection: ModelSelection | undefined;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    } = {
      modelSelection: pauseWithDraft
        ? {
            instanceId: ProviderInstanceId.make("claude-draft"),
            model: "claude-opus-5-5",
            options: [{ id: "effort", value: "high" }],
          }
        : undefined,
      runtimeMode: pauseWithDraft ? "approval-required" : "full-access",
      interactionMode: pauseWithDraft ? "plan" : "default",
    };
    let currentDraft = draft;
    const getModelSelection = vi.fn(() => currentDraft.modelSelection);
    let completeStatus!: (status: Awaited<ReturnType<typeof mocks.refreshStatus>>) => void;
    if (pauseWithDraft) {
      const pendingStatus = new Promise<Awaited<ReturnType<typeof mocks.refreshStatus>>>(
        (resolve) => {
          completeStatus = resolve;
        },
      );
      mocks.refreshStatus.mockImplementationOnce(() => pendingStatus);
    }
    const now = "2026-09-09T00:00:00.000Z";
    const onReady = vi.fn();
    const onError = vi.fn();
    const control = useThreadFork({
      available: true,
      thread: makeThreadFixture({
        id: ThreadId.make("source-thread"),
        environmentId,
        projectId,
        modelSelection,
        title: "Source",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      }),
      project: {
        id: projectId,
        environmentId,
        title: "Project",
        workspaceRoot: "/repo",
        repositoryIdentity: null,
        defaultThreadEnvMode: "worktree",
        defaultModelSelection: modelSelection,
        createdAt: now,
        updatedAt: now,
        checkpointsEnabled: true,
        scripts: [],
      },
      settings: {
        defaultThreadEnvMode: "local",
        newWorktreesStartFromOrigin: false,
        projectSettingsFolded: folded,
        projectSettingsOverrides: override
          ? { [projectId]: { defaultThreadEnvMode: override } }
          : {},
      },
      runtimeMode: draft.runtimeMode,
      interactionMode: draft.interactionMode,
      getModelSelection,
      onReady,
      onError,
    });

    const forked = control.onFork({ kind: "message", messageId: MessageId.make("message-1") });
    if (pauseWithDraft) {
      expect(mocks.refreshStatus).toHaveBeenCalledOnce();
      expect(mocks.fork).not.toHaveBeenCalled();
      currentDraft = {
        modelSelection: { instanceId: ProviderInstanceId.make("next-draft"), model: "gpt-6-luna" },
        runtimeMode: "full-access",
        interactionMode: "chat",
      };
      completeStatus({ _tag: "Success", value: { isRepo: true, refName: "main" } });
    }
    await forked;
    expect(getModelSelection).toHaveBeenCalledOnce();

    expect(mocks.refreshStatus).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: "/repo" },
    });
    expect(mocks.fork).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId,
        input: expect.objectContaining({
          sourceThreadId: "source-thread",
          modelSelection: draft.modelSelection ?? modelSelection,
          runtimeMode: draft.runtimeMode,
          interactionMode: draft.interactionMode,
          workspace:
            expectedMode === "local"
              ? { mode: "local", baseBranch: null, startFromOrigin: false, runSetupScript: false }
              : {
                  mode: "worktree",
                  baseBranch: "main",
                  startFromOrigin: false,
                  runSetupScript: true,
                },
        }),
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: "fork-thread" },
    });
    expect(onReady).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledExactlyOnceWith("source-thread", null);
  },
);
