import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { initialProjectIndexScope, projectIndexWorktrees } from "./projectIndexingScope";

const firstEnvironment = EnvironmentId.make("environment-a");
const secondEnvironment = EnvironmentId.make("environment-b");
const projectId = ProjectId.make("shared-project-id");
const rootThread = {
  environmentId: firstEnvironment,
  projectId,
  id: ThreadId.make("root"),
  worktreePath: null,
  title: "Root",
};
const worktree = {
  ...rootThread,
  id: ThreadId.make("worktree"),
  worktreePath: "/worktree",
  title: "Worktree",
};
const remoteThread = { ...worktree, environmentId: secondEnvironment, id: ThreadId.make("remote") };
const projects = [
  { environmentId: firstEnvironment, id: projectId },
  { environmentId: secondEnvironment, id: projectId },
];
const threads = [rootThread, worktree, remoteThread];

describe("project indexing scope selection", () => {
  it("never selects a project or worktree without an explicit request", () => {
    const result = initialProjectIndexScope({
      environmentId: firstEnvironment,
      projects,
      threads,
    });
    expect(result).toEqual({ projectId: null, threadId: null });
  });

  it("honors an explicit project root and retains a missing explicit worktree for an honest unavailable state", () => {
    expect(
      initialProjectIndexScope({
        environmentId: firstEnvironment,
        projects,
        threads,
        projectId,
      }),
    ).toEqual({ projectId, threadId: null });
    const missing = ThreadId.make("removed-worktree");
    expect(
      initialProjectIndexScope({
        environmentId: firstEnvironment,
        projects,
        threads,
        projectId,
        threadId: missing,
      }),
    ).toEqual({ projectId, threadId: missing });
  });

  it("offers only worktree threads belonging to the selected project and environment", () => {
    expect(projectIndexWorktrees(threads, firstEnvironment, projectId)).toEqual([worktree]);
    expect(projectIndexWorktrees(threads, secondEnvironment, projectId)).toEqual([remoteThread]);
  });
});
