import { observeResize } from "~/lib/observeResize";
import { useLayoutEffect, useRef } from "react";
import { usePanelAnimationSettings } from "../../panelAnimations";
import { COMPOSER_HEIGHT_TRANSITION_EASING } from "../composerFooterLayout";

/** Match the composer's height transition while the list owns its live-edge scroll. */
export function TimelineComposerSpacer({
  height,
  transitionDurationMs,
  onHeightChange,
}: {
  height: number;
  transitionDurationMs: number;
  onHeightChange: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);
  const { active } = usePanelAnimationSettings();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the spacer DOM animation and resize subscription in step with the composer.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const from = animation.current
      ? element.getBoundingClientRect().height
      : previousHeight.current;
    animation.current?.cancel();
    animation.current = null;
    previousHeight.current = height;
    if (
      !active ||
      transitionDurationMs <= 0 ||
      from === null ||
      from <= 0 ||
      height <= 0 ||
      Math.abs(from - height) < 0.5 ||
      typeof element.animate !== "function"
    )
      return;

    const next = element.animate([{ height: `${from}px` }, { height: `${height}px` }], {
      duration: transitionDurationMs,
      easing: COMPOSER_HEIGHT_TRANSITION_EASING,
    });
    animation.current = next;
    next.onfinish = () => {
      if (animation.current === next) animation.current = null;
    };
  }, [active, transitionDurationMs, height]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the spacer DOM animation and resize subscription in step with the composer.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    return observeResize(element, onHeightChange);
  }, [onHeightChange]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the spacer DOM animation and resize subscription in step with the composer.
  useLayoutEffect(
    () => () => {
      animation.current?.cancel();
      animation.current = null;
    },
    [],
  );

  return <div ref={ref} data-timeline-composer-inset style={{ height }} />;
}
