import { describe, expect, it } from "vite-plus/test";

import { createAgentSettingsEnvironmentAtoms } from "./agentSettings.ts";

describe("agent settings environment atoms", () => {
  it("exposes every harness chat sync command", () => {
    const atoms = createAgentSettingsEnvironmentAtoms({} as never);

    expect(atoms.harnessChatSync.sources).toBeDefined();
    expect(atoms.harnessChatSync.list).toBeDefined();
    expect(atoms.harnessChatSync.run).toBeDefined();
    expect(atoms.harnessChatSync.status).toBeDefined();
  });
});
