import { createChatInteractionRipple } from "./chatInteractionRipple";

const ARRIVAL_DURATION_MS = 620;

/** Reuse one finite shader sweep, attached below the arriving message's text. */
export function createChatMessageArrival(viewport: HTMLElement) {
  const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let renderer: ReturnType<typeof createChatInteractionRipple> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let frame: number | undefined;
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    canvas?.remove();
  };
  const play = (surface: HTMLElement) => {
    if (preference?.matches || document.visibilityState !== "visible") return;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    stop();
    if (renderer === undefined) {
      canvas = document.createElement("canvas");
      canvas.className = "better-chat-arrival";
      canvas.setAttribute("aria-hidden", "true");
      renderer = createChatInteractionRipple(canvas);
      canvas.addEventListener(
        "webglcontextlost",
        () => {
          stop();
          renderer?.dispose();
          renderer = null;
        },
        { once: true },
      );
    }
    if (!renderer || !canvas) return;
    surface.append(canvas);
    const color = getComputedStyle(surface.parentElement ?? surface).color;
    renderer.prepare(bounds.width, bounds.height, 0, bounds.height, color, 0.75, true);
    const startedAt = performance.now();
    const paint = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / ARRIVAL_DURATION_MS);
      renderer?.paint(progress);
      if (progress < 1) frame = requestAnimationFrame(paint);
      else stop();
    };
    frame = requestAnimationFrame(paint);
  };
  viewport.addEventListener("scroll", stop, true);
  window.addEventListener("resize", stop);
  document.addEventListener("visibilitychange", stop);
  preference?.addEventListener?.("change", stop);
  return {
    play,
    stop,
    dispose() {
      stop();
      renderer?.dispose();
      viewport.removeEventListener("scroll", stop, true);
      window.removeEventListener("resize", stop);
      document.removeEventListener("visibilitychange", stop);
      preference?.removeEventListener?.("change", stop);
    },
  };
}
