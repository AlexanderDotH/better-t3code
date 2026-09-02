import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  projects: [] as Array<unknown>,
  projectFileRead: vi.fn(),
  readThreadShell: vi.fn(() => null),
  routeParams: {
    environmentId: "environment-a",
    threadId: "thread-a",
  } as Record<string, string>,
  settings: {
    defaultThreadEnvMode: "local" as const,
    newWorktreesStartFromOrigin: true,
  },
  sequence: [] as Array<string>,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <Value>(value: Value) => value,
  useMemo: <Value>(factory: () => Value) => factory(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => mocks.settings,
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: (() => {
    const router = {
      navigate: (...args: Array<unknown>) => mocks.navigate(...args),
      get state() {
        return { matches: [{ params: mocks.routeParams }] };
      },
    };
    return () => router;
  })(),
}));

vi.mock("../state/entities", () => ({
  readThreadShell: mocks.readThreadShell,
  useProjects: () => mocks.projects,
  useThread: () => null,
}));

vi.mock("./useSettings", () => ({
  useClientSettings: () => ({
    sidebarProjectGroupingMode: "separate",
    sidebarProjectGroupingOverrides: {},
  }),
}));

vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFileDefaultThreadEnvMode: mocks.projectFileRead,
}));

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "./useHandleNewThread";

const ENVIRONMENT_B = EnvironmentId.make("environment-b");
const PROJECT_B = ProjectId.make("project-b");
const PROJECT_B_REF = scopeProjectRef(ENVIRONMENT_B, PROJECT_B);

function makeProject(
  defaultThreadEnvMode: EnvironmentProject["defaultThreadEnvMode"] = null,
): EnvironmentProject {
  return {
    environmentId: ENVIRONMENT_B,
    id: PROJECT_B,
    title: "Project B",
    workspaceRoot: "/workspace/project-b",
    repositoryIdentity: null,
    defaultModelSelection: null,
    defaultThreadEnvMode,
    checkpointsEnabled: true,
    faviconPath: null,
    scripts: [],
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function resetDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useNewThreadHandler cross-project navigation", () => {
  beforeEach(() => {
    resetDraftStore();
    mocks.projects = [makeProject()];
    mocks.routeParams = {
      environmentId: "environment-a",
      threadId: "thread-a",
    };
    mocks.sequence.length = 0;
    mocks.navigate.mockReset();
    mocks.projectFileRead.mockReset();
    mocks.readThreadShell.mockReset();
    mocks.readThreadShell.mockReturnValue(null);
  });

  it("registers and navigates to project B before t3.json settles and dedupes concurrent opens", async () => {
    const navigation = deferred<void>();
    const projectFile = deferred<"worktree" | null>();
    mocks.navigate.mockImplementation(() => {
      mocks.sequence.push("navigate");
      return navigation.promise;
    });
    mocks.projectFileRead.mockImplementation(() => {
      mocks.sequence.push("project-file");
      return projectFile.promise;
    });

    const handleNewThread = useNewThreadHandler();
    const firstOpen = handleNewThread(PROJECT_B_REF);
    const registeredDraft = useComposerDraftStore
      .getState()
      .getDraftSessionByProjectRef(PROJECT_B_REF);

    expect(registeredDraft).toMatchObject({
      environmentId: ENVIRONMENT_B,
      projectId: PROJECT_B,
      envMode: "local",
      startFromOrigin: false,
    });
    expect(mocks.sequence).toEqual(["navigate", "project-file"]);

    const concurrentOpen = useNewThreadHandler()(PROJECT_B_REF);
    expect(concurrentOpen).toBe(firstOpen);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);

    navigation.resolve();
    await expect(firstOpen).resolves.toMatchObject({ draftId: registeredDraft?.draftId });

    projectFile.resolve("worktree");
    await flushPromises();
    expect(
      useComposerDraftStore.getState().getDraftSession(registeredDraft!.draftId),
    ).toMatchObject({
      envMode: "worktree",
      startFromOrigin: true,
    });
  });

  it.each([
    {
      label: "gains composer content",
      change: (draftId: DraftId) => {
        useComposerDraftStore.getState().setPrompt(draftId, "keep my draft");
      },
    },
    {
      label: "changes workspace context",
      change: (draftId: DraftId) => {
        useComposerDraftStore.getState().setDraftThreadContext(draftId, {
          branch: "feature/user-choice",
        });
      },
    },
    {
      label: "starts promotion",
      change: (draftId: DraftId) => {
        useComposerDraftStore.getState().markDraftThreadPromoting(draftId);
      },
    },
  ])("does not apply a late project-file default after the draft $label", async ({ change }) => {
    const projectFile = deferred<"worktree" | null>();
    mocks.navigate.mockResolvedValue(undefined);
    mocks.projectFileRead.mockReturnValue(projectFile.promise);

    const opened = await useNewThreadHandler()(PROJECT_B_REF);
    const draft = useComposerDraftStore.getState().getDraftSession(opened!.draftId);
    expect(draft).not.toBeNull();

    change(opened!.draftId);
    projectFile.resolve("worktree");
    await flushPromises();

    expect(useComposerDraftStore.getState().getDraftSession(opened!.draftId)?.envMode).toBe(
      "local",
    );
  });

  it("uses an authoritative project setting without reading t3.json", async () => {
    mocks.projects = [makeProject("worktree")];
    mocks.navigate.mockResolvedValue(undefined);

    const opened = await useNewThreadHandler()(PROJECT_B_REF);

    expect(mocks.projectFileRead).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getDraftSession(opened!.draftId)).toMatchObject({
      envMode: "worktree",
      startFromOrigin: true,
    });
  });

  it("propagates navigation failures so the invoking surface can retain its error toast", async () => {
    const navigationError = new Error("navigation failed");
    mocks.navigate.mockRejectedValueOnce(navigationError);
    mocks.projectFileRead.mockResolvedValue(null);

    const handleNewThread = useNewThreadHandler();
    await expect(handleNewThread(PROJECT_B_REF)).rejects.toBe(navigationError);

    mocks.navigate.mockResolvedValueOnce(undefined);
    await expect(handleNewThread(PROJECT_B_REF)).resolves.not.toBeNull();
    expect(mocks.navigate).toHaveBeenCalledTimes(2);
  });
});
