import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt } from "../baseSchemas.ts";
import {
  PROJECT_INDEX_MAX_EVIDENCE_EXCERPT_LENGTH,
  PROJECT_KNOWLEDGE_VERSION,
  ProjectIndexEvidenceIds,
  ProjectIndexFreshness,
  ProjectIndexHash,
  ProjectIndexId,
  ProjectIndexLabel,
  ProjectIndexModelSelection,
  ProjectIndexPath,
  ProjectIndexProvenance,
  ProjectIndexResolution,
  ProjectIndexScopeV1,
  ProjectIndexText,
  ProjectSourceRangeV1,
} from "./common.ts";

export const ProjectSourceClassification = Schema.Literals([
  "source",
  "test",
  "rule",
  "configuration",
  "manifest",
  "documentation",
  "generated",
  "binary",
  "vendor",
  "ignored",
  "unsupported",
]);
export type ProjectSourceClassification = typeof ProjectSourceClassification.Type;

export const ProjectSourceFileStatus = Schema.Literals([
  "pending",
  "indexed",
  "skipped",
  "failed",
  "stale",
  "deleted",
]);
export type ProjectSourceFileStatus = typeof ProjectSourceFileStatus.Type;

export const ProjectSourceFileV1 = Schema.Struct({
  path: ProjectIndexPath,
  contentHash: ProjectIndexHash,
  language: ProjectIndexLabel,
  bytes: NonNegativeInt,
  classification: ProjectSourceClassification,
  status: ProjectSourceFileStatus,
  configDependencies: Schema.Array(ProjectIndexPath),
  skipReason: Schema.optionalKey(ProjectIndexText),
});
export type ProjectSourceFileV1 = typeof ProjectSourceFileV1.Type;

export const ProjectEntityKind = Schema.Literals([
  "file",
  "class",
  "interface",
  "method",
  "function",
  "constructor",
  "property",
  "variable",
  "type",
  "namespace",
  "module",
  "enum",
  "initializer",
  "lambda",
]);
export type ProjectEntityKind = typeof ProjectEntityKind.Type;

export const ProjectEntityVisibility = Schema.Literals([
  "public",
  "protected",
  "internal",
  "private",
  "package",
  "local",
  "unknown",
  "protected-internal",
  "private-protected",
]);
export type ProjectEntityVisibility = typeof ProjectEntityVisibility.Type;

const RecordEvidenceFields = {
  provenance: ProjectIndexProvenance,
  freshness: ProjectIndexFreshness,
  evidenceIds: ProjectIndexEvidenceIds,
};

export const ProjectEntityV1 = Schema.Struct({
  id: ProjectIndexId,
  filePath: ProjectIndexPath,
  kind: ProjectEntityKind,
  name: ProjectIndexLabel,
  qualifiedName: ProjectIndexLabel,
  visibility: Schema.optionalKey(ProjectEntityVisibility),
  signature: Schema.optionalKey(ProjectIndexText),
  containerId: Schema.optionalKey(ProjectIndexId),
  language: ProjectIndexLabel,
  range: ProjectSourceRangeV1,
  nameRange: Schema.optionalKey(ProjectSourceRangeV1),
  sourceHash: ProjectIndexHash,
  ...RecordEvidenceFields,
});
export type ProjectEntityV1 = typeof ProjectEntityV1.Type;

export const ProjectCallsiteDispatch = Schema.Literals([
  "direct",
  "virtual",
  "dynamic",
  "import",
  "unknown",
]);
export type ProjectCallsiteDispatch = typeof ProjectCallsiteDispatch.Type;

export const ProjectCallsiteV1 = Schema.Struct({
  id: ProjectIndexId,
  callerEntityId: Schema.optionalKey(ProjectIndexId),
  filePath: ProjectIndexPath,
  range: ProjectSourceRangeV1,
  expression: ProjectIndexText,
  dispatch: ProjectCallsiteDispatch,
  resolution: ProjectIndexResolution,
  targetEntityIds: Schema.Array(ProjectIndexId),
  reason: Schema.optionalKey(ProjectIndexText),
  sourceHash: ProjectIndexHash,
  ...RecordEvidenceFields,
}).check(
  Schema.makeFilter(
    (callsite) => {
      if (new Set(callsite.targetEntityIds).size !== callsite.targetEntityIds.length) return false;
      switch (callsite.resolution) {
        case "resolved":
          return callsite.targetEntityIds.length === 1 && callsite.provenance !== "llm";
        case "candidate":
          return callsite.targetEntityIds.length > 0;
        case "unresolved":
          return callsite.targetEntityIds.length === 0;
      }
    },
    { message: "Call resolution must agree with unique targets and its source provenance" },
  ),
);
export type ProjectCallsiteV1 = typeof ProjectCallsiteV1.Type;

