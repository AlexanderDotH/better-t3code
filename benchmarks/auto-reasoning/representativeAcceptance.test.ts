import { describe, expect, it } from "vite-plus/test";

import { REPRESENTATIVE_AUTO_REASONING_ACCEPTANCE, reduction } from "./representativeAcceptance";

describe("representative Auto Reasoning acceptance fixtures", () => {
  it("keeps an existing manual reasoning selection unchanged", () => {
    const fixture = REPRESENTATIVE_AUTO_REASONING_ACCEPTANCE.manualReasoning;
    expect(fixture.after).toBe(fixture.before);
  });

  it("presents the resolved Auto effort on web and mobile", () => {
    const fixture = REPRESENTATIVE_AUTO_REASONING_ACCEPTANCE.autoUi;
    expect(fixture.web).toBe("Auto · High");
    expect(fixture.mobile).toBe("Auto · High");
  });

  it("reserves a distinct content-free Auto routing attribution", () => {
    const fixture = REPRESENTATIVE_AUTO_REASONING_ACCEPTANCE.usageAttribution;
    expect(fixture.marker).toBe("<t3code_auto_reasoning_call>");
    expect(fixture.callKind).toBe("auto-reasoning");
    expect(JSON.stringify(fixture)).not.toContain("prompt content");
  });

  it("meets every deterministic size and total-token target", () => {
    const fixture = REPRESENTATIVE_AUTO_REASONING_ACCEPTANCE;
    for (const target of [
      fixture.staticPrompt,
      fixture.optionalToolSchemas,
      fixture.largeToolDigest,
      fixture.eightAgentHandoff,
    ]) {
      expect(reduction(target.baselineChars, target.optimizedChars)).toBeGreaterThanOrEqual(
        target.minimumReduction,
      );
    }
    expect(
      reduction(
        fixture.mixedRouting.fixedMaxTokens,
        fixture.mixedRouting.routedWorkTokens + fixture.mixedRouting.routerOverheadTokens,
      ),
    ).toBeGreaterThanOrEqual(fixture.mixedRouting.minimumReduction);
  });
});
