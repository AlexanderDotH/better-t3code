import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import {
  createComposerScrollGestureState,
  recordComposerScrollGestureEvent,
  resetComposerScrollGesture,
  shouldCollapseComposerForScrollKey,
  suppressActiveComposerScrollGesture,
} from "./composerScrollGesture";
import { isTimelineScrollTarget } from "./timelineScrollTarget";

const GESTURE_RESET_MS = 120;
const COLLAPSE_THRESHOLD_PX = 24;

export function useComposerScrollCollapse(input: {
  targetKey: string;
  isExistingThread: boolean;
  isMobileViewport: boolean;
  enabled: boolean;
  hasExpandedChrome: boolean;
  hasMultilinePrompt: boolean;
  timelineOverflows: boolean;
  getTimelineScrollableNode: (() => HTMLElement | null) | undefined;
  isTimelineAtLogicalEnd: (() => boolean) | undefined;
}) {
  const [collapsedTarget, setCollapsedTarget] = useState<string | null>(null);
  const gesture = useRef(createComposerScrollGestureState());
  const gestureTarget = useRef(input.targetKey);
  const windowRefocusInFlight = useRef(false);
  const canCollapse =
    input.isExistingThread &&
    !input.isMobileViewport &&
    input.enabled &&
    input.timelineOverflows &&
    !input.hasExpandedChrome &&
    !input.hasMultilinePrompt;
  const isResting = canCollapse && collapsedTarget === input.targetKey;
  if (collapsedTarget !== null && (!canCollapse || collapsedTarget !== input.targetKey)) {
    setCollapsedTarget(null);
  }
  const currentGesture = useStableCallback(() => {
    if (gestureTarget.current !== input.targetKey) {
      resetComposerScrollGesture(gesture.current);
      gestureTarget.current = input.targetKey;
    }
    return gesture.current;
  });
  const restoreAfterTimelineReachedEnd = useStableCallback(() => setCollapsedTarget(null));
  const expandForEditorChange = useStableCallback(() => {
    suppressActiveComposerScrollGesture(currentGesture(), performance.now(), GESTURE_RESET_MS);
    setCollapsedTarget(null);
  });
  const expandForFocus = useStableCallback(() => {
    if (!windowRefocusInFlight.current) setCollapsedTarget(null);
  });
  const collapseForTimelineScrollKey = useStableCallback((key: string) => {
    const node = input.getTimelineScrollableNode?.();
    if (
      canCollapse &&
      node &&
      shouldCollapseComposerForScrollKey({
        key,
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        isAtLogicalEnd: input.isTimelineAtLogicalEnd?.() ?? true,
      })
    )
      setCollapsedTarget(input.targetKey);
  });

  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (event.ctrlKey || !(event.target instanceof Element)) return;
    const node = input.getTimelineScrollableNode?.();
    if (!node || !node.contains(event.target)) return;
    const targetsTimeline = isTimelineScrollTarget(event.target, node, event.deltaY);
    const canScroll =
      targetsTimeline &&
      (event.deltaY < 0
        ? node.scrollTop > 0
        : node.scrollTop < node.scrollHeight - node.clientHeight);
    const deltaPx =
      Math.abs(event.deltaY) *
      (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? node.clientHeight
          : 1);
    if (
      recordComposerScrollGestureEvent(currentGesture(), {
        now: performance.now(),
        deltaPx,
        collapseThresholdPx: COLLAPSE_THRESHOLD_PX,
        collapseEligible: targetsTimeline && canCollapse && !isResting,
        canScrollInGestureDirection: canScroll,
        scrollsTowardLogicalEnd: event.deltaY > 0 && (input.isTimelineAtLogicalEnd?.() ?? true),
      })
    )
      setCollapsedTarget(input.targetKey);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for timeline wheel gestures and releases their momentum suppression after an idle gap
  useEffect(() => {
    if (!input.isExistingThread || input.isMobileViewport) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const handleWheel = (event: WheelEvent) => {
      onWheel(event);
      clearTimeout(timeout);
      timeout = setTimeout(() => resetComposerScrollGesture(gesture.current), GESTURE_RESET_MS);
    };
    document.addEventListener("wheel", handleWheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("wheel", handleWheel, true);
      clearTimeout(timeout);
      resetComposerScrollGesture(gesture.current);
    };
  }, [input.isExistingThread, input.isMobileViewport]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- distinguishes returning window focus from a composer interaction that should expand it
  useEffect(() => {
    if (!isResting) return;
    let frame: number | undefined;
    const onFocus = () => {
      windowRefocusInFlight.current = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        windowRefocusInFlight.current = false;
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (frame !== undefined) cancelAnimationFrame(frame);
      windowRefocusInFlight.current = false;
    };
  }, [isResting]);

  return {
    isResting,
    restoreAfterTimelineReachedEnd,
    expandForEditorChange,
    expandForFocus,
    collapseForTimelineScrollKey,
  };
}
