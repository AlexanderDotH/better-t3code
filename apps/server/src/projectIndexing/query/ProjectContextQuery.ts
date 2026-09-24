import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  ProjectContextInput,
  ProjectIndexOperationError,
  type ProjectIndexQueryInput,
  type ProjectIndexQueryResultV1,
  type ProjectIndexScopeV1,
  type ProjectIndexQueryVerificationV1,
  type ProjectEntityV1,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as References from "effect/References";

import { isWithinWorkspaceContextScopes } from "../../workspace/WorkspaceContextPathPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { readProjectIndexDefaults } from "../integration/ProjectIndexDefaults.ts";
import { openExistingKnowledgeKvStore } from "../persistence/KnowledgeStoreKv.ts";
import { isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
import { ProjectIndexingBridge } from "../runtime/ProjectIndexingBridge.ts";
import {
  measureProjectContextResult,
  projectContextResultFits,
  projectContextTokenBudget,
} from "./ProjectContextBudget.ts";
import {
  decodeProjectContextCursor,
  encodeProjectContextCursor,
  type ProjectContextPosition,
} from "./ProjectContextCursor.ts";
import {
  makeProjectContextRetrieval,
  type ProjectContextRecordKind,
} from "./ProjectContextRetrieval.ts";
import {
  makeProjectContextSourceValidator,
  projectContextGap,
  type ProjectContextHashReader,
  type ProjectContextReader,
  type ProjectContextRecord,
} from "./ProjectContextSources.ts";
import { readProjectIndexGraphOverview } from "./ProjectIndexGraphOverview.ts";

const MAX_CANDIDATES_PER_QUERY = 100;
const DEFAULT_PRIMARY_RECORDS = 20;
const decodeContextInput = Schema.decodeEffect(ProjectContextInput);
const isProjectIndexOperationError = Schema.is(ProjectIndexOperationError);
const CONTEXT_GUIDANCE =
  "Indexed source facts guide original-source reads. AGENTS instructions take precedence. Confirmed static calls and resolved imports do not prove runtime execution; candidate or unresolved relationships remain gaps. This query did not run tests, checks, or a code review.";

function queryError(code: ProjectIndexOperationError["code"], message: string, retryable = false) {
  return new ProjectIndexOperationError({ code, message, retryable });
}

function emptyResult(
  scope: ProjectIndexScopeV1,
  input: ProjectContextInput,
): ProjectIndexQueryResultV1 {
  return {
    version: 1,
    scope,
    revision: 0,
    operation: input.operation,
    summary: CONTEXT_GUIDANCE,
    entities: [],
    callsites: [],
    imports: [],
    modules: [],
    behaviors: [],
    flows: [],
    rules: [],
    evidence: [],
    gaps: [],
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    nextCursor: null,
    truncated: false,
    estimatedTokens: 0,
  };
}

function mergeRecords<Record extends { readonly id: string }>(
  current: ReadonlyArray<Record>,
  additions: ReadonlyArray<Record>,
): ReadonlyArray<Record> {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const addition of additions)
    if (!records.has(addition.id)) records.set(addition.id, addition);
  return [...records.values()];
}

function appendCheckedRecord(
  result: ProjectIndexQueryResultV1,
  kind: ProjectContextRecordKind,
  record: ProjectContextRecord,
  evidence: ProjectIndexQueryResultV1["evidence"],
  verificationFor: (
    records: ReadonlyArray<ProjectContextRecord>,
  ) => ProjectIndexQueryVerificationV1,
): ProjectIndexQueryResultV1 {
  let next = {
    ...result,
    [kind]: mergeRecords<ProjectContextRecord>(result[kind] ?? [], [record]),
    evidence: mergeRecords(result.evidence, evidence),
  };
  if (kind === "rules" && "appliesToEntityIds" in record) {
    const applicableEntityIds = record.appliesToEntityIds;
    next = {
      ...next,
      rules: next.rules.map((rule) =>
        rule.id === record.id
          ? {
              ...rule,
              appliesToEntityIds: [
                ...new Set([...rule.appliesToEntityIds, ...applicableEntityIds]),
              ],
            }
          : rule,
      ),
    };
  }
  return {
    ...next,
    verification: verificationFor([
      ...next.entities,
      ...next.callsites,
      ...(next.imports ?? []),
      ...next.modules,
      ...next.behaviors,
      ...next.flows,
      ...next.rules,
    ]),
  };
}

