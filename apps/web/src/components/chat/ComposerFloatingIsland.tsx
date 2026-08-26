import { useCallback, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";

import {
  SURFACE_MORPH_EXIT_DURATION_MS,
  buildDropletMorphDescriptor,
  captureSurfaceGeometry,
  prefersReducedSurfaceMotion,
  resolveSurfaceMorphOrigin,
} from "./surfaceMorph";

import "./ComposerSurfaceMorph.css";

export const FLOATING_ISLAND_EXIT_DURATION_MS = SURFACE_MORPH_EXIT_DURATION_MS;

type FloatingIslandMotion = "enter" | "exit";

export function resolveFloatingIslandMotion({
  addedSurfaceCount,
  isVisible,
  removedSurfaceCount,
  wasVisible,
}: {
  readonly addedSurfaceCount: number;
  readonly isVisible: boolean;
  readonly removedSurfaceCount: number;
  readonly wasVisible: boolean;
}): FloatingIslandMotion | null {
  if (addedSurfaceCount > 0 && isVisible) return "enter";
  if (removedSurfaceCount > 0 && wasVisible) return isVisible ? "enter" : "exit";
  if (!wasVisible && isVisible) return "enter";
  if (wasVisible && !isVisible) return "exit";
  return null;
}

const ISLAND_SECTION_SELECTOR = ".chat-composer-floating-island-section";
const MORPH_ORIGIN_SELECTOR = "[data-composer-surface-morph-origin]";
const MORPH_TRIGGER_SELECTOR = "[data-composer-surface-morph-trigger]";

type SurfaceRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type IslandSnapshot = {
  readonly clone: HTMLElement;
  readonly geometry: ReturnType<typeof captureSurfaceGeometry>;
  readonly originKey: string | null;
};

type InterruptedPanelStyle = {
  readonly borderRadius: string;
  readonly clipPath: string;
  readonly transform: string;
};

type InterruptedChromeStyle = {
  readonly borderRadius: string;
  readonly height: string;
  readonly left: string;
  readonly top: string;
  readonly width: string;
};

type InterruptedNeckStyle = {
  readonly opacity: string;
  readonly transform: string;
};

type InterruptedDropletStyle = {
  readonly chrome: InterruptedChromeStyle;
  readonly neck: InterruptedNeckStyle;
  readonly panel: InterruptedPanelStyle;
};

type ActiveDropletMotion = {
  readonly animations: ReadonlyArray<Animation>;
  readonly contentTarget: HTMLElement;
  readonly token: number;
};

function toSurfaceRect(rect: DOMRect): SurfaceRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function setForwardedRef<T>(ref: Ref<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) ref.current = value;
}

function surfaceRoots(island: HTMLElement, portalHost: HTMLElement): ReadonlyArray<HTMLElement> {
  const sections = Array.from(island.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.matches(ISLAND_SECTION_SELECTOR),
  );
  const drawers = Array.from(portalHost.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  return [...sections, ...drawers];
}

function countChangedSurfaces(
  nodes: NodeList,
  mutationTarget: Node,
  island: HTMLElement,
  portalHost: HTMLElement,
): number {
  if (mutationTarget !== island && mutationTarget !== portalHost) return 0;
  let count = 0;
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (mutationTarget === portalHost || node.matches(ISLAND_SECTION_SELECTOR)) count += 1;
  }
  return count;
}

function readOriginKey(roots: ReadonlyArray<HTMLElement>): string | null {
  for (const root of roots.toReversed()) {
    const marked = root.matches(MORPH_ORIGIN_SELECTOR)
      ? root
      : root.querySelector<HTMLElement>(MORPH_ORIGIN_SELECTOR);
    const key = marked?.dataset.composerSurfaceMorphOrigin?.trim();
    if (key) return key;
  }
  return null;
}

function findMarkedTrigger(key: string): HTMLElement | null {
  for (const trigger of document.querySelectorAll<HTMLElement>(MORPH_TRIGGER_SELECTOR)) {
    if (trigger.dataset.composerSurfaceMorphTrigger === key) return trigger;
  }
  return null;
}

function cloneForExit(island: HTMLElement): HTMLElement {
  const clone = island.cloneNode(true) as HTMLElement;
  clone.dataset.composerSurfaceMorphExitGhost = "true";
  clone.removeAttribute("data-composer-surface-morph-content-active");
  clone.removeAttribute("id");
  for (const identifiedElement of clone.querySelectorAll<HTMLElement>("[id]")) {
    identifiedElement.removeAttribute("id");
  }
  return clone;
}

