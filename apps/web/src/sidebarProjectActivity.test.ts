import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarProjectGroupMember, SidebarProjectSnapshot } from "./sidebarProjectGrouping";
import {
  partitionSidebarThreadsByProjectActivity,
  partitionSidebarProjectsByActivity,
  resolveSidebarOlderProjectsExpanded,
  SIDEBAR_PROJECT_INACTIVITY_MS,
} from "./sidebarProjectActivity";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type SidebarThreadSummary } from "./types";

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const localEnvironmentId = EnvironmentId.make("environment-local");

function timestampAtAge(ageMs: number): string {
  return new Date(NOW_MS - ageMs).toISOString();
}

function makeMember(
  projectId: string,
  overrides: Partial<SidebarProjectGroupMember> = {},
): SidebarProjectGroupMember {
  const id = ProjectId.make(projectId);
  return {
    id,
    environmentId: localEnvironmentId,
    title: projectId,
    workspaceRoot: `/tmp/${projectId}`,
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    checkpointsEnabled: true,
    scripts: [],
    createdAt: timestampAtAge(0),
    updatedAt: timestampAtAge(0),
    physicalProjectKey: `${localEnvironmentId}:${id}`,
    environmentLabel: null,
    ...overrides,
  };
}

function makeProject(
  projectKey: string,
  members: readonly SidebarProjectGroupMember[] = [makeMember(projectKey)],
): SidebarProjectSnapshot {
  const representative = members[0]!;
  return {
    ...representative,
    projectKey,
    displayName: representative.title,
    groupedProjectCount: members.length,
    environmentPresence: "local-only",
    allRemoteMembersAreDesktopLocal: false,
    memberProjects: members,
    memberProjectRefs: members.map((member) => ({
      environmentId: member.environmentId,
      projectId: member.id,
    })),
    remoteEnvironmentLabels: [],
  };
}

