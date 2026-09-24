import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "../baseSchemas.ts";
import {
  PROJECT_INDEX_MAX_QUERY_CALLSITES,
  PROJECT_INDEX_MAX_QUERY_EVIDENCE,
  PROJECT_INDEX_MAX_QUERY_RECORDS,
  PROJECT_INDEX_MAX_QUERY_TOKENS,
  PROJECT_INDEX_MAX_WIRE_BYTES,
  PROJECT_KNOWLEDGE_VERSION,
  ProjectIndexId,
  ProjectIndexHash,
  ProjectIndexModelSelection,
  ProjectIndexPath,
  ProjectIndexScopeInput,
  ProjectIndexScopeV1,
  ProjectIndexText,
  ProjectSourceRangeV1,
} from "./common.ts";
import {
  ProjectBehaviorV1,
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectEvidenceV1,
  ProjectFlowV1,
  ProjectImportV1,
  ProjectIndexCoverageV1,
  ProjectIndexGapV1,
  ProjectModuleV1,
  ProjectRuleV1,
} from "./knowledge.ts";
import { ProjectIndexUsageV1 } from "./lifecycle.ts";

export const PROJECT_INDEX_MIN_QUERY_TOKENS = 1_024;

export const ProjectIndexQueryOperation = Schema.Literals([
  "overview",
  "search",
  "entity",
  "callers",
  "callees",
  "impact",
  "task",
]);
export type ProjectIndexQueryOperation = typeof ProjectIndexQueryOperation.Type;

const ProjectIndexCursor = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(8_192));

const ProjectContextFields = {
  operation: ProjectIndexQueryOperation,
  text: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(8_000))),
  entityId: Schema.optionalKey(ProjectIndexId),
  cursor: Schema.optionalKey(ProjectIndexCursor),
  maxTokens: Schema.optionalKey(
    PositiveInt.check(
      Schema.isBetween({
        minimum: PROJECT_INDEX_MIN_QUERY_TOKENS,
        maximum: PROJECT_INDEX_MAX_QUERY_TOKENS,
      }),
    ),
  ),
  limit: Schema.optionalKey(
    PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  ),
  scopes: Schema.optionalKey(Schema.Array(ProjectIndexPath).check(Schema.isMaxLength(16))),
  includeStale: Schema.optionalKey(Schema.Boolean),
};

const queryHasRequiredSelector = Schema.makeFilter(
  (input: { operation: ProjectIndexQueryOperation; entityId?: string; text?: string }) => {
    switch (input.operation) {
      case "entity":
      case "callers":
      case "callees":
      case "impact":
        return input.entityId !== undefined;
      case "search":
      case "task":
        return input.text !== undefined && input.text.trim().length > 0;
      case "overview":
        return true;
    }
  },
  { message: "The operation requires an entityId or nonempty search/task text" },
);

/** MCP callers receive no scope selector; the authenticated session supplies it. */
export const ProjectContextInput = Schema.Struct(ProjectContextFields)
  .check(queryHasRequiredSelector)
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectContextInput = typeof ProjectContextInput.Type;

export const ProjectIndexQueryInput = Schema.Struct({
  ...ProjectIndexScopeInput.fields,
  ...ProjectContextFields,
})
  .check(queryHasRequiredSelector)
  .annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexQueryInput = typeof ProjectIndexQueryInput.Type;

export const ProjectIndexSourceHashVerificationV1 = Schema.Struct({
  state: Schema.Literals(["complete", "partial", "unavailable"]),
  matchedFiles: NonNegativeInt,
  changedFiles: NonNegativeInt,
  missingFiles: NonNegativeInt,
  unverifiedFiles: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (verification) => {
      const classifiedFiles =
        verification.matchedFiles + verification.changedFiles + verification.missingFiles;
      switch (verification.state) {
        case "complete":
          return classifiedFiles > 0 && verification.unverifiedFiles === 0;
        case "partial":
          return classifiedFiles > 0 && verification.unverifiedFiles > 0;
        case "unavailable":
          return classifiedFiles === 0;
      }
    },
    { message: "Source verification state must agree with the measured file counts" },
  ),
);
export type ProjectIndexSourceHashVerificationV1 = typeof ProjectIndexSourceHashVerificationV1.Type;

// Counts cover unique source paths considered for the returned records and
// dependencies. A completed comparison can find changes; it is not a test pass.
export const ProjectIndexQueryVerificationV1 = Schema.Struct({
  context: Schema.Literal("provided"),
  sourceHashes: ProjectIndexSourceHashVerificationV1,
  checks: Schema.Literal("not-run"),
});
export type ProjectIndexQueryVerificationV1 = typeof ProjectIndexQueryVerificationV1.Type;

