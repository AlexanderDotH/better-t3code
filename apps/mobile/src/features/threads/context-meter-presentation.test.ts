import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { EventId } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";
import { contextMeterPresentation } from "./context-meter-presentation";

const english = createInterfaceTranslator({ language: "en", locale: "en-US" });

function snapshot(usedTokens: number, maxTokens?: number) {
  const result = deriveLatestContextWindowSnapshot([
    {
      id: EventId.make("context-usage"),
      kind: "context-window.updated",
      tone: "info",
      summary: "Context usage",
      payload: { usedTokens, maxTokens },
      turnId: null,
      createdAt: "2026-10-15T12:00:00.000Z",
    },
  ]);
  if (result === null) throw new Error("Expected a context usage snapshot");
  return result;
}

describe("mobile context meter presentation", () => {
  it("shows zero usage with an empty neutral ring and accessible token values", () => {
    expect(contextMeterPresentation(snapshot(0, 100_000), english)).toEqual({
      usedTokens: "0",
      limit: "100,000",
      percentage: "0%",
      fill: 0,
      critical: false,
      accessibilityLabel: "Context usage: 0 of 100,000 tokens (0% used)",
    });
  });

  it("keeps the ring neutral through ninety percent, then marks usage as critical", () => {
    expect(contextMeterPresentation(snapshot(90_000, 100_000), english).critical).toBe(false);
    expect(contextMeterPresentation(snapshot(90_100, 100_000), english).critical).toBe(true);
  });

  it("fills the ring at the limit while preserving actual usage above the limit", () => {
    expect(contextMeterPresentation(snapshot(125_000, 100_000), english)).toEqual({
      usedTokens: "125,000",
      limit: "100,000",
      percentage: "125%",
      fill: 1,
      critical: true,
      accessibilityLabel: "Context usage: 125,000 of 100,000 tokens (125% used)",
    });
  });

  it("explains an unknown limit without treating it as zero usage", () => {
    expect(contextMeterPresentation(snapshot(25_000), english)).toEqual({
      usedTokens: "25,000",
      limit: "Limit unknown",
      percentage: "–",
      fill: 0,
      critical: false,
      accessibilityLabel: "Context usage: 25,000 tokens used. Limit unknown.",
    });
  });

  it("uses the selected locale for details and the accessible label", () => {
    const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    const presentation = contextMeterPresentation(snapshot(12_345, 20_000), german);
    expect(presentation.usedTokens).toBe("12.345");
    expect(presentation.limit).toBe("20.000");
    expect(presentation.percentage).toBe("61,7 %");
    expect(presentation.accessibilityLabel).toBe(
      "Kontextnutzung: 12.345 von 20.000 Token (61,7 % genutzt)",
    );
  });
});
