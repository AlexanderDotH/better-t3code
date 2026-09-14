import { foldSubagentActivities } from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { useDeferredValue, useMemo } from "react";

import { deriveLatestContextWindowSnapshot } from "../lib/contextWindow";
import { summarizeThreadTokenUsage } from "../lib/threadTokenUsage";

export function useThreadTokenUsage(
  threadKey: string,
  activities: readonly OrchestrationThreadActivity[],
) {
  const input = useMemo(() => ({ threadKey, activities }), [threadKey, activities]);
  const deferredInput = useDeferredValue<typeof input | null>(input, null);
  return useMemo(
    () =>
      deferredInput?.threadKey === threadKey
        ? summarizeThreadTokenUsage(
            deriveLatestContextWindowSnapshot(deferredInput.activities),
            foldSubagentActivities(deferredInput.activities, { limit: null }),
          )
        : undefined,
    [deferredInput, threadKey],
  );
}