function makeThread(overrides: Partial<SidebarThreadSummary> = {}): SidebarThreadSummary {
  const id = overrides.id ?? ThreadId.make("thread-1");
  return {
    id,
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: timestampAtAge(0),
    updatedAt: timestampAtAge(0),
    archivedAt: null,
    session: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function partition(
  projects: readonly SidebarProjectSnapshot[],
  threadsByProjectKey: ReadonlyMap<string, readonly SidebarThreadSummary[]> = new Map(),
) {
  return partitionSidebarProjectsByActivity({ projects, threadsByProjectKey, nowMs: NOW_MS });
}

describe("partitionSidebarProjectsByActivity", () => {
  it("keeps exactly seven days recent and moves one millisecond older", () => {
    const exactlySevenDays = makeProject("exact", [
      makeMember("exact", {
        createdAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS),
        updatedAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS),
      }),
    ]);
    const oneMillisecondOlder = makeProject("older", [
      makeMember("older", {
        createdAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1),
        updatedAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1),
      }),
    ]);

    const result = partition([exactlySevenDays, oneMillisecondOlder]);

    expect(result.recentProjects.map((project) => project.projectKey)).toEqual(["exact"]);
    expect(result.olderProjects.map((project) => project.projectKey)).toEqual(["older"]);
    expect(result.nextTransitionAtMs).toBe(NOW_MS + 1);
  });

  it("moves an older project back to recent as soon as renewed thread activity arrives", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const project = makeProject("project", [
      makeMember("project", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);
    const inactiveThread = makeThread({
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
      latestUserMessageAt: oldTimestamp,
    });

    const beforeActivity = partition([project], new Map([["project", [inactiveThread]]]));
    const afterActivity = partition(
      [project],
      new Map([
        [
          "project",
          [
            {
              ...inactiveThread,
              latestUserMessageAt: timestampAtAge(0),
            },
          ],
        ],
      ]),
    );

    expect(beforeActivity.recentProjects).toEqual([]);
    expect(beforeActivity.olderProjects).toEqual([project]);
    expect(afterActivity.recentProjects).toEqual([project]);
    expect(afterActivity.olderProjects).toEqual([]);
  });

  it("moves a project to older when its final chat is settled", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const settledAt = timestampAtAge(0);
    const project = makeProject("project", [
      makeMember("project", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);
    const settledThread = makeThread({
      createdAt: oldTimestamp,
      updatedAt: settledAt,
      latestUserMessageAt: timestampAtAge(1_000),
      settledOverride: "settled",
      settledAt,
    });

    const result = partition([project], new Map([["project", [settledThread]]]));

    expect(result.recentProjects).toEqual([]);
    expect(result.olderProjects).toEqual([project]);
  });

  it("uses project metadata activity and falls back to project creation", () => {
    const updatedProject = makeProject("updated", [
      makeMember("updated", {
        createdAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1),
        updatedAt: timestampAtAge(60_000),
      }),
    ]);
    const createdProject = makeProject("created", [
      makeMember("created", {
        createdAt: timestampAtAge(60_000),
        updatedAt: "invalid" as never,
      }),
    ]);

    expect(partition([updatedProject, createdProject]).recentProjects).toEqual([
      updatedProject,
      createdProject,
    ]);
  });

  it("uses latest user activity instead of recent project or thread metadata", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const project = makeProject("project", [
      makeMember("project", {
        createdAt: oldTimestamp,
        updatedAt: timestampAtAge(1_000),
      }),
    ]);
    const thread = makeThread({
      createdAt: oldTimestamp,
      updatedAt: timestampAtAge(1_000),
      latestUserMessageAt: oldTimestamp,
    });

    expect(partition([project], new Map([["project", [thread]]])).olderProjects).toEqual([project]);
  });

  it("falls back to thread metadata when a thread has no user messages", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const project = makeProject("project", [
      makeMember("project", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);
    const thread = makeThread({
      createdAt: oldTimestamp,
      updatedAt: timestampAtAge(1_000),
      latestUserMessageAt: null,
    });

    expect(partition([project], new Map([["project", [thread]]])).recentProjects).toEqual([
      project,
    ]);
  });

  it("classifies grouped projects using the newest member or thread", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const memberActiveProject = makeProject("members", [
      makeMember("members-local", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
      makeMember("members-remote", { updatedAt: timestampAtAge(1_000) }),
    ]);
    const threadActiveProject = makeProject("threads", [
      makeMember("threads", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);
    const recentThread = makeThread({ latestUserMessageAt: timestampAtAge(2_000) });

    const result = partition(
      [memberActiveProject, threadActiveProject],
      new Map([["threads", [recentThread]]]),
    );

    expect(result.recentProjects).toEqual([memberActiveProject, threadActiveProject]);
  });

  it("keeps every attention state in the recent list regardless of age", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const projects = ["approval", "input", "plan", "session", "session-running", "turn"].map(
      (key) =>
        makeProject(key, [makeMember(key, { createdAt: oldTimestamp, updatedAt: oldTimestamp })]),
    );
    const oldThread = { createdAt: oldTimestamp, updatedAt: oldTimestamp };
    const threadsByProjectKey = new Map<string, readonly SidebarThreadSummary[]>([
      ["approval", [makeThread({ ...oldThread, hasPendingApprovals: true })]],
      ["input", [makeThread({ ...oldThread, hasPendingUserInput: true })]],
      ["plan", [makeThread({ ...oldThread, hasActionableProposedPlan: true })]],
      [
        "session",
        [
          makeThread({
            ...oldThread,
            session: {
              threadId: ThreadId.make("thread-session"),
              status: "starting",
              providerName: "Codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: DEFAULT_RUNTIME_MODE,
              runtimeSessionId: null,
              activeTurnId: null,
              abortState: null,
              lastError: null,
              updatedAt: oldTimestamp,
            },
          }),
        ],
      ],
      [
        "turn",
        [
          makeThread({
            ...oldThread,
            latestTurn: {
              turnId: "turn-running" as never,
              state: "running",
              requestedAt: oldTimestamp,
              startedAt: oldTimestamp,
              completedAt: null,
              assistantMessageId: null,
            },
          }),
        ],
      ],
      [
        "session-running",
        [
          makeThread({
            ...oldThread,
            session: {
              threadId: ThreadId.make("thread-session-running"),
              status: "running",
              providerName: "Codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: DEFAULT_RUNTIME_MODE,
              runtimeSessionId: null,
              activeTurnId: null,
              abortState: null,
              lastError: null,
              updatedAt: oldTimestamp,
            },
          }),
        ],
      ],
    ]);

    const result = partition(projects, threadsByProjectKey);

    expect(result.recentProjects).toEqual(projects);
    expect(result.olderProjects).toEqual([]);
    expect(result.nextTransitionAtMs).toBeNull();
  });

  it("ignores archived thread activity so organizational cleanup does not reactivate a project", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const project = makeProject("project", [
      makeMember("project", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);
    const archivedThread = makeThread({
      updatedAt: timestampAtAge(1_000),
      archivedAt: timestampAtAge(500),
    });

    expect(partition([project], new Map([["project", [archivedThread]]])).olderProjects).toEqual([
      project,
    ]);
    expect(partition([project], new Map()).olderProjects).toEqual([project]);
  });

  it("keeps projects with malformed timestamps visible", () => {
    const project = makeProject("invalid", [
      makeMember("invalid", { createdAt: "bad" as never, updatedAt: "worse" as never }),
    ]);
    const thread = makeThread({ createdAt: "bad" as never, updatedAt: "worse" as never });

    expect(partition([project], new Map([["invalid", [thread]]])).recentProjects).toEqual([
      project,
    ]);
  });

  it("falls back when the latest user activity timestamp is malformed", () => {
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const project = makeProject("project");
    const thread = makeThread({
      latestUserMessageAt: "invalid" as never,
      updatedAt: oldTimestamp,
      createdAt: oldTimestamp,
    });

    expect(partition([project], new Map([["project", [thread]]])).olderProjects).toEqual([project]);
  });

  it("clamps future activity so it can age out after seven days", () => {
    const futureTimestamp = new Date(NOW_MS + SIDEBAR_PROJECT_INACTIVITY_MS).toISOString();
    const project = makeProject("future", [
      makeMember("future", { createdAt: futureTimestamp, updatedAt: futureTimestamp }),
    ]);

    const result = partition([project]);

    expect(result.recentProjects).toEqual([project]);
    expect(result.nextTransitionAtMs).toBe(NOW_MS + SIDEBAR_PROJECT_INACTIVITY_MS + 1);
  });

  it("preserves the incoming selected or manual order in both partitions", () => {
    const recentA = makeProject("recent-a");
    const oldTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS + 1);
    const olderA = makeProject("older-a", [
      makeMember("older-a", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);
    const recentB = makeProject("recent-b");
    const olderB = makeProject("older-b", [
      makeMember("older-b", { createdAt: oldTimestamp, updatedAt: oldTimestamp }),
    ]);

    const result = partition([recentA, olderA, recentB, olderB]);

    expect(result.recentProjects).toEqual([recentA, recentB]);
    expect(result.olderProjects).toEqual([olderA, olderB]);
  });

  it("partitions active inbox rows by older project membership without changing row order", () => {
    const recentProject = makeProject("recent");
    const olderProject = makeProject("older");
    const recentThread = makeThread({
      id: ThreadId.make("recent-thread"),
      projectId: recentProject.id,
    });
    const olderThread = makeThread({
      id: ThreadId.make("older-thread"),
      projectId: olderProject.id,
    });

    const result = partitionSidebarThreadsByProjectActivity({
      threads: [olderThread, recentThread],
      olderProjects: [olderProject],
    });

    expect(result.recentThreads).toEqual([recentThread]);
    expect(result.olderThreads).toEqual([olderThread]);
  });

  it("returns the earliest upcoming transition and excludes attention-held projects", () => {
    const firstTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS - 1_000);
    const secondTimestamp = timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS - 500);
    const first = makeProject("first", [
      makeMember("first", { createdAt: firstTimestamp, updatedAt: firstTimestamp }),
    ]);
    const second = makeProject("second", [
      makeMember("second", { createdAt: secondTimestamp, updatedAt: secondTimestamp }),
    ]);
    const held = makeProject("held", [
      makeMember("held", {
        createdAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS),
        updatedAt: timestampAtAge(SIDEBAR_PROJECT_INACTIVITY_MS),
      }),
    ]);

    const result = partition(
      [second, held, first],
      new Map([["held", [makeThread({ hasPendingApprovals: true })]]]),
    );

    expect(result.nextTransitionAtMs).toBe(NOW_MS + 501);
  });
});

describe("resolveSidebarOlderProjectsExpanded", () => {
  const olderProjectKeys = new Set(["older"]);

  it("uses persisted disclosure when no older route is active", () => {
    expect(
      resolveSidebarOlderProjectsExpanded({
        persistedExpanded: true,
        activeRouteProjectKey: null,
        dismissedAutoRevealProjectKey: null,
        olderProjectKeys,
      }),
    ).toBe(true);
  });

  it("auto-reveals an older routed project until that route reveal is dismissed", () => {
    expect(
      resolveSidebarOlderProjectsExpanded({
        persistedExpanded: false,
        activeRouteProjectKey: "older",
        dismissedAutoRevealProjectKey: null,
        olderProjectKeys,
      }),
    ).toBe(true);
    expect(
      resolveSidebarOlderProjectsExpanded({
        persistedExpanded: false,
        activeRouteProjectKey: "older",
        dismissedAutoRevealProjectKey: "older",
        olderProjectKeys,
      }),
    ).toBe(false);
  });
});
