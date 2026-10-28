const COMPOSER_SURFACES =
  "[data-chat-composer-floating-bubble-host], [data-composer-banner-surface]";

const pinnedOcclusions = new WeakMap<HTMLElement, { height: number }>();

/** Keep intermediate widget positions from changing the destination during a resize. */
export function pinComposerOcclusion(overlay: HTMLElement, height: number) {
  const pin = { height };
  pinnedOcclusions.set(overlay, pin);
  return () => {
    if (pinnedOcclusions.get(overlay) === pin) pinnedOcclusions.delete(overlay);
  };
}

/** Include floating surfaces that can extend above the composer's layout box. */
export function measureComposerOcclusion(overlay: HTMLElement, layoutHeight: number): number {
  const pinned = pinnedOcclusions.get(overlay);
  if (pinned) return pinned.height;
  const bounds = overlay.getBoundingClientRect();
  let top = bounds.top;
  for (const surface of overlay.querySelectorAll<HTMLElement>(COMPOSER_SURFACES)) {
    if (surface.closest('[aria-hidden="true"], [inert]')) continue;
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = getComputedStyle(surface);
    if (style.visibility === "hidden" || style.display === "none") continue;
    top = Math.min(top, rect.top);
  }
  return Math.ceil(layoutHeight + Math.max(0, bounds.top - top));
}

/** Watch portal content as well as the outer box, including dismiss/expand transitions. */
export function observeComposerOcclusion(overlay: HTMLElement, onChange: () => void) {
  let frame: number | null = null;
  const scheduleChange = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      onChange();
    });
  };
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleChange);
  const observeSurfaces = () => {
    resizeObserver?.disconnect();
    resizeObserver?.observe(overlay);
    for (const surface of overlay.querySelectorAll<HTMLElement>(COMPOSER_SURFACES)) {
      resizeObserver?.observe(surface);
    }
    scheduleChange();
  };
  const mutations = new MutationObserver(observeSurfaces);
  mutations.observe(overlay, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "inert", "data-hide-empty"],
  });
  overlay.addEventListener("transitionend", scheduleChange);
  overlay.addEventListener("animationend", scheduleChange);
  observeSurfaces();
  return () => {
    resizeObserver?.disconnect();
    mutations.disconnect();
    overlay.removeEventListener("transitionend", scheduleChange);
    overlay.removeEventListener("animationend", scheduleChange);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
