import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  CommandId,
  SourceControlDiscoveryResult,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  buildAddProjectRemoteSourceReadiness,
  buildProjectCreateCommand,
  canCreateProjectInEnvironment,
  findExistingAddProject,
  getAddProjectInitialQuery,
  resolveAddProjectPath,
  resolveCloneDestinationPath,
  sortAddProjectProviderSources,
} from "./projects.ts";
import type { EnvironmentProject } from "../state/models.ts";

describe("add project shared logic", () => {
  it("only allows project creation in connected environments", () => {
    expect(canCreateProjectInEnvironment("connected")).toBe(true);
    expect(canCreateProjectInEnvironment("available")).toBe(false);
    expect(canCreateProjectInEnvironment("offline")).toBe(false);
    expect(canCreateProjectInEnvironment("connecting")).toBe(false);
    expect(canCreateProjectInEnvironment("reconnecting")).toBe(false);
    expect(canCreateProjectInEnvironment("error")).toBe(false);
  });

  it("resolves initial browse paths from settings", () => {
    expect(getAddProjectInitialQuery("")).toBe("~/");
    expect(getAddProjectInitialQuery("/work")).toBe("/work/");
    expect(getAddProjectInitialQuery("C:\\work")).toBe("C:\\work\\");
  });

  it("rejects unsupported windows paths on non-windows environments", () => {
    expect(
      resolveAddProjectPath({
        rawPath: "C:\\repo",
        platform: "MacIntel",
        currentProjectCwd: null,
      }),
    ).toEqual({
      ok: false,
      error: "Windows-style paths are only supported on Windows environments.",
    });
  });

  it("resolves relative paths from the active project cwd", () => {
    expect(
      resolveAddProjectPath({
        rawPath: "../next",
        platform: "Linux",
        currentProjectCwd: "/work/current",
      }),
    ).toEqual({ ok: true, path: "/work/next" });
  });

  it("clones into a repository-named child of a selected parent folder", () => {
    expect(
      resolveCloneDestinationPath({
        rawPath: "/work/",
        platform: "Linux",
        destinationIsParent: true,
        repositoryNameWithOwner: "t3-oss/t3-env",
        remoteUrl: "git@github.com:t3-oss/t3-env.git",
      }),
    ).toEqual({ ok: true, path: "/work/t3-env" });
    expect(
      resolveCloneDestinationPath({
        rawPath: "/work",
        platform: "Linux",
        destinationIsParent: true,
        repositoryNameWithOwner: "t3-oss/t3-env",
        remoteUrl: "git@github.com:t3-oss/t3-env.git",
      }),
    ).toEqual({ ok: true, path: "/work/t3-env" });
  });

  it("derives repository folders from HTTPS and SCP-style clone URLs", () => {
    expect(
      resolveCloneDestinationPath({
        rawPath: "/work/",
        platform: "Linux",
        destinationIsParent: true,
        repositoryNameWithOwner: null,
        remoteUrl: "https://git.example.com/team/repository.git?ref=main#readme",
      }),
    ).toEqual({ ok: true, path: "/work/repository" });
    expect(
      resolveCloneDestinationPath({
        rawPath: "/work/",
        platform: "Linux",
        destinationIsParent: true,
        repositoryNameWithOwner: null,
        remoteUrl: "git@git.example.com:team/other-repository.git",
      }),
    ).toEqual({ ok: true, path: "/work/other-repository" });
  });

  it("preserves an explicitly typed clone destination", () => {
    expect(
      resolveCloneDestinationPath({
        rawPath: "/work/custom-name",
        platform: "Linux",
        destinationIsParent: false,
        repositoryNameWithOwner: "t3-oss/t3-env",
        remoteUrl: "git@github.com:t3-oss/t3-env.git",
      }),
    ).toEqual({ ok: true, path: "/work/custom-name" });
  });

  it("uses the selected environment's path separator for the clone child", () => {
    expect(
      resolveCloneDestinationPath({
        rawPath: "C:\\Work\\",
        platform: "Win32",
        destinationIsParent: true,
        repositoryNameWithOwner: "t3-oss/t3-env",
        remoteUrl: "git@github.com:t3-oss/t3-env.git",
      }),
    ).toEqual({ ok: true, path: "C:\\Work\\t3-env" });
  });

  it("marks authenticated source control providers as ready", () => {
    const discovery: SourceControlDiscoveryResult = {
      versionControlSystems: [],
      sourceControlProviders: [
        {
          kind: "github",
          label: "GitHub",
          status: "available",
          installHint: "Install gh",
          version: Option.some("1.0.0"),
          detail: Option.none(),
          auth: {
            status: "authenticated",
            account: Option.some("octo"),
            host: Option.some("github.com"),
            detail: Option.none(),
          },
        },
        {
          kind: "gitlab",
          label: "GitLab",
          status: "available",
          installHint: "Install glab",
          version: Option.some("1.0.0"),
          detail: Option.none(),
          auth: {
            status: "unauthenticated",
            account: Option.none(),
            host: Option.none(),
            detail: Option.some("Run glab auth login"),
          },
        },
      ],
    };

    const readiness = buildAddProjectRemoteSourceReadiness(discovery);
    expect(readiness.url.ready).toBe(true);
    expect(readiness.github.ready).toBe(true);
    expect(readiness.gitlab).toEqual({ ready: false, hint: "Run glab auth login" });
    expect(sortAddProjectProviderSources(readiness)[0]).toBe("github");
  });

  it("finds existing projects by normalized path in the target environment", () => {
    const env = EnvironmentId.make("env");
    const other = EnvironmentId.make("other");
    const projects: EnvironmentProject[] = [
      {
        environmentId: other,
        id: ProjectId.make("same-path-other-env"),
        title: "Other",
        workspaceRoot: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
      {
        environmentId: env,
        id: ProjectId.make("project"),
        title: "Repo",
        workspaceRoot: "/repo/",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
    ];

    expect(findExistingAddProject({ projects, environmentId: env, path: "/repo" })?.id).toBe(
      "project",
    );
  });

  it("builds the existing project.create command shape", () => {
    expect(
      buildProjectCreateCommand({
        commandId: CommandId.make("command"),
        projectId: ProjectId.make("project"),
        workspaceRoot: "/work/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      type: "project.create",
      commandId: "command",
      projectId: "project",
      title: "repo",
      workspaceRoot: "/work/repo",
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: null,
    });
  });
});
