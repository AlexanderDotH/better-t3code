import {
  buildSurfaceMorphDescriptor,
  captureSurfaceGeometry,
  type SurfaceGeometry,
  type SurfaceMorphDescriptor,
  type SurfaceMorphDirection,
  type SurfaceMorphCoordinator,
  type SurfaceRect,
} from "../chat/surfaceMorph";
import { type WorkspaceDeckDirection } from "./workspaceCardDeck.logic";

export const WORKSPACE_DECK_MORPH_DURATION_MS = 560;

const WORKSPACE_DECK_FRAME_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
const WORKSPACE_DECK_FRAME_DETACH_OFFSET = 0.12;
const WORKSPACE_DECK_FRAME_ATTACH_OFFSET = 0.88;
const WORKSPACE_DECK_CONTENT_HANDOFF_OFFSET = 0.22;
const WORKSPACE_DECK_CONTENT_VISIBLE_THRESHOLD = 0.5;
const WORKSPACE_DECK_CONTENT_CUT_EASING = "steps(1, end)";

export type WorkspaceDeckMorphProxyRole = "incoming" | "outgoing";
export type WorkspaceDeckContentHandoffRole = "incoming" | "outgoing" | "peek";

export interface WorkspaceDeckFrameMorphDescriptor {
  readonly appearanceKeyframes: readonly Keyframe[];
  readonly cornerKeyframes: readonly Keyframe[];
  readonly geometryKeyframes: readonly Keyframe[];
  readonly options: KeyframeAnimationOptions;
}

export interface WorkspaceDeckChromeAppearance {
  readonly backdropFilter: string;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly boxShadow: string;
}

export interface WorkspaceDeckSurfaceSnapshot {
  readonly appearance: WorkspaceDeckChromeAppearance;
  readonly geometry: SurfaceGeometry;
  readonly opacity: number;
}

export interface WorkspaceDeckMorphProxy {
  readonly appearanceAnimation: Animation | null;
  readonly cornerAnimation: Animation | null;
  readonly element: HTMLDivElement;
  readonly geometryAnimation: Animation | null;
}

export interface WorkspaceDeckContentHandoffState {
  readonly opacity: number;
}

export interface WorkspaceDeckContentHandoffMotion {
  readonly animation: Animation;
  readonly restoreStyles: () => void;
}

export interface WorkspaceDeckMorphIntent<CardId extends string> {
  readonly direction: WorkspaceDeckDirection;
  readonly fromId: CardId;
  readonly toId: CardId;
}

export interface WorkspaceDeckMorphCapture<
  CardId extends string,
> extends WorkspaceDeckMorphIntent<CardId> {
  readonly active: WorkspaceDeckSurfaceSnapshot;
  readonly contentStates: ReadonlyMap<CardId, WorkspaceDeckContentHandoffState>;
  readonly peeks: ReadonlyMap<CardId, WorkspaceDeckSurfaceSnapshot>;
}

export interface ActiveWorkspaceDeckMorph {
  readonly animations: readonly Animation[];
  readonly cleanupCallbacks: readonly (() => void)[];
  readonly coordinators: readonly Pick<SurfaceMorphCoordinator, "dispose">[];
  readonly contentElements: readonly HTMLElement[];
  readonly proxies: readonly HTMLElement[];
  readonly backPeek: HTMLElement | null;
  readonly token: number;
}

export function disposeWorkspaceDeckMorph(morph: ActiveWorkspaceDeckMorph): void {
  for (const animation of morph.animations) {
    try {
      animation.cancel();
    } catch {
      // Detached peek/proxy animations may already be discarded by the browser.
    }
  }
  for (const coordinator of morph.coordinators) coordinator.dispose();
  for (const cleanup of morph.cleanupCallbacks) cleanup();
  for (const proxy of morph.proxies) proxy.remove();
  if (morph.backPeek) delete morph.backPeek.dataset.deckMorphBackPeek;
}

export type WorkspaceDeckStyleReader = (
  element: Element,
  pseudoElement?: string,
) => CSSStyleDeclaration;

