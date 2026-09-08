import type { EnvironmentId } from "@t3tools/contracts";

export interface GitWorkbenchRepositoryScope {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export interface GitWorkbenchHistoryScope extends GitWorkbenchRepositoryScope {
  readonly snapshotOid?: string | null;
  readonly ref?: string | null;
  readonly cursor?: string | number | null;
  readonly limit?: number;
  readonly path?: string | null;
}

export interface GitWorkbenchCommitScope extends GitWorkbenchRepositoryScope {
  readonly oid: string;
  readonly path?: string | null;
}

export function gitWorkbenchRepositoryKey(scope: GitWorkbenchRepositoryScope): string {
  return JSON.stringify([scope.environmentId, scope.cwd]);
}

export function gitWorkbenchHistoryKey(scope: GitWorkbenchHistoryScope): string {
  return JSON.stringify([
    scope.environmentId,
    scope.cwd,
    scope.snapshotOid ?? null,
    scope.ref ?? null,
    scope.cursor ?? null,
    scope.limit ?? null,
    scope.path ?? null,
  ]);
}

export function gitWorkbenchCommitKey(scope: GitWorkbenchCommitScope): string {
  return JSON.stringify([scope.environmentId, scope.cwd, scope.oid, scope.path ?? null]);
}
