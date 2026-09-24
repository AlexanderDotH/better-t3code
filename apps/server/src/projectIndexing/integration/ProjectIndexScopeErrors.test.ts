import { describe, expect, it } from "@effect/vitest";

import { KnowledgeGraphScopeResolutionError } from "../../knowledge-graph/runtime/KnowledgeGraphScopeCatalog.ts";
import { projectIndexScopeError } from "./ProjectIndexScopeErrors.ts";

describe("project indexing workspace diagnostics", () => {
  it("explains protected roots without recommending a connection retry", () => {
    const error = projectIndexScopeError(
      new KnowledgeGraphScopeResolutionError({ reason: "workspace-root-protected" }),
    );
    expect(error.code).toBe("invalid-request");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("Choose a project folder");
    expect(error.message).toContain("Home directories");
  });

  it("distinguishes unavailable folders from removed projects and worktrees", () => {
    const missing = projectIndexScopeError(
      new KnowledgeGraphScopeResolutionError({ reason: "workspace-root-unavailable" }),
    );
    expect(missing.retryable).toBe(true);
    expect(missing.message).toContain("path and access permissions");
    for (const reason of [
      "project-not-found",
      "thread-not-found",
      "thread-project-mismatch",
    ] as const) {
      expect(
        projectIndexScopeError(new KnowledgeGraphScopeResolutionError({ reason })).retryable,
      ).toBe(false);
    }
  });
});
