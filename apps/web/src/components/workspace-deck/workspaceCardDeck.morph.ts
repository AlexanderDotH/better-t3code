import {
  captureSurfaceGeometry,
  type SurfaceGeometry,
  type SurfaceMorphDescriptor,
  type SurfaceRect,
} from "../chat/surfaceMorph";

export const WORKSPACE_DECK_MORPH_DURATION_MS = 560;
export const WORKSPACE_DECK_CONTENT_PEEK_OPACITY = 0.84;

const WORKSPACE_DECK_APPROACH_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const WORKSPACE_DECK_SETTLE_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
const WORKSPACE_DECK_CORNER_SAMPLE_COUNT = 12;
const WORKSPACE_DECK_APPROACH_OFFSET = 0.84;

export type WorkspaceDeckMorphProxyRole = "incoming" | "outgoing";

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
  readonly element: HTMLDivElement;
  readonly geometryAnimation: Animation | null;
}

export type WorkspaceDeckStyleReader = (
  element: Element,
  pseudoElement?: string,
) => CSSStyleDeclaration;

export interface WorkspaceDeckOutgoingMotion {
  readonly animation: Animation;
  readonly cornerAnimation: Animation;
  readonly restoreStyles: () => void;
}

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
  return {
    geometry: captureSurfaceGeometry(element, () => style),
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
  readonly descriptor: SurfaceMorphDescriptor;
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
  return { appearanceAnimation, element, geometryAnimation };
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
  readonly from: SurfaceGeometry;
  readonly to: SurfaceGeometry;
}): Animation {
  const settlesAbove = input.to.rect.top < input.from.rect.top;
  const startY = settlesAbove ? 3 : -3;
  input.element.dataset.deckMorphBackPeek = "true";
  return input.element.animate(
    [
      {
        offset: 0,
        transform: `translate3d(0, ${startY}px, 0) scaleX(0.985)`,
        opacity: 0.72,
        easing: WORKSPACE_DECK_APPROACH_EASING,
      },
      {
        offset: 0.82,
        transform: `translate3d(0, ${settlesAbove ? 1 : -1}px, 0) scaleX(1.008)`,
        opacity: 1,
        easing: WORKSPACE_DECK_SETTLE_EASING,
      },
      {
        offset: 1,
        transform: "translate3d(0, 0, 0) scaleX(1)",
        opacity: 1,
      },
    ],
    { duration: input.duration, easing: "linear", fill: "both" },
  );
}

export function animateWorkspaceDeckContentFade(input: {
  readonly duration: number;
  readonly element: HTMLElement;
  readonly from: number;
  readonly to: number;
}): Animation {
  const from = normalizeOpacity(input.from);
  const to = normalizeOpacity(input.to);
  return input.element.animate(
    [
      { offset: 0, opacity: from, easing: WORKSPACE_DECK_APPROACH_EASING },
      { offset: 0.72, opacity: to, easing: WORKSPACE_DECK_SETTLE_EASING },
      { offset: 1, opacity: to },
    ],
    { duration: input.duration, easing: "linear", fill: "both" },
  );
}

export function animateWorkspaceDeckCorners(input: {
  readonly duration: number;
  readonly element: HTMLElement;
  readonly from: SurfaceGeometry;
  readonly fromScaleX: number;
  readonly fromScaleY: number;
  readonly to: SurfaceGeometry;
  readonly toScaleX: number;
  readonly toScaleY: number;
}): Animation {
  return input.element.animate(createWorkspaceDeckCornerKeyframes(input), {
    duration: input.duration,
    easing: "linear",
    fill: "both",
  });
}

export function animateWorkspaceDeckOutgoing(input: {
  readonly descriptor: SurfaceMorphDescriptor;
  readonly element: HTMLElement;
  readonly from: SurfaceGeometry;
  readonly surface: HTMLElement;
  readonly to: SurfaceGeometry;
}): WorkspaceDeckOutgoingMotion {
  const elementRect = input.element.getBoundingClientRect();
  const surfaceRect = input.surface.getBoundingClientRect();
  const start = resolveSurfaceTransform(input.from.rect, elementRect, surfaceRect);
  const target = resolveSurfaceTransform(input.to.rect, elementRect, surfaceRect);
  const overshootY = Math.sign(target.deltaY - start.deltaY) * 3;
  const startTransform = formatTransform(start.deltaX, start.deltaY, start.scaleX, start.scaleY);
  const targetTransform = formatTransform(
    target.deltaX,
    target.deltaY,
    target.scaleX,
    target.scaleY,
  );
  const previous = {
    overflow: input.element.style.overflow,
    transformOrigin: input.element.style.transformOrigin,
    willChange: input.element.style.willChange,
  };
  input.element.style.overflow = "clip";
  input.element.style.transformOrigin = "top left";
  input.element.style.willChange = "transform, clip-path, border-radius, opacity";
  const animation = input.element.animate(
    [
      {
        offset: 0,
        transform: startTransform,
        easing: WORKSPACE_DECK_APPROACH_EASING,
      },
      {
        offset: 0.84,
        transform: formatTransform(
          target.deltaX,
          target.deltaY + overshootY,
          target.scaleX,
          target.scaleY,
        ),
        easing: WORKSPACE_DECK_SETTLE_EASING,
      },
      {
        offset: 1,
        transform: targetTransform,
      },
    ],
    input.descriptor.options,
  );
  const cornerAnimation = animateWorkspaceDeckCorners({
    duration: Number(input.descriptor.options.duration),
    element: input.element,
    from: input.from,
    fromScaleX: start.scaleX,
    fromScaleY: start.scaleY,
    to: input.to,
    toScaleX: target.scaleX,
    toScaleY: target.scaleY,
  });
  return {
    animation,
    cornerAnimation,
    restoreStyles: () => {
      input.element.style.overflow = previous.overflow;
      input.element.style.transformOrigin = previous.transformOrigin;
      input.element.style.willChange = previous.willChange;
    },
  };
}

