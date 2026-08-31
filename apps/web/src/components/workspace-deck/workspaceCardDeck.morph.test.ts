import { describe, expect, it } from "vite-plus/test";

import {
  animateWorkspaceDeckBackPeek,
  animateWorkspaceDeckContentHandoff,
  buildWorkspaceDeckFrameMorphDescriptor,
  captureWorkspaceDeckContentHandoffState,
  captureWorkspaceDeckSurface,
  createWorkspaceDeckAppearanceKeyframe,
  createWorkspaceDeckAppearanceKeyframes,
  createWorkspaceDeckMorphProxy,
  localizeWorkspaceDeckChromeKeyframes,
  markWorkspaceDeckMorphSurface,
  resolveWorkspaceDeckContentHandoffOffset,
  WORKSPACE_DECK_MORPH_DURATION_MS,
} from "./workspaceCardDeck.morph";
import type { SurfaceGeometry } from "../chat/surfaceMorph";

describe("workspace deck morph chrome", () => {
  it("reveals the reordered back peek at its destination edge without clipping its hit target", () => {
    const keyframes: Keyframe[][] = [];
    const element = {
      animate: (frames: Keyframe[]) => {
        keyframes.push(frames);
        return { cancel: () => undefined } as Animation;
      },
      dataset: {},
    } as unknown as HTMLElement;
    animateWorkspaceDeckBackPeek({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element,
    });

    expect(element.dataset.deckMorphBackPeek).toBe("true");
    expect(keyframes[0]?.[0]).toMatchObject({ opacity: 1 });
    expect(keyframes[0]?.at(-1)).toMatchObject({ opacity: 1 });
    expect(keyframes[0]?.every((frame) => frame.opacity === 1)).toBe(true);
    expect(keyframes[0]?.every((frame) => !("transform" in frame))).toBe(true);
    expect(keyframes[0]?.some((frame) => "clipPath" in frame)).toBe(false);
  });

  it("keeps outgoing content solid until the crisp 22% handoff", () => {
    const outgoing = fakeAnimatedElement();

    animateWorkspaceDeckContentHandoff({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element: outgoing.element,
      handoffOffset: 0.22,
      role: "outgoing",
    });

    expect(contentTimeline(outgoing.keyframes[0] ?? [])).toEqual([
      { offset: 0, opacity: 1 },
      { offset: 0.22, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);
    expect(outgoing.keyframes[0]?.[0]?.easing).toBe("steps(1, end)");
    expect(outgoing.keyframes[0]?.every(isNaturalScaleContentFrame)).toBe(true);
  });

  it("reveals incoming content at the same crisp 22% handoff", () => {
    const incoming = fakeAnimatedElement();

    animateWorkspaceDeckContentHandoff({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element: incoming.element,
      handoffOffset: 0.22,
      role: "incoming",
    });

    expect(contentTimeline(incoming.keyframes[0] ?? [])).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 0.22, opacity: 1 },
      { offset: 1, opacity: 1 },
    ]);
    expect(incoming.keyframes[0]?.[0]?.easing).toBe("steps(1, end)");
    expect(incoming.keyframes[0]?.every(isNaturalScaleContentFrame)).toBe(true);
  });

  it("reveals the new target peek label at the crisp 22% handoff", () => {
    const targetPeek = fakeAnimatedElement();

    animateWorkspaceDeckContentHandoff({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element: targetPeek.element,
      handoffOffset: 0.22,
      role: "peek",
    });

    expect(
      (targetPeek.keyframes[0] ?? []).map(({ offset, opacity }) => ({ offset, opacity })),
    ).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 0.22, opacity: 1 },
      { offset: 1, opacity: 1 },
    ]);
    expect(targetPeek.keyframes[0]?.[0]?.easing).toBe("steps(1, end)");
    expect(targetPeek.keyframes[0]?.every(isNaturalScaleContentFrame)).toBe(true);
    expect(targetPeek.options[0]).toMatchObject({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      fill: "both",
    });
  });

  it("cuts immediately to new content when a rapid follow-up interrupts an invisible card", () => {
    const outgoing = fakeAnimatedElement({
      opacity: "0.76",
      transform: "translate3d(0, 2px, 0)",
      willChange: "filter",
    });

    const motion = animateWorkspaceDeckContentHandoff({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element: outgoing.element,
      handoffOffset: 0,
      role: "outgoing",
    });

    expect(contentTimeline(outgoing.keyframes[0] ?? [])).toEqual([
      { offset: 0, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);
    expect(outgoing.element.style.willChange).toBe("opacity");

    const incoming = fakeAnimatedElement();
    animateWorkspaceDeckContentHandoff({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element: incoming.element,
      handoffOffset: 0,
      role: "incoming",
    });
    expect(contentTimeline(incoming.keyframes[0] ?? [])).toEqual([
      { offset: 0, opacity: 1 },
      { offset: 1, opacity: 1 },
    ]);

    motion.restoreStyles();

    expect(outgoing.element.style.opacity).toBe("0.76");
    expect(outgoing.element.style.transform).toBe("translate3d(0, 2px, 0)");
    expect(outgoing.element.style.willChange).toBe("filter");
  });

  it("uses an immediate handoff only when the interrupted active content is invisible", () => {
    expect(resolveWorkspaceDeckContentHandoffOffset({ opacity: 0 })).toBe(0);
    expect(resolveWorkspaceDeckContentHandoffOffset({ opacity: 0.49 })).toBe(0);
    expect(resolveWorkspaceDeckContentHandoffOffset({ opacity: 0.5 })).toBe(0.22);
    expect(resolveWorkspaceDeckContentHandoffOffset({ opacity: 1 })).toBe(0.22);
    expect(resolveWorkspaceDeckContentHandoffOffset(undefined)).toBe(0.22);
  });

  it("captures interrupted opacity without coupling it to element transforms", () => {
    const element = fakeElement();

    expect(
      captureWorkspaceDeckContentHandoffState(element, () =>
        fakeStyle({
          opacity: "0.42",
          transform: "matrix(1, 0, 0, 1, 0, -1.5)",
        }),
      ),
    ).toEqual({ opacity: 0.42 });
    expect(
      captureWorkspaceDeckContentHandoffState(element, () =>
        fakeStyle({ opacity: "invalid", transform: "none" }),
      ),
    ).toEqual({ opacity: 1 });
  });

  it("moves forward and backward frames toward their destination with a 3px directional settle", () => {
    const upperPeek: SurfaceGeometry = {
      rect: { left: 122, top: 68, width: 356, height: 32 },
      radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
    };
    const active: SurfaceGeometry = {
      rect: { left: 100, top: 100, width: 400, height: 200 },
      radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
    };
    const lowerPeek: SurfaceGeometry = {
      rect: { left: 122, top: 300, width: 356, height: 32 },
      radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
    };

    const forwardIncoming = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: lowerPeek,
      role: "incoming",
      to: active,
    });
    const forwardOutgoing = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: active,
      role: "outgoing",
      to: upperPeek,
    });
    const backwardIncoming = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "backward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: upperPeek,
      role: "incoming",
      to: active,
    });
    const backwardOutgoing = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "backward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: active,
      role: "outgoing",
      to: lowerPeek,
    });

    expect(frameTops(forwardIncoming.geometryKeyframes)).toEqual([300, 97, 100]);
    expect(frameTops(forwardOutgoing.geometryKeyframes)).toEqual([100, 65, 68]);
    expect(frameTops(backwardIncoming.geometryKeyframes)).toEqual([68, 103, 100]);
    expect(frameTops(backwardOutgoing.geometryKeyframes)).toEqual([100, 303, 300]);
    for (const descriptor of [
      forwardIncoming,
      forwardOutgoing,
      backwardIncoming,
      backwardOutgoing,
    ]) {
      expect(frameOffsets(descriptor.geometryKeyframes)).toEqual([0, 0.84, 1]);
      expect(descriptor.geometryKeyframes.every(isGeometryOnlyFrame)).toBe(true);
    }
  });

  it("detaches and attaches corners on their own track with exact resting radii", () => {
    const lowerPeek: SurfaceGeometry = {
      rect: { left: 122, top: 300, width: 356, height: 32 },
      radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
    };
    const upperPeek: SurfaceGeometry = {
      rect: { left: 122, top: 68, width: 356, height: 32 },
      radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
    };
    const active: SurfaceGeometry = {
      rect: { left: 100, top: 100, width: 400, height: 200 },
      radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
    };

    const incoming = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: lowerPeek,
      role: "incoming",
      to: active,
    });
    const outgoing = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: active,
      role: "outgoing",
      to: upperPeek,
    });

    expect(frameOffsets(incoming.cornerKeyframes)).toEqual([0, 0.12, 1]);
    expect(frameOffsets(outgoing.cornerKeyframes)).toEqual([0, 0.12, 0.88, 1]);
    expect(incoming.cornerKeyframes[0]?.borderRadius).toBe("0px 0px 16px 16px");
    expect(incoming.cornerKeyframes.at(-1)?.borderRadius).toBe("22px 22px 22px 22px");
    expect(outgoing.cornerKeyframes[0]?.borderRadius).toBe("22px 22px 22px 22px");
    expect(outgoing.cornerKeyframes.at(-1)?.borderRadius).toBe("16px 16px 0px 0px");
    expect(allCornersRounded(incoming.cornerKeyframes[1])).toBe(true);
    expect(allCornersRounded(outgoing.cornerKeyframes[1])).toBe(true);
    expect(allCornersRounded(outgoing.cornerKeyframes[2])).toBe(true);
    expect(incoming.cornerKeyframes.every(isCornerOnlyFrame)).toBe(true);
    expect(outgoing.cornerKeyframes.every(isCornerOnlyFrame)).toBe(true);
    expect(incoming.geometryKeyframes.every((frame) => !("borderRadius" in frame))).toBe(true);
    expect(outgoing.geometryKeyframes.every((frame) => !("borderRadius" in frame))).toBe(true);
  });

  it("rounds an interrupted outgoing frame early instead of holding edgy corners", () => {
    const interrupted: SurfaceGeometry = {
      rect: { left: 116, top: 248, width: 368, height: 74 },
      radii: { topLeft: 4, topRight: 4, bottomRight: 17, bottomLeft: 17 },
    };
    const upperPeek: SurfaceGeometry = {
      rect: { left: 122, top: 68, width: 356, height: 32 },
      radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
    };

    const outgoing = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: interrupted,
      role: "outgoing",
      to: upperPeek,
    });

    expect(frameOffsets(outgoing.cornerKeyframes)).toEqual([0, 0.12, 0.88, 1]);
    expect(outgoing.cornerKeyframes[0]?.borderRadius).toBe("4px 4px 17px 17px");
    expect(outgoing.cornerKeyframes[1]?.borderRadius).toBe("17px 17px 17px 17px");
    expect(outgoing.cornerKeyframes[2]?.borderRadius).toBe("17px 17px 17px 17px");
    expect(outgoing.cornerKeyframes.at(-1)?.borderRadius).toBe("16px 16px 0px 0px");
  });

  it("uses only the interpolable background color in chrome keyframes", () => {
    const keyframe = createWorkspaceDeckAppearanceKeyframe({
      backdropFilter: "blur(18px)",
      backgroundColor: "rgba(20, 20, 20, 0.8)",
      borderColor: "rgba(255, 255, 255, 0.08)",
      boxShadow: "0 12px 28px rgba(0, 0, 0, 0.4)",
    });

    expect(keyframe).toMatchObject({
      backdropFilter: "blur(18px)",
      backgroundColor: "rgba(20, 20, 20, 0.8)",
      borderColor: "rgba(255, 255, 255, 0.08)",
      boxShadow: "0 12px 28px rgba(0, 0, 0, 0.4)",
    });
    expect(keyframe).not.toHaveProperty("background");
  });

  it("keeps color, glass, and geometry on the same easing timeline", () => {
    const descriptor = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: {
        rect: { left: 122, top: 300, width: 356, height: 32 },
        radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
      },
      to: {
        rect: { left: 100, top: 100, width: 400, height: 200 },
        radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
      },
      role: "incoming",
    });
    const from = {
      backdropFilter: "blur(12px)",
      backgroundColor: "rgb(20, 20, 20)",
      borderColor: "rgb(40, 40, 40)",
      boxShadow: "none",
    };
    const to = { ...from, backgroundColor: "rgb(60, 60, 60)" };

    expect(
      createWorkspaceDeckAppearanceKeyframes(descriptor, from, to).map(({ easing, offset }) => ({
        easing,
        offset,
      })),
    ).toEqual(descriptor.geometryKeyframes.map(({ easing, offset }) => ({ easing, offset })));
    expect(frameOffsets(descriptor.appearanceKeyframes)).toEqual([0, 0.84, 1]);
  });

  it("starts independent geometry, corner, and appearance animations on each proxy", () => {
    const host = fakeMorphHost();
    const descriptor = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: {
        rect: { left: 122, top: 300, width: 356, height: 32 },
        radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
      },
      role: "incoming",
      to: {
        rect: { left: 100, top: 100, width: 400, height: 200 },
        radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
      },
    });
    const appearance = {
      backdropFilter: "blur(12px)",
      backgroundColor: "rgb(20, 20, 20)",
      borderColor: "rgb(40, 40, 40)",
      boxShadow: "none",
    };

    const proxy = createWorkspaceDeckMorphProxy({
      descriptor,
      from: appearance,
      host: host.element,
      role: "incoming",
      to: { ...appearance, backgroundColor: "rgb(60, 60, 60)" },
    });

    expect(host.animationCalls).toHaveLength(3);
    expect(
      new Set([proxy.appearanceAnimation, proxy.geometryAnimation, proxy.cornerAnimation]),
    ).toEqual(new Set(host.animations));
    expect(animationFramesFor(host, proxy.geometryAnimation).every(isGeometryOnlyFrame)).toBe(true);
    expect(animationFramesFor(host, proxy.cornerAnimation).every(isCornerOnlyFrame)).toBe(true);
    expect(host.appended).toEqual([proxy.element]);
    expect(proxy.element.dataset.surfaceMorphProxy).toBe("deck-incoming");
    expect(proxy.element.getAttribute("aria-hidden")).toBe("true");
    expect(proxy.element.getAttribute("inert")).toBe("");
  });

  it("keeps all proxy animation handles nullable for the non-WAAPI fallback", () => {
    const host = fakeMorphHost({ supportsAnimate: false });
    const descriptor = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "backward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: {
        rect: { left: 122, top: 68, width: 356, height: 32 },
        radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
      },
      role: "incoming",
      to: {
        rect: { left: 100, top: 100, width: 400, height: 200 },
        radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
      },
    });
    const appearance = {
      backdropFilter: "none",
      backgroundColor: "transparent",
      borderColor: "transparent",
      boxShadow: "none",
    };

    const proxy = createWorkspaceDeckMorphProxy({
      descriptor,
      from: appearance,
      host: host.element,
      role: "incoming",
      to: appearance,
    });

    expect(proxy.appearanceAnimation).toBeNull();
    expect(proxy.geometryAnimation).toBeNull();
    expect(proxy.cornerAnimation).toBeNull();
  });

  it("keeps chrome geometry in the card-local coordinate system", () => {
    expect(
      localizeWorkspaceDeckChromeKeyframes(
        [
          {
            offset: 0,
            left: "122px",
            top: "68px",
            width: "356px",
            height: "32px",
            borderRadius: "16px 16px 0 0",
          },
        ],
        { left: 100, top: 100 },
      ),
    ).toEqual([
      {
        offset: 0,
        left: "22px",
        top: "-32px",
        width: "356px",
        height: "32px",
        borderRadius: "16px 16px 0 0",
      },
    ]);
  });

  it("marks both composer shell chrome hosts and restores them after the morph", () => {
    const ancestorHost = fakeElement();
    const descendantHost = fakeElement();
    const surface = fakeElement({ ancestorHost, descendantHost });

    const cleanup = markWorkspaceDeckMorphSurface(surface);

    expect(surface.dataset.deckMorphSurface).toBe("true");
    expect(ancestorHost.dataset.deckMorphSurface).toBe("true");
    expect(descendantHost.dataset.deckMorphSurface).toBe("true");

    cleanup();

    expect(surface.dataset.deckMorphSurface).toBeUndefined();
    expect(ancestorHost.dataset.deckMorphSurface).toBeUndefined();
    expect(descendantHost.dataset.deckMorphSurface).toBeUndefined();
  });

  it("captures composer glass from its shell and descendant outline pseudos", () => {
    const glassHost = fakeElement();
    const surface = fakeElement({ descendantHost: glassHost });
    const transparent = fakeStyle();
    const shellGlass = fakeStyle({
      backdropFilter: "blur(18px) saturate(1.2)",
      background: "rgba(20, 20, 20, 0.8)",
      backgroundColor: "rgba(20, 20, 20, 0.8)",
    });
    const hostStyle = fakeStyle({ boxShadow: "0 12px 28px -18px rgba(0, 0, 0, 0.4)" });
    const hostOutline = fakeStyle({
      borderColor: "rgba(255, 255, 255, 0.08)",
      borderStyle: "solid",
      borderTopWidth: "1px",
      borderRightWidth: "1px",
      borderBottomWidth: "1px",
      borderLeftWidth: "1px",
    });
    const readStyle = (element: Element, pseudo?: string) => {
      if (element === surface && pseudo === "::before") return shellGlass;
      if (element === glassHost && pseudo === "::after") return hostOutline;
      if (element === glassHost) return hostStyle;
      return transparent;
    };

    expect(captureWorkspaceDeckSurface(surface, readStyle).appearance).toEqual({
      backdropFilter: "blur(18px) saturate(1.2)",
      backgroundColor: "rgba(20, 20, 20, 0.8)",
      borderColor: "rgba(255, 255, 255, 0.08)",
      boxShadow: "0 12px 28px -18px rgba(0, 0, 0, 0.4)",
    });
    expect(captureWorkspaceDeckSurface(surface, readStyle).opacity).toBe(1);
  });

  it("captures the currently visible proxy radii before an interrupted follow-up", () => {
    const surface = fakeElement();
    const snapshot = captureWorkspaceDeckSurface(surface, () =>
      fakeStyle({
        borderTopLeftRadius: "13px",
        borderTopRightRadius: "17px",
        borderBottomRightRadius: "9px",
        borderBottomLeftRadius: "5px",
      }),
    );

    expect(snapshot.geometry.radii).toEqual({
      topLeft: 13,
      topRight: 17,
      bottomRight: 9,
      bottomLeft: 5,
    });
  });
});

