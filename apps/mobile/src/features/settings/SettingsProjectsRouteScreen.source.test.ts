import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const routeSource = NodeFS.readFileSync(
  new URL("./SettingsProjectsRouteScreen.tsx", import.meta.url),
  "utf8",
);
const syncSource = NodeFS.readFileSync(
  new URL("./HarnessChatSyncSettings.tsx", import.meta.url),
  "utf8",
);

describe("SettingsProjectsRouteScreen harness chat sync source", () => {
  it("loads the environment-scoped history surface behind its advertised capability", () => {
    expect(routeSource).toContain("<HarnessChatSyncEnvironment");
    expect(syncSource).toContain("harnessChatSyncVersion");
    expect(syncSource).toContain("agentSettingsEnvironment.harnessChatSync.sources");
    expect(syncSource).toContain("agentSettingsEnvironment.harnessChatSync.list");
    expect(syncSource).toContain("agentSettingsEnvironment.harnessChatSync.status");
  });

  it("keeps synchronization manual with mobile search, archive, and pagination controls", () => {
    expect(syncSource).toContain("Include archived");
    expect(syncSource).toContain("Load more");
    expect(syncSource).toContain("Sync selected");
    expect(syncSource).toContain("Clear all");
  });

  it("resolves missing workspaces before calling the run mutation", () => {
    expect(syncSource).toContain("HarnessChatTargetResolverModal");
    expect(syncSource).toContain("Apply to all unresolved chats");
    expect(syncSource).toContain("agentSettingsEnvironment.harnessChatSync.run");
  });

  it("surfaces linked, active, changed, and partial-failure states", () => {
    expect(syncSource).toContain("Active elsewhere");
    expect(syncSource).toContain("Already linked");
    expect(syncSource).toContain("Changes available");
    expect(syncSource).toContain("lastResult.failures.map");
  });
});