export const ProjectImportResolution = Schema.Literals(["workspace", "external", "unresolved"]);
export type ProjectImportResolution = typeof ProjectImportResolution.Type;

export const ProjectImportV1 = Schema.Struct({
  id: ProjectIndexId,
  filePath: ProjectIndexPath,
  sourceHash: ProjectIndexHash,
  range: ProjectSourceRangeV1,
  importText: ProjectIndexText,
  specifier: ProjectIndexLabel,
  resolution: ProjectImportResolution,
  targetPath: Schema.optionalKey(ProjectIndexPath),
  packageName: Schema.optionalKey(ProjectIndexLabel),
  ...RecordEvidenceFields,
}).check(
  Schema.makeFilter(
    (record) =>
      (record.resolution === "workspace" &&
        record.targetPath !== undefined &&
        record.packageName === undefined) ||
      (record.resolution === "external" &&
        record.targetPath === undefined &&
        record.packageName !== undefined) ||
      (record.resolution === "unresolved" &&
        record.targetPath === undefined &&
        record.packageName === undefined),
    { message: "Import resolution must agree with its workspace target or external package" },
  ),
);
export type ProjectImportV1 = typeof ProjectImportV1.Type;

export const ProjectAnalysisCoverageV1 = Schema.Struct({
  rootEntityId: ProjectIndexId,
  sourceHash: ProjectIndexHash,
  planId: ProjectIndexHash,
  partIndex: NonNegativeInt,
  partCount: PositiveInt,
  range: ProjectSourceRangeV1,
}).check(
  Schema.makeFilter((coverage) => coverage.partIndex < coverage.partCount, {
    message: "Analysis partIndex must be zero-based and less than partCount",
  }),
);
export type ProjectAnalysisCoverageV1 = typeof ProjectAnalysisCoverageV1.Type;

export const ProjectAnalysisMetadataV1 = Schema.Struct({
  modelSelection: ProjectIndexModelSelection,
  contextWindowTokens: Schema.optionalKey(PositiveInt),
  maxOutputTokens: Schema.optionalKey(PositiveInt),
  sourceRevision: NonNegativeInt,
  analyzedAt: IsoDateTime,
  unitId: ProjectIndexId,
  coverage: Schema.optionalKey(ProjectAnalysisCoverageV1),
});
export type ProjectAnalysisMetadataV1 = typeof ProjectAnalysisMetadataV1.Type;

const SemanticRecordFields = {
  ...RecordEvidenceFields,
  analysis: Schema.optionalKey(ProjectAnalysisMetadataV1),
};

export const ProjectModuleV1 = Schema.Struct({
  id: ProjectIndexId,
  name: ProjectIndexLabel,
  summary: ProjectIndexText,
  entityIds: Schema.Array(ProjectIndexId),
  filePaths: Schema.Array(ProjectIndexPath),
  dependsOnModuleIds: Schema.Array(ProjectIndexId),
  ...SemanticRecordFields,
});
export type ProjectModuleV1 = typeof ProjectModuleV1.Type;

export const ProjectBehaviorV1 = Schema.Struct({
  id: ProjectIndexId,
  entityIds: Schema.Array(ProjectIndexId).check(Schema.isMinLength(1)),
  summary: ProjectIndexText,
  inputs: Schema.Array(ProjectIndexText),
  outputs: Schema.Array(ProjectIndexText),
  sideEffects: Schema.Array(ProjectIndexText),
  errorPaths: Schema.Array(ProjectIndexText),
  invariants: Schema.Array(ProjectIndexText),
  ...SemanticRecordFields,
});
export type ProjectBehaviorV1 = typeof ProjectBehaviorV1.Type;

export const ProjectFlowStepV1 = Schema.Struct({
  order: NonNegativeInt,
  entityId: Schema.optionalKey(ProjectIndexId),
  description: ProjectIndexText,
  evidenceIds: ProjectIndexEvidenceIds,
});
export type ProjectFlowStepV1 = typeof ProjectFlowStepV1.Type;