function contentTimeline(keyframes: readonly Keyframe[]) {
  return keyframes.map(({ offset, opacity }) => ({ offset, opacity }));
}

function isNaturalScaleContentFrame(frame: Keyframe): boolean {
  return !("transform" in frame) && !("borderRadius" in frame) && !("clipPath" in frame);
}

function frameOffsets(keyframes: readonly Keyframe[]): readonly (number | null)[] {
  return keyframes.map(({ offset }) => offset ?? null);
}

function frameTops(keyframes: readonly Keyframe[]): readonly number[] {
  return keyframes.map(({ top }) => Number.parseFloat(String(top)));
}

function isGeometryOnlyFrame(frame: Keyframe): boolean {
  return (
    "left" in frame &&
    "top" in frame &&
    "width" in frame &&
    "height" in frame &&
    !("borderRadius" in frame)
  );
}

function isCornerOnlyFrame(frame: Keyframe): boolean {
  return (
    "borderRadius" in frame &&
    !("left" in frame) &&
    !("top" in frame) &&
    !("width" in frame) &&
    !("height" in frame)
  );
}

function allCornersRounded(keyframe: Keyframe | undefined): boolean {
  return String(keyframe?.borderRadius)
    .split(/\s+/)
    .every((radius) => Number.parseFloat(radius) > 0);
}

