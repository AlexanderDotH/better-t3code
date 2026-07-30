import { describe, expect, it } from "vite-plus/test";

import { resolveThreadAbortPresentation } from "./threadAbortPresentation";

describe("resolveThreadAbortPresentation", () => {
  it("offers an enabled stop action for a running session", () => {
    expect(
      resolveThreadAbortPresentation({
        status: "running",
        abortState: null,
      }),
    ).toEqual({
      accessibilityLabel: "Stop generation",
      disabled: false,
      phase: null,
      showStopAction: true,
    });
  });

  it("offers an enabled stop action while the runtime is starting", () => {
    expect(
      resolveThreadAbortPresentation({
        status: "starting",
        abortState: null,
      }),
    ).toEqual({
      accessibilityLabel: "Stop generation",
      disabled: false,
      phase: null,
      showStopAction: true,
    });
  });

  it("shows cooperative cancellation as pending and disabled", () => {
    expect(
      resolveThreadAbortPresentation({
        status: "running",
        abortState: { phase: "interrupting" },
      }),
    ).toEqual({
      accessibilityLabel: "Stopping generation",
      disabled: true,
      phase: "interrupting",
      showStopAction: true,
    });
  });

  it("keeps the force-stopping state visible while session settlement catches up", () => {
    expect(
      resolveThreadAbortPresentation({
        status: "stopped",
        abortState: { phase: "force-stopping" },
      }),
    ).toEqual({
      accessibilityLabel: "Force stopping generation",
      disabled: true,
      phase: "force-stopping",
      showStopAction: true,
    });
  });

  it("hides the stop action when no runtime or cancellation is active", () => {
    expect(
      resolveThreadAbortPresentation({
        status: "ready",
        abortState: null,
      }),
    ).toEqual({
      accessibilityLabel: "Stop generation",
      disabled: false,
      phase: null,
      showStopAction: false,
    });
  });
});
