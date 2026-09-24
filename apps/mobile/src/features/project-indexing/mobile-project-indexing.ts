import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  PROJECT_INDEX_DEFAULT_QUERY_TOKENS,
  type AuthSessionState,
  type EnvironmentId,
  type ProjectContextInput,
  type ProjectId,
  type ProjectIndexScopeInput,
  type ProjectIndexReviewFindingV1,
  type ThreadId,
} from "@t3tools/contracts";
import { normalizeProjectIndexTokenBudget } from "@t3tools/client-runtime/project-indexing";

const MOBILE_PROJECT_INDEX_QUERY_LIMIT = 80;

export function mobileProjectIndexPermissions(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null,
) {
  return {
    canRead:
      session?.authenticated === true &&
      session.scopes?.includes(AuthOrchestrationReadScope) === true,
    canOperate:
      session?.authenticated === true &&
      session.scopes?.includes(AuthOrchestrationOperateScope) === true,
  };
}

export function mobileProjectIndexQuery(input: {
  readonly text: string;
  readonly selection: {
    readonly entityId: string;
    readonly operation: "entity" | "callers" | "callees";
  } | null;
  readonly cursor?: string;
  readonly maxTokens?: number;
}): ProjectContextInput {
  const text = input.text.trim();
  return {
    ...(input.selection ?? (text ? { operation: "search", text } : { operation: "overview" })),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: MOBILE_PROJECT_INDEX_QUERY_LIMIT,
    maxTokens: input.selection
      ? normalizeProjectIndexTokenBudget(input.maxTokens)
      : PROJECT_INDEX_DEFAULT_QUERY_TOKENS,
    includeStale: true,
  };
}

export function mobileProjectIndexSourceRequest(input: {
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly project: {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  } | null;
  readonly thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
  } | null;
  readonly source: {
    readonly filePath: string;
    readonly sourceSide?: ProjectIndexReviewFindingV1["sourceSide"];
  };
}) {
  if (input.source.sourceSide === "before") return null;
  if (
    !input.project ||
    input.project.environmentId !== input.environmentId ||
    input.project.id !== input.scope.projectId
  )
    return null;
  let cwd = input.project.workspaceRoot;
  if (input.scope.threadId) {
    if (
      !input.thread ||
      input.thread.id !== input.scope.threadId ||
      input.thread.environmentId !== input.environmentId ||
      input.thread.projectId !== input.scope.projectId
    )
      return null;
    cwd = input.thread.worktreePath ?? cwd;
  }
  return {
    environmentId: input.environmentId,
    input: { cwd, relativePath: input.source.filePath },
  };
}
