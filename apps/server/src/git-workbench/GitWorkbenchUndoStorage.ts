import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { GitWorkbenchUndoSnapshot } from "./GitWorkbenchUndoService.ts";

export class GitWorkbenchUndoStorageError extends Data.TaggedError("GitWorkbenchUndoStorageError")<{
  readonly operation: "get" | "insert" | "list" | "remove";
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export class GitWorkbenchUndoStorage extends Context.Service<
  GitWorkbenchUndoStorage,
  {
    readonly insert: (
      snapshot: GitWorkbenchUndoSnapshot,
    ) => Effect.Effect<void, GitWorkbenchUndoStorageError>;
    readonly get: (
      cwd: string,
      id: string,
    ) => Effect.Effect<GitWorkbenchUndoSnapshot | null, GitWorkbenchUndoStorageError>;
    readonly list: (
      cwd: string,
    ) => Effect.Effect<readonly GitWorkbenchUndoSnapshot[], GitWorkbenchUndoStorageError>;
    readonly remove: (cwd: string, id: string) => Effect.Effect<void, GitWorkbenchUndoStorageError>;
  }
>()("t3/git-workbench/GitWorkbenchUndoStorage") {}
