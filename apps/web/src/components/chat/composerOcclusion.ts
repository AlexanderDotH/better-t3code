const COMPOSER_SURFACES =
  "[data-chat-composer-floating-bubble-host], [data-composer-banner-surface]";

/** Include floating surfaces that can extend above the composer's layout box. */
export function measureComposerOcclusion(overlay: HTMLElement, layoutHeight: number): number {
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
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onChange);
  const observeSurfaces = () => {
    resizeObserver?.disconnect();
    resizeObserver?.observe(overlay);
    for (const surface of overlay.querySelectorAll<HTMLElement>(COMPOSER_SURFACES)) {
      resizeObserver?.observe(surface);
    }
    onChange();
  };
  const mutations = new MutationObserver(observeSurfaces);
  mutations.observe(overlay, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "inert", "data-hide-empty"],
  });
  overlay.addEventListener("transitionend", onChange);
  overlay.addEventListener("animationend", onChange);
  observeSurfaces();
  return () => {
    resizeObserver?.disconnect();
    mutations.disconnect();
    overlay.removeEventListener("transitionend", onChange);
    overlay.removeEventListener("animationend", onChange);
  };
}
