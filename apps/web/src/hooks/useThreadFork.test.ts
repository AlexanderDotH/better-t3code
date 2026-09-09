import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import * as Stream from "effect/Stream";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
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
vi.mock("../state/threads", () => ({ threadEnvironment: { fork: "fork" } }));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: { status: "status-stream", refreshStatus: "refresh-status" },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "fork" ? mocks.fork : mocks.refreshStatus),
}));
vi.mock("../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => () => {
    const registry = AtomRegistry.make();
    return executeAtomQuery(
      registry,
      Atom.make(Stream.concat(Stream.succeed({ isRepo: true, refName: "main" }), Stream.never)),
      { refresh: true },
    ).finally(() => registry.dispose());
  },
}));
vi.mock("../components/ChatView.logic", () => ({
  waitForStartedServerThread: async () => true,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFileDefaultThreadEnvMode: async () => null,
}));
vi.mock("../lib/utils", () => ({ newThreadId: () => "fork-thread" }));

import { useThreadFork } from "./useThreadFork";

it("finishes a fork without waiting for the live Git status stream to end", async () => {
  const environmentId = EnvironmentId.make("environment-1");
  const projectId = ProjectId.make("project-1");
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
  const now = "2026-09-09T00:00:00.000Z";
  const onReady = vi.fn();
  const onError = vi.fn();
  const control = useThreadFork({
    available: true,
    thread: {
      id: ThreadId.make("source-thread"),
      environmentId,
      projectId,
      modelSelection,
      title: "Source",
      runtimeMode: "full-access",
      interactionMode: "default",
      session: null,
      messages: [],
      proposedPlans: [],
      subagents: [],
      activities: [],
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
      latestTurn: null,
      branch: null,
      worktreePath: null,
    },
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
    settings: { defaultThreadEnvMode: "local", newWorktreesStartFromOrigin: false },
    runtimeMode: "full-access",
    interactionMode: "default",
    getModelSelection: () => undefined,
    onReady,
    onError,
  });

  await control.onFork({ kind: "message", messageId: MessageId.make("message-1") });

  expect(mocks.fork).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId,
      input: expect.objectContaining({
        sourceThreadId: "source-thread",
        workspace: {
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
});
