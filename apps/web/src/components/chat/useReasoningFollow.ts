import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

const BOTTOM_TOLERANCE_PX = 4;

/** Follow appended thoughts until the reader scrolls away; schedule only on content changes. */
export function useReasoningFollow(
  contentVersion: unknown,
  reducedMotion: boolean,
  enabled = true,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const scrollingRef = useRef(false);
  const initialRef = useRef(true);
  const previousTopRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const stopSmoothScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (scrollingRef.current && viewport) {
      viewport.scrollTo({ top: viewport.scrollTop, behavior: "instant" });
    }
    scrollingRef.current = false;
  }, []);

  const cancelFollow = useCallback(() => {
    followingRef.current = false;
    stopSmoothScroll();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, [stopSmoothScroll]);

  const scheduleFollow = useCallback(() => {
    if (!enabled || !followingRef.current || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport || !followingRef.current) return;
      const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      scrollingRef.current = !initialRef.current && !reducedMotion;
      initialRef.current = false;
      if (Math.abs(viewport.scrollTop - top) <= BOTTOM_TOLERANCE_PX) return;
      viewport.scrollTo({ top, behavior: scrollingRef.current ? "smooth" : "instant" });
    });
  }, [enabled, reducedMotion]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!enabled || !content) return;
    const observer = new ResizeObserver(scheduleFollow);
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [enabled, scheduleFollow]);

  useLayoutEffect(scheduleFollow, [contentVersion, scheduleFollow]);

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const atBottom =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= BOTTOM_TOLERANCE_PX;
    if (atBottom) {
      followingRef.current = true;
      scrollingRef.current = false;
    } else if (!scrollingRef.current || viewport.scrollTop < previousTopRef.current) {
      cancelFollow();
    }
    previousTopRef.current = viewport.scrollTop;
  }, [cancelFollow]);

  return {
    viewportRef,
    contentRef,
    onScroll,
    onWheel: (event: WheelEvent) => {
      if (event.deltaY < 0) cancelFollow();
    },
    onTouchMove: cancelFollow,
    onPointerDown: (event: PointerEvent) => {
      if (event.target === event.currentTarget) stopSmoothScroll();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) cancelFollow();
    },
  };
}