export function captureWorkspaceDeckSurface(
  element: HTMLElement,
  readStyle: WorkspaceDeckStyleReader = getComputedStyle,
): WorkspaceDeckSurfaceSnapshot {
  const style = readStyle(element);
  const beforeStyle = readStyle(element, "::before");
  const glassHost =
    element.querySelector<HTMLElement>(".chat-composer-glass-host") ??
    element.closest<HTMLElement>(".chat-composer-glass-host");
  const hostStyle = glassHost ? readStyle(glassHost) : null;
  const hostOutlineStyle = glassHost ? readStyle(glassHost, "::after") : null;
  const frameStyle = firstPaintedFrameStyle(style, beforeStyle, hostStyle, hostOutlineStyle);
  return {
    geometry: captureSurfaceGeometry(element, () => frameStyle),
    opacity: normalizeOpacity(style.opacity),
    appearance: {
      backdropFilter: firstPaintedBackdrop(style, beforeStyle),
      backgroundColor: firstPaintedBackgroundColor(style, beforeStyle),
      borderColor: firstPaintedBorder(style, hostOutlineStyle),
      boxShadow: firstPaintedShadow(style, hostStyle),
    },
  };
}

export function createWorkspaceDeckMorphProxy(input: {
  readonly descriptor: WorkspaceDeckFrameMorphDescriptor;
  readonly from: WorkspaceDeckChromeAppearance;
  readonly host: HTMLElement;
  readonly role: WorkspaceDeckMorphProxyRole;
  readonly to: WorkspaceDeckChromeAppearance;
}): WorkspaceDeckMorphProxy {
  const element = input.host.ownerDocument.createElement("div");
  element.className = "workspace-card-deck__morph-proxy";
  element.dataset.surfaceMorphProxy = `deck-${input.role}`;
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
  applyAppearance(element, input.from);
  input.host.append(element);

  const appearanceAnimation = animateAppearance(element, input);
  const hostRect = input.host.getBoundingClientRect();
  const geometryAnimation = animateGeometry(element, input.descriptor, hostRect);
  const cornerAnimation = animateCorners(element, input.descriptor);
  return { appearanceAnimation, cornerAnimation, element, geometryAnimation };
}

export function buildWorkspaceDeckFrameMorphDescriptor(input: {
  readonly direction: WorkspaceDeckDirection;
  readonly durationMs: number;
  readonly from: SurfaceGeometry;
  readonly role: WorkspaceDeckMorphProxyRole;
  readonly to: SurfaceGeometry;
}): WorkspaceDeckFrameMorphDescriptor {
  const base = buildSurfaceMorphDescriptor({
    direction: resolveWorkspaceDeckFrameDirection(input.direction, input.role),
    durationMs: input.durationMs,
    from: input.from,
    to: input.to,
  });
  const descriptor = adaptWorkspaceDeckFrameMorphDescriptor(base);
  return {
    ...descriptor,
    cornerKeyframes: createWorkspaceDeckCornerKeyframes(input),
  };
}

export function adaptWorkspaceDeckFrameMorphDescriptor(
  descriptor: Pick<SurfaceMorphDescriptor, "chromeKeyframes" | "options">,
): WorkspaceDeckFrameMorphDescriptor {
  const geometryKeyframes = descriptor.chromeKeyframes.map(geometryOnlyKeyframe);
  return {
    appearanceKeyframes: geometryKeyframes.map(timelineOnlyKeyframe),
    cornerKeyframes: descriptor.chromeKeyframes.map(cornerOnlyKeyframe),
    geometryKeyframes,
    options: descriptor.options,
  };
}

export function localizeWorkspaceDeckChromeKeyframes(
  keyframes: readonly Keyframe[],
  hostOrigin: Pick<SurfaceRect, "left" | "top">,
): Keyframe[] {
  return keyframes.map((keyframe) => ({
    ...keyframe,
    left: localizePixel(keyframe.left, hostOrigin.left),
    top: localizePixel(keyframe.top, hostOrigin.top),
  }));
}

