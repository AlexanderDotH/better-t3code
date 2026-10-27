import { describe, expect, it } from "vite-plus/test";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { formatReasoningDuration, reasoningDurationMs } from "./reasoningDuration";

const time = (seconds: number) => new Date(Date.UTC(2026, 9, 27, 10, 0, seconds)).toISOString();

describe("reasoning duration", () => {
  it("sums recorded thinking intervals without counting tools or overlapping traces twice", () => {
    expect(
      reasoningDurationMs([
        { createdAt: time(40), updatedAt: time(45) },
        { createdAt: time(0), updatedAt: time(10) },
        { createdAt: time(5), updatedAt: time(20) },
        { createdAt: time(6), updatedAt: time(8) },
      ]),
    ).toBe(25_000);
  });

  it("does not turn missing, invalid, or reversed timing into zero seconds", () => {
    expect(reasoningDurationMs([])).toBeNull();
    expect(reasoningDurationMs([{ createdAt: time(0) }])).toBeNull();
    expect(
      reasoningDurationMs([{ createdAt: time(0), updatedAt: time(10) }, { createdAt: time(20) }]),
    ).toBeNull();
    expect(reasoningDurationMs([{ createdAt: "invalid", updatedAt: time(1) }])).toBeNull();
    expect(reasoningDurationMs([{ createdAt: time(10), updatedAt: time(5) }])).toBeNull();
    expect(reasoningDurationMs([{ createdAt: time(10), updatedAt: time(10) }])).toBe(0);
  });

  it("uses compact duration units consistently across interface languages", () => {
    const en = createInterfaceTranslator({ language: "en", locale: "en-US" });
    const de = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    expect(formatReasoningDuration(81_000, en)).toBe("1m 21s");
    expect(formatReasoningDuration(3_661_000, en)).toBe("1h 1m 1s");
    expect(formatReasoningDuration(81_000, de)).toBe("1m 21s");
    expect(formatReasoningDuration(60_000, en)).toBe("1m");
    expect(formatReasoningDuration(9_000, en)).toBe("9s");
    expect(formatReasoningDuration(200, en)).toBe("<1s");
    expect(formatReasoningDuration(null, en)).toBe("Duration unavailable");
  });
});
