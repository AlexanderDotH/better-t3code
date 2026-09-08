export const SURFACE_MORPH_PRIMARY_DURATION_MS = 480;
export const SURFACE_MORPH_SECONDARY_DURATION_MS = 420;
export const SURFACE_MORPH_EXIT_DURATION_MS = 360;
export const SURFACE_MORPH_ANIMATION_ID = "t3-surface-morph";
export const SURFACE_MORPH_EASING = "linear";
export const SURFACE_MORPH_PHASE_OFFSETS = Object.freeze({
  start: 0,
  neck: 0.22,
  rise: 0.68,
  detach: 0.84,
  end: 1,
} as const);

const SURFACE_MORPH_APPROACH_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const SURFACE_MORPH_SETTLE_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
const CARD_OVERSHOOT_PX = 3;
const DROPLET_OVERSHOOT_PX = 6;
const DROPLET_OVERSHOOT_SCALE = 1.015;
const DROPLET_NECK_WIDTH_PX = 8;

export interface SurfaceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SurfaceCornerRadii {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
}

export interface SurfaceGeometry {
  readonly rect: SurfaceRect;
  readonly radii: SurfaceCornerRadii;
}

export type SurfaceMorphDirection =
  | "automatic"
  | "from-bottom"
  | "from-top"
  | "to-bottom"
  | "to-top";

export type SurfaceMorphOriginSource =
  | "composer-bottom"
  | "composer-left"
  | "composer-right"
  | "composer-top"
  | "trigger";

export interface SurfaceMorphOrigin {
  readonly x: number;
  readonly y: number;
  readonly source: SurfaceMorphOriginSource;
}

export interface SurfaceMorphContentStyles {
  readonly overflow: "clip";
  readonly transformOrigin: "top left";
  readonly willChange: "transform, clip-path, border-radius";
}

export interface SurfaceMorphChromeStyles {
  readonly pointerEvents: "none";
  readonly position: "fixed";
  readonly willChange: "left, top, width, height, border-radius";
}

