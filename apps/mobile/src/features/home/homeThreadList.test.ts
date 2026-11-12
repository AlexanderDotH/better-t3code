import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGroupedThreadListItems,
  buildHomeProjectScopes,
  findHomeProjectScope,
  resolveHomeProjectFilter,
  sortHomeProjectScopes,
  reorderHomeProjectKeys,
  resolveProjectFolderAttention,
} from "./homeThreadList";
import { makeThreadShellFixture } from "../../test-fixtures";
import {
  buildThreadListV2Items,
  type ThreadListV2Item,
  type ThreadListV2ListItem,
} from "../threads/threadListV2";

function makeProject(
  input: Partial<EnvironmentProject> & Pick<EnvironmentProject, "environmentId" | "id" | "title">,
): EnvironmentProject {
  return {
    workspaceRoot: `/workspaces/${input.id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...input,
  };
}

function makeThread(
  input: Partial<EnvironmentThreadShell> &
    Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId" | "title">,
): EnvironmentThreadShell {
  return makeThreadShellFixture({
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  });
}

describe("home project scopes", () => {
  it("filters threads across both scratch hosts while retaining the selected environment boundary", () => {
    const localEnvironmentId = EnvironmentId.make("local");
    const remoteEnvironmentId = EnvironmentId.make("remote");
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: ProjectId.make("scratch-local"),
        title: "No project",
        workspaceRoot: "/local/scratch",
        isScratch: true,
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: ProjectId.make("scratch-remote"),
        title: "No project",
        workspaceRoot: "/remote/scratch",
        isScratch: true,
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: ProjectId.make("ordinary"),
        title: "No project",
      }),
    ];
    const threads = projects.map((project) =>
      makeThread({
        environmentId: project.environmentId,
        projectId: project.id,
        id: ThreadId.make(`thread-${project.id}`),
        title: project.id,
      }),
    );
    const scopes = buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: "separate",
    });
    expect(scopes).toHaveLength(2);
    const scratchScope = scopes.find((scope) => scope.representative.isScratch)!;
    const filtered = buildThreadListV2Items({
      threads,
      environmentId: null,
      projectRefs: scratchScope.projectRefs,
      searchQuery: "",
      now: "2026-06-01T00:00:00.000Z",
    });
    expect(filtered.items.map((item) => item.thread.id).sort()).toEqual(
      threads
        .slice(0, 2)
        .map((thread) => thread.id)
        .sort(),
    );
    const remoteScopes = buildHomeProjectScopes({
      projects,
      environmentId: remoteEnvironmentId,
      projectGroupingMode: "separate",
    });
    const remoteScratch = remoteScopes.find((scope) => scope.representative.isScratch)!;
    expect(remoteScratch.key).toBe(scratchScope.key);
    expect(remoteScratch.projectRefs).toEqual([
      { environmentId: remoteEnvironmentId, projectId: projects[1]!.id },
    ]);
    expect(
      buildThreadListV2Items({
        threads,
        environmentId: remoteEnvironmentId,
        projectRefs: remoteScratch.projectRefs,
        searchQuery: "",
        now: "2026-06-01T00:00:00.000Z",
      }).items.map((item) => item.thread.id),
    ).toEqual([threads[1]!.id]);
  });

  it("keeps repository identity from an older duplicate when the freshness winner lacks it", () => {
    const localEnvironmentId = EnvironmentId.make("environment-local");
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const repositoryIdentity = {
      canonicalKey: "github.com/pingdotgg/t3code",
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: "git@github.com:pingdotgg/t3code.git",
      },
    };
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: ProjectId.make("project-local"),
        title: "t3code",
        repositoryIdentity,
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: ProjectId.make("project-remote-with-identity"),
        title: "t3code",
        workspaceRoot: "/remote/t3code",
        repositoryIdentity,
        updatedAt: "2026-06-01T00:00:00.000Z",
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: ProjectId.make("project-remote-fresh"),
        title: "t3code",
        workspaceRoot: "/remote/t3code/",
        updatedAt: "2026-06-02T00:00:00.000Z",
      }),
    ];

    const scopes = buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: "repository",
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.representative.id).toBe(ProjectId.make("project-local"));
    expect(scopes[0]?.projects.map((project) => project.id)).toContain(
      ProjectId.make("project-remote-fresh"),
    );
    expect(scopes[0]?.projectRefs).toHaveLength(3);
  });

  it("does not merge unrelated repositories that share a title", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const projects = ["one", "two"].map((name) =>
      makeProject({
        environmentId,
        id: ProjectId.make(`project-${name}`),
        title: "app",
        repositoryIdentity: {
          canonicalKey: `github.com/example/${name}`,
          locator: {
            source: "git-remote" as const,
            remoteName: "origin",
            remoteUrl: `git@github.com:example/${name}.git`,
          },
        },
      }),
    );

    expect(
      buildHomeProjectScopes({
        projects,
        environmentId: null,
        projectGroupingMode: "repository",
      }),
    ).toHaveLength(2);
  });

  it("prefers an exact scope key over a project ID that collides with it", () => {
    const environmentId = EnvironmentId.make("environment-local");
    const collidingProject = makeProject({
      environmentId,
      id: ProjectId.make("/workspaces/target"),
      title: "Colliding",
      workspaceRoot: "/workspaces/colliding",
    });
    const targetProject = makeProject({
      environmentId,
      id: ProjectId.make("project-target"),
      title: "Target",
      workspaceRoot: "/workspaces/target",
    });
    const scopes = buildHomeProjectScopes({
      projects: [collidingProject, targetProject],
      environmentId: null,
      projectGroupingMode: "separate",
    });
    const targetScope = scopes.find((scope) => scope.title === "Target");
    expect(scopes.map((scope) => scope.title)).toEqual(["Colliding", "Target"]);
    expect(targetScope?.key).toBe("environment-local:/workspaces/target");

    expect(findHomeProjectScope(scopes, "environment-local:/workspaces/target")).toBe(targetScope);
    expect(findHomeProjectScope(scopes, "environment-local:project-target")).toBe(targetScope);
    expect(findHomeProjectScope(scopes, "environment-local:missing")).toBeNull();
    expect(findHomeProjectScope(scopes, null)).toBeNull();
  });
  it("filters the union of selected logical projects without leaking same IDs from other hosts", () => {
    const first = EnvironmentId.make("first");
    const second = EnvironmentId.make("second");
    const projects = [
      makeProject({ environmentId: first, id: ProjectId.make("same"), title: "A" }),
      makeProject({ environmentId: second, id: ProjectId.make("same"), title: "B" }),
      makeProject({ environmentId: first, id: ProjectId.make("third"), title: "C" }),
    ];
    const scopes = buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: "separate",
    });
    expect(resolveHomeProjectFilter(scopes, [scopes[0]!.key, scopes[2]!.key]).projectRefs).toEqual([
      { environmentId: first, projectId: projects[0]!.id },
      { environmentId: first, projectId: projects[2]!.id },
    ]);
    expect(resolveHomeProjectFilter(scopes, []).projectRefs).toBeNull();
  });

  it("keeps a manual order stable across new scopes and moves only the requested project", () => {
    const environmentId = EnvironmentId.make("local");
    const projects = ["a", "b", "c"].map((id) =>
      makeProject({ environmentId, id: ProjectId.make(id), title: id }),
    );
    const scopes = buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: "separate",
    });
    const ordered = sortHomeProjectScopes({
      scopes,
      threads: [],
      pendingTasks: [],
      projectSortOrder: "manual",
      projectOrder: [scopes[1]!.key, scopes[0]!.key],
    });
    expect(ordered.map((scope) => scope.title)).toEqual(["b", "a", "c"]);
    expect(
      sortHomeProjectScopes({
        scopes,
        threads: [],
        pendingTasks: [],
        projectSortOrder: "manual",
        projectOrder: ["local:/workspaces/c", "local:/workspaces/a"],
      }).map((scope) => scope.title),
    ).toEqual(["c", "a", "b"]);
    expect(
      reorderHomeProjectKeys(
        ordered.map((scope) => scope.key),
        scopes[0]!.key,
        "up",
      ),
    ).toEqual([scopes[0]!.key, scopes[1]!.key, scopes[2]!.key]);
  });

  it("applies physical-project grouping overrides before building logical scopes", () => {
    const environmentId = EnvironmentId.make("local");
    const projects = ["a", "b"].map((id) =>
      makeProject({
        environmentId,
        id: ProjectId.make(id),
        title: id,
        repositoryIdentity: {
          canonicalKey: "github.com/org/repo",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://github.com/org/repo",
          },
        },
      }),
    );
    expect(
      buildHomeProjectScopes({
        projects,
        environmentId: null,
        projectGroupingMode: "repository",
        projectGroupingOverrides: { "local:/workspaces/b": "separate" },
      }),
    ).toHaveLength(2);
  });
});

describe("grouped thread list", () => {
  const environmentId = EnvironmentId.make("local");
  const projects = ["alpha", "beta"].map((id) =>
    makeProject({ environmentId, id: ProjectId.make(id), title: id }),
  );
  const scopes = buildHomeProjectScopes({
    projects,
    environmentId,
    projectGroupingMode: "separate",
  });
  const row = (
    id: string,
    projectId: string,
    item: Partial<Pick<ThreadListV2Item, "variant" | "snoozed" | "pinned">> = {},
  ): ThreadListV2ListItem => ({
    type: "v2-thread",
    key: id,
    item: {
      thread: makeThread({
        environmentId,
        id: ThreadId.make(id),
        projectId: ProjectId.make(projectId),
        title: id,
      }),
      variant: "card",
      snoozed: false,
      pinned: false,
      wokeAt: null,
      isLast: false,
      ...item,
    },
    snoozeWakeLabelText: undefined,
    timeLabel: "",
    snoozePresetMinute: undefined,
    showTrailingDivider: false,
    hasQueuedMessages: false,
    canMoveUp: false,
    canMoveDown: false,
  });
  const settled = (id: string, projectId: string) => row(id, projectId, { variant: "slim" });
  const build = (
    rows: ReadonlyArray<ThreadListV2ListItem>,
    overrides: Partial<Parameters<typeof buildGroupedThreadListItems>[0]> = {},
  ) =>
    buildGroupedThreadListItems({
      rows,
      scopes,
      boring: false,
      searching: false,
      previewCount: 10,
      projectSortField: "updatedAt",
      threadSortField: "updatedAt",
      collapsedGroups: undefined,
      openSettledGroups: undefined,
      expandedGroups: new Set(),
      selectedThreadKey: null,
      ...overrides,
    });
  const alphaKey = scopes.find((scope) => scope.title === "alpha")!.key;
  const betaKey = scopes.find((scope) => scope.title === "beta")!.key;

  it("folds settled chats behind a toggle per project and opens only that project", () => {
    const rows = [row("a1", "alpha"), settled("a2", "alpha"), settled("b1", "beta")];
    const closed = build(rows).items.map((item) => item.key);
    expect(closed).not.toContain("a2");
    expect(closed).not.toContain("b1");
    expect(closed).toContain(`v2-project-settled:${alphaKey}`);

    const opened = build(rows, { openSettledGroups: [alphaKey] }).items.map((item) => item.key);
    expect(opened).toContain("a2");
    expect(opened).not.toContain("b1");
  });

  it("gives a project with only settled chats a header on its toggle", () => {
    const { groups } = build([settled("b1", "beta")]);
    expect(groups.get(`v2-project-settled:${betaKey}`)).toMatchObject({
      first: true,
      title: "beta",
    });
  });

  it("keeps the open chat visible while its settled group is closed", () => {
    const keys = build([settled("a2", "alpha")], {
      selectedThreadKey: `${environmentId}:a2`,
    }).items.map((item) => item.key);
    expect(keys).toContain("a2");
  });

  it("lists settled matches inline while searching", () => {
    const keys = build([settled("a2", "alpha")], { searching: true }).items.map((item) => item.key);
    expect(keys).toEqual(["a2"]);
  });

  it("starts each project with its own favorites and keeps snoozed chats below in Boring", () => {
    const rows = [
      row("snoozed", "alpha", { variant: "slim", snoozed: true }),
      row("active", "alpha"),
      row("favorite", "alpha", { pinned: true }),
      row("other-favorite", "beta", { pinned: true }),
    ];
    expect(build(rows, { boring: true }).items.map((item) => item.key)).toEqual([
      "favorite",
      "active",
      "other-favorite",
      "snoozed",
    ]);
    expect(build(rows, { boring: true }).groups.get("favorite")).toMatchObject({ first: true });
    expect(build(rows).items.map((item) => item.key)).toContain("favorite");
    expect(build(rows).groups.has("favorite")).toBe(true);
  });

  it("retains empty pinned and explicitly selected folders", () => {
    const pinnedScopes = scopes.map((scope) => ({ ...scope, pinned: scope.key === alphaKey }));
    const result = build([], { scopes: pinnedScopes, selectedProjectKeys: [betaKey] });
    expect([...result.groups.values()].map((group) => group.title)).toEqual(["alpha", "beta"]);
    expect(result.items.every((item) => item.type === "v2-project-header")).toBe(true);
  });

  it("never folds a favorite behind the project's preview limit in Boring", () => {
    const rows = [
      row("one", "alpha", { pinned: true }),
      row("two", "alpha", { pinned: true }),
      row("rest", "alpha"),
    ];
    const { items, groups } = build(rows, { boring: true, previewCount: 1 });
    expect(items.map((item) => item.key)).toEqual(["one", "two"]);
    expect(groups.get("two")).toMatchObject({ last: true, hiddenCount: 1 });
  });
});

describe("folder attention", () => {
  it("prioritizes requests, failures, unread completion, then work, leaving waiting quiet", () => {
    const ready = makeThreadShellFixture({
      latestRun: {
        runId: RunId.make("run"),
        status: "completed",
        requestedAt: "2026-11-11T10:00:00.000Z",
        assistantMessageId: null,
        startedAt: "2026-11-11T10:00:00.000Z",
        completedAt: "2026-11-11T11:00:00.000Z",
      },
      lastVisitedAt: "2026-11-11T09:00:00.000Z",
    });
    const working = {
      ...ready,
      runtime: {
        status: "running" as const,
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "Codex",
        lastError: null,
        updatedAt: ready.updatedAt,
      },
    };
    const failed = { ...working, runtime: { ...working.runtime, status: "failed" as const } };
    const waiting = { ...working, runtime: { ...working.runtime, status: "idle" as const } };
    expect(resolveProjectFolderAttention([working, ready])).toBe("unread");
    expect(resolveProjectFolderAttention([ready, failed])).toBe("failed");
    expect(resolveProjectFolderAttention([failed, { ...ready, hasPendingUserInput: true }])).toBe(
      "attention",
    );
    expect(resolveProjectFolderAttention([working])).toBe("working");
    expect(resolveProjectFolderAttention([waiting])).toBeNull();
  });
});