function animateAppearance(
  element: HTMLElement,
  input: {
    readonly descriptor: SurfaceMorphDescriptor;
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
  descriptor: SurfaceMorphDescriptor,
  hostRect: Pick<SurfaceRect, "left" | "top">,
): Animation | null {
  if (typeof element.animate !== "function") return null;
  return element.animate(
    localizeWorkspaceDeckChromeKeyframes(descriptor.chromeKeyframes, hostRect),
    descriptor.options,
  );
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
  descriptor: SurfaceMorphDescriptor,
  from: WorkspaceDeckChromeAppearance,
  to: WorkspaceDeckChromeAppearance,
): Keyframe[] {
  return descriptor.chromeKeyframes.map((timeline, index) => ({
    ...createWorkspaceDeckAppearanceKeyframe(index === 0 ? from : to),
    ...(timeline.offset === undefined ? {} : { offset: timeline.offset }),
    ...(timeline.easing === undefined ? {} : { easing: timeline.easing }),
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
  readonly fromScaleX: number;
  readonly fromScaleY: number;
  readonly to: SurfaceGeometry;
  readonly toScaleX: number;
  readonly toScaleY: number;
}): Keyframe[] {
  const approachFrames = Array.from(
    { length: WORKSPACE_DECK_CORNER_SAMPLE_COUNT + 1 },
    (_, index) => {
      const linearProgress = index / WORKSPACE_DECK_CORNER_SAMPLE_COUNT;
      const progress = cubicBezierProgress(linearProgress, 0.22, 1, 0.36, 1);
      const scaleX = lerp(input.fromScaleX, input.toScaleX, progress);
      const scaleY = lerp(input.fromScaleY, input.toScaleY, progress);
      const radii = interpolateRadii(input.from, input.to, progress);
      const borderRadius = formatCompensatedRadii(radii, scaleX, scaleY);
      return {
        offset: linearProgress * WORKSPACE_DECK_APPROACH_OFFSET,
        borderRadius,
        clipPath: `inset(0 round ${borderRadius})`,
      } satisfies Keyframe;
    },
  );
  const finalRadii = formatCompensatedRadii(input.to.radii, input.toScaleX, input.toScaleY);
  return [
    ...approachFrames,
    {
      offset: 1,
      borderRadius: finalRadii,
      clipPath: `inset(0 round ${finalRadii})`,
    },
  ];
}

function interpolateRadii(
  from: SurfaceGeometry,
  to: SurfaceGeometry,
  progress: number,
): SurfaceGeometry["radii"] {
  return {
    topLeft: lerp(from.radii.topLeft, to.radii.topLeft, progress),
    topRight: lerp(from.radii.topRight, to.radii.topRight, progress),
    bottomRight: lerp(from.radii.bottomRight, to.radii.bottomRight, progress),
    bottomLeft: lerp(from.radii.bottomLeft, to.radii.bottomLeft, progress),
  };
}

function formatCompensatedRadii(
  radii: SurfaceGeometry["radii"],
  scaleX: number,
  scaleY: number,
): string {
  const horizontal = Object.values(radii).map((radius) => `${radius / safeScale(scaleX)}px`);
  const vertical = Object.values(radii).map((radius) => `${radius / safeScale(scaleY)}px`);
  return `${horizontal.join(" ")} / ${vertical.join(" ")}`;
}

function safeScale(value: number): number {
  return Math.max(Math.abs(value), 0.01);
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function cubicBezierProgress(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidate = (lower + upper) / 2;
    if (cubicBezierCoordinate(candidate, x1, x2) < progress) lower = candidate;
    else upper = candidate;
  }
  return cubicBezierCoordinate((lower + upper) / 2, y1, y2);
}

function cubicBezierCoordinate(time: number, point1: number, point2: number): number {
  const inverse = 1 - time;
  return 3 * inverse * inverse * time * point1 + 3 * inverse * time * time * point2 + time ** 3;
}

function formatTransform(deltaX: number, deltaY: number, scaleX: number, scaleY: number): string {
  return `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`;
}

function ratio(value: number, reference: number): number {
  return reference > 0 ? value / reference : 1;
}

function resolveSurfaceTransform(
  target: SurfaceRect,
  element: SurfaceRect,
  surface: SurfaceRect,
): {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly scaleX: number;
  readonly scaleY: number;
} {
  const scaleX = ratio(target.width, surface.width);
  const scaleY = ratio(target.height, surface.height);
  return {
    deltaX: target.left - element.left - (surface.left - element.left) * scaleX,
    deltaY: target.top - element.top - (surface.top - element.top) * scaleY,
    scaleX,
    scaleY,
  };
}

function normalizeOpacity(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
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