function fakeAnimatedElement(style: Partial<CSSStyleDeclaration> = {}) {
  const keyframes: Keyframe[][] = [];
  const options: KeyframeAnimationOptions[] = [];
  const element = {
    animate: (frames: Keyframe[], animationOptions: KeyframeAnimationOptions) => {
      keyframes.push(frames);
      options.push(animationOptions);
      return { cancel: () => undefined } as Animation;
    },
    style: Object.assign({ opacity: "", transform: "", willChange: "" }, style),
  } as unknown as HTMLElement;
  return { element, keyframes, options };
}

function fakeMorphHost(options: { readonly supportsAnimate?: boolean } = {}) {
  const animations: Animation[] = [];
  const animationCalls: Array<{
    readonly frames: Keyframe[];
    readonly options: KeyframeAnimationOptions;
  }> = [];
  const appended: Element[] = [];
  const attributes = new Map<string, string>();
  const proxyElement = {
    animate:
      options.supportsAnimate === false
        ? undefined
        : (frames: Keyframe[], animationOptions: KeyframeAnimationOptions) => {
            const animation = { cancel: () => undefined } as Animation;
            animations.push(animation);
            animationCalls.push({ frames, options: animationOptions });
            return animation;
          },
    className: "",
    dataset: {},
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: {
      backdropFilter: "",
      backgroundColor: "",
      borderColor: "",
      boxShadow: "",
      setProperty: () => undefined,
    },
  } as unknown as HTMLDivElement;
  const element = {
    append: (child: Element) => appended.push(child),
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 200 }),
    ownerDocument: { createElement: () => proxyElement },
  } as unknown as HTMLElement;
  return { animationCalls, animations, appended, element };
}

