// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type { ProjectContextInput, ProjectIndexScopeV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const Cursor = Schema.Struct({
  version: Schema.Literal(2),
  scope: Schema.String,
  revision: Schema.Int,
  query: Schema.String,
  stage: Schema.Int,
  afterId: Schema.NullOr(Schema.String),
  afterKind: Schema.NullOr(Schema.String),
  afterRank: Schema.NullOr(Schema.Finite),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeCursor = Schema.decodeUnknownSync(Schema.fromJsonString(Cursor));
const ENTITY_CONTEXT_LAYOUT_VERSION = 3;
const SEARCH_RECORD_KINDS = new Set(["entities", "imports", "modules", "rules"]);

export interface ProjectContextPosition {
  readonly stage: number;
  readonly afterId: string | null;
  readonly afterKind?: string | null;
  readonly afterRank?: number | null;
}

function fingerprint(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function cursorIdentity(scope: ProjectIndexScopeV1, input: ProjectContextInput) {
  return {
    scope: fingerprint([scope.scopeId, scope.workspaceFingerprint]),
    query: fingerprint([
      input.operation,
      ...(input.operation === "entity" ? [ENTITY_CONTEXT_LAYOUT_VERSION] : []),
      input.text ?? null,
      input.entityId ?? null,
      [...(input.scopes ?? [])].sort(),
      input.includeStale ?? false,
    ]),
  };
}

export function encodeProjectContextCursor(
  scope: ProjectIndexScopeV1,
  input: ProjectContextInput,
  revision: number,
  position: ProjectContextPosition,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 2,
      ...cursorIdentity(scope, input),
      revision,
      stage: position.stage,
      afterId: position.afterId,
      afterKind: position.afterKind ?? null,
      afterRank: position.afterRank ?? null,
    }),
  ).toString("base64url");
}

export function decodeProjectContextCursor(
  scope: ProjectIndexScopeV1,
  input: ProjectContextInput,
  revision: number,
): ProjectContextPosition | null {
  if (input.cursor === undefined)
    return { stage: 0, afterId: null, afterKind: null, afterRank: null };
  if (input.cursor.length > 8_192) return null;
  try {
    const decoded = decodeCursor(Buffer.from(input.cursor, "base64url").toString("utf8"));
    const identity = cursorIdentity(scope, input);
    if (
      decoded.scope !== identity.scope ||
      decoded.query !== identity.query ||
      decoded.revision !== revision ||
      decoded.stage < 0 ||
      (decoded.afterId?.length ?? 0) > 512 ||
      (decoded.afterKind?.length ?? 0) > 32 ||
      (decoded.afterKind !== null && !SEARCH_RECORD_KINDS.has(decoded.afterKind)) ||
      (decoded.afterKind !== null && input.operation !== "task" && input.operation !== "search") ||
      (decoded.afterId === null && (decoded.afterKind !== null || decoded.afterRank !== null)) ||
      (decoded.afterKind === null) !== (decoded.afterRank === null)
    )
      return null;
    return {
      stage: decoded.stage,
      afterId: decoded.afterId,
      afterKind: decoded.afterKind,
      afterRank: decoded.afterRank,
    };
  } catch {
    return null;
  }
}
