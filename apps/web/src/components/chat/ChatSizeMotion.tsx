import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { useChatVisualMode } from "../../chatVisualModeSync";
import { useBetterT3DeviceFeature } from "../../hooks/useBetterT3Feature";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { AnimatedHeight } from "../AnimatedHeight";

export function useChatSizeMotionEnabled() {
  const better = useChatVisualMode() === "better-t3";
  const enabled = useBetterT3DeviceFeature("chat.presentationMotion");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  return better && enabled && !reduced;
}

export const ChatSizeMotionContext = createContext(false);

/** Own the height once so nested disclosures do not start competing transitions. */
export function ChatSizeMotion({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const motion = useChatSizeMotionEnabled();
  const parent = useContext(ChatSizeMotionContext);
  const active = motion && enabled && !parent;
  return (
    <ChatSizeMotionContext value={parent || active}>
      <AnimatedHeight enabled={active} containMargins>
        {children}
      </AnimatedHeight>
    </ChatSizeMotionContext>
  );
}

/** Animate content-driven width changes; pointer-driven resizing stays immediate. */
export function useChatWidthMotion<T extends HTMLElement>(key: unknown, enabled: boolean) {
  const ref = useRef<T>(null);
  const previous = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const before = animation.current ? element.getBoundingClientRect().width : previous.current;
    animation.current?.cancel();
    animation.current = null;
    const bounds = element.getBoundingClientRect();
    previous.current = bounds.width;
    if (
      !enabled ||
      before === null ||
      Math.abs(before - bounds.width) < 0.5 ||
      bounds.width === 0 ||
      bounds.bottom <= 0 ||
      bounds.top >= window.innerHeight ||
      document.visibilityState !== "visible" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      typeof element.animate !== "function"
    )
      return;
    const next = element.animate(
      { width: [before + "px", bounds.width + "px"] },
      { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    animation.current = next;
    next.onfinish = () => {
      if (animation.current === next) animation.current = null;
    };
  }, [key, enabled]);

  useEffect(() => {
    const reset = () => {
      animation.current?.cancel();
      animation.current = null;
      previous.current = null;
    };
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    window.addEventListener("resize", reset);
    document.addEventListener("visibilitychange", reset);
    media?.addEventListener?.("change", reset);
    return () => {
      reset();
      window.removeEventListener("resize", reset);
      document.removeEventListener("visibilitychange", reset);
      media?.removeEventListener?.("change", reset);
    };
  }, []);
  return ref;
}
