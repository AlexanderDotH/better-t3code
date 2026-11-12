import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appAtomRegistry } from "../../state/atom-registry";
import { planMultiModelLaunch } from "./multi-model-launch";
import {
  INITIAL_NEW_TASK_FLOW_STATE,
  newTaskFlowKey,
  newTaskFlowStateAtom,
  pruneNewTaskFlowStates,
  readNewTaskFlowState,
  resolveRouteDraft,
  stampedEnvironmentProjectsLoading,
  updateNewTaskFlowState,
} from "./new-task-flow-state";

function draftRoute(key: string, draftId: string) {
  return { key, name: "Thread", params: { draft: { draftId } } };
}

describe("multi-model task planning", () => {
  const primary = { instanceId: ProviderInstanceId.make("codex"), model: "primary" };
  const other = {
    instanceId: ProviderInstanceId.make("claude"),
    model: "other",
    options: [{ id: "effort", value: "low" }],
  };
  const message = {
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    commandId: CommandId.make("command"),
    text: "Build this",
    attachments: [],
    createdAt: "2026-11-11T00:00:00.000Z",
    modelSelection: primary,
    creation: {
      projectId: ProjectId.make("project"),
      workspaceMode: "local" as const,
      branch: "main",
      worktreePath: "/existing",
    },
  };
  const input = {
    message,
    selections: [primary, other, primary],
    baseBranch: "main",
    providers: [],
    metadataForSelection: (_selection: unknown, index: number) => ({
      commandId: `command-${index}`,
      messageId: `message-${index}`,
      threadId: `thread-${index}`,
      createdAt: message.createdAt,
    }),
  };
  it("launches each selected model once, retaining options and giving each thread its own worktree", () => {
    const launches = planMultiModelLaunch(input);
    expect(launches.map((launch) => launch.modelSelection)).toEqual([primary, other]);
    expect(launches.map((launch) => launch.threadId)).toEqual(["thread-0", "thread-1"]);
    expect(new Set(launches.map((launch) => launch.commandId)).size).toBe(2);
    expect(
      launches.every(
        (launch) =>
          launch.creation?.workspaceMode === "worktree" &&
          launch.creation.worktreePath === null &&
          launch.creation.branch === "main",
      ),
    ).toBe(true);
    expect(launches.every((launch) => launch.text === message.text)).toBe(true);
    expect(
      planMultiModelLaunch({
        ...input,
        selections: [primary, { ...primary, options: [{ id: "effort", value: "high" }] }],
      }).map((launch) => launch.modelSelection),
    ).toEqual([primary]);
  });
  it("rejects multi-model Deep Plan and a missing base branch before enqueueing anything", () => {
    expect(() =>
      planMultiModelLaunch({ ...input, message: { ...message, composerMode: "deep-plan" } }),
    ).toThrow("one model");
    expect(() => planMultiModelLaunch({ ...input, baseBranch: null })).toThrow("base branch");
    expect(planMultiModelLaunch({ ...input, selections: [primary] })[0]?.creation).toEqual(
      message.creation,
    );
  });
});

describe("new task flow state", () => {
  it("keeps a covered draft route's flow while another draft route is pushed above it", () => {
    const routeA = draftRoute("route-a", "draft-a");
    const routeB = draftRoute("route-b", "draft-b");
    const flowA = newTaskFlowKey(routeA)!;
    const flowB = newTaskFlowKey(routeB)!;

    // The provider subscribes to A, writes its selection, then moves to B.
    const unmountA = appAtomRegistry.mount(newTaskFlowStateAtom(flowA));
    updateNewTaskFlowState(flowA, { projectKey: "env:project-a", draftKey: "draft-a" });
    unmountA();
    const unmountB = appAtomRegistry.mount(newTaskFlowStateAtom(flowB));
    pruneNewTaskFlowStates({ routes: [{ key: "home", name: "Home" }, routeA, routeB] });

    expect(readNewTaskFlowState(flowB)).toBe(INITIAL_NEW_TASK_FLOW_STATE);
    expect(appAtomRegistry.get(newTaskFlowStateAtom(flowA))).toMatchObject({
      projectKey: "env:project-a",
      draftKey: "draft-a",
    });

    // Popping B returns to A with its state intact.
    unmountB();
    pruneNewTaskFlowStates({ routes: [{ key: "home", name: "Home" }, routeA] });
    expect(readNewTaskFlowState(flowA).projectKey).toBe("env:project-a");
  });

  it("drops a flow when its route is popped or promoted to a live thread", () => {
    const routeA = draftRoute("route-a", "draft-a");
    const routeB = draftRoute("route-b", "draft-b");
    updateNewTaskFlowState(newTaskFlowKey(routeA)!, { projectKey: "env:project-a" });
    updateNewTaskFlowState(newTaskFlowKey(routeB)!, { projectKey: "env:project-b" });

    pruneNewTaskFlowStates({
      routes: [{ key: "route-a", name: "Thread", params: { environmentId: "env", threadId: "t" } }],
    });

    expect(readNewTaskFlowState(newTaskFlowKey(routeA)!)).toBe(INITIAL_NEW_TASK_FLOW_STATE);
    expect(readNewTaskFlowState(newTaskFlowKey(routeB)!)).toBe(INITIAL_NEW_TASK_FLOW_STATE);
  });
});

