import { describe, expect, it } from "vite-plus/test";

import {
  animateWorkspaceDeckBackPeek,
  animateWorkspaceDeckContentFade,
  animateWorkspaceDeckCorners,
  animateWorkspaceDeckOutgoing,
  captureWorkspaceDeckSurface,
  createWorkspaceDeckAppearanceKeyframe,
  createWorkspaceDeckAppearanceKeyframes,
  localizeWorkspaceDeckChromeKeyframes,
  markWorkspaceDeckMorphSurface,
  WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
  WORKSPACE_DECK_MORPH_DURATION_MS,
} from "./workspaceCardDeck.morph";
import { buildSurfaceMorphDescriptor, type SurfaceGeometry } from "../chat/surfaceMorph";

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
    const from: SurfaceGeometry = {
      rect: { left: 122, top: 300, width: 356, height: 32 },
      radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
    };
    const to: SurfaceGeometry = {
      rect: { left: 122, top: 68, width: 356, height: 32 },
      radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
    };

    animateWorkspaceDeckBackPeek({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element,
      from,
      to,
    });

    expect(element.dataset.deckMorphBackPeek).toBe("true");
    expect(keyframes[0]?.[0]).toMatchObject({
      opacity: 0.72,
      transform: "translate3d(0, 3px, 0) scaleX(0.985)",
    });
    expect(keyframes[0]?.at(-1)).toMatchObject({
      opacity: 1,
      transform: "translate3d(0, 0, 0) scaleX(1)",
    });
    expect(keyframes[0]?.every((frame) => Number(frame.opacity ?? 1) >= 0.72)).toBe(true);
    expect(keyframes[0]?.some((frame) => "clipPath" in frame)).toBe(false);
    expect(keyframes[0]?.some((frame) => String(frame.transform).includes("232px"))).toBe(false);
  });

  it("adds a subtle interruption-safe fade to compressed card content", () => {
    const keyframes: Keyframe[][] = [];
    const options: KeyframeAnimationOptions[] = [];
    const element = {
      animate: (frames: Keyframe[], animationOptions: KeyframeAnimationOptions) => {
        keyframes.push(frames);
        options.push(animationOptions);
        return { cancel: () => undefined } as Animation;
      },
    } as unknown as HTMLElement;

    animateWorkspaceDeckContentFade({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element,
      from: 0.93,
      to: WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
    });

    expect(keyframes[0]?.[0]).toMatchObject({ offset: 0, opacity: 0.93 });
    expect(keyframes[0]?.at(-1)).toMatchObject({
      offset: 1,
      opacity: WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
    });
    expect(options[0]).toMatchObject({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      fill: "both",
    });
  });

  it("compensates visible corner radii across non-uniform scale", () => {
    const keyframes: Keyframe[][] = [];
    const element = {
      animate: (frames: Keyframe[]) => {
        keyframes.push(frames);
        return { cancel: () => undefined } as Animation;
      },
    } as unknown as HTMLElement;
    const from: SurfaceGeometry = {
      rect: { left: 122, top: 300, width: 356, height: 32 },
      radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
    };
    const to: SurfaceGeometry = {
      rect: { left: 100, top: 100, width: 400, height: 200 },
      radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
    };

    animateWorkspaceDeckCorners({
      duration: WORKSPACE_DECK_MORPH_DURATION_MS,
      element,
      from,
      fromScaleX: 0.89,
      fromScaleY: 0.16,
      to,
      toScaleX: 1,
      toScaleY: 1,
    });

    expect(keyframes[0]?.length).toBeGreaterThan(10);
    expect(keyframes[0]?.[0]).toMatchObject({
      borderRadius: "0px 0px 17.97752808988764px 17.97752808988764px / 0px 0px 100px 100px",
    });
    expect(keyframes[0]?.at(-1)?.borderRadius).toBe("22px 22px 22px 22px / 22px 22px 22px 22px");
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
    const descriptor = buildSurfaceMorphDescriptor({
      from: {
        rect: { left: 122, top: 300, width: 356, height: 32 },
        radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
      },
      to: {
        rect: { left: 100, top: 100, width: 400, height: 200 },
        radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
      },
      direction: "from-bottom",
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
    ).toEqual(descriptor.chromeKeyframes.map(({ easing, offset }) => ({ easing, offset })));
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

  it("continues outgoing content from the visible geometry of an interrupted morph", () => {
    const keyframes: Keyframe[][] = [];
    const element = {
      animate: (frames: Keyframe[]) => {
        keyframes.push(frames);
        return { cancel: () => undefined } as Animation;
      },
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 200 }),
      style: { overflow: "", transformOrigin: "", willChange: "" },
    } as unknown as HTMLElement;
    const surface = {
      getBoundingClientRect: () => ({ left: 100, top: 100, width: 400, height: 240 }),
    } as unknown as HTMLElement;
    const from: SurfaceGeometry = {
      rect: { left: 110, top: 82, width: 378, height: 108 },
      radii: { topLeft: 19, topRight: 19, bottomRight: 11, bottomLeft: 11 },
    };
    const to: SurfaceGeometry = {
      rect: { left: 122, top: 68, width: 356, height: 32 },
      radii: { topLeft: 16, topRight: 16, bottomRight: 0, bottomLeft: 0 },
    };

    animateWorkspaceDeckOutgoing({
      descriptor: buildSurfaceMorphDescriptor({ from, to, direction: "to-top" }),
      element,
      from,
      surface,
      to,
    });

    expect(keyframes[0]?.[0]).toMatchObject({
      transform: "translate3d(10px, -18px, 0) scale(0.945, 0.45)",
    });
    expect(keyframes[0]?.at(-1)).toMatchObject({
      transform: "translate3d(22px, -32px, 0) scale(0.89, 0.13333333333333333)",
    });
  });
});

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
  return {
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
    ...overrides,
  } as CSSStyleDeclaration;
}
