import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyPullRequestFilterSelection,
  applyPullRequestProjectSelection,
  pullRequestProjectKey,
  updatePullRequestFilters,
} from "./PullRequestListFilters";

describe("pull request filters menu", () => {
  it("does not emit a change when the selected state is chosen again", () => {
    const onState = vi.fn();
    applyPullRequestFilterSelection("open", "open", onState);
    expect(onState).not.toHaveBeenCalled();

    applyPullRequestFilterSelection("open", "closed", onState);
    expect(onState).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledWith("closed");
  });

  it("names the chosen narrowing and leaves the others alone", () => {
    const onFilters = vi.fn();
    onFilters(updatePullRequestFilters({ review: "approved" }, "draft", "hide"));
    expect(onFilters).toHaveBeenCalledWith({ review: "approved", draft: "hide" });
  });

  it("drops a narrowing chosen back to all rather than sending it as undefined", () => {
    const onFilters = vi.fn();
    onFilters(updatePullRequestFilters({ review: "none", checks: "failing" }, "review", "all"));
    expect(onFilters).toHaveBeenCalledWith({ checks: "failing" });
  });

  it("does not emit a change when the selected project is chosen again", () => {
    const projectId = "project-1" as ProjectId;
    const environmentId = "env-1" as EnvironmentId;
    const onProject = vi.fn();
    const projects = [
      {
        id: projectId,
        environmentId,
        title: "T3 Code",
        workspaceRoot: "/work/t3code",
      },
    ];
    applyPullRequestProjectSelection({
      next: pullRequestProjectKey({ id: projectId, environmentId }),
      projects,
      projectId,
      projectEnvironmentId: environmentId,
      onProject,
    });
    expect(onProject).not.toHaveBeenCalled();

    applyPullRequestProjectSelection({
      next: "all",
      projects,
      projectId,
      projectEnvironmentId: environmentId,
      onProject,
    });
    expect(onProject).toHaveBeenCalledWith(undefined, undefined);
  });

  it("passes the environment along so a duplicate project id on another server is told apart", () => {
    const projectId = "project-1" as ProjectId;
    const onProject = vi.fn();
    const projects = [
      {
        id: projectId,
        environmentId: "env-1" as EnvironmentId,
      },
      {
        id: projectId,
        environmentId: "env-2" as EnvironmentId,
      },
    ];
    applyPullRequestProjectSelection({
      next: pullRequestProjectKey({ id: projectId, environmentId: "env-2" as EnvironmentId }),
      projects,
      projectId: undefined,
      projectEnvironmentId: undefined,
      onProject,
    });
    expect(onProject).toHaveBeenCalledWith(projectId, "env-2");
  });

  it("does not collide when environment and project ids contain spaces", () => {
    expect(
      pullRequestProjectKey({
        environmentId: "a b" as EnvironmentId,
        id: "c" as ProjectId,
      }),
    ).not.toBe(
      pullRequestProjectKey({
        environmentId: "a" as EnvironmentId,
        id: "b c" as ProjectId,
      }),
    );
  });
});