export interface SurfaceMorphMetrics {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly overshootY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface SurfaceMorphDescriptor {
  readonly chromeKeyframes: Keyframe[];
  readonly chromeStyles: SurfaceMorphChromeStyles;
  readonly contentKeyframes: Keyframe[];
  readonly contentStyles: SurfaceMorphContentStyles;
  readonly metrics: SurfaceMorphMetrics;
  readonly options: KeyframeAnimationOptions;
}

export interface DropletNeckStyles {
  readonly borderRadius: "999px";
  readonly height: string;
  readonly left: string;
  readonly pointerEvents: "none";
  readonly position: "fixed";
  readonly top: string;
  readonly transformOrigin: "50% 0%" | "50% 100%";
  readonly width: "8px";
  readonly willChange: "transform, opacity";
}

export interface DropletPanelStyles {
  readonly overflow: "clip";
  readonly transformOrigin: "center center";
  readonly willChange: "transform, clip-path, border-radius";
}

export interface DropletMorphMetrics {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly neckLength: number;
  readonly overshootScale: number;
  readonly overshootY: number;
}

export interface DropletMorphDescriptor {
  readonly chromeKeyframes: Keyframe[];
  readonly chromeStyles: SurfaceMorphChromeStyles;
  readonly metrics: DropletMorphMetrics;
  readonly neckKeyframes: Keyframe[];
  readonly neckStyles: DropletNeckStyles;
  readonly options: KeyframeAnimationOptions;
  readonly panelKeyframes: Keyframe[];
  readonly panelStyles: DropletPanelStyles;
  readonly phases: typeof SURFACE_MORPH_PHASE_OFFSETS;
}

export type SurfaceStyleReader = (element: Element) => CSSStyleDeclaration;

export function captureSurfaceGeometry(
  element: HTMLElement,
  readStyle: SurfaceStyleReader = readComputedStyle,
): SurfaceGeometry {
  const rect = element.getBoundingClientRect();
  const style = readStyle(element);
  return {
    rect: {
      left: finiteNumber(rect.left),
      top: finiteNumber(rect.top),
      width: nonNegativeNumber(rect.width),
      height: nonNegativeNumber(rect.height),
    },
    radii: {
      topLeft: parseRadius(style.borderTopLeftRadius),
      topRight: parseRadius(style.borderTopRightRadius),
      bottomRight: parseRadius(style.borderBottomRightRadius),
      bottomLeft: parseRadius(style.borderBottomLeftRadius),
    },
  };
}

export function buildSurfaceMorphDescriptor(input: {
  readonly direction?: SurfaceMorphDirection;
  readonly durationMs?: number;
  readonly from: SurfaceGeometry;
  readonly to: SurfaceGeometry;
}): SurfaceMorphDescriptor {
  const from = normalizeGeometry(input.from);
  const to = normalizeGeometry(input.to);
  const deltaX = roundNumber(from.rect.left - to.rect.left);
  const deltaY = roundNumber(from.rect.top - to.rect.top);
  const scaleX = scaleBetween(from.rect.width, to.rect.width);
  const scaleY = scaleBetween(from.rect.height, to.rect.height);
  const overshootY = resolveCardOvershoot(input.direction ?? "automatic", deltaY);
  const fromRadii = formatRadii(from.radii);
  const toRadii = formatRadii(to.radii);
  const duration = validDuration(input.durationMs, SURFACE_MORPH_PRIMARY_DURATION_MS);

  return {
    metrics: { deltaX, deltaY, scaleX, scaleY, overshootY },
    options: animationOptions(duration),
    contentStyles: {
      overflow: "clip",
      transformOrigin: "top left",
      willChange: "transform, clip-path, border-radius",
    },
    chromeStyles: {
      position: "fixed",
      pointerEvents: "none",
      willChange: "left, top, width, height, border-radius",
    },
    contentKeyframes: [
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.start,
        transform: formatTransform(deltaX, deltaY, scaleX, scaleY),
        borderRadius: fromRadii,
        clipPath: formatClip(from.radii),
        easing: SURFACE_MORPH_APPROACH_EASING,
      },
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.detach,
        transform: formatTransform(0, overshootY, 1, 1),
        borderRadius: toRadii,
        clipPath: formatClip(to.radii),
        easing: SURFACE_MORPH_SETTLE_EASING,
      },
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.end,
        transform: "translate3d(0, 0, 0) scale(1, 1)",
        borderRadius: toRadii,
        clipPath: formatClip(to.radii),
      },
    ],
    chromeKeyframes: [
      chromeKeyframe(from, SURFACE_MORPH_PHASE_OFFSETS.start, SURFACE_MORPH_APPROACH_EASING),
      chromeKeyframe(
        {
          rect: { ...to.rect, top: roundNumber(to.rect.top + overshootY) },
          radii: to.radii,
        },
        SURFACE_MORPH_PHASE_OFFSETS.detach,
        SURFACE_MORPH_SETTLE_EASING,
      ),
      chromeKeyframe(to, SURFACE_MORPH_PHASE_OFFSETS.end),
    ],
  };
}

export function resolveSurfaceMorphOrigin(input: {
  readonly composerRect: SurfaceRect;
  readonly destinationRect: SurfaceRect;
  readonly triggerRect?: SurfaceRect;
}): SurfaceMorphOrigin {
  if (input.triggerRect) {
    const trigger = normalizeRect(input.triggerRect);
    return {
      x: roundNumber(trigger.left + trigger.width / 2),
      y: roundNumber(trigger.top + trigger.height / 2),
      source: "trigger",
    };
  }

  const composer = normalizeRect(input.composerRect);
  const destination = normalizeRect(input.destinationRect);
  const center = rectCenter(destination);
  const right = composer.left + composer.width;
  const bottom = composer.top + composer.height;
  const candidates: SurfaceMorphOrigin[] = [
    {
      x: clamp(center.x, composer.left, right),
      y: composer.top,
      source: "composer-top",
    },
    {
      x: right,
      y: clamp(center.y, composer.top, bottom),
      source: "composer-right",
    },
    {
      x: clamp(center.x, composer.left, right),
      y: bottom,
      source: "composer-bottom",
    },
    {
      x: composer.left,
      y: clamp(center.y, composer.top, bottom),
      source: "composer-left",
    },
  ];
  const closest = candidates.reduce((current, candidate) =>
    squaredDistance(candidate, center) < squaredDistance(current, center) ? candidate : current,
  );
  return { ...closest, x: roundNumber(closest.x), y: roundNumber(closest.y) };
}

