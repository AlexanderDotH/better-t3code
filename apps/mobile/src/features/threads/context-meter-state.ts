import {
  deriveLatestContextWindowSnapshot,
  type ContextWindowSnapshot,
} from "@t3tools/client-runtime/context-window";
import type { OrchestrationThreadActivity, ThreadId } from "@t3tools/contracts";

export function selectedThreadContextWindowSnapshot(
  selectedThreadId: ThreadId | undefined,
  detailThreadId: ThreadId | undefined,
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
) {
  return selectedThreadId !== undefined && selectedThreadId === detailThreadId && activities
    ? deriveLatestContextWindowSnapshot(activities)
    : null;
}

export function visibleContextWindowSnapshot(
  snapshot: ContextWindowSnapshot | null,
  options: { readonly enabled: boolean; readonly loading: boolean },
) {
  return options.enabled && !options.loading ? snapshot : null;
}
