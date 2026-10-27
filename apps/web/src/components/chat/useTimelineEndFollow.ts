import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { LegendListRef } from "@legendapp/list/react";

interface TimelineEndFollowOptions {
  listRef: RefObject<LegendListRef | null>;
  identity: string;
  enabled: boolean;
  isFollowingEnd: () => boolean;
  bottomInset: number;
  revision: unknown;
}

/** Follow layout changes even when a large expansion exceeds the list's near-end band. */
export function useTimelineEndFollow(options: TimelineEndFollowOptions) {
  const current = useRef<TimelineEndFollowOptions | null>(null);
  const frame = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const schedule = useCallback(() => {
    if (frame.current !== null || current.current === null) return;
    const identity = current.current.identity;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const latest = current.current;
      if (!latest || identity !== latest.identity || !latest.enabled || !latest.isFollowingEnd())
        return;
      const { listRef } = latest;
      const list = listRef.current;
      const viewport = list?.getScrollableNode();
      if (!list || !viewport || viewport.clientHeight <= 0) return;
      const offset = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      if (Math.abs(viewport.scrollTop - offset) > 1) {
        // Row and footer height transitions already provide the motion. A second
        // smooth scroll would lag behind them and leave the last line obscured.
        void list.scrollToEnd({ animated: false });
      }
    });
  }, []);
  useLayoutEffect(() => {
    const previous = current.current;
    current.current = options;
    if (previous?.identity !== options.identity) cancel();
    if (
      previous?.identity !== options.identity ||
      previous.bottomInset !== options.bottomInset ||
      previous.revision !== options.revision
    )
      schedule();
  });
  useLayoutEffect(
    () => () => {
      cancel();
      current.current = null;
    },
    [cancel],
  );
  return schedule;
}