function appendGaps(
  result: ProjectIndexQueryResultV1,
  gaps: ProjectIndexQueryResultV1["gaps"],
  budget: number,
): ProjectIndexQueryResultV1 {
  let next = result;
  for (const gap of gaps) {
    const candidate = { ...next, gaps: mergeRecords(next.gaps, [gap]), truncated: true };
    if (projectContextResultFits(candidate, budget)) next = candidate;
    else next = { ...next, truncated: true };
  }
  return next;
}

export const queryProjectContext = Effect.fn("ProjectContextQuery.queryProjectContext")(
  function* (request: {
    readonly scope: ProjectIndexScopeV1;
    readonly workspaceRoot: string;
    readonly input: ProjectContextInput;
    readonly reader: ProjectContextReader | null;
    readonly readHash?: ProjectContextHashReader;
  }) {
    const input = yield* decodeContextInput(request.input).pipe(
      Effect.mapError(() =>
        queryError("invalid-request", "The project context request is invalid."),
      ),
    );
    const budget = projectContextTokenBudget(input.maxTokens);
    let result = emptyResult(request.scope, input);
    if (!projectContextResultFits(result, budget)) {
      return yield* queryError(
        "invalid-request",
        "The token budget is too small for this scope's response metadata. Increase maxTokens.",
      );
    }
    const reader = request.reader;
    const state = reader === null ? null : yield* reader.getState();
    if (state && state.workspaceId !== request.scope.workspaceFingerprint) {
      return yield* queryError(
        "scope-mismatch",
        "The index does not belong to the authenticated workspace.",
      );
    }
    if (state && !state.settings.enabled) {
      return yield* queryError(
        "disabled",
        "Project Indexing is disabled for this workspace. Use workspace_find and workspace_read.",
      );
    }
    if (reader === null || state === null || state.publishedRevision === null) {
      result = {
        ...result,
        summary:
          "No published project index is available. Use scoped workspace_find and bounded workspace_read. AGENTS instructions take precedence.",
        gaps: [
          projectContextGap(
            "index-unavailable",
            "No index revision is published for this workspace. Original-source tools remain available.",
            "incomplete-analysis",
          ),
        ],
      };
      if (!projectContextResultFits(result, budget))
        result = { ...result, gaps: [], truncated: true };
      return measureProjectContextResult(result, budget);
    }
    const revision = state.publishedRevision;
    const initialPosition = decodeProjectContextCursor(request.scope, input, revision);
    if (initialPosition === null) {
      return yield* queryError(
        "invalid-cursor",
        "The cursor does not match this workspace, query, or published revision. Restart without the cursor.",
      );
    }
    if (!(yield* reader.isStaticRevision(revision))) {
      const current = yield* reader.getState();
      if (!current.settings.enabled) {
        return yield* queryError(
          "disabled",
          "Project Indexing was disabled while context was being read.",
        );
      }
      if (current.publishedRevision !== revision) {
        return yield* queryError(
          "stale-revision",
          "The project index changed while context was being read. Restart the query.",
          true,
        );
      }
      result = {
        ...result,
        revision,
        summary:
          "This project has no published static index yet. Rebuild Project Indexing or read original files with workspace_find and workspace_read.",
        gaps: [
          projectContextGap(
            "static-rebuild-required",
            "The published index uses the previous AI format. Rebuild it to retrieve static source facts.",
            "incomplete-analysis",
          ),
        ],
      };
      if (!projectContextResultFits(result, budget)) {
        result = {
          ...result,
          summary: "Static index unavailable. Rebuild or read original files.",
          gaps: [],
          truncated: true,
        };
      }
      return measureProjectContextResult(result, budget);
    }
    const coverage = yield* reader.getCoverage(revision);
    result = { ...result, revision, coverage: coverage ?? EMPTY_PROJECT_INDEX_COVERAGE };
    if (input.operation === "overview" && input.cursor === undefined && budget >= 12_000) {
      result = {
        ...result,
        graph: yield* readProjectIndexGraphOverview(
          reader,
          revision,
          input.scopes,
          Math.floor(budget / 2),
        ),
      };
    }
    let position: ProjectContextPosition = initialPosition;
    const requestedEntity =
      input.entityId === undefined
        ? undefined
        : yield* reader.getRecord("entities", input.entityId, revision);
    if (
      input.entityId !== undefined &&
      (requestedEntity == null ||
        !isSafeProjectSourcePath(requestedEntity.filePath) ||
        !isWithinWorkspaceContextScopes(requestedEntity.filePath, input.scopes))
    ) {
      return yield* queryError(
        "not-found",
        "The entity is unavailable in this workspace and query scope.",
      );
    }
    const { validate: validateSource, verificationFor } = makeProjectContextSourceValidator({
      reader,
      workspaceRoot: request.workspaceRoot,
      revision,
      restrictEvidenceToScopes: input.operation !== "task",
      ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
      ...(request.readHash === undefined ? {} : { readHash: request.readHash }),
    });
    const retrieval = makeProjectContextRetrieval(
      reader,
      input,
      revision,
      (callsite) =>
        validateSource(callsite).pipe(
          Effect.map((validated) => validated.record?.freshness === "current"),
        ),
      requestedEntity ?? undefined,
    );
    if (position.stage >= retrieval.stageCount) {
      return yield* queryError(
        "invalid-cursor",
        "The cursor is outside this query's result range.",
      );
    }
    const rankedStage =
      (input.operation === "search" || input.operation === "task") &&
      position.stage === retrieval.stageCount - 1;
    if (
      (rankedStage && position.afterId !== null && position.afterKind == null) ||
      (!rankedStage && position.afterKind != null)
    ) {
      return yield* queryError(
        "invalid-cursor",
        "The cursor does not match this query's result order. Restart without the cursor.",
      );
    }
    const cursor = (next: NonNullable<typeof position>) =>
      encodeProjectContextCursor(request.scope, input, revision, next);
    result = { ...result, nextCursor: cursor(position) };
    let selectedEntity: ProjectEntityV1 | undefined;
    if (requestedEntity != null) {
      const entity = requestedEntity;
      const seed = yield* validateSource(entity);
      result = appendGaps(result, seed.gaps, budget);
      if (seed.record === null || (!input.includeStale && seed.record.freshness !== "current")) {
        return measureProjectContextResult(
          { ...result, nextCursor: null, truncated: true },
          budget,
        );
      }
      if (input.operation === "entity") {
        selectedEntity = entity;
        const anchored = appendCheckedRecord(
          result,
          "entities",
          seed.record,
          seed.evidence,
          verificationFor,
        );
        result = projectContextResultFits(anchored, budget)
          ? anchored
          : appendGaps(
              result,
              [
                projectContextGap(
                  "entity-anchor-limit",
                  "The selected entity does not fit this answer. Increase maxTokens and restart without the cursor for its complete declaration.",
                  "limit",
                  entity.filePath,
                ),
              ],
              budget,
            );
      }
    }
    if (!projectContextResultFits(result, budget)) {
      return yield* queryError(
        "invalid-request",
        "The token budget is too small for pagination metadata. Increase maxTokens.",
      );
    }
    if (coverage === null) {
      result = appendGaps(
        result,
        [
          projectContextGap(
            "coverage-unavailable",
            "Coverage metadata is unavailable for this published revision.",
            "incomplete-analysis",
          ),
        ],
        budget,
      );
    }
    const storedGaps = yield* reader.listRecords({
      kind: "gaps",
      revision,
      limit: 8,
      ...(input.scopes === undefined ? {} : { filePathPrefixes: input.scopes }),
    });
    result = appendGaps(
      result,
      storedGaps.items.filter(
        (gap) =>
          gap.kind !== "provider-error" &&
          (gap.filePath === undefined || isSafeProjectSourcePath(gap.filePath)),
      ),
      Math.min(
        budget,
        measureProjectContextResult(result, budget).estimatedTokens + Math.floor(budget / 4),
      ),
    );
    const seen = new Set<string>();
    const accepted = new Set<string>();
    let primaryCount = 0;
    let complete = false;
    let omittedRelated = false;
    for (let scanned = 0; scanned < MAX_CANDIDATES_PER_QUERY; scanned += 1) {
      const page = yield* retrieval.next(position);
      if (page.traversalTruncated) {
        result = appendGaps(
          result,
          [
            projectContextGap(
              "impact-limit",
              "Impact follows confirmed callers for at most three levels and 200 callsites. Query a related entity to continue.",
              "limit",
            ),
          ],
          budget,
        );
      }
      const candidate = page.candidate;
      if (candidate === null || seen.has(`${candidate.kind}:${candidate.record.id}`)) {
        position = page.position;
        complete = page.complete;
        result = { ...result, nextCursor: complete ? null : cursor(position) };
        if (complete) break;
        continue;
      }
      seen.add(`${candidate.kind}:${candidate.record.id}`);
      const checked = yield* validateSource(
        candidate.record,
        candidate.originalRuleScope !== undefined,
        candidate.originalRuleScope?.entityIds,
      );
      result = appendGaps(result, checked.gaps, budget);
      if (
        checked.record === null ||
        (!input.includeStale && checked.record.freshness !== "current")
      ) {
        position = page.position;
        complete = page.complete;
        result = { ...result, truncated: true, nextCursor: complete ? null : cursor(position) };
        if (complete) break;
        continue;
      }
      const continued = { ...result, nextCursor: page.complete ? null : cursor(page.position) };
      const added = appendCheckedRecord(
        continued,
        candidate.kind,
        checked.record,
        checked.evidence,
        verificationFor,
      );
      if (!projectContextResultFits(added, budget)) {
        if (primaryCount > 0) {
          result = { ...result, truncated: true, nextCursor: cursor(position) };
          break;
        }
        result = appendGaps(
          continued,
          [
            projectContextGap(
              `budget:${candidate.record.id}`,
              candidate.kind === "rules"
                ? "An applicable original rule did not fit this answer. Read its rule file through workspace_read or increase maxTokens and restart without the cursor."
                : "One complete record exceeds the answer budget. Increase maxTokens and restart without the cursor, or read its original source through workspace_read.",
              "limit",
              candidate.originalRuleScope?.filePath ??
                checked.evidence[0]?.filePath ??
                ("filePath" in candidate.record ? candidate.record.filePath : undefined),
            ),
          ],
          budget,
        );
      } else {
        result = added;
        accepted.add(`${candidate.kind}:${candidate.record.id}`);
        primaryCount += 1;
        const related = yield* retrieval.related(candidate);
        result = appendGaps(result, related.gaps, budget);
        for (const relatedCandidate of related.records) {
          const key = `${relatedCandidate.kind}:${relatedCandidate.record.id}`;
          if (accepted.has(key)) {
            const originalRuleScope = relatedCandidate.originalRuleScope;
            if (originalRuleScope !== undefined) {
              const enriched = {
                ...result,
                rules: result.rules.map((rule) =>
                  rule.id === relatedCandidate.record.id
                    ? {
                        ...rule,
                        appliesToEntityIds: [
                          ...new Set([...rule.appliesToEntityIds, ...originalRuleScope.entityIds]),
                        ],
                      }
                    : rule,
                ),
              };
              if (projectContextResultFits(enriched, budget)) result = enriched;
            }
            continue;
          }
          const validated = yield* validateSource(
            relatedCandidate.record,
            input.operation === "task" || relatedCandidate.originalRuleScope !== undefined,
            relatedCandidate.originalRuleScope?.entityIds,
          );
          result = appendGaps(result, validated.gaps, budget);
          if (
            validated.record === null ||
            (!input.includeStale && validated.record.freshness !== "current")
          )
            continue;
          const withRelated = appendCheckedRecord(
            result,
            relatedCandidate.kind,
            validated.record,
            validated.evidence,
            verificationFor,
          );
          if (!projectContextResultFits(withRelated, budget)) {
            omittedRelated = true;
            if (relatedCandidate.originalRuleScope !== undefined) {
              result = appendGaps(
                result,
                [
                  projectContextGap(
                    `agent-rule-budget:${relatedCandidate.originalRuleScope.filePath}`,
                    `Applicable original directives from ${relatedCandidate.originalRuleScope.filePath} did not fit. Read that file before relying on this context.`,
                    "limit",
                    relatedCandidate.originalRuleScope.filePath,
                  ),
                ],
                budget,
              );
            }
            continue;
          }
          result = withRelated;
          accepted.add(key);
        }
      }
      position = page.position;
      complete = page.complete;
      if (complete || primaryCount >= (input.limit ?? DEFAULT_PRIMARY_RECORDS)) break;
    }
    if (selectedEntity !== undefined) {
      const anchors: Array<{ kind: ProjectContextRecordKind; record: ProjectContextRecord }> = [];
      if (
        selectedEntity.containerId &&
        !result.entities.some((entity) => entity.id === selectedEntity.containerId)
      ) {
        const container = yield* reader.getRecord("entities", selectedEntity.containerId, revision);
        if (container) anchors.push({ kind: "entities", record: container });
      }
      for (const anchor of anchors) {
        const checked = yield* validateSource(anchor.record);
        if (
          checked.record === null ||
          (!input.includeStale && checked.record.freshness !== "current")
        )
          continue;
        const anchored = appendCheckedRecord(
          result,
          anchor.kind,
          checked.record,
          checked.evidence,
          verificationFor,
        );
        if (projectContextResultFits(anchored, budget)) result = anchored;
      }
    }
    if (!complete || omittedRelated) result = { ...result, truncated: true };
    if (omittedRelated) {
      result = appendGaps(
        result,
        [
          projectContextGap(
            "related-limit",
            "Related context was bounded. Query entity, callers, or callees for further detail.",
            "limit",
          ),
        ],
        budget,
      );
    }
    const sourcePaths = [...new Set(result.evidence.map((source) => source.filePath))];
    if (sourcePaths.length > 0) {
      const relevantGaps = yield* reader.listRecords({
        kind: "gaps",
        revision,
        filePathPrefixes: sourcePaths.slice(0, 16),
        limit: 4,
      });
      result = appendGaps(
        result,
        relevantGaps.items.filter(
          (gap) =>
            gap.kind !== "provider-error" &&
            (gap.filePath === undefined || isSafeProjectSourcePath(gap.filePath)),
        ),
        budget,
      );
      if (sourcePaths.length > 16 || relevantGaps.nextCursor !== null)
        result = { ...result, truncated: true };
    }
    const current = yield* reader.getState();
    if (!current.settings.enabled) {
      return yield* queryError(
        "disabled",
        "Project Indexing was disabled while context was being read. Use workspace_find and workspace_read.",
      );
    }
    if (current.publishedRevision !== revision || current.activeRevision !== state.activeRevision) {
      return yield* queryError(
        "stale-revision",
        "The project index changed while context was being read. Restart the query.",
        true,
      );
    }
    if (!projectContextResultFits(result, budget)) {
      return yield* queryError(
        "invalid-request",
        "The token budget is too small for the result continuation. Increase maxTokens.",
      );
    }
    return measureProjectContextResult(result, budget);
  },
);