describe("resolveRouteDraft", () => {
  const environmentId = EnvironmentId.make("env");
  const projectId = ProjectId.make("project");
  const stamp = { environmentId, projectId };
  const project = { environmentId, id: projectId };
  const base = {
    flow: INITIAL_NEW_TASK_FLOW_STATE,
    routeDraftId: "new-task:draft-1",
    draftsLoaded: true,
    stamp,
    projects: [project],
    stampedEnvironmentLoading: false,
  };

  it("binds the route's draft and its stamped project", () => {
    expect(resolveRouteDraft(base)).toEqual({
      kind: "open",
      flow: {
        ...INITIAL_NEW_TASK_FLOW_STATE,
        environmentId,
        projectKey: "env:project",
        draftKey: "new-task:draft-1",
      },
    });
  });

  it("leaves a flow that already bound a draft alone", () => {
    const flow = { ...INITIAL_NEW_TASK_FLOW_STATE, draftKey: "new-task:other" };
    expect(resolveRouteDraft({ ...base, flow })).toEqual({ kind: "none" });
  });

  it("waits for hydration, and for the stamped environment's projects", () => {
    expect(resolveRouteDraft({ ...base, draftsLoaded: false, stamp: undefined })).toEqual({
      kind: "pending",
    });
    expect(resolveRouteDraft({ ...base, projects: [], stampedEnvironmentLoading: true })).toEqual({
      kind: "pending",
    });
  });

  it("waits for a slower environment's projects while another environment's have loaded", () => {
    const environmentB = EnvironmentId.make("env-b");
    const projectB = { environmentId: environmentB, id: ProjectId.make("project-b") };
    const stampB = { environmentId: environmentB, projectId: projectB.id };

    expect(resolveRouteDraft({ ...base, stamp: stampB, stampedEnvironmentLoading: true })).toEqual({
      kind: "pending",
    });
    expect(
      resolveRouteDraft({ ...base, stamp: stampB, projects: [project, projectB] }),
    ).toMatchObject({ kind: "open", flow: { environmentId: environmentB } });
  });

  it("reports a draft that is gone or whose project is gone", () => {
    expect(resolveRouteDraft({ ...base, stamp: undefined })).toEqual({ kind: "missing" });
    expect(
      resolveRouteDraft({ ...base, projects: [{ environmentId, id: ProjectId.make("other") }] }),
    ).toEqual({ kind: "missing" });
  });
});

describe("stampedEnvironmentProjectsLoading", () => {
  const settled = {
    connectionsReady: true,
    connectionState: "connected" as const,
    shellCacheRead: true,
    shellStatus: "live" as const,
    shellHasError: false,
  };

  it("waits while the environment is still delivering its first project list", () => {
    expect(stampedEnvironmentProjectsLoading({ ...settled, connectionsReady: false })).toBe(true);
    expect(stampedEnvironmentProjectsLoading({ ...settled, shellCacheRead: false })).toBe(true);
    expect(stampedEnvironmentProjectsLoading({ ...settled, connectionState: "connecting" })).toBe(
      true,
    );
    expect(stampedEnvironmentProjectsLoading({ ...settled, shellStatus: "synchronizing" })).toBe(
      true,
    );
  });

  it("settles once the list is live, or when nothing more will arrive", () => {
    expect(stampedEnvironmentProjectsLoading(settled)).toBe(false);
    expect(stampedEnvironmentProjectsLoading({ ...settled, connectionState: null })).toBe(false);
    expect(
      stampedEnvironmentProjectsLoading({
        ...settled,
        connectionState: "reconnecting",
        shellStatus: "synchronizing",
      }),
    ).toBe(false);
    expect(stampedEnvironmentProjectsLoading({ ...settled, shellHasError: true })).toBe(false);
  });
});
