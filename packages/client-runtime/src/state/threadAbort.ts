import type { OrchestrationSession, OrchestrationTurnAbortPhase } from "@t3tools/contracts";

export interface ThreadAbortPresentation {
  readonly accessibilityLabel:
    | "Stop generation"
    | "Force stop generation"
    | "Force stopping generation";
  readonly disabled: boolean;
  readonly phase: OrchestrationTurnAbortPhase | null;
  readonly showStopAction: boolean;
}

function currentAbortPhase(
  session: OrchestrationSession | null,
): OrchestrationTurnAbortPhase | null {
  const abortState = session?.abortState;
  if (
    !session ||
    !abortState ||
    session.runtimeSessionId === null ||
    abortState.runtimeSessionId !== session.runtimeSessionId
  ) {
    return null;
  }
  return abortState.phase;
}

export function resolveThreadAbortPresentation(
  session: OrchestrationSession | null,
): ThreadAbortPresentation {
  const phase = currentAbortPhase(session);
  const showStopAction =
    phase !== null || session?.status === "running" || session?.status === "starting";

  if (phase === "force-stopping") {
    return {
      accessibilityLabel: "Force stopping generation",
      disabled: true,
      phase,
      showStopAction,
    };
  }
  if (phase === "interrupting") {
    return {
      accessibilityLabel: "Force stop generation",
      disabled: false,
      phase,
      showStopAction,
    };
  }
  return {
    accessibilityLabel: "Stop generation",
    disabled: false,
    phase: null,
    showStopAction,
  };
}
