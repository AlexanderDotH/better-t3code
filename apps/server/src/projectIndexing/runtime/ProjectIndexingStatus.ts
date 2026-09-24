import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  EMPTY_PROJECT_INDEX_USAGE,
  type ProjectIndexScopeV1,
  type ProjectIndexState,
  type ProjectIndexStatusV1,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { KnowledgeStore } from "../persistence/KnowledgeStore.ts";
import { decodeProjectIndexGenerationMetadata } from "./ProjectIndexingMetadata.ts";

const STATUS_GAP_LIMIT = 32;

export function emptyProjectIndexStatus(
  scope: ProjectIndexScopeV1,
  now: string,
): ProjectIndexStatusV1 {
  return {
    version: 1,
    scope,
    revision: 0,
    state: "disabled",
    settings: DEFAULT_PROJECT_INDEX_SETTINGS,
    job: null,
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    gaps: [],
    updatedAt: now,
  };
}

export const readProjectIndexStatus = Effect.fn("readProjectIndexStatus")(function* (
  store: KnowledgeStore,
  scope: ProjectIndexScopeV1,
  liveState?: ProjectIndexState,
) {
  const state = yield* store.getState();
  const revision = state.activeRevision ?? state.publishedRevision ?? 0;
  const metadataJson = revision === 0 ? null : yield* store.getGenerationMetadata(revision);
  const metadata =
    metadataJson === null
      ? null
      : yield* decodeProjectIndexGenerationMetadata(metadataJson).pipe(
          Effect.orElseSucceed(() => null),
        );
  const staticGeneration = metadata?.knowledgeFormat === "static-v1";
  const summary = revision === 0 || !staticGeneration ? [] : yield* store.getJobsSummary(revision);
  const units = { pending: 0, running: 0, completed: 0, failed: 0, stale: 0, cancelled: 0 };
  for (const item of summary) units[item.state] += item.count;
  const gapPage =
    revision === 0 || !staticGeneration
      ? null
      : yield* store.listRecords({ revision, kind: "gaps", limit: STATUS_GAP_LIMIT });
  const gaps = [...(gapPage?.items ?? [])];
  if (metadataJson !== null && metadata === null)
    gaps.push({
      id: "runtime:invalid-metadata",
      kind: "incomplete-analysis",
      message:
        "The saved indexing checkpoint is invalid. Rebuild to recover; existing published knowledge was preserved.",
      retryable: true,
    });
  if (gapPage?.nextCursor !== null && gapPage?.nextCursor !== undefined) {
    gaps.splice(STATUS_GAP_LIMIT - 1, gaps.length - STATUS_GAP_LIMIT + 1, {
      id: "runtime:additional-gaps",
      kind: "limit",
      message: "Additional coverage gaps are available through project context queries.",
      retryable: false,
    });
  }
  const incomplete =
    (staticGeneration && metadata?.incomplete === true) ||
    units.failed > 0 ||
    gaps.some((gap) =>
      [
        "provider-error",
        "stale-source",
        "incomplete-analysis",
        "parse-error",
        "unsupported-language",
      ].includes(gap.kind),
    );
  const status: ProjectIndexState = !state.settings.enabled
    ? "disabled"
    : (liveState ??
      (state.status === "paused"
        ? "paused"
        : state.status === "cancelled"
          ? "cancelled"
          : state.status === "completed"
            ? !staticGeneration
              ? "idle"
              : incomplete
                ? "partial"
                : "ready"
            : state.status === "running"
              ? "queued"
              : "idle"));
  const updatedAt = DateTime.formatIso(DateTime.makeUnsafe(state.updatedAt));
  return {
    version: 1,
    scope,
    revision: state.revision,
    state: status,
    settings: state.settings,
    coverage: staticGeneration
      ? (metadata?.coverage ?? EMPTY_PROJECT_INDEX_COVERAGE)
      : EMPTY_PROJECT_INDEX_COVERAGE,
    gaps: gaps.slice(0, 200),
    updatedAt,
    ...(!staticGeneration || metadata?.lastError === undefined
      ? {}
      : { lastError: metadata.lastError }),
    job:
      !staticGeneration || metadata === null
        ? null
        : {
            id: `generation:${scope.scopeId}:${revision}`,
            generationId: `generation:${scope.scopeId}:${revision}`,
            kind: metadata.kind,
            state:
              state.status === "paused"
                ? "paused"
                : state.status === "cancelled"
                  ? "cancelled"
                  : state.status === "completed"
                    ? incomplete
                      ? "failed"
                      : "completed"
                    : units.running > 0 || liveState !== undefined
                      ? "running"
                      : "queued",
            phase: metadata.phase,
            revision,
            units,
            modelSelection: metadata.modelSelection,
            usage: metadata.usage ?? EMPTY_PROJECT_INDEX_USAGE,
            startedAt: metadata.startedAt,
            updatedAt,
            ...(state.status === "completed" ? { completedAt: updatedAt } : {}),
            ...(metadata.lastError === undefined ? {} : { lastError: metadata.lastError }),
          },
  } satisfies ProjectIndexStatusV1;
});