export function markWorkspaceDeckMorphSurface(surface: HTMLElement): () => void {
  const marked = new Set<HTMLElement>([surface]);
  const ancestorGlassHost = surface.closest<HTMLElement>(".chat-composer-glass-host");
  const descendantGlassHost = surface.querySelector<HTMLElement>(".chat-composer-glass-host");
  if (ancestorGlassHost) marked.add(ancestorGlassHost);
  if (descendantGlassHost) marked.add(descendantGlassHost);
  for (const element of marked) element.dataset.deckMorphSurface = "true";

  return () => {
    for (const element of marked) delete element.dataset.deckMorphSurface;
  };
}

export function animateWorkspaceDeckBackPeek(input: {
  readonly duration: number;
  readonly element: HTMLElement;
}): Animation {
  input.element.dataset.deckMorphBackPeek = "true";
  return input.element.animate(
    [
      {
        offset: 0,
        opacity: 1,
      },
      {
        offset: 1,
        opacity: 1,
      },
    ],
    { duration: input.duration, easing: "linear", fill: "both" },
  );
}

export function captureWorkspaceDeckContentHandoffState(
  element: HTMLElement,
  readStyle: WorkspaceDeckStyleReader = getComputedStyle,
): WorkspaceDeckContentHandoffState {
  const style = readStyle(element);
  return { opacity: normalizeOpacity(style.opacity) };
}

export function animateWorkspaceDeckContentHandoff(input: {
  readonly duration: number;
  readonly element: HTMLElement;
  readonly handoffOffset: number;
  readonly role: WorkspaceDeckContentHandoffRole;
}): WorkspaceDeckContentHandoffMotion {
  const previous = {
    opacity: input.element.style.opacity,
    willChange: input.element.style.willChange,
  };
  input.element.style.willChange = "opacity";
  const animation = input.element.animate(createWorkspaceDeckContentHandoffKeyframes(input), {
    duration: input.duration,
    easing: "linear",
    fill: "both",
  });
  return {
    animation,
    restoreStyles: () => {
      input.element.style.opacity = previous.opacity;
      input.element.style.willChange = previous.willChange;
    },
  };
}

function createWorkspaceDeckContentHandoffKeyframes(input: {
  readonly handoffOffset: number;
  readonly role: WorkspaceDeckContentHandoffRole;
}): Keyframe[] {
  const handoffOffset = normalizeOffset(input.handoffOffset);
  const finalOpacity = input.role === "outgoing" ? 0 : 1;
  if (handoffOffset === 0) {
    return [contentHandoffKeyframe(0, finalOpacity), contentHandoffKeyframe(1, finalOpacity)];
  }

  const initialOpacity = input.role === "outgoing" ? 1 : 0;
  return [
    contentHandoffKeyframe(0, initialOpacity, WORKSPACE_DECK_CONTENT_CUT_EASING),
    contentHandoffKeyframe(handoffOffset, finalOpacity),
    contentHandoffKeyframe(1, finalOpacity),
  ];
}

export function resolveWorkspaceDeckContentHandoffOffset(
  outgoingState: WorkspaceDeckContentHandoffState | undefined,
): number {
  if (
    outgoingState &&
    normalizeOpacity(outgoingState.opacity) < WORKSPACE_DECK_CONTENT_VISIBLE_THRESHOLD
  ) {
    return 0;
  }
  return WORKSPACE_DECK_CONTENT_HANDOFF_OFFSET;
}

function contentHandoffKeyframe(offset: number, opacity: number, easing?: string): Keyframe {
  return {
    offset,
    opacity,
    ...(easing ? { easing } : {}),
  };
}

function animateAppearance(
  element: HTMLElement,
  input: {
    readonly descriptor: WorkspaceDeckFrameMorphDescriptor;
    readonly from: WorkspaceDeckChromeAppearance;
    readonly to: WorkspaceDeckChromeAppearance;
  },
): Animation | null {
  if (typeof element.animate !== "function") return null;
  return element.animate(
    createWorkspaceDeckAppearanceKeyframes(input.descriptor, input.from, input.to),
    input.descriptor.options,
  );
}

