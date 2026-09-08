import { describe, expect, it } from "vite-plus/test";

import { mobileUsageCallMessageKey, visibleMobileContextDiagnostics } from "./usage-presentation";

describe("mobile usage presentation", () => {
  it("keeps Auto routing distinct and exposes every present content-free size counter", () => {
    expect(mobileUsageCallMessageKey("auto-reasoning")).toBe("mobile.usage.calls.auto-reasoning");
    const rows = visibleMobileContextDiagnostics({
      nativeForks: 0,
      compactHandoffs: 0,
      totalHandoffChars: 0,
      compactionEvents: 0,
      maxContextTokens: 200_000,
      instructionChars: 1,
      memoryInjectionChars: 2,
      toolSchemaChars: 3,
      subagentResultChars: 4,
      toolDigestChars: 5,
      autoRoutingChars: 6,
    });
    expect(rows.slice(5).map(({ key }) => key)).toEqual([
      "instructionChars",
      "memoryInjectionChars",
      "toolSchemaChars",
      "subagentResultChars",
      "toolDigestChars",
      "autoRoutingChars",
    ]);
    expect(JSON.stringify(rows)).not.toContain("content");
  });
});
