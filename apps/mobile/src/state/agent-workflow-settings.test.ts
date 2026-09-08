import { describe, expect, it } from "@effect/vitest";

import { resolveMobileAgentWorkflowSettings } from "./agent-workflow-settings";

describe("resolveMobileAgentWorkflowSettings", () => {
  it("hides fork workflow controls when the server does not advertise them", () => {
    expect(
      resolveMobileAgentWorkflowSettings({
        agentWorkflowVersion: undefined,
        experimentalFetch: true,
      }),
    ).toEqual({ supported: false, fetchEnabled: false, fetchMode: undefined });
  });

  it("enables repository Fetch only when both the server and device opt in", () => {
    expect(
      resolveMobileAgentWorkflowSettings({
        agentWorkflowVersion: 1,
        experimentalFetch: true,
      }),
    ).toEqual({
      supported: true,
      fetchEnabled: true,
      fetchMode: "repository-exploration",
    });
  });
});
