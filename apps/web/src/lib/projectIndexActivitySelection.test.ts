import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProjectIndexActivityV1, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  selectActiveProjectIndexActivities,
  selectProjectGroupIndexingActivity,
  selectProjectIndexActivity,
} from "./projectIndexActivitySelection";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");
const decodeActivity = Schema.decodeSync(ProjectIndexActivityV1);

function activity(
  projectId: ProjectId,
  scopeId: string,
  state: ProjectIndexActivityV1["state"],
  options: { threadId?: ThreadId; updatedAt?: string; enabled?: boolean } = {},
): ProjectIndexActivityV1 {
  return decodeActivity({
    scope: {
      scopeId,
      projectId,
      ...(options.threadId ? { threadId: options.threadId } : {}),
      workspaceFingerprint: `fingerprint-${scopeId}`,
    },
    state,
    settings: { enabled: options.enabled ?? true },
    coverage: { indexedFiles: 4, eligibleFiles: 8 },
    job: null,
    updatedAt: options.updatedAt ?? "2026-09-23T00:00:00.000Z",
  });
}

function scopes(...activities: ProjectIndexActivityV1[]) {
  return new Map(activities.map((entry) => [entry.scope.scopeId, entry]));
}

describe("project index activity selection", () => {
  it("selects only the open project's status even when another project is indexing", () => {
    const openProject = activity(projectA, "root-a", "ready");
    const otherProject = activity(projectB, "root-b", "extracting");
    const allScopes = scopes(openProject, otherProject);

    expect(selectProjectIndexActivity(allScopes, projectA)).toBe(openProject);
    expect(selectProjectIndexActivity(scopes(otherProject), projectA)).toBeNull();
  });

  it("prefers running work over a ready worktree and the current thread among equal jobs", () => {
    const threadA = ThreadId.make("thread-a");
    const threadB = ThreadId.make("thread-b");
    const ready = activity(projectA, "root", "ready");
    const current = activity(projectA, "current", "extracting", { threadId: threadA });
    const other = activity(projectA, "other", "extracting", {
      threadId: threadB,
      updatedAt: "2026-09-23T00:01:00.000Z",
    });

    expect(selectProjectIndexActivity(scopes(ready, other, current), projectA, threadA)).toBe(
      current,
    );
    expect(selectProjectIndexActivity(scopes(ready, other, current), projectA)).toBe(other);
  });

  it("indexes only active projects and keeps equal project IDs in separate environments", () => {
    const runningA = activity(projectA, "running-a", "extracting");
    const runningB = activity(projectA, "running-b", "waiting-for-resources");
    const ready = activity(projectB, "ready-b", "ready");
    const paused = activity(projectB, "paused-b", "paused");
    const disabled = activity(projectB, "disabled-b", "extracting", { enabled: false });
    const active = selectActiveProjectIndexActivities(
      new Map([
        [environmentA, scopes(runningA, ready, paused, disabled)],
        [environmentB, scopes(runningB)],
      ]),
    );

    expect(active.size).toBe(2);
    expect(active.get(scopedProjectKey(scopeProjectRef(environmentA, projectA)))?.activity).toBe(
      runningA,
    );
    expect(active.get(scopedProjectKey(scopeProjectRef(environmentB, projectA)))?.activity).toBe(
      runningB,
    );
    expect(active.has(scopedProjectKey(scopeProjectRef(environmentA, projectB)))).toBe(false);
  });

  it("shows one indicator for a grouped project when a member is indexing", () => {
    const running = activity(projectA, "worktree", "updating");
    const active = selectActiveProjectIndexActivities(new Map([[environmentB, scopes(running)]]));

    expect(
      selectProjectGroupIndexingActivity(active, [
        scopeProjectRef(environmentA, projectA),
        scopeProjectRef(environmentB, projectA),
      ])?.activity,
    ).toBe(running);
    expect(
      selectProjectGroupIndexingActivity(active, [scopeProjectRef(environmentA, projectB)]),
    ).toBeNull();
  });

  it("keeps unaffected project indicators stable when another project updates", () => {
    const runningA = activity(projectA, "running-a", "extracting");
    const runningB = activity(projectB, "running-b", "discovering");
    const original = selectActiveProjectIndexActivities(
      new Map([[environmentA, scopes(runningA, runningB)]]),
    );
    const updatedB = activity(projectB, "running-b", "updating", {
      updatedAt: "2026-09-23T00:01:00.000Z",
    });
    const updated = selectActiveProjectIndexActivities(
      new Map([[environmentA, scopes(runningA, updatedB)]]),
      original,
    );

    const keyA = scopedProjectKey(scopeProjectRef(environmentA, projectA));
    const keyB = scopedProjectKey(scopeProjectRef(environmentA, projectB));
    expect(updated.get(keyA)).toBe(original.get(keyA));
    expect(updated.get(keyB)).not.toBe(original.get(keyB));
  });
});
