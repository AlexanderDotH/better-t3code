import { useEffect, useMemo, useState } from "react";
import { scopedThreadKey } from "../../lib/scopedEntities";

import {
  partitionHomeProjectGroupsByActivity,
  type HomeProjectActivityPartition,
  type HomeThreadGroup,
} from "./homeThreadList";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function useHomeProjectActivity(
  groups: ReadonlyArray<HomeThreadGroup>,
  enabled: boolean,
  settledThreadKeys: ReadonlySet<string>,
): HomeProjectActivityPartition {
  const [boundaryTick, setBoundaryTick] = useState(0);
  const partition = useMemo(
    () =>
      enabled
        ? partitionHomeProjectGroupsByActivity({
            groups,
            nowMs: Date.now(),
            isThreadSettled: (thread) =>
              settledThreadKeys.has(scopedThreadKey(thread.environmentId, thread.id)),
          })
        : { recentGroups: groups, olderGroups: [], nextTransitionAtMs: null },
    [boundaryTick, enabled, groups, settledThreadKeys],
  );

  useEffect(() => {
    if (partition.nextTransitionAtMs === null) return;
    const delay = Math.min(
      Math.max(0, partition.nextTransitionAtMs - Date.now()) + 5,
      MAX_TIMER_DELAY_MS,
    );
    const timeout = setTimeout(() => setBoundaryTick((tick) => tick + 1), delay);
    return () => clearTimeout(timeout);
  }, [partition.nextTransitionAtMs]);

  return partition;
}
