import { ProjectIndexOperationError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { KnowledgeGraphScopeResolutionError } from "../../knowledge-graph/runtime/KnowledgeGraphScopeCatalog.ts";

const isScopeError = Schema.is(KnowledgeGraphScopeResolutionError);

export function projectIndexScopeError(error: unknown): ProjectIndexOperationError {
  if (isScopeError(error)) {
    switch (error.reason) {
      case "workspace-root-protected":
        return new ProjectIndexOperationError({
          code: "invalid-request",
          message:
            "Choose a project folder for indexing. Home directories and filesystem roots cannot be indexed.",
          retryable: false,
        });
      case "workspace-root-unavailable":
        return new ProjectIndexOperationError({
          code: "scope-mismatch",
          message:
            "This project's folder is unavailable in the selected environment. Check its path and access permissions.",
          retryable: true,
        });
      case "project-not-found":
        return new ProjectIndexOperationError({
          code: "scope-mismatch",
          message: "This project is no longer available. Select a project in this environment.",
          retryable: false,
        });
      case "thread-not-found":
      case "thread-project-mismatch":
        return new ProjectIndexOperationError({
          code: "scope-mismatch",
          message: "This worktree is no longer associated with the selected project.",
          retryable: false,
        });
    }
  }
  return new ProjectIndexOperationError({
    code: "scope-mismatch",
    message: "The selected project's workspace could not be resolved.",
    retryable: true,
  });
}
