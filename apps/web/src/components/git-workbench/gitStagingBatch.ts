import type {
  GitApplyChangeSelectionInput,
  GitApplyChangeSelectionResult,
  GitChangesDiffInput,
  GitChangesDiffResult,
  GitWorkbenchSnapshot,
} from "@t3tools/contracts";

interface GitStagingBatchProgress {
  readonly completedPaths: readonly string[];
  readonly skippedPaths: readonly string[];
}

export type GitStagingBatchResult = GitStagingBatchProgress &
  (
    | { readonly status: "completed" }
    | {
        readonly status: "stopped";
        readonly path: string;
        readonly reason: "cancelled" | "conflicted" | "error" | "operation" | "stale";
        readonly error?: unknown;
      }
  );

export async function setGitFilesStaged(input: {
  readonly paths: readonly string[];
  readonly staged: boolean;
  readonly expectedStateToken: string;
  readonly refreshSnapshot: () => Promise<GitWorkbenchSnapshot>;
  readonly readDiff: (request: Omit<GitChangesDiffInput, "cwd">) => Promise<GitChangesDiffResult>;
  readonly applyFile: (
    request: Omit<GitApplyChangeSelectionInput, "cwd">,
  ) => Promise<GitApplyChangeSelectionResult>;
  readonly canContinue: () => boolean;
}): Promise<GitStagingBatchResult> {
  let expectedStateToken = input.expectedStateToken;
  const completedPaths: string[] = [];
  const skippedPaths: string[] = [];
  const stopped = (
    path: string,
    reason: Extract<GitStagingBatchResult, { status: "stopped" }>["reason"],
    error?: unknown,
  ): GitStagingBatchResult => ({
    completedPaths,
    skippedPaths,
    status: "stopped",
    path,
    reason,
    ...(error === undefined ? {} : { error }),
  });

  for (const path of new Set(input.paths)) {
    if (!input.canContinue()) return stopped(path, "cancelled");
    try {
      const snapshot = await input.refreshSnapshot();
      if (!input.canContinue()) return stopped(path, "cancelled");
      if (
        !snapshot.isRepository ||
        snapshot.truncated ||
        snapshot.stateToken !== expectedStateToken
      ) {
        return stopped(path, "stale");
      }
      if (snapshot.operation.kind !== "none") return stopped(path, "operation");
      const file = snapshot.files.find((candidate) => candidate.path === path);
      if (file?.conflicted) return stopped(path, "conflicted");
      const needsChange = input.staged ? file?.unstaged || file?.untracked : file?.staged;
      if (!needsChange) {
        skippedPaths.push(path);
        continue;
      }
      const source = input.staged ? "unstaged" : "staged";
      const diff = await input.readDiff({
        expectedStateToken: snapshot.stateToken,
        path,
        source,
      });
      if (!input.canContinue()) return stopped(path, "cancelled");
      if (diff.path !== path || diff.source !== source || diff.stateToken !== snapshot.stateToken) {
        return stopped(path, "stale");
      }
      const applied = await input.applyFile({
        action: input.staged ? "stage" : "unstage",
        expectedPatchId: diff.patchId,
        expectedStateToken: snapshot.stateToken,
        path,
        selection: { kind: "file" },
        source,
      });
      expectedStateToken = applied.snapshot.stateToken;
      completedPaths.push(path);
    } catch (error) {
      return stopped(path, "error", error);
    }
  }
  return { completedPaths, skippedPaths, status: "completed" };
}
