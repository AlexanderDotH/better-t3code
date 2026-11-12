import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { makeRawThreadShell } from "../../test-fixtures";
import { buildArchivedThreadGroups, buildArchivedProjectScopes } from "./archivedThreadList";

describe("archived project scopes", () => {
  const at = DateTime.makeUnsafe("2026-11-11T12:00:00.000Z");
  const snapshots = ["local", "remote"].map((id) => {
    const project: OrchestrationProjectShell = {
      id: ProjectId.make(`project-${id}`),
      title: "App",
      workspaceRoot: `/${id}/app`,
      repositoryIdentity: {
        canonicalKey: "github.com/org/app",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: "https://github.com/org/app",
        },
      },
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-11-11T12:00:00.000Z",
      updatedAt: "2026-11-11T12:00:00.000Z",
    };
    return {
      environmentId: EnvironmentId.make(id),
      snapshot: {
        schemaVersion: 1 as const,
        snapshotSequence: 1,
        projects: [project],
        threads: [
          makeRawThreadShell({ id: ThreadId.make("same"), projectId: project.id, archivedAt: at }),
        ],
      },
    };
  });
  const base = {
    snapshots,
    environmentLabels: { local: "Local", remote: "Remote" },
    environmentId: null,
    searchQuery: "",
    sortOrder: "newest" as const,
  };

  it("combines logical repositories while preserving each thread's destination", () => {
    const groups = buildArchivedThreadGroups(base);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.threads.map((thread) => thread.environmentId)).toEqual(["local", "remote"]);
    expect(
      buildArchivedThreadGroups({ ...base, environmentId: EnvironmentId.make("remote") })[0]!
        .threads,
    ).toHaveLength(1);
  });

  it("retains threads from older duplicate project records in one logical folder", () => {
    const local = snapshots[0]!;
    const olderId = ProjectId.make("older-project");
    const duplicate = {
      ...local,
      snapshot: {
        ...local.snapshot,
        projects: [...local.snapshot.projects, { ...local.snapshot.projects[0]!, id: olderId }],
        threads: [
          ...local.snapshot.threads,
          makeRawThreadShell({ id: ThreadId.make("older"), projectId: olderId, archivedAt: at }),
        ],
      },
    };
    expect(
      buildArchivedThreadGroups({ ...base, snapshots: [duplicate] })[0]!
        .threads.map((thread) => thread.id)
        .sort(),
    ).toEqual(["older", "same"]);
  });

  it("respects project scope, grouping overrides and environment-qualified message search", () => {
    const settings = {
      sidebarProjectGroupingMode: "repository" as const,
      sidebarProjectGroupingOverrides: { "remote:/remote/app": "separate" as const },
    };
    const scopes = buildArchivedProjectScopes({
      snapshots,
      environmentId: null,
      projectGroupingSettings: settings,
    });
    expect(scopes).toHaveLength(2);
    const key = scopes.find((scope) => scope.representative.environmentId === "remote")!.key;
    const groups = buildArchivedThreadGroups({
      ...base,
      projectGroupingSettings: settings,
      projectKey: key,
    });
    expect(groups.flatMap((group) => group.threads).map((thread) => thread.environmentId)).toEqual([
      "remote",
    ]);
    expect(
      buildArchivedThreadGroups({ ...base, searchQuery: "Remote" })[0]!.threads.map(
        (thread) => thread.environmentId,
      ),
    ).toEqual(["remote"]);
  });
});