function animationFramesFor(
  host: ReturnType<typeof fakeMorphHost>,
  animation: Animation | null,
): readonly Keyframe[] {
  const index = animation === null ? -1 : host.animations.indexOf(animation);
  return host.animationCalls[index]?.frames ?? [];
}

function fakeElement(options?: {
  readonly ancestorHost?: HTMLElement;
  readonly descendantHost?: HTMLElement;
}): HTMLElement {
  return {
    dataset: {},
    closest: () => options?.ancestorHost ?? null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
    querySelector: () => options?.descendantHost ?? null,
  } as unknown as HTMLElement;
}

function fakeStyle(overrides: Partial<CSSStyleDeclaration> = {}): CSSStyleDeclaration {
  return Object.assign(
    {
      backdropFilter: "none",
      background: "transparent",
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      borderBottomLeftRadius: "22px",
      borderBottomRightRadius: "22px",
      borderBottomWidth: "0px",
      borderColor: "transparent",
      borderLeftWidth: "0px",
      borderRightWidth: "0px",
      borderStyle: "none",
      borderTopLeftRadius: "22px",
      borderTopRightRadius: "22px",
      borderTopWidth: "0px",
      boxShadow: "none",
      opacity: "1",
      getPropertyValue: () => "",
    },
    overrides,
  ) as CSSStyleDeclaration;
}
