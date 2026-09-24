import { normalizeProjectIndexTokenBudget } from "@t3tools/client-runtime/project-indexing";
import {
  PROJECT_INDEX_MAX_QUERY_TOKENS,
  type ProjectContextInput,
  type ProjectEntityV1,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";

type EntityContext = Pick<ProjectIndexQueryResultV1, "scope" | "revision" | "entities">;

export interface MobileProjectIndexEntityAnchor {
  readonly entity: ProjectEntityV1;
  readonly scope: ProjectIndexQueryResultV1["scope"];
  readonly revision: number;
}

export function captureMobileProjectIndexEntity(
  result: EntityContext,
  entityId: string,
): MobileProjectIndexEntityAnchor | null {
  const entity = result.entities.find((candidate) => candidate.id === entityId);
  return entity ? { entity, scope: result.scope, revision: result.revision } : null;
}

export function resolveMobileProjectIndexEntity(
  result: EntityContext,
  entityId: string,
  anchor: MobileProjectIndexEntityAnchor | null,
): ProjectEntityV1 | null {
  const current = result.entities.find((candidate) => candidate.id === entityId);
  if (current) return current;
  if (
    !anchor ||
    anchor.entity.id !== entityId ||
    anchor.revision !== result.revision ||
    anchor.scope.scopeId !== result.scope.scopeId ||
    anchor.scope.workspaceFingerprint !== result.scope.workspaceFingerprint
  )
    return null;
  return { ...anchor.entity, freshness: "unknown" };
}

export function nextMobileProjectIndexEntityContext(input: {
  readonly entityId: string;
  readonly request: ProjectContextInput;
  readonly result: Pick<ProjectIndexQueryResultV1, "truncated" | "nextCursor">;
}):
  | (ProjectContextInput & {
      readonly operation: "entity";
      readonly entityId: string;
      readonly maxTokens: number;
    })
  | null {
  const maxTokens = normalizeProjectIndexTokenBudget(input.request.maxTokens);
  const request = {
    operation: "entity" as const,
    entityId: input.entityId,
    maxTokens,
    ...(input.request.limit === undefined ? {} : { limit: input.request.limit }),
    ...(input.request.scopes === undefined ? {} : { scopes: input.request.scopes }),
    ...(input.request.includeStale === undefined
      ? {}
      : { includeStale: input.request.includeStale }),
  };
  if (input.request.operation !== "entity" || input.request.entityId !== input.entityId)
    return request;
  if (input.result.nextCursor && input.result.nextCursor !== input.request.cursor)
    return { ...request, cursor: input.result.nextCursor };
  if (!input.result.truncated || maxTokens >= PROJECT_INDEX_MAX_QUERY_TOKENS) return null;
  return { ...request, maxTokens: Math.min(PROJECT_INDEX_MAX_QUERY_TOKENS, maxTokens * 2) };
}
