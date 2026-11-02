import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { observeResize } from "../lib/observeResize";

const HEIGHT_TRANSITION_FALLBACK_MS = 250;

export function AnimatedHeight({
  children,
  holdHeight = false,
  enabled = true,
  containMargins = false,
}: {
  readonly children: ReactNode;
  readonly enabled?: boolean;
  readonly containMargins?: boolean;
  /** Retain the previous content height while a replacement is loading. */
  readonly holdHeight?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [heightState, setHeightState] = useState<{
    readonly height: number | null;
    readonly isClipping: boolean;
  }>({ height: null, isClipping: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fallback timer that ends clipping when the height transition never reports its end
  useEffect(() => {
    if (!heightState.isClipping) return;
    const timeoutId = window.setTimeout(() => {
      setHeightState((currentState) =>
        currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
      );
    }, HEIGHT_TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A height change mid-transition starts a new transition, so the fallback timer restarts.
    heightState.height,
    heightState.isClipping,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the content element and observes its size before paint to animate height
  useLayoutEffect(() => {
    if (holdHeight || !enabled) return;
    const element = contentRef.current;
    if (!element) return;
    let firstFrameId: number | null = null;
    let secondFrameId: number | null = null;
    let previousWidth: number | null = null;
    let resizingByPointer = false;

    const updateHeight = () => {
      const bounds = element.getBoundingClientRect();
      const nextHeight = Math.ceil(element.scrollHeight || bounds.height);
      const animate =
        previousWidth !== null &&
        Math.abs(previousWidth - bounds.width) < 0.5 &&
        !resizingByPointer &&
        document.visibilityState === "visible";
      previousWidth = bounds.width;
      setHeightState((currentState) => {
        if (currentState.height === nextHeight) return currentState;
        return {
          height: nextHeight,
          isClipping: animate && currentState.height !== null,
        };
      });
    };
    const cancelPendingFrames = () => {
      if (firstFrameId !== null) {
        window.cancelAnimationFrame(firstFrameId);
        firstFrameId = null;
      }
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
        secondFrameId = null;
      }
    };
    const updateHeightAfterPaint = () => {
      cancelPendingFrames();
      updateHeight();
      firstFrameId = window.requestAnimationFrame(() => {
        firstFrameId = null;
        updateHeight();
        secondFrameId = window.requestAnimationFrame(() => {
          secondFrameId = null;
          updateHeight();
        });
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      const bounds = target.getBoundingClientRect();
      resizingByPointer =
        event.clientY >= bounds.bottom - 20 &&
        (event.clientX >= bounds.right - 20 || event.clientX <= bounds.left + 20);
    };
    const onPointerUp = () => {
      resizingByPointer = false;
    };
    element.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    const cleanup = () => {
      cancelPendingFrames();
      element.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    updateHeightAfterPaint();
    const stopObserving = observeResize(element, updateHeightAfterPaint);
    return () => {
      stopObserving();
      cleanup();
    };
  }, [holdHeight, enabled]);

  return (
    <div
      data-slot={enabled ? "animated-height" : undefined}
      className={
        enabled && heightState.isClipping
          ? "transition-[height] duration-200 ease-out motion-reduce:transition-none"
          : undefined
      }
      style={
        !enabled || heightState.height === null
          ? undefined
          : {
              height: heightState.height,
              overflow: holdHeight || heightState.isClipping ? "clip" : "visible",
            }
      }
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "height") return;
        setHeightState((currentState) =>
          currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
        );
      }}
    >
      <div
        ref={contentRef}
        className={containMargins ? "flow-root" : undefined}
        style={holdHeight ? { height: "100%" } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
