import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  PROJECT_INDEX_MAX_QUERY_RECORDS,
  PROJECT_INDEX_MAX_QUERY_TOKENS,
  ProjectAnalysisMetadataV1,
  ProjectCallsiteV1,
  ProjectContextInput,
  ProjectIndexControlInput,
  ProjectIndexModelCheckInput,
  ProjectIndexModelSelection,
  ProjectIndexPath,
  ProjectIndexQueryInput,
  ProjectIndexQueryResultV1,
  ProjectIndexQueryVerificationV1,
  ProjectIndexReviewFindingV1,
  ProjectIndexReviewInput,
  ProjectIndexScopeInput,
  ProjectIndexSettings,
  ProjectIndexSettingsPatch,
  ProjectIndexUsageV1,
  ProjectKnowledgeV1,
  ProjectSourceRangeV1,
  resolveProjectIndexSettings,
} from "./projectIndexing.ts";

const decodeModelSelection = Schema.decodeUnknownSync(ProjectIndexModelSelection);
const decodeContext = Schema.decodeUnknownSync(ProjectContextInput);
const decodePath = Schema.decodeUnknownSync(ProjectIndexPath);
const decodeKnowledge = Schema.decodeUnknownSync(ProjectKnowledgeV1);
const decodeQueryResult = Schema.decodeUnknownSync(ProjectIndexQueryResultV1);
const decodeVerification = Schema.decodeUnknownSync(ProjectIndexQueryVerificationV1);
const decodeReviewFinding = Schema.decodeUnknownSync(ProjectIndexReviewFindingV1);
const decodeAnalysisMetadata = Schema.decodeUnknownSync(ProjectAnalysisMetadataV1);
const decodeModelCheck = Schema.decodeUnknownSync(ProjectIndexModelCheckInput);
const decodeProjectSettings = Schema.decodeUnknownSync(ProjectIndexSettings);
const decodeControlInput = Schema.decodeUnknownSync(ProjectIndexControlInput);

const range = { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 };
const scope = { scopeId: "scope-a", projectId: "project-a", workspaceFingerprint: "workspace-a" };
const entity = {
  id: "entity-a",
  filePath: "src/example.ts",
  kind: "function",
  name: "example",
  qualifiedName: "example",
  language: "typescript",
  range,
  sourceHash: "hash-a",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
};
const callsite = {
  id: "call-a",
  callerEntityId: "entity-a",
  filePath: "src/example.ts",
  range,
  expression: "example()",
  dispatch: "direct",
  resolution: "resolved",
  targetEntityIds: ["entity-a"],
  sourceHash: "hash-a",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
};
const knowledge = {
  version: 1,
  scope,
  revision: 1,
  files: [],
  entities: [],
  callsites: [],
  modules: [],
  behaviors: [],
  flows: [],
  rules: [],
  evidence: [],
  coverage: EMPTY_PROJECT_INDEX_COVERAGE,
  gaps: [],
  updatedAt: "2026-09-20T00:00:00.000Z",
};
const queryResult = {
  version: 1,
  scope,
  revision: 1,
  operation: "overview",
  summary: "Synthetic project",
  entities: [],
  callsites: [],
  modules: [],
  behaviors: [],
  flows: [],
  rules: [],
  evidence: [],
  gaps: [],
  coverage: EMPTY_PROJECT_INDEX_COVERAGE,
  nextCursor: null,
  truncated: false,
  estimatedTokens: 100,
};