export class ProjectContextQuery extends Context.Service<
  ProjectContextQuery,
  {
    readonly query: (
      input: ProjectIndexQueryInput,
    ) => Effect.Effect<ProjectIndexQueryResultV1, ProjectIndexOperationError>;
  }
>()("t3/projectIndexing/query/ProjectContextQuery") {}

export const layer = Layer.effect(
  ProjectContextQuery,
  Effect.gen(function* () {
    const bridge = yield* ProjectIndexingBridge;
    const settings = yield* ServerSettingsService;
    const assertEnabled = readProjectIndexDefaults.pipe(
      Effect.provideService(ServerSettingsService, settings),
      Effect.mapError(() =>
        queryError("store-unavailable", "Project Indexing settings are unavailable.", true),
      ),
      Effect.flatMap((defaults) =>
        defaults.enabled
          ? Effect.void
          : queryError(
              "disabled",
              "Project Indexing is disabled for this environment. Enable it in Better T3 → Project Indexing, or use workspace_find and workspace_read.",
            ),
      ),
    );
    const query = Effect.fn("ProjectContextQuery.query")(function* (input: ProjectIndexQueryInput) {
      yield* assertEnabled;
      const resolved = yield* bridge
        .resolveScope(input)
        .pipe(
          Effect.mapError((error) =>
            isProjectIndexOperationError(error)
              ? error
              : queryError(
                  "scope-mismatch",
                  "The project or thread workspace could not be resolved.",
                ),
          ),
        );
      const { projectId: _projectId, threadId: _threadId, ...contextInput } = input;
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* openExistingKnowledgeKvStore({
            workspaceRoot: resolved.workspaceRoot,
          });
          return yield* queryProjectContext({ ...resolved, input: contextInput, reader });
        }),
      ).pipe(
        Effect.mapError((error) =>
          isProjectIndexOperationError(error)
            ? error
            : queryError(
                "store-unavailable",
                "Project index storage is unavailable. Use scoped workspace_find and workspace_read.",
                true,
              ),
        ),
      );
      yield* assertEnabled;
      return result;
    });
    return ProjectContextQuery.of({
      query: (input) => query(input).pipe(Effect.provideService(References.TracerEnabled, false)),
    });
  }),
);
