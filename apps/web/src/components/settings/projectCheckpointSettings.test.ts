import { describe, expect, it } from "vite-plus/test";

import { resolveProjectCheckpointSetting } from "./projectCheckpointSettings";

describe("resolveProjectCheckpointSetting", () => {
  it("reports an enabled group only when every checkout is enabled", () => {
    expect(
      resolveProjectCheckpointSetting([{ checkpointsEnabled: true }, { checkpointsEnabled: true }]),
    ).toEqual({ state: "enabled", effectiveEnabled: true });
  });

  it("reports a disabled group when every checkout is disabled", () => {
    expect(
      resolveProjectCheckpointSetting([
        { checkpointsEnabled: false },
        { checkpointsEnabled: false },
      ]),
    ).toEqual({ state: "disabled", effectiveEnabled: false });
  });

  it("reports mixed groups and treats them as disabled until normalized", () => {
    expect(
      resolveProjectCheckpointSetting([
        { checkpointsEnabled: true },
        { checkpointsEnabled: false },
      ]),
    ).toEqual({ state: "mixed", effectiveEnabled: false });
  });
});