function copyChromeTokens(source: HTMLElement, target: HTMLElement): void {
  const computed = window.getComputedStyle(source);
  for (const property of [
    "--chat-composer-floating-island-outline",
    "--chat-composer-floating-island-surface",
    "--glass-opacity",
    "--glass-blur",
    "--glass-saturation",
  ]) {
    target.style.setProperty(property, computed.getPropertyValue(property));
  }
}

function positionChrome(
  chrome: HTMLElement,
  geometry: ReturnType<typeof captureSurfaceGeometry>,
): void {
  chrome.style.left = `${geometry.rect.left}px`;
  chrome.style.top = `${geometry.rect.top}px`;
  chrome.style.width = `${geometry.rect.width}px`;
  chrome.style.height = `${geometry.rect.height}px`;
}

function reverseKeyframes(keyframes: ReadonlyArray<Keyframe>): Keyframe[] {
  return keyframes.toReversed().map((keyframe) => {
    if (typeof keyframe.offset !== "number") return { ...keyframe };
    return { ...keyframe, offset: 1 - keyframe.offset };
  });
}

function withInterruptedStart(
  keyframes: ReadonlyArray<Keyframe>,
  interrupted: InterruptedChromeStyle | InterruptedNeckStyle | InterruptedPanelStyle | null,
): Keyframe[] {
  if (!interrupted || keyframes.length === 0) return [...keyframes];
  const [first, ...rest] = keyframes;
  return [{ ...first, ...interrupted, offset: 0 }, ...rest];
}

