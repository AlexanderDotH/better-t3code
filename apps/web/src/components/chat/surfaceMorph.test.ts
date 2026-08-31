import { describe, expect, it, vi } from "vite-plus/test";

import {
  SURFACE_MORPH_EXIT_DURATION_MS,
  SURFACE_MORPH_ANIMATION_ID,
  SURFACE_MORPH_PHASE_OFFSETS,
  SURFACE_MORPH_PRIMARY_DURATION_MS,
  SURFACE_MORPH_SECONDARY_DURATION_MS,
  buildDropletMorphDescriptor,
  buildSurfaceMorphDescriptor,
  captureSurfaceGeometry,
  createSurfaceMorphCoordinator,
  prefersReducedSurfaceMotion,
  resolveSurfaceMorphOrigin,
  shouldAnimateSurfaceMorph,
  type SurfaceGeometry,
} from "./surfaceMorph";

const activeGeometry: SurfaceGeometry = {
  rect: { left: 100, top: 100, width: 400, height: 200 },
  radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
};

const topPeekGeometry: SurfaceGeometry = {
  rect: { left: 122, top: 68, width: 356, height: 32 },
  radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
};

const bottomPeekGeometry: SurfaceGeometry = {
  rect: { left: 122, top: 300, width: 356, height: 32 },
  radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
};

describe("surface morph geometry", () => {
  it("captures the visible rectangle and all four computed corner radii", () => {
    const element = {
      getBoundingClientRect: () => ({ left: 14, top: 28, width: 320, height: 180 }),
    } as unknown as HTMLElement;
    const readStyle = () =>
      ({
        borderTopLeftRadius: "18px",
        borderTopRightRadius: "20px 12px",
        borderBottomRightRadius: "22px",
        borderBottomLeftRadius: "0px",
      }) as CSSStyleDeclaration;

    expect(captureSurfaceGeometry(element, readStyle)).toEqual({
      rect: { left: 14, top: 28, width: 320, height: 180 },
      radii: { topLeft: 18, topRight: 20, bottomRight: 22, bottomLeft: 0 },
    });
  });
});

describe("card surface morph", () => {
  it("publishes the primary, secondary, exit, and droplet timing contract", () => {
    expect(SURFACE_MORPH_PRIMARY_DURATION_MS).toBe(480);
    expect(SURFACE_MORPH_SECONDARY_DURATION_MS).toBe(420);
    expect(SURFACE_MORPH_EXIT_DURATION_MS).toBe(360);
    expect(SURFACE_MORPH_PHASE_OFFSETS).toEqual({
      start: 0,
      neck: 0.22,
      rise: 0.68,
      detach: 0.84,
      end: 1,
    });
  });

  it("grows the upper peek through the active card with at most three pixels of overshoot", () => {
    const descriptor = buildSurfaceMorphDescriptor({
      from: topPeekGeometry,
      to: activeGeometry,
      direction: "from-top",
    });

    expect(descriptor.options.duration).toBe(480);
    expect(descriptor.metrics).toMatchObject({
      deltaX: 22,
      deltaY: -32,
      scaleX: 0.89,
      scaleY: 0.16,
      overshootY: 3,
    });
    expect(descriptor.contentKeyframes.map(({ offset }) => offset)).toEqual([0, 0.84, 1]);
    expect(descriptor.chromeKeyframes.map(({ offset }) => offset)).toEqual([0, 0.84, 1]);
    expect(descriptor.chromeKeyframes[0]?.easing).toBe(descriptor.contentKeyframes[0]?.easing);
    expect(Math.abs(descriptor.metrics.overshootY)).toBeLessThanOrEqual(3);
    expect(descriptor.contentKeyframes[0]).toMatchObject({
      borderRadius: "16px 16px 0px 0px",
      clipPath: "inset(0 round 16px 16px 0px 0px)",
    });
    expect(descriptor.contentKeyframes.at(-1)).toMatchObject({
      transform: "translate3d(0, 0, 0) scale(1, 1)",
      borderRadius: "22px 22px 22px 22px",
      clipPath: "inset(0 round 22px 22px 22px 22px)",
    });
    expect(descriptor.contentStyles).toEqual({
      overflow: "clip",
      transformOrigin: "top left",
      willChange: "transform, clip-path, border-radius",
    });
  });

  it("grows the lower peek upward and shrinks the active card toward the upper peek", () => {
    const fromBottom = buildSurfaceMorphDescriptor({
      from: bottomPeekGeometry,
      to: activeGeometry,
      direction: "from-bottom",
    });
    const toTop = buildSurfaceMorphDescriptor({
      from: activeGeometry,
      to: topPeekGeometry,
      direction: "to-top",
    });

    expect(fromBottom.metrics.overshootY).toBe(-3);
    expect(toTop.metrics.overshootY).toBe(-3);
    expect(toTop.chromeKeyframes[0]).toMatchObject({
      left: "100px",
      top: "100px",
      width: "400px",
      height: "200px",
      borderRadius: "22px 22px 22px 22px",
    });
    expect(toTop.chromeKeyframes.at(-1)).toMatchObject({
      left: "122px",
      top: "68px",
      width: "356px",
      height: "32px",
      borderRadius: "16px 16px 0px 0px",
    });
    expect(toTop.contentKeyframes.some((frame) => "opacity" in frame)).toBe(false);
  });
});

