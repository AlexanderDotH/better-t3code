import { describe, expect, it } from "vitest";

import { knowledgeGraphDependencyNameFromSpecifier } from "./KnowledgeGraphSourceAnalysis.ts";

describe("knowledgeGraphDependencyNameFromSpecifier", () => {
  it("keeps dependency labels non-empty for supported and path-like specifiers", () => {
    expect(knowledgeGraphDependencyNameFromSpecifier("@effect/platform-node/NodeFileSystem")).toBe(
      "@effect/platform-node",
    );
    expect(knowledgeGraphDependencyNameFromSpecifier("node:fs/promises")).toBe("node");
    expect(knowledgeGraphDependencyNameFromSpecifier("/workspace/src/main.ts")).toBe("workspace");
    expect(knowledgeGraphDependencyNameFromSpecifier("/")).toBe("unknown");
  });
});