function animateGeometry(
  element: HTMLElement,
  descriptor: WorkspaceDeckFrameMorphDescriptor,
  hostRect: Pick<SurfaceRect, "left" | "top">,
): Animation | null {
  if (typeof element.animate !== "function") return null;
  return element.animate(
    localizeWorkspaceDeckChromeKeyframes(descriptor.geometryKeyframes, hostRect),
    descriptor.options,
  );
}

function animateCorners(
  element: HTMLElement,
  descriptor: WorkspaceDeckFrameMorphDescriptor,
): Animation | null {
  if (typeof element.animate !== "function") return null;
  return element.animate([...descriptor.cornerKeyframes], descriptor.options);
}

export function createWorkspaceDeckAppearanceKeyframe(
  appearance: WorkspaceDeckChromeAppearance,
): Keyframe {
  return {
    backdropFilter: appearance.backdropFilter,
    backgroundColor: appearance.backgroundColor,
    borderColor: appearance.borderColor,
    boxShadow: appearance.boxShadow,
  };
}

export function createWorkspaceDeckAppearanceKeyframes(
  descriptor: WorkspaceDeckFrameMorphDescriptor,
  from: WorkspaceDeckChromeAppearance,
  to: WorkspaceDeckChromeAppearance,
): Keyframe[] {
  return descriptor.appearanceKeyframes.map((keyframe, index) => ({
    ...createWorkspaceDeckAppearanceKeyframe(index === 0 ? from : to),
    ...(keyframe.offset === undefined ? {} : { offset: keyframe.offset }),
    ...(keyframe.easing === undefined ? {} : { easing: keyframe.easing }),
  }));
}

function applyAppearance(element: HTMLElement, appearance: WorkspaceDeckChromeAppearance): void {
  element.style.backdropFilter = appearance.backdropFilter;
  element.style.setProperty("-webkit-backdrop-filter", appearance.backdropFilter);
  element.style.backgroundColor = appearance.backgroundColor;
  element.style.borderColor = appearance.borderColor;
  element.style.boxShadow = appearance.boxShadow;
}

function createWorkspaceDeckCornerKeyframes(input: {
  readonly from: SurfaceGeometry;
  readonly role: WorkspaceDeckMorphProxyRole;
  readonly to: SurfaceGeometry;
}): Keyframe[] {
  const start = cornerRadiusKeyframe(input.from.radii, 0);
  const end = cornerRadiusKeyframe(input.to.radii, 1);
  if (input.role === "incoming") {
    return [
      { ...start, easing: WORKSPACE_DECK_FRAME_EASING },
      cornerRadiusKeyframe(input.to.radii, WORKSPACE_DECK_FRAME_DETACH_OFFSET),
      end,
    ];
  }

  return [
    { ...start, easing: WORKSPACE_DECK_FRAME_EASING },
    cornerRadiusKeyframe(
      uniformCornerRadii(maxCornerRadius(input.from.radii, input.to.radii)),
      WORKSPACE_DECK_FRAME_DETACH_OFFSET,
    ),
    {
      ...cornerRadiusKeyframe(
        uniformCornerRadii(maxCornerRadius(input.from.radii, input.to.radii)),
        WORKSPACE_DECK_FRAME_ATTACH_OFFSET,
      ),
      easing: WORKSPACE_DECK_FRAME_EASING,
    },
    end,
  ];
}

function maxCornerRadius(from: SurfaceGeometry["radii"], to: SurfaceGeometry["radii"]): number {
  return Math.max(...Object.values(from), ...Object.values(to));
}

function uniformCornerRadii(radius: number): SurfaceGeometry["radii"] {
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
}

function cornerRadiusKeyframe(radii: SurfaceGeometry["radii"], offset: number): Keyframe {
  return {
    offset,
    borderRadius: [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft]
      .map(formatPixel)
      .join(" "),
  };
}

