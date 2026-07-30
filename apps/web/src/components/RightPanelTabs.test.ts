import { SubagentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rightPanelSurfaceTitle } from "./RightPanelTabs";

describe("rightPanelSurfaceTitle", () => {
  it("presents the singleton subagent transcript as the Agent surface", () => {
    expect(
      rightPanelSurfaceTitle(
        {
          id: "subagent",
          kind: "subagent",
          subagentId: SubagentId.make("agent-runtime"),
        },
        {},
        new Map(),
      ),
    ).toBe("Agent");
  });
});