describe("composer surface origins and droplet motion", () => {
  const composerRect = { left: 100, top: 500, width: 400, height: 180 };
  const floatingIslandGeometry: SurfaceGeometry = {
    rect: activeGeometry.rect,
    radii: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
  };

  it("starts explicit drawers at the clicked trigger center", () => {
    expect(
      resolveSurfaceMorphOrigin({
        composerRect,
        destinationRect: { left: 120, top: 300, width: 360, height: 160 },
        triggerRect: { left: 410, top: 620, width: 40, height: 24 },
      }),
    ).toEqual({ x: 430, y: 632, source: "trigger" });
  });

  it("starts automatic drawers at the nearest point on the composer edge", () => {
    expect(
      resolveSurfaceMorphOrigin({
        composerRect,
        destinationRect: { left: 170, top: 300, width: 220, height: 120 },
      }),
    ).toEqual({ x: 280, y: 500, source: "composer-top" });
    expect(
      resolveSurfaceMorphOrigin({
        composerRect,
        destinationRect: { left: 560, top: 520, width: 160, height: 120 },
      }),
    ).toEqual({ x: 500, y: 580, source: "composer-right" });
  });

  it("forms, detaches, and settles the droplet on the specified five phases", () => {
    const origin = { x: 300, y: 500, source: "composer-top" } as const;
    const descriptor = buildDropletMorphDescriptor({
      destination: floatingIslandGeometry,
      origin,
    });

    expect(descriptor.options.duration).toBe(480);
    expect(descriptor.panelKeyframes.map(({ offset }) => offset)).toEqual([0, 0.22, 0.68, 0.84, 1]);
    expect(descriptor.neckKeyframes.map(({ offset }) => offset)).toEqual([0, 0.22, 0.68, 0.84, 1]);
    expect(descriptor.chromeKeyframes.map(({ offset }) => offset)).toEqual([
      0, 0.22, 0.68, 0.84, 1,
    ]);
    expect(Math.abs(descriptor.metrics.overshootY)).toBeLessThanOrEqual(6);
    expect(descriptor.metrics.overshootScale).toBeLessThanOrEqual(1.015);
    expect(descriptor.panelStyles.transformOrigin).toBe("center center");
    expect(
      activeGeometry.rect.left + activeGeometry.rect.width / 2 + descriptor.metrics.deltaX,
    ).toBe(origin.x);
    expect(
      activeGeometry.rect.top + activeGeometry.rect.height / 2 + descriptor.metrics.deltaY,
    ).toBe(origin.y);
    expect(descriptor.neckStyles).toMatchObject({
      pointerEvents: "none",
      position: "fixed",
      transformOrigin: "50% 100%",
      width: "8px",
    });
    expect(descriptor.chromeStyles).toMatchObject({
      pointerEvents: "none",
      position: "fixed",
    });
    expect(descriptor.chromeKeyframes[0]).toMatchObject({
      left: "296px",
      top: "496px",
      width: "8px",
      height: "8px",
      borderRadius: "999px 999px 999px 999px",
    });
    expect(descriptor.chromeKeyframes.at(-1)).toMatchObject({
      left: "100px",
      top: "100px",
      width: "400px",
      height: "200px",
      borderRadius: "16px 16px 16px 16px",
    });
    expect(descriptor.panelKeyframes.at(-1)).toMatchObject({
      transform: "translate3d(0, 0, 0) scale(1, 1)",
      borderRadius: "16px 16px 16px 16px",
    });
  });
});

describe("surface morph policy", () => {
  it("bypasses motion for reduced-motion users and without WAAPI", () => {
    expect(
      prefersReducedSurfaceMotion({
        matchMedia: () => ({ matches: true }) as MediaQueryList,
      }),
    ).toBe(true);
    expect(shouldAnimateSurfaceMorph({ canAnimate: true, reducedMotion: true })).toBe(false);
    expect(shouldAnimateSurfaceMorph({ canAnimate: false, reducedMotion: false })).toBe(false);
    expect(shouldAnimateSurfaceMorph({ canAnimate: true, reducedMotion: false })).toBe(true);
  });
});