function geometryOnlyKeyframe(keyframe: Keyframe): Keyframe {
  const geometry = { ...keyframe };
  delete geometry.borderRadius;
  return geometry;
}

function cornerOnlyKeyframe(keyframe: Keyframe): Keyframe {
  return {
    borderRadius: keyframe.borderRadius,
    ...(keyframe.offset === undefined ? {} : { offset: keyframe.offset }),
    ...(keyframe.easing === undefined ? {} : { easing: keyframe.easing }),
  };
}

function timelineOnlyKeyframe(keyframe: Keyframe): Keyframe {
  return {
    ...(keyframe.offset === undefined ? {} : { offset: keyframe.offset }),
    ...(keyframe.easing === undefined ? {} : { easing: keyframe.easing }),
  };
}

function resolveWorkspaceDeckFrameDirection(
  direction: WorkspaceDeckDirection,
  role: WorkspaceDeckMorphProxyRole,
): SurfaceMorphDirection {
  if (direction === "forward") return role === "incoming" ? "from-bottom" : "to-top";
  return role === "incoming" ? "from-top" : "to-bottom";
}

function formatPixel(value: number): string {
  const rounded = Math.round(value * 1_000) / 1_000;
  return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function normalizeOpacity(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeOffset(value: number): number {
  if (!Number.isFinite(value)) return WORKSPACE_DECK_CONTENT_HANDOFF_OFFSET;
  return Math.min(1, Math.max(0, value));
}

function localizePixel(value: unknown, origin: number): string {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  const localized = Number.isFinite(parsed) ? parsed - origin : 0;
  return `${Object.is(localized, -0) ? 0 : localized}px`;
}

function firstPaintedBackdrop(...styles: readonly (CSSStyleDeclaration | null)[]): string {
  for (const style of styles) {
    if (!style) continue;
    const filter = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
    if (filter && filter !== "none") return filter;
  }
  return "none";
}

function firstPaintedBackgroundColor(...styles: readonly (CSSStyleDeclaration | null)[]): string {
  for (const style of styles) {
    if (!style) continue;
    if (!isTransparentColor(style.backgroundColor)) return style.backgroundColor;
  }
  return "transparent";
}

function firstPaintedBorder(...styles: readonly (CSSStyleDeclaration | null)[]): string {
  for (const style of styles) {
    if (!style || !hasPaintedBorder(style)) continue;
    return style.borderColor;
  }
  return "transparent";
}

function firstPaintedShadow(...styles: readonly (CSSStyleDeclaration | null)[]): string {
  for (const style of styles) {
    if (style?.boxShadow && style.boxShadow !== "none") return style.boxShadow;
  }
  return "none";
}

function firstPaintedFrameStyle(
  fallback: CSSStyleDeclaration,
  ...styles: readonly (CSSStyleDeclaration | null)[]
): CSSStyleDeclaration {
  for (const style of [fallback, ...styles]) {
    if (style && paintsFrame(style)) return style;
  }
  return fallback;
}

function paintsFrame(style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (normalizeOpacity(style.opacity) === 0) return false;
  const backdrop = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
  return (
    (backdrop !== "" && backdrop !== "none") ||
    !isTransparentColor(style.backgroundColor) ||
    hasPaintedBorder(style) ||
    (style.boxShadow !== "" && style.boxShadow !== "none")
  );
}

function hasPaintedBorder(style: CSSStyleDeclaration): boolean {
  const borderWidth =
    Number.parseFloat(style.borderTopWidth) +
    Number.parseFloat(style.borderRightWidth) +
    Number.parseFloat(style.borderBottomWidth) +
    Number.parseFloat(style.borderLeftWidth);
  return borderWidth > 0 && style.borderStyle !== "none" && !isTransparentColor(style.borderColor);
}

function isTransparentColor(color: string): boolean {
  return color === "transparent" || color === "rgba(0, 0, 0, 0)" || color === "rgb(0 0 0 / 0)";
}
