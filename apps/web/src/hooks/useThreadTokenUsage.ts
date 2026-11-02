import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { useDeferredValue } from "react";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "../lib/contextWindow";
import { summarizeThreadTokenUsage } from "../lib/threadTokenUsage";

export function useThreadTokenUsage(threadKey: string, projection: ThreadStructure | null) {
  const input = { threadKey, projection };
  const deferred = useDeferredValue<typeof input | null>(input, null);
  const projectionForUsage = deferred?.threadKey === threadKey ? deferred.projection : null;
  if (!projectionForUsage) return undefined;
  const providerThread =
    projectionForUsage.providerThreads.find(
      (thread) => thread.id === projectionForUsage.thread.activeProviderThreadId,
    ) ?? null;
  const liveUsage = latestProviderTurnTokenUsage(
    projectionForUsage.providerTurns,
    projectionForUsage,
    providerThread,
  );
  return summarizeThreadTokenUsage(
    deriveLatestContextWindowSnapshot(
      projectionForUsage.visibleTurnItems,
      liveUsage,
      providerThread,
    ),
    projectedSubagentsToRuntime(projectionForUsage.subagents),
  );
}
