import { describe, expect, it } from "@effect/vitest";

import { rangeFromOffsets } from "../extraction/source.ts";
import {
  assertProjectIndexPromptFits,
  projectIndexContextBudget,
  selectProjectIndexContextBudget,
} from "./ProjectIndexContextBudget.ts";
import { splitProjectIndexSourceRange } from "./ProjectIndexSourceUnits.ts";

describe("review source budgets", () => {
  it("selects a supported context window that fits the request", () => {
    const capabilities = {
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 8_192,
      supportedContextWindows: [32_768, 131_072, 1_048_576],
    };
    expect(
      selectProjectIndexContextBudget("x".repeat(5_000), capabilities).contextWindowTokens,
    ).toBe(32_768);
    expect(
      selectProjectIndexContextBudget("x".repeat(100_000), capabilities).contextWindowTokens,
    ).toBe(131_072);
    expect(() => selectProjectIndexContextBudget("x".repeat(2_000_000), capabilities)).toThrow();
  });

  it("rejects a source request larger than the selected model capacity", () => {
    const budget = projectIndexContextBudget({
      contextWindowTokens: 32_768,
      maxOutputTokens: 8_192,
    });
    expect(() => assertProjectIndexPromptFits("x".repeat(250_000), budget)).toThrow();
  });

  it("splits long Unicode source without dropping or corrupting characters", () => {
    const source = `class Example {\n${"🙂𐐀漢字".repeat(3_000)}\n}\n`;
    const parts = splitProjectIndexSourceRange({
      source,
      range: rangeFromOffsets(source, 0, source.length),
      maximumSourceTokens: 512,
    });
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.map((part) => source.slice(part.startOffset, part.endOffset)).join("")).toBe(
      source,
    );
    for (const part of parts) {
      const text = source.slice(part.startOffset, part.endOffset);
      expect(Buffer.byteLength(JSON.stringify(text), "utf8")).toBeLessThanOrEqual(512);
      expect(text.isWellFormed()).toBe(true);
    }
  });
});