export function buildDropletMorphDescriptor(input: {
  readonly destination: SurfaceGeometry;
  readonly durationMs?: number;
  readonly origin: SurfaceMorphOrigin;
}): DropletMorphDescriptor {
  const destination = normalizeGeometry(input.destination);
  const center = rectCenter(destination.rect);
  const deltaX = roundNumber(input.origin.x - center.x);
  const deltaY = roundNumber(input.origin.y - center.y);
  const overshootY = resolveDropletOvershoot(input.origin, center);
  const neckLength = roundNumber(clamp(Math.abs(deltaY) * 0.28, 12, 48));
  const movingUp = center.y < input.origin.y;
  const finalRadii = formatRadii(destination.radii);
  const duration = validDuration(input.durationMs, SURFACE_MORPH_PRIMARY_DURATION_MS);
  const startScaleX = clampScale(DROPLET_NECK_WIDTH_PX / destination.rect.width);
  const startScaleY = clampScale(DROPLET_NECK_WIDTH_PX / destination.rect.height);
  const initialChromeRadii: SurfaceCornerRadii = {
    topLeft: 999,
    topRight: 999,
    bottomRight: 999,
    bottomLeft: 999,
  };
  const initialPanelRadii = formatRadii(initialChromeRadii);
  const neckRadii: SurfaceCornerRadii = {
    topLeft: 999,
    topRight: 999,
    bottomRight: 18,
    bottomLeft: 18,
  };
  const sourceChrome = geometryAroundCenter(
    input.origin.x,
    input.origin.y,
    DROPLET_NECK_WIDTH_PX,
    DROPLET_NECK_WIDTH_PX,
    initialChromeRadii,
  );
  const neckChrome = geometryAroundCenter(
    center.x + deltaX * 0.88,
    center.y + deltaY * 0.88,
    destination.rect.width * 0.18,
    destination.rect.height * 0.28,
    neckRadii,
  );
  const risenChrome = geometryAroundCenter(
    center.x + deltaX * 0.1,
    center.y + deltaY * 0.1,
    destination.rect.width * 0.92,
    destination.rect.height * 0.96,
    destination.radii,
  );
  const detachedChrome = geometryAroundCenter(
    center.x,
    center.y + overshootY,
    destination.rect.width * DROPLET_OVERSHOOT_SCALE,
    destination.rect.height * DROPLET_OVERSHOOT_SCALE,
    destination.radii,
  );

  return {
    phases: SURFACE_MORPH_PHASE_OFFSETS,
    metrics: {
      deltaX,
      deltaY,
      neckLength,
      overshootScale: DROPLET_OVERSHOOT_SCALE,
      overshootY,
    },
    options: animationOptions(duration),
    chromeStyles: {
      position: "fixed",
      pointerEvents: "none",
      willChange: "left, top, width, height, border-radius",
    },
    panelStyles: {
      overflow: "clip",
      transformOrigin: "center center",
      willChange: "transform, clip-path, border-radius",
    },
    neckStyles: {
      position: "fixed",
      pointerEvents: "none",
      left: formatPixels(input.origin.x - DROPLET_NECK_WIDTH_PX / 2),
      top: formatPixels(movingUp ? input.origin.y - neckLength : input.origin.y),
      width: "8px",
      height: formatPixels(neckLength),
      borderRadius: "999px",
      transformOrigin: movingUp ? "50% 100%" : "50% 0%",
      willChange: "transform, opacity",
    },
    chromeKeyframes: [
      chromeKeyframe(
        sourceChrome,
        SURFACE_MORPH_PHASE_OFFSETS.start,
        SURFACE_MORPH_APPROACH_EASING,
      ),
      chromeKeyframe(neckChrome, SURFACE_MORPH_PHASE_OFFSETS.neck, SURFACE_MORPH_APPROACH_EASING),
      chromeKeyframe(risenChrome, SURFACE_MORPH_PHASE_OFFSETS.rise, SURFACE_MORPH_APPROACH_EASING),
      chromeKeyframe(
        detachedChrome,
        SURFACE_MORPH_PHASE_OFFSETS.detach,
        SURFACE_MORPH_SETTLE_EASING,
      ),
      chromeKeyframe(destination, SURFACE_MORPH_PHASE_OFFSETS.end),
    ],
    panelKeyframes: [
      dropletPanelKeyframe({
        offset: SURFACE_MORPH_PHASE_OFFSETS.start,
        deltaX,
        deltaY,
        scaleX: startScaleX,
        scaleY: startScaleY,
        borderRadius: initialPanelRadii,
        easing: SURFACE_MORPH_APPROACH_EASING,
      }),
      dropletPanelKeyframe({
        offset: SURFACE_MORPH_PHASE_OFFSETS.neck,
        deltaX: deltaX * 0.88,
        deltaY: deltaY * 0.88,
        scaleX: 0.18,
        scaleY: 0.28,
        borderRadius: "999px 999px 18px 18px",
        easing: SURFACE_MORPH_APPROACH_EASING,
      }),
      dropletPanelKeyframe({
        offset: SURFACE_MORPH_PHASE_OFFSETS.rise,
        deltaX: deltaX * 0.1,
        deltaY: deltaY * 0.1,
        scaleX: 0.92,
        scaleY: 0.96,
        borderRadius: finalRadii,
        easing: SURFACE_MORPH_APPROACH_EASING,
      }),
      dropletPanelKeyframe({
        offset: SURFACE_MORPH_PHASE_OFFSETS.detach,
        deltaX: 0,
        deltaY: overshootY,
        scaleX: DROPLET_OVERSHOOT_SCALE,
        scaleY: DROPLET_OVERSHOOT_SCALE,
        borderRadius: finalRadii,
        easing: SURFACE_MORPH_SETTLE_EASING,
      }),
      dropletPanelKeyframe({
        offset: SURFACE_MORPH_PHASE_OFFSETS.end,
        deltaX: 0,
        deltaY: 0,
        scaleX: 1,
        scaleY: 1,
        borderRadius: finalRadii,
      }),
    ],
    neckKeyframes: [
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.start,
        transform: "scale3d(0.25, 0, 1)",
        opacity: 0,
        easing: SURFACE_MORPH_APPROACH_EASING,
      },
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.neck,
        transform: "scale3d(1, 1, 1)",
        opacity: 1,
        easing: SURFACE_MORPH_APPROACH_EASING,
      },
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.rise,
        transform: "scale3d(0.65, 0.42, 1)",
        opacity: 0.72,
        easing: SURFACE_MORPH_SETTLE_EASING,
      },
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.detach,
        transform: "scale3d(0.35, 0, 1)",
        opacity: 0,
      },
      {
        offset: SURFACE_MORPH_PHASE_OFFSETS.end,
        transform: "scale3d(0.35, 0, 1)",
        opacity: 0,
      },
    ],
  };
}