export function ComposerFloatingIsland({
  children,
  portalHostRef,
}: {
  readonly children: ReactNode;
  readonly portalHostRef: Ref<HTMLDivElement>;
}) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const islandRef = useRef<HTMLDivElement | null>(null);
  const internalPortalHostRef = useRef<HTMLDivElement | null>(null);
  const morphLayerRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const neckRef = useRef<HTMLDivElement | null>(null);
  const previousVisibleRef = useRef(false);
  const lastSnapshotRef = useRef<IslandSnapshot | null>(null);
  const activeMotionRef = useRef<ActiveDropletMotion | null>(null);
  const motionTokenRef = useRef(0);
  const triggerRectsRef = useRef(new Map<string, SurfaceRect>());

  const attachPortalHostRef = useCallback(
    (element: HTMLDivElement | null) => {
      internalPortalHostRef.current = element;
      setForwardedRef(portalHostRef, element);
    },
    [portalHostRef],
  );

  useLayoutEffect(() => {
    const region = regionRef.current;
    const island = islandRef.current;
    const portalHost = internalPortalHostRef.current;
    const layer = morphLayerRef.current;
    const chrome = chromeRef.current;
    const neck = neckRef.current;
    if (!region || !island || !portalHost || !layer || !chrome || !neck) return;

    const clearVisualState = () => {
      region.removeAttribute("data-composer-surface-morph-state");
      island.removeAttribute("data-composer-surface-morph-content-active");
      layer.removeAttribute("data-composer-surface-morph-state");
      layer.removeAttribute("data-composer-surface-morph-origin-mode");
      chrome.replaceChildren();
      for (const ghost of layer.querySelectorAll<HTMLElement>(
        ':scope > [data-composer-surface-morph-exit-ghost="true"]',
      )) {
        ghost.remove();
      }
      for (const element of [chrome, neck]) element.removeAttribute("style");
    };

    const cancelActiveMotion = (preserveContent: boolean): InterruptedDropletStyle | null => {
      const active = activeMotionRef.current;
      if (!active) return null;
      let interrupted: InterruptedDropletStyle | null = null;
      if (preserveContent && active.contentTarget.isConnected) {
        const panelStyle = window.getComputedStyle(active.contentTarget);
        const chromeStyle = window.getComputedStyle(chrome);
        const neckStyle = window.getComputedStyle(neck);
        interrupted = {
          chrome: {
            borderRadius: chromeStyle.borderRadius,
            height: chromeStyle.height,
            left: chromeStyle.left,
            top: chromeStyle.top,
            width: chromeStyle.width,
          },
          neck: { opacity: neckStyle.opacity, transform: neckStyle.transform },
          panel: {
            borderRadius: panelStyle.borderRadius,
            clipPath: panelStyle.clipPath,
            transform: panelStyle.transform,
          },
        };
        Object.assign(active.contentTarget.style, interrupted.panel);
      }
      motionTokenRef.current += 1;
      for (const animation of active.animations) animation.cancel();
      activeMotionRef.current = null;
      clearVisualState();
      return interrupted;
    };

    const snapshotIsland = (): IslandSnapshot | null => {
      const roots = surfaceRoots(island, portalHost);
      if (roots.length === 0) return null;
      const snapshot = {
        clone: cloneForExit(island),
        geometry: captureSurfaceGeometry(island),
        originKey: readOriginKey(roots),
      };
      lastSnapshotRef.current = snapshot;
      return snapshot;
    };

    const resolveOrigin = (
      geometry: ReturnType<typeof captureSurfaceGeometry>,
      originKey: string | null,
    ) => {
      const overlay = region.closest<HTMLElement>('[data-chat-composer-overlay="true"]');
      const composer = overlay?.querySelector<HTMLElement>(
        '[data-chat-composer-main-surface="true"]',
      );
      const fallbackComposerRect: SurfaceRect = {
        left: geometry.rect.left,
        top: geometry.rect.top + geometry.rect.height + 16,
        width: geometry.rect.width,
        height: 1,
      };
      const liveTrigger = originKey ? findMarkedTrigger(originKey) : null;
      const triggerRect = originKey
        ? (triggerRectsRef.current.get(originKey) ??
          (liveTrigger ? toSurfaceRect(liveTrigger.getBoundingClientRect()) : undefined))
        : undefined;
      return {
        mode: triggerRect ? ("trigger" as const) : ("automatic-edge" as const),
        origin: resolveSurfaceMorphOrigin({
          composerRect: composer
            ? toSurfaceRect(composer.getBoundingClientRect())
            : fallbackComposerRect,
          destinationRect: geometry.rect,
          ...(triggerRect ? { triggerRect } : {}),
        }),
      };
    };

    const settleWhenFinished = (
      animations: ReadonlyArray<Animation>,
      token: number,
      onSettled: () => void,
    ) => {
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (activeMotionRef.current?.token !== token) return;
        activeMotionRef.current = null;
        clearVisualState();
        onSettled();
      });
    };

    const playEnter = () => {
      const interrupted = cancelActiveMotion(true);
      if (interrupted) {
        for (const property of ["border-radius", "clip-path", "transform"]) {
          island.style.removeProperty(property);
        }
      }
      const snapshot = snapshotIsland();
      if (!snapshot) return;
      if (interrupted) Object.assign(island.style, interrupted.panel);
      if (
        document.hidden ||
        prefersReducedSurfaceMotion(window) ||
        typeof island.animate !== "function"
      ) {
        for (const property of ["border-radius", "clip-path", "transform"]) {
          island.style.removeProperty(property);
        }
        return;
      }

      const { mode, origin } = resolveOrigin(snapshot.geometry, snapshot.originKey);
      const descriptor = buildDropletMorphDescriptor({
        destination: snapshot.geometry,
        origin,
      });
      copyChromeTokens(island, chrome);
      positionChrome(chrome, snapshot.geometry);
      Object.assign(chrome.style, descriptor.chromeStyles);
      Object.assign(neck.style, descriptor.neckStyles);
      region.dataset.composerSurfaceMorphState = "enter";
      island.dataset.composerSurfaceMorphContentActive = "true";
      layer.dataset.composerSurfaceMorphState = "enter";
      layer.dataset.composerSurfaceMorphOriginMode = mode;

      const panelKeyframes = withInterruptedStart(
        descriptor.panelKeyframes,
        interrupted?.panel ?? null,
      );
      const chromeKeyframes = withInterruptedStart(
        descriptor.chromeKeyframes,
        interrupted?.chrome ?? null,
      );
      const neckKeyframes = withInterruptedStart(
        descriptor.neckKeyframes,
        interrupted?.neck ?? null,
      );
      const options = { ...descriptor.options, fill: "both" as const };
      const contentAnimation = island.animate(panelKeyframes, options);
      contentAnimation.id = "t3-composer-floating-island-droplet-content";
      const chromeAnimation = chrome.animate(chromeKeyframes, options);
      chromeAnimation.id = "t3-composer-floating-island-droplet-chrome";
      const neckAnimation = neck.animate(neckKeyframes, options);
      neckAnimation.id = "t3-composer-floating-island-droplet-neck";
      for (const property of ["border-radius", "clip-path", "transform"]) {
        island.style.removeProperty(property);
      }

      const token = (motionTokenRef.current += 1);
      const animations = [contentAnimation, chromeAnimation, neckAnimation];
      activeMotionRef.current = { animations, contentTarget: island, token };
      settleWhenFinished(animations, token, () => {
        snapshotIsland();
      });
    };

    const playExit = () => {
      const snapshot = lastSnapshotRef.current;
      if (!snapshot) return;
      cancelActiveMotion(false);
      if (
        document.hidden ||
        prefersReducedSurfaceMotion(window) ||
        typeof chrome.animate !== "function"
      ) {
        clearVisualState();
        return;
      }

      const { mode, origin } = resolveOrigin(snapshot.geometry, snapshot.originKey);
      const descriptor = buildDropletMorphDescriptor({
        destination: snapshot.geometry,
        origin,
      });
      copyChromeTokens(island, chrome);
      positionChrome(chrome, snapshot.geometry);
      Object.assign(chrome.style, descriptor.chromeStyles);
      positionChrome(snapshot.clone, snapshot.geometry);
      layer.append(snapshot.clone);
      Object.assign(neck.style, descriptor.neckStyles);
      region.dataset.composerSurfaceMorphState = "exit";
      layer.dataset.composerSurfaceMorphState = "exit";
      layer.dataset.composerSurfaceMorphOriginMode = mode;
      if (surfaceRoots(island, portalHost).length > 0) {
        island.dataset.composerSurfaceMorphContentActive = "true";
      }

      const options = {
        ...descriptor.options,
        duration: FLOATING_ISLAND_EXIT_DURATION_MS,
        fill: "both" as const,
      };
      const chromeAnimation = chrome.animate(reverseKeyframes(descriptor.chromeKeyframes), options);
      chromeAnimation.id = "t3-composer-floating-island-droplet-exit-chrome";
      const contentAnimation = snapshot.clone.animate(
        reverseKeyframes(descriptor.panelKeyframes),
        options,
      );
      contentAnimation.id = "t3-composer-floating-island-droplet-exit-content";
      const neckAnimation = neck.animate(reverseKeyframes(descriptor.neckKeyframes), options);
      neckAnimation.id = "t3-composer-floating-island-droplet-exit-neck";
      const token = (motionTokenRef.current += 1);
      const animations = [chromeAnimation, contentAnimation, neckAnimation];
      activeMotionRef.current = { animations, contentTarget: snapshot.clone, token };
      settleWhenFinished(animations, token, () => {
        if (surfaceRoots(island, portalHost).length > 0) snapshotIsland();
      });
    };

    const synchronize = (records: ReadonlyArray<MutationRecord>) => {
      const roots = surfaceRoots(island, portalHost);
      const isVisible = roots.length > 0;
      let addedSurfaceCount = 0;
      let removedSurfaceCount = 0;
      for (const record of records) {
        addedSurfaceCount += countChangedSurfaces(
          record.addedNodes,
          record.target,
          island,
          portalHost,
        );
        removedSurfaceCount += countChangedSurfaces(
          record.removedNodes,
          record.target,
          island,
          portalHost,
        );
      }
      const motion = resolveFloatingIslandMotion({
        addedSurfaceCount,
        isVisible,
        removedSurfaceCount,
        wasVisible: previousVisibleRef.current,
      });
      previousVisibleRef.current = isVisible;
      if (motion === "enter") {
        playEnter();
        return;
      }
      if (motion === "exit") {
        playExit();
        return;
      }
      if (isVisible) snapshotIsland();
    };

    const rememberTrigger = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const trigger = target?.closest<HTMLElement>(MORPH_TRIGGER_SELECTOR);
      const key = trigger?.dataset.composerSurfaceMorphTrigger?.trim();
      if (!trigger || !key) return;
      triggerRectsRef.current.set(key, toSurfaceRect(trigger.getBoundingClientRect()));
    };

    const observer = new MutationObserver((records) => synchronize(records));
    observer.observe(island, { childList: true, subtree: true });
    document.addEventListener("pointerdown", rememberTrigger, true);
    document.addEventListener("click", rememberTrigger, true);
    const settle = () => cancelActiveMotion(false);
    window.addEventListener("resize", settle);
    window.addEventListener("popstate", settle);
    document.addEventListener("visibilitychange", settle);

    synchronize([]);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", rememberTrigger, true);
      document.removeEventListener("click", rememberTrigger, true);
      window.removeEventListener("resize", settle);
      window.removeEventListener("popstate", settle);
      document.removeEventListener("visibilitychange", settle);
      cancelActiveMotion(false);
    };
  }, []);

  return (
    <div
      ref={regionRef}
      className="chat-composer-floating-island-region pointer-events-auto relative z-30 mx-auto w-full max-w-3xl"
      data-chat-composer-floating-island-region="true"
    >
      <div
        ref={islandRef}
        className="chat-composer-floating-island"
        data-chat-composer-floating-island="true"
      >
        {children}
        <div
          ref={attachPortalHostRef}
          className="chat-composer-floating-drawer-host"
          data-chat-composer-floating-drawer-host="true"
        />
      </div>
      <div
        ref={morphLayerRef}
        aria-hidden="true"
        inert
        data-composer-surface-morph-kind="droplet"
        data-composer-surface-morph-layer="true"
      >
        <div ref={chromeRef} data-composer-surface-morph-chrome="true" />
        <div ref={neckRef} data-composer-surface-morph-neck="true" />
      </div>
    </div>
  );
}

export function ComposerFloatingIslandSection({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="chat-composer-floating-island-section"
      data-chat-composer-floating-island-section="true"
    >
      {children}
    </div>
  );
}
