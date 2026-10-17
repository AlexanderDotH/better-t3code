import { describe, expect, it } from "vite-plus/test";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import {
  buildPlanImplementationPrompt,
  estimatePlanImplementationWorkUnits,
  formatPlanExecutionDuration,
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

describe("plan execution duration", () => {
  const english = createInterfaceTranslator({ language: "en", locale: "en-US" });

  it.each([
    [2, 5, "Approx. 2–5 min after starting"],
    [20, 59, "Approx. 20–59 min after starting"],
    [20, 60, "Approx. 0.3–1 h after starting"],
    [94, 282, "Approx. 1.6–4.7 h after starting"],
    [480, 1439, "Approx. 8–24 h after starting"],
    [540, 1440, "Approx. 0.4–1 days after starting"],
    [1440, 4320, "Approx. 1–3 days after starting"],
  ])("formats %s–%s minutes as %s", (minMinutes, maxMinutes, expected) => {
    expect(formatPlanExecutionDuration({ minMinutes, maxMinutes }, english)).toBe(expected);
  });

  it("localizes decimal estimates and time units", () => {
    const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });
    expect(formatPlanExecutionDuration({ minMinutes: 94, maxMinutes: 282 }, german)).toBe(
      "Ca. 1,6–4,7 Std. ab Start",
    );
    expect(formatPlanExecutionDuration({ minMinutes: 94, maxMinutes: 282 }, french)).toBe(
      "Env. 1,6–4,7 h après le démarrage",
    );
    expect(formatPlanExecutionDuration({ minMinutes: 1440, maxMinutes: 4320 }, german)).toBe(
      "Ca. 1–3 Tage ab Start",
    );
  });
});