describe("project indexing opt-in contracts", () => {
  it("inherits only the environment model and master gate while preserving project choices", () => {
    const inheritedModel = decodeModelSelection({
      instanceId: "environment",
      model: "default-model",
    });
    const overrideModel = decodeModelSelection({ instanceId: "project", model: "override-model" });
    const raw = decodeProjectSettings({ enabled: true, autoRefresh: false, reviewEnabled: true });
    expect(resolveProjectIndexSettings(raw)).toEqual(raw);
    expect(
      resolveProjectIndexSettings(raw, { enabled: true, modelSelection: inheritedModel }),
    ).toEqual({
      ...raw,
      modelSelection: inheritedModel,
    });
    expect(
      resolveProjectIndexSettings(raw, { enabled: false, modelSelection: inheritedModel }),
    ).toEqual({
      ...raw,
      enabled: false,
      modelSelection: inheritedModel,
    });
    expect(
      resolveProjectIndexSettings(
        { ...raw, enabled: false },
        { enabled: true, modelSelection: inheritedModel },
      ).enabled,
    ).toBe(false);
    expect(
      resolveProjectIndexSettings(
        { ...raw, modelSelection: overrideModel },
        { enabled: true, modelSelection: inheritedModel },
      ).modelSelection,
    ).toEqual(overrideModel);
    expect(
      resolveProjectIndexSettings(raw, { enabled: true, modelSelection: null }).modelSelection,
    ).toBeNull();
    expect(raw).toMatchObject({
      enabled: true,
      autoRefresh: false,
      reviewEnabled: true,
      modelSelection: null,
    });
  });

  it("permits a global model check without permitting an unbound thread scope", () => {
    const modelSelection = { instanceId: "analysis", model: "synthetic-model" };
    expect(decodeModelCheck({ modelSelection })).toEqual({ modelSelection });
    expect(
      decodeModelCheck({ projectId: "project-a", threadId: "thread-a", modelSelection }),
    ).toMatchObject({ projectId: "project-a", threadId: "thread-a" });
    expect(() => decodeModelCheck({ threadId: "thread-a", modelSelection })).toThrow();
    expect(() => decodeModelCheck({ workspaceRoot: "/untrusted", modelSelection })).toThrow();
    expect(() => decodeControlInput({ action: "pause" })).toThrow();
  });

  it("defaults only initial indexing off and keeps later refresh preference independent", () => {
    const decode = Schema.decodeUnknownSync(ProjectIndexSettings);
    expect(decode({})).toEqual(DEFAULT_PROJECT_INDEX_SETTINGS);
    expect(decode({ enabled: true })).toEqual({ ...DEFAULT_PROJECT_INDEX_SETTINGS, enabled: true });
    expect(decode({ enabled: false, autoRefresh: false, reviewEnabled: true })).toEqual({
      enabled: false,
      autoRefresh: false,
      reviewEnabled: true,
      modelSelection: null,
    });
  });

  it("rejects unknown write fields and noncanonical model routing", () => {
    const decodePatch = Schema.decodeUnknownSync(ProjectIndexSettingsPatch);
    expect(() => decodePatch({ enabled: true, root: "/private" })).toThrow();
    expect(() => decodePatch({ enabled: "true" })).toThrow();
    expect(() =>
      decodePatch({ modelSelection: { provider: "codex", model: "example" } }),
    ).toThrow();
    expect(decodePatch({ modelSelection: { instanceId: "local", model: "example" } })).toEqual({
      modelSelection: { instanceId: "local", model: "example" },
    });
    expect(() => decodeModelSelection({ instanceId: "local", model: "  " })).toThrow();
  });

  it("accepts project/thread selectors and rejects client workspace roots", () => {
    const decode = Schema.decodeUnknownSync(ProjectIndexScopeInput);
    expect(decode({ projectId: "project-a", threadId: "thread-a" })).toEqual({
      projectId: "project-a",
      threadId: "thread-a",
    });
    expect(() => decode({ projectId: "project-a", workspaceRoot: "/private" })).toThrow();
    expect(() =>
      decodeContext({
        operation: "overview",
        projectId: "another-project",
      }),
    ).toThrow();
  });

  it("requires reversible known lifecycle actions and server-resolved review selections", () => {
    const decodeControl = Schema.decodeUnknownSync(ProjectIndexControlInput);
    for (const action of ["pause", "resume", "cancel", "clear"]) {
      expect(decodeControl({ projectId: "project-a", action }).action).toBe(action);
    }
    expect(() => decodeControl({ projectId: "project-a", action: "delete-project" })).toThrow();
    const decodeReview = Schema.decodeUnknownSync(ProjectIndexReviewInput);
    expect(decodeReview({ projectId: "project-a", selection: "staged" }).selection).toBe("staged");
    expect(() => decodeReview({ projectId: "project-a", diff: "untrusted" })).toThrow();
    expect(() => decodeReview({ projectId: "project-a", baseRef: "HEAD" })).toThrow();
  });
});

