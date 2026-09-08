import { describe, expect, it } from "vite-plus/test";

import {
  buildPlanImplementationPrompt,
  estimatePlanImplementationWorkUnits,
} from "./planImplementation.ts";
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  normalizePlanMarkdownForExport,
} from "./proposedPlan.ts";

describe("shared plan presentation", () => {
  it("does not count fenced examples as implementation work", () => {
    expect(
      estimatePlanImplementationWorkUnits("## Work\n1. Build\n2. Verify\n```\n3. Example\n```"),
    ).toBe(2);
    expect(buildPlanImplementationPrompt("  Build it  ")).toBe(
      "PLEASE IMPLEMENT THIS PLAN:\nBuild it",
    );
    expect(() =>
      buildPlanImplementationPrompt("Build it", { strategy: { kind: "subagents", count: 8 } }),
    ).toThrow("Selected provider does not support native subagents");
  });

  it("keeps the exported plan intact while truncating its preview", () => {
    const plan = "# Plan\n\n## Summary\n\nFirst\nSecond\nThird";
    expect(buildCollapsedProposedPlanPreviewMarkdown(plan, { maxLines: 2 })).toContain(
      "First\nSecond",
    );
    expect(normalizePlanMarkdownForExport(plan)).toContain("Third");
  });
});
