import { RuntimeSessionId, ThreadId, TurnId, type OrchestrationSession } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadAbortPresentation } from "./threadAbort.ts";

const RUNTIME_ONE = RuntimeSessionId.make("runtime-1");
const RUNTIME_TWO = RuntimeSessionId.make("runtime-2");

function makeSession(overrides: Partial<OrchestrationSession> = {}): OrchestrationSession {
  return {
    threadId: ThreadId.make("thread-1"),
    status: "running",
    providerName: "codex",
    runtimeSessionId: RUNTIME_ONE,
    runtimeMode: "full-access",
    activeTurnId: TurnId.make("turn-1"),
    abortState: null,
    lastError: null,
    updatedAt: "2026-07-31T08:00:00.000Z",
    ...overrides,
  };
}

describe("resolveThreadAbortPresentation", () => {
  it("offers an enabled stop action for an active runtime", () => {
    expect(resolveThreadAbortPresentation(makeSession())).toEqual({
      accessibilityLabel: "Stop generation",
      disabled: false,
      phase: null,
      showStopAction: true,
    });
  });

  it("shows cooperative cancellation for the matching runtime", () => {
    expect(
      resolveThreadAbortPresentation(
        makeSession({
          abortState: {
            runtimeSessionId: RUNTIME_ONE,
            targetTurnId: TurnId.make("turn-1"),
            phase: "interrupting",
            requestedAt: "2026-07-31T08:00:01.000Z",
            forceAt: "2026-07-31T08:00:06.000Z",
          },
        }),
      ),
    ).toEqual({
      accessibilityLabel: "Stopping generation",
      disabled: true,
      phase: "interrupting",
      showStopAction: true,
    });
  });

  it("keeps forced cancellation visible until the matching abort settles", () => {
    expect(
      resolveThreadAbortPresentation(
        makeSession({
          status: "stopped",
          abortState: {
            runtimeSessionId: RUNTIME_ONE,
            targetTurnId: TurnId.make("turn-1"),
            phase: "force-stopping",
            requestedAt: "2026-07-31T08:00:01.000Z",
            forceAt: "2026-07-31T08:00:06.000Z",
          },
        }),
      ),
    ).toEqual({
      accessibilityLabel: "Force stopping generation",
      disabled: true,
      phase: "force-stopping",
      showStopAction: true,
    });
  });

  it("discards a stale abort when a newer runtime replaces it", () => {
    expect(
      resolveThreadAbortPresentation(
        makeSession({
          runtimeSessionId: RUNTIME_TWO,
          abortState: {
            runtimeSessionId: RUNTIME_ONE,
            targetTurnId: TurnId.make("turn-1"),
            phase: "force-stopping",
            requestedAt: "2026-07-31T08:00:01.000Z",
            forceAt: "2026-07-31T08:00:06.000Z",
          },
        }),
      ),
    ).toEqual({
      accessibilityLabel: "Stop generation",
      disabled: false,
      phase: null,
      showStopAction: true,
    });
  });

  it("hides the stop action after the synchronized abort settles", () => {
    expect(
      resolveThreadAbortPresentation(
        makeSession({
          status: "ready",
          activeTurnId: null,
          abortState: null,
        }),
      ),
    ).toEqual({
      accessibilityLabel: "Stop generation",
      disabled: false,
      phase: null,
      showStopAction: false,
    });
  });
});
