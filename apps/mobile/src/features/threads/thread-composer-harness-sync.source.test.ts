import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const composerSource = NodeFS.readFileSync(
  new URL("./ThreadComposer.tsx", import.meta.url),
  "utf8",
);

describe("mobile composer harness continuation guard", () => {
  it("disables send and refreshes a confirmed active external session", () => {
    expect(composerSource).toContain("agentSettingsEnvironment.harnessChatSync.status");
    expect(composerSource).toContain("harnessSessionActive");
    expect(composerSource).toContain("!harnessSessionActive");
    expect(composerSource).toContain("Active in another harness");
    expect(composerSource).toContain("refreshHarnessStatus");
  });
});
