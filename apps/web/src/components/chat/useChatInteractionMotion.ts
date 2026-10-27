import { useEffect } from "react";
import { createChatInteractionRipple } from "./chatInteractionRipple";

const RIPPLE_DURATION_MS = 460;

function interactionSurface(target: EventTarget | null, viewport: HTMLElement) {
  if (!(target instanceof Element)) return null;
  const control = target.closest<HTMLElement>("button, [role='button']");
  if (
    !control ||
    !viewport.contains(control) ||
    !control.closest("[data-timeline-row-id]") ||
    control.matches(":disabled, [aria-disabled='true'], [data-chat-media-preview]")
  )
    return null;
  // Expanded output belongs to text selection, even when its parent is a row toggle.
  const status = control.querySelector<HTMLElement>(":scope > [data-presentation-status]");
  if (status && !status.contains(target)) return null;
  return status ?? control;
}

export function useChatInteractionMotion(
  viewport: HTMLElement | null,
  enabled: boolean,
  identity: string,
) {
  useEffect(() => {
    if (!viewport || !enabled) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let renderer: ReturnType<typeof createChatInteractionRipple> | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let frame: number | undefined;
    const stop = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      if (canvas) canvas.hidden = true;
    };
    const play = (event: MouseEvent | PointerEvent) => {
      if (
        preference.matches ||
        document.visibilityState !== "visible" ||
        window.getSelection()?.isCollapsed === false
      )
        return;
      const surface = interactionSurface(event.target, viewport);
      if (!surface) return;
      const hover = event.type === "pointerover";
      if (
        hover &&
        ((event as PointerEvent).pointerType !== "mouse" ||
          (event.relatedTarget instanceof Node && surface.contains(event.relatedTarget)))
      )
        return;
      const bounds = surface.getBoundingClientRect();
      const clip = viewport.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.height > 120) return;
      stop();
      if (renderer === undefined) {
        canvas = document.createElement("canvas");
        canvas.className = "better-chat-interaction-ripple";
        canvas.setAttribute("aria-hidden", "true");
        renderer = createChatInteractionRipple(canvas);
        if (renderer) {
          canvas.addEventListener(
            "webglcontextlost",
            () => {
              stop();
              renderer?.dispose();
              renderer = null;
              canvas?.remove();
            },
            { once: true },
          );
          viewport.append(canvas);
        }
      }
      if (!renderer || !canvas) return;
      const appearance = getComputedStyle(surface);
      Object.assign(canvas.style, {
        left: `${bounds.left - clip.left}px`,
        top: `${bounds.top - clip.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        borderRadius: appearance.borderRadius,
      });
      const keyboard = !hover && event.detail === 0;
      renderer.prepare(
        bounds.width,
        bounds.height,
        keyboard ? bounds.width / 2 : event.clientX - bounds.left,
        keyboard ? bounds.height / 2 : event.clientY - bounds.top,
        appearance.color,
        hover ? 0.45 : 1,
      );
      canvas.hidden = false;
      const startedAt = performance.now();
      const paint = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / RIPPLE_DURATION_MS);
        renderer?.paint(progress);
        if (progress < 1) frame = requestAnimationFrame(paint);
        else stop();
      };
      frame = requestAnimationFrame(paint);
    };
    viewport.addEventListener("click", play, true);
    viewport.addEventListener("pointerover", play);
    viewport.addEventListener("scroll", stop, true);
    document.addEventListener("visibilitychange", stop);
    preference.addEventListener("change", stop);
    window.addEventListener("resize", stop);
    return () => {
      stop();
      viewport.removeEventListener("click", play, true);
      viewport.removeEventListener("pointerover", play);
      viewport.removeEventListener("scroll", stop, true);
      document.removeEventListener("visibilitychange", stop);
      preference.removeEventListener("change", stop);
      window.removeEventListener("resize", stop);
      renderer?.dispose();
      canvas?.remove();
    };
  }, [viewport, enabled, identity]);
}