describe("surface morph coordinator", () => {
  it("exposes animation handles and a stable id for route handoffs", () => {
    const activeAnimation = pendingAnimation();
    const coordinator = createSurfaceMorphCoordinator({
      captureGeometry: () => activeGeometry,
      reducedMotion: () => false,
      windowTarget: null,
      documentTarget: null,
    });

    const run = coordinator.run({
      element: createMorphElement(vi.fn(() => activeAnimation.animation)),
      from: topPeekGeometry,
      to: activeGeometry,
      direction: "from-top",
      animationId: "t3-draft-hero-transition",
    });

    expect(SURFACE_MORPH_ANIMATION_ID).toBe("t3-surface-morph");
    expect(run.animations).toEqual([activeAnimation.animation]);
    expect(activeAnimation.animation.id).toBe("t3-draft-hero-transition");
    coordinator.dispose();
  });

  it("cancels the previous intent and restarts from its visible geometry", () => {
    let visibleGeometry = activeGeometry;
    const animations = [pendingAnimation(), pendingAnimation()];
    const animate = vi
      .fn()
      .mockReturnValueOnce(animations[0]?.animation)
      .mockReturnValueOnce(animations[1]?.animation);
    const element = createMorphElement(animate);
    const coordinator = createSurfaceMorphCoordinator({
      captureGeometry: () => visibleGeometry,
      reducedMotion: () => false,
      windowTarget: null,
      documentTarget: null,
    });

    coordinator.run({
      element,
      from: topPeekGeometry,
      to: activeGeometry,
      direction: "from-top",
    });
    visibleGeometry = {
      rect: { left: 110, top: 82, width: 378, height: 108 },
      radii: { topLeft: 19, topRight: 19, bottomRight: 11, bottomLeft: 11 },
    };
    const latest = coordinator.run({
      element,
      from: bottomPeekGeometry,
      to: activeGeometry,
      direction: "from-bottom",
    });

    expect(animations[0]?.cancel).toHaveBeenCalledOnce();
    expect(latest.from).toEqual(visibleGeometry);
    expect(latest.descriptor.contentKeyframes[0]).toMatchObject({
      borderRadius: "19px 19px 11px 11px",
    });
    coordinator.dispose();
  });

  it("finishes immediately for reduced motion without invoking WAAPI", async () => {
    const animate = vi.fn();
    const onFinish = vi.fn();
    const coordinator = createSurfaceMorphCoordinator({
      captureGeometry: () => activeGeometry,
      reducedMotion: () => true,
      windowTarget: null,
      documentTarget: null,
    });

    const run = coordinator.run({
      element: createMorphElement(animate),
      from: topPeekGeometry,
      to: activeGeometry,
      direction: "from-top",
      onFinish,
    });
    await run.finished;

    expect(run.started).toBe(false);
    expect(animate).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it("cancels active morphs on resize, hidden documents, navigation, and disposal", () => {
    const windowTarget = new TestEventTarget();
    const documentTarget = new TestDocumentTarget();
    const activeAnimations = Array.from({ length: 4 }, () => pendingAnimation());
    const animate = vi.fn();
    for (const activeAnimation of activeAnimations) {
      animate.mockReturnValueOnce(activeAnimation.animation);
    }
    const coordinator = createSurfaceMorphCoordinator({
      captureGeometry: () => activeGeometry,
      reducedMotion: () => false,
      windowTarget,
      documentTarget,
    });
    const element = createMorphElement(animate);
    const run = () =>
      coordinator.run({
        element,
        from: topPeekGeometry,
        to: activeGeometry,
        direction: "from-top",
      });

    run();
    windowTarget.dispatch("resize");
    run();
    documentTarget.hidden = true;
    documentTarget.dispatch("visibilitychange");
    documentTarget.hidden = false;
    run();
    windowTarget.dispatch("popstate");
    run();
    coordinator.dispose();

    for (const activeAnimation of activeAnimations) {
      expect(activeAnimation.cancel).toHaveBeenCalledOnce();
    }
    expect(windowTarget.listenerCount()).toBe(0);
    expect(documentTarget.listenerCount()).toBe(0);
  });
});

function createMorphElement(animate: ReturnType<typeof vi.fn>): HTMLElement {
  return {
    animate,
    style: { overflow: "", transformOrigin: "", willChange: "" },
  } as unknown as HTMLElement;
}

function pendingAnimation() {
  const cancel = vi.fn();
  return {
    animation: { cancel, finished: new Promise<never>(() => undefined) } as unknown as Animation,
    cancel,
  };
}

class TestEventTarget {
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(new Event(type));
      else listener.handleEvent(new Event(type));
    }
  }

  listenerCount(): number {
    return Array.from(this.listeners.values()).reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }
}

class TestDocumentTarget extends TestEventTarget {
  hidden = false;
}
