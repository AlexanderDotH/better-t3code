import type { ProjectCallsiteV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProjectContextReader } from "./ProjectContextSources.ts";
import type { KnowledgeStoreError } from "../persistence/KnowledgeStore.ts";

export const PROJECT_CONTEXT_MAX_IMPACT_DEPTH = 3;
export const PROJECT_CONTEXT_MAX_IMPACT_CALLSITES = 200;

/** Impact follows confirmed incoming calls. Candidate calls remain visible evidence. */
export const projectContextImpact = Effect.fn("ProjectContextQuery.impact")(function* (
  reader: ProjectContextReader,
  entityId: string,
  revision: number,
  validateCall?: (callsite: ProjectCallsiteV1) => Effect.Effect<boolean, KnowledgeStoreError>,
) {
  const pending = [{ entityId, depth: 0 }];
  const visited = new Set([entityId]);
  const callsites = new Map<string, ProjectCallsiteV1>();
  let truncated = false;
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index];
    if (!current) continue;
    if (current.depth >= PROJECT_CONTEXT_MAX_IMPACT_DEPTH) {
      truncated = true;
      continue;
    }
    const remaining = PROJECT_CONTEXT_MAX_IMPACT_CALLSITES - callsites.size;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const page = yield* reader.listCalls({
      entityIds: [current.entityId],
      direction: "callers",
      revision,
      limit: remaining,
    });
    if (page.nextCursor !== null) truncated = true;
    for (const callsite of page.items) {
      callsites.set(callsite.id, callsite);
      if (
        callsite.freshness !== "current" ||
        (validateCall !== undefined && !(yield* validateCall(callsite)))
      )
        continue;
      if (
        callsite.resolution !== "resolved" ||
        callsite.callerEntityId === undefined ||
        visited.has(callsite.callerEntityId)
      )
        continue;
      visited.add(callsite.callerEntityId);
      pending.push({ entityId: callsite.callerEntityId, depth: current.depth + 1 });
    }
  }
  return {
    callsites: [...callsites.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
    truncated,
  };
});
