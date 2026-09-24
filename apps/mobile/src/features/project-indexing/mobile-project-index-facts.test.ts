import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  ProjectId,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileProjectIndexFacts,
  mobileStaticProjectIndexResult,
} from "./mobile-project-index-facts";

const range = { startLine: 2, startColumn: 1, endLine: 2, endColumn: 20 };
const source = {
  id: "source-rule",
  filePath: "AGENTS.md",
  sourceHash: "hash",
  range,
  excerpt: "Use source-backed facts.",
  provenance: "parser" as const,
};
const result: ProjectIndexQueryResultV1 = {
  version: 1,
  scope: {
    scopeId: "scope-1",
    projectId: ProjectId.make("project-1"),
    workspaceFingerprint: "workspace-1",
  },
  revision: 3,
  operation: "overview",
  summary: "A generated story about the project",
  entities: [
    {
      id: "entry",
      filePath: "src/index.ts",
      kind: "function",
      name: "entry",
      qualifiedName: "entry",
      language: "typescript",
      range,
      sourceHash: "hash",
      provenance: "parser",
      freshness: "current",
      evidenceIds: [],
    },
    {
      id: "generated",
      filePath: "src/index.ts",
      kind: "function",
      name: "generated",
      qualifiedName: "generated",
      language: "typescript",
      range,
      sourceHash: "hash",
      provenance: "llm",
      freshness: "current",
      evidenceIds: [],
    },
  ],
  callsites: [],
  imports: [
    {
      id: "import-workspace",
      filePath: "src/index.ts",
      sourceHash: "hash",
      range,
      importText: "import { helper } from './helper'",
      specifier: "./helper",
      resolution: "workspace",
      targetPath: "src/helper.ts",
      provenance: "parser",
      freshness: "current",
      evidenceIds: [],
    },
  ],
  modules: [
    {
      id: "package",
      name: "app",
      summary: "package.json",
      entityIds: [],
      filePaths: ["package.json"],
      dependsOnModuleIds: [],
      provenance: "parser",
      freshness: "current",
      evidenceIds: [],
    },
    {
      id: "story",
      name: "Speculative module",
      summary: "Generated description",
      entityIds: [],
      filePaths: [],
      dependsOnModuleIds: [],
      provenance: "llm",
      freshness: "current",
      evidenceIds: [],
    },
  ],
  behaviors: [],
  flows: [],
  rules: [
    {
      id: "rule",
      name: "AGENTS.md",
      description: "Use source-backed facts.",
      severity: "info",
      source: "explicit",
      appliesToEntityIds: [],
      provenance: "parser",
      freshness: "current",
      evidenceIds: [source.id],
    },
  ],
  evidence: [source],
  gaps: [],
  coverage: EMPTY_PROJECT_INDEX_COVERAGE,
  nextCursor: null,
  truncated: false,
  estimatedTokens: 100,
};

describe("mobile static project facts", () => {
  it("keeps manifest, import, explicit rule and original source while hiding generated prose", () => {
    const safe = mobileStaticProjectIndexResult(result);
    const facts = mobileProjectIndexFacts(safe);

    expect(safe.summary).toBe("");
    expect(safe.entities.map((entity) => entity.id)).toEqual(["entry"]);
    expect(facts.packages.map((entry) => entry.name)).toEqual(["app"]);
    expect(facts.imports.map((entry) => [entry.specifier, entry.targetPath])).toEqual([
      ["./helper", "src/helper.ts"],
    ]);
    expect(facts.rules.map((entry) => entry.name)).toEqual(["AGENTS.md"]);
    expect(facts.sources.map((entry) => entry.filePath)).toEqual(["AGENTS.md"]);
  });
});