describe("project knowledge source facts", () => {
  it.each([
    "/absolute.ts",
    "../outside.ts",
    "src/../outside.ts",
    "src//empty.ts",
    "./file.ts",
    "C:/file.ts",
    "src\\file.ts",
    "src/\u0000.ts",
  ])("rejects nonrelative or nonnormalized source path %j", (path) => {
    expect(() => decodePath(path)).toThrow();
  });

  it("preserves valid filenames and checks ordered positions and paired offsets", () => {
    expect(decodePath("src/a file.ts")).toBe("src/a file.ts");
    const decodeRange = Schema.decodeUnknownSync(ProjectSourceRangeV1);
    expect(decodeRange({ ...range, startOffset: 0, endOffset: 5 })).toEqual({
      ...range,
      startOffset: 0,
      endOffset: 5,
    });
    for (const invalid of [
      { ...range, startLine: 0 },
      { ...range, startLine: 3 },
      { ...range, startLine: 2, startColumn: 5 },
      { ...range, startOffset: 2 },
      { ...range, startOffset: 5, endOffset: 2 },
    ])
      expect(() => decodeRange(invalid)).toThrow();
  });

  it("keeps call resolution separate from provenance and freshness", () => {
    const decode = Schema.decodeUnknownSync(ProjectCallsiteV1);
    expect(decode({ ...callsite, freshness: "stale" }).resolution).toBe("resolved");
    expect(decode({ ...callsite, freshness: "unknown" })).toMatchObject({
      freshness: "unknown",
      resolution: "resolved",
      provenance: "compiler",
    });
    expect(decode({ ...callsite, freshness: "missing" }).freshness).toBe("missing");
    expect(
      decode({ ...callsite, resolution: "candidate", targetEntityIds: ["entity-a", "entity-b"] })
        .targetEntityIds,
    ).toHaveLength(2);
    expect(
      decode({
        ...callsite,
        resolution: "unresolved",
        targetEntityIds: [],
        reason: "Dynamic receiver",
      }).resolution,
    ).toBe("unresolved");
    for (const invalid of [
      { ...callsite, targetEntityIds: [] },
      { ...callsite, targetEntityIds: ["a", "b"] },
      { ...callsite, resolution: "candidate", targetEntityIds: [] },
      { ...callsite, resolution: "candidate", targetEntityIds: ["a", "a"] },
      { ...callsite, resolution: "unresolved" },
      { ...callsite, provenance: "llm" },
    ])
      expect(() => decode(invalid)).toThrow();
  });

  it("does not impose query collection limits on exhaustive durable knowledge", () => {
    const entities = Array.from({ length: PROJECT_INDEX_MAX_QUERY_RECORDS + 1 }, (_, index) => ({
      ...entity,
      id: `entity-${index}`,
    }));
    expect(decodeKnowledge({ ...knowledge, entities }).entities).toHaveLength(entities.length);
    expect(() => decodeQueryResult({ ...queryResult, entities })).toThrow();
    expect(() => decodeKnowledge({ ...knowledge, arbitrary: true })).toThrow();
  });
});

