export type ThreadAbortPhase = "interrupting" | "force-stopping";

interface ThreadAbortSession {
  readonly status: string;
  readonly abortState: { readonly phase: ThreadAbortPhase } | null;
}

export interface ThreadAbortPresentation {
  readonly accessibilityLabel:
    | "Stop generation"
    | "Stopping generation"
    | "Force stopping generation";
  readonly disabled: boolean;
  readonly phase: ThreadAbortPhase | null;
  readonly showStopAction: boolean;
}

export function resolveThreadAbortPresentation(
  session: ThreadAbortSession | null,
): ThreadAbortPresentation {
  const phase = session?.abortState?.phase ?? null;
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
      accessibilityLabel: "Stopping generation",
      disabled: true,
      phase,
      showStopAction,
    };
  }
  return {
    accessibilityLabel: "Stop generation",
    disabled: false,
    phase,
    showStopAction,
  };
}
