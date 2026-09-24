import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileProjectIndexPermissions,
  mobileProjectIndexQuery,
  mobileProjectIndexSourceRequest,
} from "./mobile-project-indexing";

const localEnvironment = EnvironmentId.make("local");
const remoteEnvironment = EnvironmentId.make("remote");
const projectId = ProjectId.make("same-project-id");
const remoteProject = { environmentId: remoteEnvironment, id: projectId, title: "Alpha" };

describe("mobile project indexing permissions and queries", () => {
  it("allows read-only inspection while keeping lifecycle actions unavailable", () => {
    expect(mobileProjectIndexPermissions(null)).toEqual({ canRead: false, canOperate: false });
    expect(
      mobileProjectIndexPermissions({ authenticated: true, scopes: [AuthOrchestrationReadScope] }),
    ).toEqual({ canRead: true, canOperate: false });
    expect(
      mobileProjectIndexPermissions({
        authenticated: true,
        scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
      }),
    ).toEqual({ canRead: true, canOperate: true });
  });

  it("uses bounded search and caller requests without leaking project scope into the request body", () => {
    expect(mobileProjectIndexQuery({ text: "  SomeClass  ", selection: null })).toEqual({
      operation: "search",
      text: "SomeClass",
      limit: 80,
      maxTokens: 6_000,
      includeStale: true,
    });
    expect(
      mobileProjectIndexQuery({
        text: "old search",
        selection: { entityId: "method-1", operation: "callers" },
        cursor: "next-page",
      }),
    ).toEqual({
      operation: "callers",
      entityId: "method-1",
      cursor: "next-page",
      limit: 80,
      maxTokens: 6_000,
      includeStale: true,
    });
    expect(mobileProjectIndexQuery({ text: "   ", selection: null }).operation).toBe("overview");
  });
});

describe("mobile project indexing source navigation", () => {
  const threadId = ThreadId.make("thread-1");
  const project = { ...remoteProject, workspaceRoot: "/server/project" };
  const source = { filePath: "src/index.ts" };

  it("opens project source through its owning environment without an active thread", () => {
    expect(
      mobileProjectIndexSourceRequest({
        environmentId: remoteEnvironment,
        scope: { projectId },
        project,
        thread: null,
        source,
      }),
    ).toEqual({
      environmentId: "remote",
      input: { cwd: "/server/project", relativePath: "src/index.ts" },
    });
  });

  it("uses the selected thread's worktree without falling back to another thread", () => {
    const thread = {
      environmentId: remoteEnvironment,
      id: threadId,
      projectId,
      worktreePath: "/server/worktree",
    };
    expect(
      mobileProjectIndexSourceRequest({
        environmentId: remoteEnvironment,
        scope: { projectId, threadId },
        project,
        thread,
        source,
      }),
    ).toEqual({
      environmentId: "remote",
      input: { cwd: "/server/worktree", relativePath: "src/index.ts" },
    });
    for (const wrongThread of [
      null,
      { ...thread, environmentId: localEnvironment },
      { ...thread, projectId: ProjectId.make("other-project") },
    ]) {
      expect(
        mobileProjectIndexSourceRequest({
          environmentId: remoteEnvironment,
          scope: { projectId, threadId },
          project,
          thread: wrongThread,
          source,
        }),
      ).toBeNull();
    }
  });

  it("does not read from a project on another environment", () => {
    expect(
      mobileProjectIndexSourceRequest({
        environmentId: localEnvironment,
        scope: { projectId },
        project,
        thread: null,
        source,
      }),
    ).toBeNull();
  });

  it("does not open current source for findings anchored to the old side of a diff", () => {
    expect(
      mobileProjectIndexSourceRequest({
        environmentId: remoteEnvironment,
        scope: { projectId },
        project,
        thread: null,
        source: { ...source, sourceSide: "before" },
      }),
    ).toBeNull();
    expect(
      mobileProjectIndexSourceRequest({
        environmentId: remoteEnvironment,
        scope: { projectId },
        project,
        thread: null,
        source: { ...source, sourceSide: "after" },
      }),
    ).toEqual({
      environmentId: "remote",
      input: { cwd: "/server/project", relativePath: "src/index.ts" },
    });
  });
});