export const ProjectIndexGraphOverviewV1 = Schema.Struct({
  basis: Schema.Literal("published-index"),
  rootPath: Schema.String.check(Schema.isMaxLength(4_096)),
  indexedFiles: NonNegativeInt,
  omittedFiles: NonNegativeInt,
  truncated: Schema.Boolean,
  nodes: Schema.Array(
    Schema.Struct({
      path: ProjectIndexPath,
      kind: Schema.Literals(["directory", "file"]),
      fileCount: PositiveInt,
    }),
  ).check(Schema.isMaxLength(64)),
  edges: Schema.Array(
    Schema.Struct({
      source: ProjectIndexPath,
      target: ProjectIndexPath,
      imports: PositiveInt,
    }),
  ).check(Schema.isMaxLength(128)),
});
export type ProjectIndexGraphOverviewV1 = typeof ProjectIndexGraphOverviewV1.Type;

export const ProjectIndexQueryResultV1 = Schema.Struct({
  version: Schema.Literal(PROJECT_KNOWLEDGE_VERSION),
  scope: ProjectIndexScopeV1,
  revision: NonNegativeInt,
  operation: ProjectIndexQueryOperation,
  summary: ProjectIndexText,
  graph: Schema.optionalKey(ProjectIndexGraphOverviewV1),
  entities: Schema.Array(ProjectEntityV1).check(
    Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS),
  ),
  callsites: Schema.Array(ProjectCallsiteV1).check(
    Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_CALLSITES),
  ),
  imports: Schema.optionalKey(
    Schema.Array(ProjectImportV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  ),
  modules: Schema.Array(ProjectModuleV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  behaviors: Schema.Array(ProjectBehaviorV1).check(
    Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS),
  ),
  flows: Schema.Array(ProjectFlowV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  rules: Schema.Array(ProjectRuleV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  evidence: Schema.Array(ProjectEvidenceV1).check(
    Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_EVIDENCE),
  ),
  gaps: Schema.Array(ProjectIndexGapV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  coverage: ProjectIndexCoverageV1,
  nextCursor: Schema.NullOr(ProjectIndexCursor),
  truncated: Schema.Boolean,
  estimatedTokens: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROJECT_INDEX_MAX_QUERY_TOKENS)),
  verification: Schema.optionalKey(ProjectIndexQueryVerificationV1),
}).check(
  Schema.makeFilter(
    (result) =>
      new TextEncoder().encode(JSON.stringify(result)).byteLength <= PROJECT_INDEX_MAX_WIRE_BYTES,
    { message: "Project index query exceeds the bounded wire payload" },
  ),
);
export type ProjectIndexQueryResultV1 = typeof ProjectIndexQueryResultV1.Type;

export const ProjectIndexReviewSelection = Schema.Literals(["workingtree", "staged"]);
export type ProjectIndexReviewSelection = typeof ProjectIndexReviewSelection.Type;

export const ProjectIndexReviewInput = Schema.Struct({
  ...ProjectIndexScopeInput.fields,
  selection: Schema.optionalKey(ProjectIndexReviewSelection),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectIndexReviewInput = typeof ProjectIndexReviewInput.Type;

export const ProjectIndexReviewFindingV1 = Schema.Struct({
  id: ProjectIndexId,
  filePath: ProjectIndexPath,
  range: ProjectSourceRangeV1,
  severity: Schema.Literals(["info", "warning", "error"]),
  category: Schema.Literals([
    "correctness",
    "security",
    "performance",
    "maintainability",
    "testing",
    "other",
  ]),
  message: ProjectIndexText,
  evidenceIds: Schema.Array(ProjectIndexId).check(Schema.isMaxLength(64)),
  sourceHash: ProjectIndexHash,
  provenance: Schema.Literal("llm"),
  sourceSide: Schema.optionalKey(Schema.Literals(["before", "after"])),
  diffExcerpt: Schema.optionalKey(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2_000)),
  ),
});
export type ProjectIndexReviewFindingV1 = typeof ProjectIndexReviewFindingV1.Type;

export const ProjectIndexReviewResultV1 = Schema.Struct({
  version: Schema.Literal(PROJECT_KNOWLEDGE_VERSION),
  scope: ProjectIndexScopeV1,
  revision: NonNegativeInt,
  selection: ProjectIndexReviewSelection,
  diffHash: ProjectIndexHash,
  state: Schema.Literals(["completed", "failed"]),
  modelSelection: ProjectIndexModelSelection,
  findings: Schema.Array(ProjectIndexReviewFindingV1).check(Schema.isMaxLength(100)),
  summary: ProjectIndexText,
  gaps: Schema.Array(ProjectIndexGapV1).check(Schema.isMaxLength(PROJECT_INDEX_MAX_QUERY_RECORDS)),
  usage: ProjectIndexUsageV1,
});
export type ProjectIndexReviewResultV1 = typeof ProjectIndexReviewResultV1.Type;