describe("project context query and usage contracts", () => {
  it("preserves unknown completeness in older analysis metadata and validates split parts", () => {
    const metadata = {
      modelSelection: { instanceId: "local", model: "example" },
      sourceRevision: 2,
      analyzedAt: "2026-09-20T00:00:00.000Z",
      unitId: "unit-a",
    };
    const coverage = {
      rootEntityId: "entity-a",
      sourceHash: "hash-a",
      planId: "plan-a",
      partIndex: 0,
      partCount: 3,
      range,
    };
    expect(decodeAnalysisMetadata(metadata).coverage).toBeUndefined();
    expect(decodeAnalysisMetadata({ ...metadata, coverage }).coverage).toEqual(coverage);
    expect(
      decodeAnalysisMetadata({
        ...metadata,
        coverage: { ...coverage, partIndex: 2 },
      }).coverage?.partCount,
    ).toBe(3);
    for (const invalid of [
      { partIndex: -1 },
      { partIndex: 3 },
      { partCount: 0 },
      { partCount: 1.5 },
      { partIndex: 0.5 },
    ]) {
      expect(() =>
        decodeAnalysisMetadata({
          ...metadata,
          coverage: { ...coverage, ...invalid },
        }),
      ).toThrow();
    }
  });

  it("keeps verification optional and separates source comparisons from executed checks", () => {
    expect(decodeQueryResult(queryResult).verification).toBeUndefined();
    const verification = {
      context: "provided",
      sourceHashes: {
        state: "complete",
        matchedFiles: 2,
        changedFiles: 1,
        missingFiles: 1,
        unverifiedFiles: 0,
      },
      checks: "not-run",
    };
    expect(
      decodeQueryResult({ ...queryResult, entities: [entity], verification }).verification,
    ).toEqual(verification);
    expect(() => decodeVerification({ ...verification, checks: "passed" })).toThrow();
    expect(() => decodeVerification({ ...verification, checks: "executed" })).toThrow();
    expect(() => decodeVerification({ ...verification, context: "verified" })).toThrow();
  });

  it("requires source-comparison availability to agree with measured counts", () => {
    const decode = (sourceHashes: unknown) =>
      decodeVerification({ context: "provided", sourceHashes, checks: "not-run" });
    expect(
      decode({
        state: "partial",
        matchedFiles: 1,
        changedFiles: 0,
        missingFiles: 0,
        unverifiedFiles: 2,
      }).sourceHashes.state,
    ).toBe("partial");
    expect(
      decode({
        state: "unavailable",
        matchedFiles: 0,
        changedFiles: 0,
        missingFiles: 0,
        unverifiedFiles: 1,
      }).sourceHashes.state,
    ).toBe("unavailable");
    for (const state of ["complete", "partial"]) {
      expect(() =>
        decode({ state, matchedFiles: 0, changedFiles: 0, missingFiles: 0, unverifiedFiles: 0 }),
      ).toThrow();
    }
    expect(() =>
      decode({
        state: "complete",
        matchedFiles: 1,
        changedFiles: 0,
        missingFiles: 0,
        unverifiedFiles: 1,
      }),
    ).toThrow();
    expect(() =>
      decode({
        state: "unavailable",
        matchedFiles: 1,
        changedFiles: 0,
        missingFiles: 0,
        unverifiedFiles: 0,
      }),
    ).toThrow();
  });

  it("accepts bounded before-change diff evidence without requiring it in older findings", () => {
    const finding = {
      id: "review-1",
      filePath: "src/example.ts",
      range,
      severity: "warning",
      category: "correctness",
      message: "The removed guard handled the empty case.",
      evidenceIds: [],
      sourceHash: "old-hash",
      provenance: "llm",
    };
    expect(decodeReviewFinding(finding).sourceSide).toBeUndefined();
    expect(
      decodeReviewFinding({
        ...finding,
        sourceSide: "before",
        diffExcerpt: "if (items.length === 0) return;",
      }),
    ).toMatchObject({ sourceSide: "before", sourceHash: "old-hash" });
    expect(() => decodeReviewFinding({ ...finding, diffExcerpt: "" })).toThrow();
    expect(() => decodeReviewFinding({ ...finding, diffExcerpt: "x".repeat(2_001) })).toThrow();
    expect(() => decodeReviewFinding({ ...finding, sourceSide: "current" })).toThrow();
  });

  it("bounds query tokens and requires the selector the operation actually needs", () => {
    const decode = Schema.decodeUnknownSync(ProjectIndexQueryInput);
    expect(
      decode({
        projectId: "project-a",
        operation: "overview",
        maxTokens: PROJECT_INDEX_MAX_QUERY_TOKENS,
      }).maxTokens,
    ).toBe(PROJECT_INDEX_MAX_QUERY_TOKENS);
    for (const invalid of [
      { operation: "overview", maxTokens: PROJECT_INDEX_MAX_QUERY_TOKENS + 1 },
      { operation: "overview", maxTokens: 1 },
      { operation: "entity" },
      { operation: "callers" },
      { operation: "callees" },
      { operation: "impact" },
      { operation: "search", text: " " },
      { operation: "task" },
      { operation: "overview", scopes: ["../other"] },
    ])
      expect(() => decode({ projectId: "project-a", ...invalid })).toThrow();
  });

  it("retains evidence of unknown and partial usage without fabricating zero", () => {
    const decode = Schema.decodeUnknownSync(ProjectIndexUsageV1);
    expect(decode({ usageStatus: "unavailable", requests: 2 })).toEqual({
      usageStatus: "unavailable",
      requests: 2,
    });
    expect(
      decode({ usageStatus: "partial", requests: 1, inputTokens: 30 }).outputTokens,
    ).toBeUndefined();
    expect(
      decode({ usageStatus: "complete", requests: 1, inputTokens: 0, outputTokens: 0 })
        .outputTokens,
    ).toBe(0);
    expect(() => decode({ usageStatus: "unavailable", requests: 1, inputTokens: 0 })).toThrow();
    expect(() => decode({ usageStatus: "complete", requests: 1 })).toThrow();
  });
});
