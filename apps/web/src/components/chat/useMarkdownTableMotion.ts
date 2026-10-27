import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

function canAnimate() {
  return (
    document.visibilityState === "visible" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Animate prepared toggles and keyboard sizes, never restored geometry or a drag. */
export function useMarkdownTableMotion(
  ref: RefObject<HTMLDivElement | null>,
  geometry: unknown,
  enabled: boolean,
) {
  const [animating, setAnimating] = useState(false);
  const beforeRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const cancel = useCallback(() => {
    const animation = animationRef.current;
    const bounds = animation ? ref.current?.getBoundingClientRect() : undefined;
    animationRef.current = null;
    animation?.cancel();
    if (animation) {
      setAnimating(false);
      ref.current?.removeAttribute("data-table-animating");
    }
    return bounds;
  }, [ref]);
  const prepare = useCallback(() => {
    if (!enabled || !canAnimate()) return;
    const bounds = ref.current?.getBoundingClientRect() ?? null;
    cancel();
    beforeRef.current = bounds;
  }, [cancel, enabled, ref]);

  useLayoutEffect(() => {
    const before = beforeRef.current;
    beforeRef.current = null;
    cancel();
    const element = ref.current;
    if (!enabled || !before || !element?.animate || !canAnimate()) return;
    const after = element.getBoundingClientRect();
    if (before.width === after.width && before.height === after.height) return;
    element.setAttribute("data-table-animating", "");
    const animation = element.animate(
      {
        width: [before.width + "px", after.width + "px"],
        height: [before.height + "px", after.height + "px"],
      },
      {
        duration: 280,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    );
    animationRef.current = animation;
    setAnimating(true);
    animation.onfinish = () => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      setAnimating(false);
      element.removeAttribute("data-table-animating");
    };
    return () => {
      cancel();
    };
  }, [cancel, geometry, enabled, ref]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const stop = () => {
      beforeRef.current = null;
      cancel();
    };
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", stop);
    window.addEventListener("resize", stop);
    media?.addEventListener?.("change", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", stop);
      window.removeEventListener("resize", stop);
      media?.removeEventListener?.("change", stop);
    };
  }, [cancel, enabled]);
  return { prepare, cancel, animating };
}