export interface SurfaceMotionPreferenceTarget {
  readonly matchMedia?: (query: string) => Pick<MediaQueryList, "matches">;
}

export function prefersReducedSurfaceMotion(
  target: SurfaceMotionPreferenceTarget | null = defaultMotionPreferenceTarget(),
): boolean {
  try {
    return target?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export function shouldAnimateSurfaceMorph(input: {
  readonly canAnimate: boolean;
  readonly reducedMotion: boolean;
}): boolean {
  return input.canAnimate && !input.reducedMotion;
}

export interface SurfaceMorphEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface SurfaceMorphWindowTarget
  extends SurfaceMorphEventTarget, SurfaceMotionPreferenceTarget {}

export interface SurfaceMorphDocumentTarget extends SurfaceMorphEventTarget {
  readonly hidden: boolean;
}

export interface SurfaceMorphCoordinatorOptions {
  readonly captureGeometry?: (element: HTMLElement) => SurfaceGeometry;
  readonly documentTarget?: SurfaceMorphDocumentTarget | null;
  readonly reducedMotion?: () => boolean;
  readonly windowTarget?: SurfaceMorphWindowTarget | null;
}

export interface SurfaceMorphRunRequest {
  readonly animationId?: string;
  readonly chromeElement?: HTMLElement;
  readonly direction?: SurfaceMorphDirection;
  readonly durationMs?: number;
  readonly element: HTMLElement;
  readonly from: SurfaceGeometry;
  readonly onFinish?: () => void;
  readonly to?: SurfaceGeometry;
}

export interface SurfaceMorphRun {
  readonly animations: readonly Animation[];
  readonly descriptor: SurfaceMorphDescriptor;
  readonly finished: Promise<void>;
  readonly from: SurfaceGeometry;
  readonly started: boolean;
  readonly to: SurfaceGeometry;
}

export interface SurfaceMorphCoordinator {
  cancel(): void;
  dispose(): void;
  isActive(): boolean;
  run(request: SurfaceMorphRunRequest): SurfaceMorphRun;
}

interface ActiveSurfaceMorph {
  readonly animations: Animation[];
  readonly element: HTMLElement;
  readonly restoreStyles: () => void;
  readonly token: number;
}

export function createSurfaceMorphCoordinator(
  options: SurfaceMorphCoordinatorOptions = {},
): SurfaceMorphCoordinator {
  const captureGeometry = options.captureGeometry ?? captureSurfaceGeometry;
  const windowTarget = resolveWindowTarget(options.windowTarget);
  const documentTarget = resolveDocumentTarget(options.documentTarget);
  const reducedMotion = options.reducedMotion ?? (() => prefersReducedSurfaceMotion(windowTarget));
  let active: ActiveSurfaceMorph | null = null;
  let disposed = false;
  let nextToken = 0;

  const cancel = () => {
    if (!active) return;
    const cancelled = active;
    active = null;
    cancelAnimations(cancelled.animations);
    cancelled.restoreStyles();
  };

  const cancelWhenHidden = () => {
    if (documentTarget?.hidden) cancel();
  };
  const cancelForEnvironmentChange = () => cancel();
  addCoordinatorListeners(
    windowTarget,
    documentTarget,
    cancelForEnvironmentChange,
    cancelWhenHidden,
  );

  const run = (request: SurfaceMorphRunRequest): SurfaceMorphRun => {
    const from =
      active?.element === request.element
        ? safelyCaptureGeometry(captureGeometry, request.element, request.from)
        : normalizeGeometry(request.from);
    cancel();
    const to = request.to
      ? normalizeGeometry(request.to)
      : safelyCaptureGeometry(captureGeometry, request.element, from);
    const descriptor = buildSurfaceMorphDescriptor({
      from,
      to,
      direction: request.direction ?? "automatic",
      ...(request.durationMs === undefined ? {} : { durationMs: request.durationMs }),
    });
    const canAnimate = !disposed && typeof request.element.animate === "function";
    if (!shouldAnimateSurfaceMorph({ canAnimate, reducedMotion: reducedMotion() })) {
      const finished = Promise.resolve().then(() => request.onFinish?.());
      return { animations: [], descriptor, finished, from, started: false, to };
    }

    const restoreStyles = applyContentStyles(request.element, descriptor.contentStyles);
    let animations: Animation[];
    try {
      animations = [request.element.animate(descriptor.contentKeyframes, descriptor.options)];
      if (request.chromeElement && typeof request.chromeElement.animate === "function") {
        animations.push(
          request.chromeElement.animate(descriptor.chromeKeyframes, descriptor.options),
        );
      }
      const animationId = request.animationId ?? SURFACE_MORPH_ANIMATION_ID;
      animations[0]!.id = animationId;
      if (animations[1]) animations[1].id = `${animationId}-chrome`;
    } catch {
      restoreStyles();
      const finished = Promise.resolve().then(() => request.onFinish?.());
      return { animations: [], descriptor, finished, from, started: false, to };
    }

    const token = ++nextToken;
    active = { animations, element: request.element, restoreStyles, token };
    const finished = Promise.all(animations.map(waitForAnimation)).then(() => {
      if (active?.token !== token) return;
      const completed = active;
      active = null;
      cancelAnimations(completed.animations);
      completed.restoreStyles();
      request.onFinish?.();
    });
    return { animations, descriptor, finished, from, started: true, to };
  };

  return {
    cancel,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancel();
      removeCoordinatorListeners(
        windowTarget,
        documentTarget,
        cancelForEnvironmentChange,
        cancelWhenHidden,
      );
    },
    isActive: () => active !== null,
    run,
  };
}

function readComputedStyle(element: Element): CSSStyleDeclaration {
  if (typeof getComputedStyle !== "function") {
    throw new Error("Surface geometry requires getComputedStyle in this environment");
  }
  return getComputedStyle(element);
}

function parseRadius(value: string): number {
  return nonNegativeNumber(Number.parseFloat(value));
}

function normalizeGeometry(geometry: SurfaceGeometry): SurfaceGeometry {
  return {
    rect: normalizeRect(geometry.rect),
    radii: {
      topLeft: nonNegativeNumber(geometry.radii.topLeft),
      topRight: nonNegativeNumber(geometry.radii.topRight),
      bottomRight: nonNegativeNumber(geometry.radii.bottomRight),
      bottomLeft: nonNegativeNumber(geometry.radii.bottomLeft),
    },
  };
}

function normalizeRect(rect: SurfaceRect): SurfaceRect {
  return {
    left: finiteNumber(rect.left),
    top: finiteNumber(rect.top),
    width: nonNegativeNumber(rect.width),
    height: nonNegativeNumber(rect.height),
  };
}

function rectCenter(rect: SurfaceRect): { readonly x: number; readonly y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function squaredDistance(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): number {
  return (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
}

function scaleBetween(from: number, to: number): number {
  if (to <= 0) return 1;
  return roundNumber(from / to);
}

function clampScale(value: number): number {
  return roundNumber(clamp(Number.isFinite(value) ? value : 0.01, 0.01, 0.15));
}

function geometryAroundCenter(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  radii: SurfaceCornerRadii,
): SurfaceGeometry {
  return normalizeGeometry({
    rect: {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height,
    },
    radii,
  });
}

function resolveCardOvershoot(direction: SurfaceMorphDirection, deltaY: number): number {
  if (direction === "from-top" || direction === "to-bottom") return CARD_OVERSHOOT_PX;
  if (direction === "from-bottom" || direction === "to-top") return -CARD_OVERSHOOT_PX;
  if (deltaY === 0) return 0;
  return Math.sign(-deltaY) * CARD_OVERSHOOT_PX;
}

function resolveDropletOvershoot(
  origin: SurfaceMorphOrigin,
  destinationCenter: { readonly x: number; readonly y: number },
): number {
  const travelY = destinationCenter.y - origin.y;
  if (travelY !== 0) return Math.sign(travelY) * DROPLET_OVERSHOOT_PX;
  if (origin.source === "composer-bottom") return DROPLET_OVERSHOOT_PX;
  return -DROPLET_OVERSHOOT_PX;
}

function formatTransform(deltaX: number, deltaY: number, scaleX: number, scaleY: number): string {
  return `translate3d(${formatPixels(deltaX)}, ${formatPixels(deltaY)}, 0) scale(${formatNumber(scaleX)}, ${formatNumber(scaleY)})`;
}

function formatRadii(radii: SurfaceCornerRadii): string {
  return [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft]
    .map(formatPixels)
    .join(" ");
}

function formatClip(radii: SurfaceCornerRadii): string {
  return `inset(0 round ${formatRadii(radii)})`;
}

function formatPixels(value: number): string {
  return `${formatNumber(value)}px`;
}

function formatNumber(value: number): string {
  const rounded = roundNumber(value);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function chromeKeyframe(geometry: SurfaceGeometry, offset: number, easing?: string): Keyframe {
  return {
    offset,
    left: formatPixels(geometry.rect.left),
    top: formatPixels(geometry.rect.top),
    width: formatPixels(geometry.rect.width),
    height: formatPixels(geometry.rect.height),
    borderRadius: formatRadii(geometry.radii),
    ...(easing ? { easing } : {}),
  };
}

function dropletPanelKeyframe(input: {
  readonly borderRadius: string;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly easing?: string;
  readonly offset: number;
  readonly scaleX: number;
  readonly scaleY: number;
}): Keyframe {
  return {
    offset: input.offset,
    transform:
      input.offset === SURFACE_MORPH_PHASE_OFFSETS.end
        ? "translate3d(0, 0, 0) scale(1, 1)"
        : formatTransform(input.deltaX, input.deltaY, input.scaleX, input.scaleY),
    borderRadius: input.borderRadius,
    clipPath: `inset(0 round ${input.borderRadius})`,
    ...(input.easing ? { easing: input.easing } : {}),
  };
}

function animationOptions(duration: number): KeyframeAnimationOptions {
  return { duration, easing: SURFACE_MORPH_EASING, fill: "both" };
}

function validDuration(duration: number | undefined, fallback: number): number {
  return duration !== undefined && Number.isFinite(duration) && duration >= 0 ? duration : fallback;
}

function finiteNumber(value: number): number {
  return roundNumber(Number.isFinite(value) ? value : 0);
}

function nonNegativeNumber(value: number): number {
  return Math.max(0, finiteNumber(value));
}

function roundNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function defaultMotionPreferenceTarget(): SurfaceMotionPreferenceTarget | null {
  return typeof window === "undefined" ? null : window;
}

function resolveWindowTarget(
  configured: SurfaceMorphWindowTarget | null | undefined,
): SurfaceMorphWindowTarget | null {
  if (configured !== undefined) return configured;
  return typeof window === "undefined" ? null : (window as unknown as SurfaceMorphWindowTarget);
}

function resolveDocumentTarget(
  configured: SurfaceMorphDocumentTarget | null | undefined,
): SurfaceMorphDocumentTarget | null {
  if (configured !== undefined) return configured;
  return typeof document === "undefined"
    ? null
    : (document as unknown as SurfaceMorphDocumentTarget);
}

function safelyCaptureGeometry(
  capture: (element: HTMLElement) => SurfaceGeometry,
  element: HTMLElement,
  fallback: SurfaceGeometry,
): SurfaceGeometry {
  try {
    return normalizeGeometry(capture(element));
  } catch {
    return normalizeGeometry(fallback);
  }
}

function applyContentStyles(element: HTMLElement, styles: SurfaceMorphContentStyles): () => void {
  const previous = {
    overflow: element.style.overflow,
    transformOrigin: element.style.transformOrigin,
    willChange: element.style.willChange,
  };
  element.style.overflow = styles.overflow;
  element.style.transformOrigin = styles.transformOrigin;
  element.style.willChange = styles.willChange;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    element.style.overflow = previous.overflow;
    element.style.transformOrigin = previous.transformOrigin;
    element.style.willChange = previous.willChange;
  };
}

function cancelAnimations(animations: readonly Animation[]): void {
  for (const animation of animations) {
    try {
      animation.cancel();
    } catch {
      // The browser may already have discarded a detached animation target.
    }
  }
}

async function waitForAnimation(animation: Animation): Promise<void> {
  try {
    await animation.finished;
  } catch {
    // Cancellation is an expected handoff to the latest morph intent.
  }
}

const WINDOW_CLEANUP_EVENTS = ["resize", "pagehide", "popstate", "hashchange"] as const;

function addCoordinatorListeners(
  windowTarget: SurfaceMorphWindowTarget | null,
  documentTarget: SurfaceMorphDocumentTarget | null,
  cancelForEnvironmentChange: EventListener,
  cancelWhenHidden: EventListener,
): void {
  for (const event of WINDOW_CLEANUP_EVENTS) {
    windowTarget?.addEventListener(event, cancelForEnvironmentChange);
  }
  documentTarget?.addEventListener("visibilitychange", cancelWhenHidden);
}

function removeCoordinatorListeners(
  windowTarget: SurfaceMorphWindowTarget | null,
  documentTarget: SurfaceMorphDocumentTarget | null,
  cancelForEnvironmentChange: EventListener,
  cancelWhenHidden: EventListener,
): void {
  for (const event of WINDOW_CLEANUP_EVENTS) {
    windowTarget?.removeEventListener(event, cancelForEnvironmentChange);
  }
  documentTarget?.removeEventListener("visibilitychange", cancelWhenHidden);
}
