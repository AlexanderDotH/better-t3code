import type { OrchestrationHarnessSyncState, ThreadId } from "@t3tools/contracts";

type HarnessThread = {
  readonly id: ThreadId;
  readonly harnessSync?: OrchestrationHarnessSyncState | null | undefined;
};

export function activeMobileHarnessSession(
  threadId: ThreadId | null,
  detail: HarnessThread | null | undefined,
  shell: HarnessThread | null | undefined,
): OrchestrationHarnessSyncState | null {
  if (threadId === null) return null;
  const detailState = detail?.id === threadId ? detail.harnessSync : undefined;
  const state =
    detailState === undefined
      ? shell?.id === threadId
        ? shell.harnessSync
        : undefined
      : detailState;
  return state?.activity === "active" ? state : null;
}