export const ProjectFlowV1 = Schema.Struct({
  id: ProjectIndexId,
  name: ProjectIndexLabel,
  summary: ProjectIndexText,
  entryEntityIds: Schema.Array(ProjectIndexId),
  exitEntityIds: Schema.Array(ProjectIndexId),
  steps: Schema.Array(ProjectFlowStepV1),
  ...SemanticRecordFields,
});
export type ProjectFlowV1 = typeof ProjectFlowV1.Type;

export const ProjectRuleV1 = Schema.Struct({
  id: ProjectIndexId,
  name: ProjectIndexLabel,
  description: ProjectIndexText,
  severity: Schema.Literals(["info", "warning", "error"]),
  source: Schema.Literals(["explicit", "inferred"]),
  appliesToEntityIds: Schema.Array(ProjectIndexId),
  ...SemanticRecordFields,
});
export type ProjectRuleV1 = typeof ProjectRuleV1.Type;

export const ProjectEvidenceV1 = Schema.Struct({
  id: ProjectIndexId,
  filePath: ProjectIndexPath,
  sourceHash: ProjectIndexHash,
  range: ProjectSourceRangeV1,
  excerpt: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(PROJECT_INDEX_MAX_EVIDENCE_EXCERPT_LENGTH)),
  ),
  provenance: ProjectIndexProvenance,
});
export type ProjectEvidenceV1 = typeof ProjectEvidenceV1.Type;

export const ProjectIndexGapKind = Schema.Literals([
  "unsupported-language",
  "parse-error",
  "unresolved-call",
  "missing-config",
  "excluded",
  "provider-error",
  "stale-source",
  "incomplete-analysis",
  "limit",
  "other",
]);
export type ProjectIndexGapKind = typeof ProjectIndexGapKind.Type;

export const ProjectIndexGapV1 = Schema.Struct({
  id: ProjectIndexId,
  kind: ProjectIndexGapKind,
  message: ProjectIndexText,
  filePath: Schema.optionalKey(ProjectIndexPath),
  entityId: Schema.optionalKey(ProjectIndexId),
  retryable: Schema.Boolean,
});
export type ProjectIndexGapV1 = typeof ProjectIndexGapV1.Type;

export const ProjectIndexCoverageV1 = Schema.Struct({
  discoveredFiles: NonNegativeInt,
  eligibleFiles: NonNegativeInt,
  indexedFiles: NonNegativeInt,
  skippedFiles: NonNegativeInt,
  failedFiles: NonNegativeInt,
  totalEntities: NonNegativeInt,
  analyzedEntities: NonNegativeInt,
  totalCallsites: NonNegativeInt,
  totalImports: Schema.optionalKey(NonNegativeInt),
  resolvedImports: Schema.optionalKey(NonNegativeInt),
  resolvedCallsites: NonNegativeInt,
  candidateCallsites: NonNegativeInt,
  unresolvedCallsites: NonNegativeInt,
});
export type ProjectIndexCoverageV1 = typeof ProjectIndexCoverageV1.Type;

export const EMPTY_PROJECT_INDEX_COVERAGE: ProjectIndexCoverageV1 = {
  discoveredFiles: 0,
  eligibleFiles: 0,
  indexedFiles: 0,
  skippedFiles: 0,
  failedFiles: 0,
  totalEntities: 0,
  analyzedEntities: 0,
  totalCallsites: 0,
  totalImports: 0,
  resolvedImports: 0,
  resolvedCallsites: 0,
  candidateCallsites: 0,
  unresolvedCallsites: 0,
};

// The durable model is exhaustive. Only query/subscription projections have
// collection limits; crossing a presentation limit must never discard storage.
export const ProjectKnowledgeV1 = Schema.Struct({
  version: Schema.Literal(PROJECT_KNOWLEDGE_VERSION),
  scope: ProjectIndexScopeV1,
  revision: NonNegativeInt,
  files: Schema.Array(ProjectSourceFileV1),
  entities: Schema.Array(ProjectEntityV1),
  callsites: Schema.Array(ProjectCallsiteV1),
  imports: Schema.optionalKey(Schema.Array(ProjectImportV1)),
  modules: Schema.Array(ProjectModuleV1),
  behaviors: Schema.Array(ProjectBehaviorV1),
  flows: Schema.Array(ProjectFlowV1),
  rules: Schema.Array(ProjectRuleV1),
  evidence: Schema.Array(ProjectEvidenceV1),
  coverage: ProjectIndexCoverageV1,
  gaps: Schema.Array(ProjectIndexGapV1),
  updatedAt: IsoDateTime,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ProjectKnowledgeV1 = typeof ProjectKnowledgeV1.Type;
