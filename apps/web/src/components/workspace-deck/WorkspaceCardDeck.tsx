import {
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";

import {
  buildSurfaceMorphDescriptor,
  createSurfaceMorphCoordinator,
  SURFACE_MORPH_EXIT_DURATION_MS,
  SURFACE_MORPH_SECONDARY_DURATION_MS,
  type SurfaceMorphCoordinator,
  type SurfaceMorphDirection,
} from "../chat/surfaceMorph";
import {
  findDuplicateWorkspaceDeckCardId,
  pruneWorkspaceDeckMeasurements,
  resolveWorkspaceDeckActiveCard,
  resolveWorkspaceDeckCompactHeight,
  resolveWorkspaceDeckDirection,
  resolveWorkspaceDeckMorphRoles,
  resolveWorkspaceDeckRoles,
  type WorkspaceDeckDirection,
  type WorkspaceDeckPosition,
  type WorkspaceDeckSelectionMode,
  type WorkspaceDeckTransition,
} from "./workspaceCardDeck.logic";
import {
  animateWorkspaceDeckBackPeek,
  animateWorkspaceDeckContentFade,
  animateWorkspaceDeckCorners,
  animateWorkspaceDeckOutgoing,
  captureWorkspaceDeckSurface,
  createWorkspaceDeckMorphProxy,
  markWorkspaceDeckMorphSurface,
  WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
  WORKSPACE_DECK_MORPH_DURATION_MS,
  type WorkspaceDeckSurfaceSnapshot,
} from "./workspaceCardDeck.morph";
import "./WorkspaceCardDeck.css";

const TRANSITION_FALLBACK_MS = WORKSPACE_DECK_MORPH_DURATION_MS + 120;
const COLLAPSE_FALLBACK_MS = SURFACE_MORPH_EXIT_DURATION_MS + 60;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const COMPACT_CONTENT_SELECTOR = '[data-workspace-card-compact-content="true"]';
const COMPACT_SURFACE_SELECTOR = '[data-workspace-card-compact-surface="true"]';
const EXPANDED_SURFACE_SELECTOR = '[data-workspace-card-expanded-surface="true"]';
const CARD_CONTENT_SELECTOR = ".workspace-card-deck__card-content";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface WorkspaceDeckCardDefinition<CardId extends string> {
  readonly id: CardId;
  readonly label: string;
  readonly renderBody: (context: {
    readonly active: boolean;
    readonly expanded: boolean;
  }) => ReactNode;
  readonly renderPeek: (context: {
    readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
    readonly blocked: boolean;
    readonly requestActivation: () => void;
  }) => ReactNode;
}

export interface WorkspaceCardDeckProps<CardId extends string> {
  readonly activeCard: CardId;
  readonly cards: readonly WorkspaceDeckCardDefinition<CardId>[];
  readonly compactHeightReferenceCard: CardId;
  readonly expandedCard: CardId | null;
  readonly resetKey: string;
  readonly selectionMode: WorkspaceDeckSelectionMode;
  readonly onRequestCard: (cardId: CardId, direction: WorkspaceDeckDirection) => boolean | void;
  readonly onExpandedCardCollapseComplete?: (cardId: CardId) => void;
  readonly selectionLocked?: boolean;
  readonly className?: string;
}

interface WorkspaceDeckStyle extends CSSProperties {
  "--workspace-card-deck-compact-height"?: string;
  "--workspace-card-deck-expanded-height"?: string;
}

interface ExpandedMeasurement<CardId extends string> {
  readonly id: CardId;
  readonly height: number;
}

interface WorkspaceDeckMorphIntent<CardId extends string> {
  readonly direction: WorkspaceDeckDirection;
  readonly fromId: CardId;
  readonly toId: CardId;
}

interface WorkspaceDeckMorphCapture<
  CardId extends string,
> extends WorkspaceDeckMorphIntent<CardId> {
  readonly active: WorkspaceDeckSurfaceSnapshot;
  readonly activeContentOpacity: number;
  readonly peeks: ReadonlyMap<CardId, WorkspaceDeckSurfaceSnapshot>;
}

interface ActiveWorkspaceDeckMorph {
  readonly animations: readonly Animation[];
  readonly cleanupCallbacks: readonly (() => void)[];
  readonly coordinators: readonly SurfaceMorphCoordinator[];
  readonly proxies: readonly HTMLElement[];
  readonly backPeek: HTMLElement | null;
  readonly token: number;
}

function disposeWorkspaceDeckMorph(morph: ActiveWorkspaceDeckMorph): void {
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

function readObservedBlockSize(entry: ResizeObserverEntry): number {
  const borderBoxSize = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize;
  return Math.ceil(borderBoxSize?.blockSize ?? entry.target.getBoundingClientRect().height);
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readElementOpacity(element: HTMLElement): number {
  const opacity = Number.parseFloat(window.getComputedStyle(element).opacity);
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(1, Math.max(0, opacity));
}

function findCompactContent(intrinsic: HTMLElement): HTMLElement | null {
  return (
    intrinsic.querySelector<HTMLElement>(COMPACT_CONTENT_SELECTOR) ??
    intrinsic.querySelector<HTMLElement>(CARD_CONTENT_SELECTOR)
  );
}

function findCompactSurface(intrinsic: HTMLElement, compactContent: HTMLElement): HTMLElement {
  const markedSurface = intrinsic.querySelector<HTMLElement>(COMPACT_SURFACE_SELECTOR);
  if (markedSurface) return markedSurface;

  let surface = compactContent;
  for (let parent = compactContent.parentElement; parent && parent !== intrinsic; ) {
    if (window.getComputedStyle(parent).display !== "contents") surface = parent;
    parent = parent.parentElement;
  }
  return surface;
}

function findExpandedSurface(intrinsic: HTMLElement): HTMLElement {
  return intrinsic.querySelector<HTMLElement>(EXPANDED_SURFACE_SELECTOR) ?? intrinsic;
}

function readNaturalCompactBlockSize(intrinsic: HTMLElement): number {
  const compactContent = findCompactContent(intrinsic);
  if (!compactContent || compactContent.hidden) {
    return Math.ceil(Math.max(intrinsic.scrollHeight, intrinsic.offsetHeight));
  }

  const compactSurface = findCompactSurface(intrinsic, compactContent);
  const surfaceStyle = window.getComputedStyle(compactSurface);
  const surfaceChrome =
    cssPixelValue(surfaceStyle.paddingBlockStart) +
    cssPixelValue(surfaceStyle.paddingBlockEnd) +
    cssPixelValue(surfaceStyle.borderBlockStartWidth) +
    cssPixelValue(surfaceStyle.borderBlockEndWidth);
  const minimumSurfaceHeight = cssPixelValue(surfaceStyle.minHeight);
  const contentHeight = Math.max(compactContent.offsetHeight, compactContent.scrollHeight);
  return Math.ceil(Math.max(minimumSurfaceHeight, contentHeight + surfaceChrome));
}

function observeIntrinsicElements(observer: ResizeObserver, intrinsic: HTMLElement): void {
  observer.observe(intrinsic);
  const compactContent = findCompactContent(intrinsic);
  if (compactContent) observer.observe(compactContent);
  const expandedSurface = findExpandedSurface(intrinsic);
  if (expandedSurface !== intrinsic) observer.observe(expandedSurface, { box: "border-box" });
}

function unobserveIntrinsicElements(observer: ResizeObserver, intrinsic: HTMLElement): void {
  observer.unobserve(intrinsic);
  const compactContent = findCompactContent(intrinsic);
  if (compactContent) observer.unobserve(compactContent);
  const expandedSurface = findExpandedSurface(intrinsic);
  if (expandedSurface !== intrinsic) observer.unobserve(expandedSurface);
}

function sameMeasurements(
  left: Readonly<Record<string, number | undefined>>,
  right: Readonly<Record<string, number | undefined>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === "undefined" || !window.matchMedia
      ? false
      : window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);
    return () => mediaQuery.removeEventListener?.("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function WorkspaceCardDeck<CardId extends string>(props: WorkspaceCardDeckProps<CardId>) {
  const cardIds = useMemo(() => props.cards.map((card) => card.id), [props.cards]);
  const duplicateCardId = findDuplicateWorkspaceDeckCardId(cardIds);
  if (duplicateCardId !== null) {
    throw new Error(`Duplicate workspace card id: ${duplicateCardId}`);
  }
  const firstCard = props.cards[0];
  if (!firstCard) {
    throw new Error("WorkspaceCardDeck requires at least one card");
  }
  const fallbackCard = firstCard.id;
  const activeCard = resolveWorkspaceDeckActiveCard({
    cardIds,
    activeCard: props.activeCard,
    fallbackCard,
  });
  if (activeCard === null) {
    throw new Error("WorkspaceCardDeck could not resolve an active card");
  }
  const compactHeightReferenceCard = cardIds.includes(props.compactHeightReferenceCard)
    ? props.compactHeightReferenceCard
    : activeCard;

  const prefersReducedMotion = usePrefersReducedMotion();
  const previousActiveCardRef = useRef(activeCard);
  const previousResetKeyRef = useRef(props.resetKey);
  const transitionTokenRef = useRef(0);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const keyboardRequestedCardRef = useRef<CardId | null>(null);
  const focusedElementByCardRef = useRef(new Map<CardId, HTMLElement>());
  const cardSectionRefs = useRef(new Map<CardId, HTMLElement>());
  const intrinsicElementRefs = useRef(new Map<CardId, HTMLDivElement>());
  const morphHostRefs = useRef(new Map<CardId, HTMLDivElement>());
  const peekSlotRefs = useRef(new Map<CardId, HTMLDivElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const pendingCompactMeasurementsRef = useRef(new Map<CardId, number>());
  const pendingExpandedMeasurementRef = useRef<ExpandedMeasurement<CardId> | null>(null);
  const measurementFrameRef = useRef<number | null>(null);
  const expandedCardRef = useRef<CardId | null>(props.expandedCard);
  const compactHeightReferenceCardRef = useRef(compactHeightReferenceCard);
  const cardIdsRef = useRef(cardIds);
  const previousExpandedCardRef = useRef<CardId | null>(props.expandedCard);
  const previousCollapseResetKeyRef = useRef(props.resetKey);
  const collapsingCardRef = useRef<CardId | null>(null);
  const collapseCompleteCallbackRef = useRef(props.onExpandedCardCollapseComplete);
  const activeCardRef = useRef(activeCard);
  const pendingMorphIntentRef = useRef<WorkspaceDeckMorphIntent<CardId> | null>(null);
  const pendingMorphCaptureRef = useRef<WorkspaceDeckMorphCapture<CardId> | null>(null);
  const activeMorphRef = useRef<ActiveWorkspaceDeckMorph | null>(null);
  const activeExpansionMorphRef = useRef<ActiveWorkspaceDeckMorph | null>(null);
  const expansionMorphTokenRef = useRef(0);
  const previousMorphExpandedCardRef = useRef<CardId | null>(props.expandedCard);
  const previousMorphResetKeyRef = useRef(props.resetKey);
  const surfaceSnapshotByCardRef = useRef(new Map<CardId, WorkspaceDeckSurfaceSnapshot>());
  const transitionRef = useRef<WorkspaceDeckTransition<CardId> | null>(null);
  const [measurements, setMeasurements] = useState<Partial<Record<CardId, number>>>({});
  const [expandedMeasurement, setExpandedMeasurement] =
    useState<ExpandedMeasurement<CardId> | null>(null);
  const [frozenCompactHeight, setFrozenCompactHeight] = useState<number | null>(null);
  const [collapsingCard, setCollapsingCard] = useState<CardId | null>(null);
  const [transition, setTransition] = useState<WorkspaceDeckTransition<CardId> | null>(null);

  expandedCardRef.current = props.expandedCard;
  activeCardRef.current = activeCard;
  compactHeightReferenceCardRef.current = compactHeightReferenceCard;
  cardIdsRef.current = cardIds;
  collapseCompleteCallbackRef.current = props.onExpandedCardCollapseComplete;
  transitionRef.current = transition;

  const focusDestination = useCallback((cardId: CardId) => {
    if (keyboardRequestedCardRef.current === cardId) {
      keyboardRequestedCardRef.current = null;
      const section = cardSectionRefs.current.get(cardId);
      if (!section) return;
      requestAnimationFrame(() => section.focus({ preventScroll: true }));
      return;
    }

    const previousFocus = focusedElementByCardRef.current.get(cardId);
    if (!previousFocus?.isConnected) return;
    requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
  }, []);

  const cleanupActiveMorph = useCallback(() => {
    const activeMorph = activeMorphRef.current;
    if (activeMorph === null) return;
    activeMorphRef.current = null;
    disposeWorkspaceDeckMorph(activeMorph);
  }, []);

  const cleanupExpansionMorph = useCallback(() => {
    const activeMorph = activeExpansionMorphRef.current;
    if (activeMorph === null) return;
    activeExpansionMorphRef.current = null;
    disposeWorkspaceDeckMorph(activeMorph);
  }, []);

  const capturePeekSurface = useCallback((cardId: CardId) => {
    const slot = peekSlotRefs.current.get(cardId);
    const peek = slot?.querySelector<HTMLElement>("[data-workspace-card-peek]");
    return peek ? captureWorkspaceDeckSurface(peek) : null;
  }, []);

  const captureMorphRequest = useCallback(
    (intent: WorkspaceDeckMorphIntent<CardId>) => {
      const activeIntrinsic = intrinsicElementRefs.current.get(intent.fromId);
      if (!activeIntrinsic) return null;
      const activeProxy = morphHostRefs.current
        .get(intent.fromId)
        ?.querySelector<HTMLElement>('[data-surface-morph-proxy^="deck-"]');
      const activeSurface =
        activeProxy ??
        findCompactSurface(activeIntrinsic, findCompactContent(activeIntrinsic) ?? activeIntrinsic);
      const peeks = new Map<CardId, WorkspaceDeckSurfaceSnapshot>();
      for (const cardId of cardIdsRef.current) {
        const snapshot = capturePeekSurface(cardId);
        if (snapshot) peeks.set(cardId, snapshot);
      }
      if (!peeks.has(intent.toId)) return null;
      return {
        ...intent,
        active: captureWorkspaceDeckSurface(activeSurface),
        activeContentOpacity: readElementOpacity(activeIntrinsic),
        peeks,
      } satisfies WorkspaceDeckMorphCapture<CardId>;
    },
    [capturePeekSurface],
  );

  const finishTransition = useCallback(
    (token?: number) => {
      const currentTransition = transitionRef.current;
      if (currentTransition === null) return;
      if (token !== undefined && currentTransition.token !== token) return;
      cleanupActiveMorph();
      pendingMorphCaptureRef.current = null;
      pendingMorphIntentRef.current = null;
      focusDestination(currentTransition.toId);
      transitionRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
    },
    [cleanupActiveMorph, focusDestination],
  );

  const cancelCollapse = useCallback(() => {
    collapsingCardRef.current = null;
    setCollapsingCard(null);
  }, []);

  const finishCollapse = useCallback(() => {
    const collapsedCard = collapsingCardRef.current;
    if (collapsedCard === null) return;
    cleanupExpansionMorph();
    const pendingIntent = pendingMorphIntentRef.current;
    if (pendingIntent?.fromId === collapsedCard) {
      pendingMorphCaptureRef.current = captureMorphRequest(pendingIntent);
    }
    collapsingCardRef.current = null;
    setCollapsingCard(null);
    collapseCompleteCallbackRef.current?.(collapsedCard);
  }, [captureMorphRequest, cleanupExpansionMorph]);

  useIsomorphicLayoutEffect(() => {
    const resetChanged = previousCollapseResetKeyRef.current !== props.resetKey;
    previousCollapseResetKeyRef.current = props.resetKey;
    const previousExpandedCard = previousExpandedCardRef.current;
    previousExpandedCardRef.current = props.expandedCard;

    if (resetChanged) {
      cancelCollapse();
      return;
    }
    if (props.expandedCard !== null) {
      cancelCollapse();
      return;
    }
    if (previousExpandedCard === null) return;

    collapsingCardRef.current = previousExpandedCard;
    setCollapsingCard(previousExpandedCard);
  }, [cancelCollapse, props.expandedCard, props.resetKey]);

  useEffect(() => {
    if (collapsingCard === null) return;
    if (prefersReducedMotion || props.selectionMode === "immediate") {
      finishCollapse();
      return;
    }
    const fallback = window.setTimeout(finishCollapse, COLLAPSE_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [collapsingCard, finishCollapse, prefersReducedMotion, props.selectionMode]);

  useIsomorphicLayoutEffect(() => {
    const resetChanged = previousResetKeyRef.current !== props.resetKey;
    previousResetKeyRef.current = props.resetKey;
    if (resetChanged) {
      cleanupActiveMorph();
      previousActiveCardRef.current = activeCard;
      keyboardRequestedCardRef.current = null;
      pendingMorphCaptureRef.current = null;
      pendingMorphIntentRef.current = null;
      transitionRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
      setMeasurements({});
      setExpandedMeasurement(null);
      return;
    }

    const previousActiveCard = previousActiveCardRef.current;
    if (previousActiveCard === activeCard) return;
    previousActiveCardRef.current = activeCard;
    cleanupExpansionMorph();

    const direction = resolveWorkspaceDeckDirection(cardIds, previousActiveCard, activeCard);
    const activeCardWasRemoved = !cardIds.includes(props.activeCard);
    if (
      direction === null ||
      activeCardWasRemoved ||
      props.selectionMode === "immediate" ||
      prefersReducedMotion
    ) {
      cleanupActiveMorph();
      pendingMorphCaptureRef.current = null;
      pendingMorphIntentRef.current = null;
      transitionRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
      focusDestination(activeCard);
      return;
    }

    const compactHeight = resolveWorkspaceDeckCompactHeight({
      activeCard: previousActiveCard,
      cardIds,
      referenceCard: compactHeightReferenceCard,
      measurements,
    });
    const capture = pendingMorphCaptureRef.current;
    const capturedIntentMatches =
      capture?.fromId === previousActiveCard && capture.toId === activeCard;
    const incomingIntrinsic = intrinsicElementRefs.current.get(activeCard);
    const motion =
      capturedIntentMatches && typeof incomingIntrinsic?.animate === "function"
        ? "morph"
        : "fallback";
    transitionTokenRef.current += 1;
    const nextTransition: WorkspaceDeckTransition<CardId> = {
      fromId: previousActiveCard,
      toId: activeCard,
      direction,
      motion,
      token: transitionTokenRef.current,
    };
    setFrozenCompactHeight(compactHeight);
    transitionRef.current = nextTransition;
    setTransition(nextTransition);
  }, [
    activeCard,
    cardIds,
    cleanupActiveMorph,
    cleanupExpansionMorph,
    compactHeightReferenceCard,
    focusDestination,
    measurements,
    prefersReducedMotion,
    props.activeCard,
    props.resetKey,
    props.selectionMode,
  ]);

  useIsomorphicLayoutEffect(() => {
    if (props.selectionMode !== "immediate" || transition === null) return;
    cleanupActiveMorph();
    focusDestination(activeCard);
    transitionRef.current = null;
    setTransition(null);
    setFrozenCompactHeight(null);
  }, [activeCard, cleanupActiveMorph, focusDestination, props.selectionMode, transition]);

  useEffect(() => {
    if (transition === null) return;
    const fallback = window.setTimeout(
      () => finishTransition(transition.token),
      TRANSITION_FALLBACK_MS,
    );
    return () => window.clearTimeout(fallback);
  }, [finishTransition, transition]);

  useIsomorphicLayoutEffect(() => {
    if (transition?.motion !== "morph") return;
    const capture = pendingMorphCaptureRef.current;
    if (
      capture === null ||
      capture.fromId !== transition.fromId ||
      capture.toId !== transition.toId
    ) {
      transitionRef.current = { ...transition, motion: "fallback" };
      setTransition(transitionRef.current);
      return;
    }

    const incomingIntrinsic = intrinsicElementRefs.current.get(transition.toId);
    const outgoingIntrinsic = intrinsicElementRefs.current.get(transition.fromId);
    const incomingHost = morphHostRefs.current.get(transition.toId);
    const outgoingHost = morphHostRefs.current.get(transition.fromId);
    const incomingContent = incomingIntrinsic ? findCompactContent(incomingIntrinsic) : null;
    const outgoingContent = outgoingIntrinsic ? findCompactContent(outgoingIntrinsic) : null;
    const sourcePeek = capture.peeks.get(transition.toId);
    const targetPeek = capturePeekSurface(transition.fromId);
    if (
      !incomingIntrinsic ||
      !outgoingIntrinsic ||
      !incomingHost ||
      !outgoingHost ||
      !sourcePeek ||
      !targetPeek
    ) {
      transitionRef.current = { ...transition, motion: "fallback" };
      setTransition(transitionRef.current);
      return;
    }

    const incomingSurface = findCompactSurface(
      incomingIntrinsic,
      incomingContent ?? incomingIntrinsic,
    );
    const outgoingSurface = findCompactSurface(
      outgoingIntrinsic,
      outgoingContent ?? outgoingIntrinsic,
    );
    const incomingTarget = captureWorkspaceDeckSurface(incomingSurface);
    const incomingDirection: SurfaceMorphDirection =
      transition.direction === "forward" ? "from-bottom" : "from-top";
    const outgoingDirection: SurfaceMorphDirection =
      transition.direction === "forward" ? "to-top" : "to-bottom";
    const incomingDescriptor = buildSurfaceMorphDescriptor({
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: sourcePeek.geometry,
      to: incomingTarget.geometry,
      direction: incomingDirection,
    });
    const outgoingDescriptor = buildSurfaceMorphDescriptor({
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: capture.active.geometry,
      to: targetPeek.geometry,
      direction: outgoingDirection,
    });

    cleanupActiveMorph();
    try {
      const incomingProxy = createWorkspaceDeckMorphProxy({
        descriptor: incomingDescriptor,
        from: sourcePeek.appearance,
        host: incomingHost,
        role: "incoming",
        to: incomingTarget.appearance,
      });
      const outgoingProxy = createWorkspaceDeckMorphProxy({
        descriptor: outgoingDescriptor,
        from: capture.active.appearance,
        host: outgoingHost,
        role: "outgoing",
        to: targetPeek.appearance,
      });
      const incomingCoordinator = createSurfaceMorphCoordinator({
        documentTarget: null,
        reducedMotion: () => prefersReducedMotion,
        windowTarget: null,
      });
      const outgoingMotion = animateWorkspaceDeckOutgoing({
        descriptor: outgoingDescriptor,
        element: outgoingIntrinsic,
        from: capture.active.geometry,
        surface: outgoingSurface,
        to: targetPeek.geometry,
      });
      const incomingContentFade = animateWorkspaceDeckContentFade({
        duration: WORKSPACE_DECK_MORPH_DURATION_MS,
        element: incomingIntrinsic,
        from: Math.min(WORKSPACE_DECK_CONTENT_PEEK_OPACITY, sourcePeek.opacity),
        to: 1,
      });
      const outgoingContentFade = animateWorkspaceDeckContentFade({
        duration: WORKSPACE_DECK_MORPH_DURATION_MS,
        element: outgoingIntrinsic,
        from: capture.activeContentOpacity,
        to: WORKSPACE_DECK_CONTENT_PEEK_OPACITY,
      });
      const cleanupCallbacks = [
        markWorkspaceDeckMorphSurface(incomingSurface),
        markWorkspaceDeckMorphSurface(outgoingSurface),
        outgoingMotion.restoreStyles,
      ];
      outgoingMotion.animation.id = `workspace-deck-${transition.token}-outgoing`;
      outgoingMotion.cornerAnimation.id = `workspace-deck-${transition.token}-outgoing-corners`;
      incomingContentFade.id = `workspace-deck-${transition.token}-incoming-content-fade`;
      outgoingContentFade.id = `workspace-deck-${transition.token}-outgoing-content-fade`;
      const animations: Animation[] = [
        outgoingMotion.animation,
        outgoingMotion.cornerAnimation,
        incomingContentFade,
        outgoingContentFade,
      ];
      if (incomingProxy.geometryAnimation) {
        incomingProxy.geometryAnimation.id = `workspace-deck-${transition.token}-incoming-chrome`;
        animations.push(incomingProxy.geometryAnimation);
      }
      if (outgoingProxy.geometryAnimation) {
        outgoingProxy.geometryAnimation.id = `workspace-deck-${transition.token}-outgoing-chrome`;
        animations.push(outgoingProxy.geometryAnimation);
      }
      if (incomingProxy.appearanceAnimation) {
        incomingProxy.appearanceAnimation.id = `workspace-deck-${transition.token}-incoming-glass`;
        animations.push(incomingProxy.appearanceAnimation);
      }
      if (outgoingProxy.appearanceAnimation) {
        outgoingProxy.appearanceAnimation.id = `workspace-deck-${transition.token}-outgoing-glass`;
        animations.push(outgoingProxy.appearanceAnimation);
      }

      const backRole = resolveWorkspaceDeckMorphRoles(
        cardIds,
        transition.fromId,
        transition.toId,
      ).find((role) => role.morph === "orbiting");
      const backPeek = backRole
        ? (peekSlotRefs.current
            .get(backRole.id)
            ?.querySelector<HTMLElement>("[data-workspace-card-peek]") ?? null)
        : null;
      const backFrom = backRole ? capture.peeks.get(backRole.id) : null;
      const backTo = backRole ? capturePeekSurface(backRole.id) : null;
      if (backPeek && backFrom && backTo) {
        const backPeekAnimation = animateWorkspaceDeckBackPeek({
          duration: WORKSPACE_DECK_MORPH_DURATION_MS,
          element: backPeek,
          from: backFrom.geometry,
          to: backTo.geometry,
        });
        backPeekAnimation.id = `workspace-deck-${transition.token}-back-peek`;
        animations.push(backPeekAnimation);
      }

      activeMorphRef.current = {
        animations,
        cleanupCallbacks,
        coordinators: [incomingCoordinator],
        proxies: [incomingProxy.element, outgoingProxy.element],
        backPeek,
        token: transition.token,
      };
      const incomingRun = incomingCoordinator.run({
        animationId: `workspace-deck-${transition.token}-incoming`,
        direction: incomingDirection,
        durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
        element: incomingIntrinsic,
        from: sourcePeek.geometry,
        to: incomingTarget.geometry,
      });
      if (!incomingRun.started) {
        cleanupActiveMorph();
        transitionRef.current = { ...transition, motion: "fallback" };
        setTransition(transitionRef.current);
        return;
      }
      const incomingCornerAnimation = animateWorkspaceDeckCorners({
        duration: WORKSPACE_DECK_MORPH_DURATION_MS,
        element: incomingIntrinsic,
        from: sourcePeek.geometry,
        fromScaleX: incomingDescriptor.metrics.scaleX,
        fromScaleY: incomingDescriptor.metrics.scaleY,
        to: incomingTarget.geometry,
        toScaleX: 1,
        toScaleY: 1,
      });
      incomingCornerAnimation.id = `workspace-deck-${transition.token}-incoming-corners`;
      animations.push(incomingCornerAnimation);
      incomingIntrinsic.style.willChange = "transform, clip-path, border-radius, opacity";
      void incomingRun.finished.then(() => {
        if (activeMorphRef.current?.token === transition.token) {
          finishTransition(transition.token);
        }
      });
    } catch {
      cleanupActiveMorph();
      transitionRef.current = { ...transition, motion: "fallback" };
      setTransition(transitionRef.current);
    }
  }, [
    capturePeekSurface,
    cardIds,
    cleanupActiveMorph,
    finishTransition,
    prefersReducedMotion,
    transition,
  ]);

  useEffect(() => {
    if (transition?.motion !== "morph") return;
    const token = transition.token;
    const settle = () => finishTransition(token);
    const settleWhenHidden = () => {
      if (document.hidden) settle();
    };
    window.addEventListener("resize", settle);
    window.addEventListener("scroll", settle, true);
    window.addEventListener("pagehide", settle);
    window.addEventListener("popstate", settle);
    window.addEventListener("hashchange", settle);
    document.addEventListener("visibilitychange", settleWhenHidden);
    return () => {
      window.removeEventListener("resize", settle);
      window.removeEventListener("scroll", settle, true);
      window.removeEventListener("pagehide", settle);
      window.removeEventListener("popstate", settle);
      window.removeEventListener("hashchange", settle);
      document.removeEventListener("visibilitychange", settleWhenHidden);
    };
  }, [finishTransition, transition]);

  useEffect(
    () => () => {
      cleanupActiveMorph();
      cleanupExpansionMorph();
    },
    [cleanupActiveMorph, cleanupExpansionMorph],
  );

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const onAnimationCancel = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.hasAttribute("data-transition-role")) return;
      const currentTransition = transitionRef.current;
      if (currentTransition?.motion !== "fallback") return;
      finishTransition(currentTransition.token);
    };
    deck.addEventListener("animationcancel", onAnimationCancel);
    return () => deck.removeEventListener("animationcancel", onAnimationCancel);
  }, [finishTransition]);

  useEffect(() => {
    setMeasurements((currentMeasurements) => {
      const pruned = pruneWorkspaceDeckMeasurements(cardIds, currentMeasurements);
      return sameMeasurements(currentMeasurements, pruned) ? currentMeasurements : pruned;
    });
  }, [cardIds]);

  useEffect(() => {
    if (props.expandedCard === null) {
      setExpandedMeasurement(null);
      return;
    }
    setExpandedMeasurement((currentMeasurement) =>
      currentMeasurement?.id === props.expandedCard ? currentMeasurement : null,
    );
  }, [props.expandedCard]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    const flushMeasurements = () => {
      measurementFrameRef.current = null;
      const pendingCompactMeasurements = new Map(pendingCompactMeasurementsRef.current);
      pendingCompactMeasurementsRef.current.clear();
      const pendingExpandedMeasurement = pendingExpandedMeasurementRef.current;
      pendingExpandedMeasurementRef.current = null;
      const currentExpandedCard = expandedCardRef.current;

      if (currentExpandedCard !== null && pendingExpandedMeasurement?.id === currentExpandedCard) {
        setExpandedMeasurement(pendingExpandedMeasurement);
      }

      if (pendingCompactMeasurements.size === 0) return;
      setMeasurements((currentMeasurements) => {
        const nextMeasurements = pruneWorkspaceDeckMeasurements(
          cardIdsRef.current,
          currentMeasurements,
        );
        for (const [cardId, height] of pendingCompactMeasurements) {
          if (!cardIdsRef.current.includes(cardId)) continue;
          nextMeasurements[cardId] = height;
        }
        return sameMeasurements(currentMeasurements, nextMeasurements)
          ? currentMeasurements
          : nextMeasurements;
      });
    };

    const observer = new ResizeObserver((entries) => {
      const compactCardsToMeasure = new Set<CardId>();
      for (const entry of entries) {
        const intrinsic = entry.target.matches("[data-workspace-card-intrinsic]")
          ? entry.target
          : entry.target.closest("[data-workspace-card-intrinsic]");
        if (!(intrinsic instanceof HTMLElement)) continue;
        const cardId = intrinsic.getAttribute("data-workspace-card-intrinsic") as CardId | null;
        if (cardId === null || !cardIdsRef.current.includes(cardId)) continue;
        const currentExpandedCard = expandedCardRef.current;
        const expandedSurface = findExpandedSurface(intrinsic);
        if (cardId === currentExpandedCard && entry.target === expandedSurface) {
          pendingExpandedMeasurementRef.current = {
            id: cardId,
            height: readObservedBlockSize(entry),
          };
        }
        if (cardId === currentExpandedCard) continue;
        if (cardId !== compactHeightReferenceCardRef.current) continue;
        compactCardsToMeasure.add(cardId);
      }
      for (const cardId of compactCardsToMeasure) {
        const intrinsic = intrinsicElementRefs.current.get(cardId);
        if (!intrinsic) continue;
        pendingCompactMeasurementsRef.current.set(cardId, readNaturalCompactBlockSize(intrinsic));
      }
      if (measurementFrameRef.current !== null) return;
      measurementFrameRef.current = requestAnimationFrame(flushMeasurements);
    });
    observerRef.current = observer;
    for (const element of intrinsicElementRefs.current.values()) {
      observeIntrinsicElements(observer, element);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (measurementFrameRef.current !== null) {
        cancelAnimationFrame(measurementFrameRef.current);
        measurementFrameRef.current = null;
      }
      pendingCompactMeasurementsRef.current.clear();
      pendingExpandedMeasurementRef.current = null;
    };
  }, [props.resetKey]);

  useIsomorphicLayoutEffect(() => {
    const expandedCard = props.expandedCard;
    if (expandedCard === null) return;
    const intrinsic = intrinsicElementRefs.current.get(expandedCard);
    if (!intrinsic) return;
    const expandedSurface = findExpandedSurface(intrinsic);
    const observer = observerRef.current;
    if (observer && expandedSurface !== intrinsic) {
      observer.observe(expandedSurface, { box: "border-box" });
    }

    const height = Math.ceil(expandedSurface.getBoundingClientRect().height);
    if (height > 0) {
      setExpandedMeasurement((currentMeasurement) =>
        currentMeasurement?.id === expandedCard && currentMeasurement.height === height
          ? currentMeasurement
          : { id: expandedCard, height },
      );
    }

    return () => {
      if (observer && expandedSurface !== intrinsic) observer.unobserve(expandedSurface);
    };
  }, [props.expandedCard, props.resetKey]);

  useIsomorphicLayoutEffect(() => {
    if (compactHeightReferenceCard === props.expandedCard) return;
    const intrinsic = intrinsicElementRefs.current.get(compactHeightReferenceCard);
    if (!intrinsic) return;
    const height = readNaturalCompactBlockSize(intrinsic);
    setMeasurements((currentMeasurements) =>
      currentMeasurements[compactHeightReferenceCard] === height
        ? currentMeasurements
        : { ...currentMeasurements, [compactHeightReferenceCard]: height },
    );
  }, [cardIds, compactHeightReferenceCard, props.expandedCard, props.resetKey]);

  useIsomorphicLayoutEffect(() => {
    const resetChanged = previousMorphResetKeyRef.current !== props.resetKey;
    previousMorphResetKeyRef.current = props.resetKey;
    const previousExpandedCard = previousMorphExpandedCardRef.current;
    previousMorphExpandedCardRef.current = props.expandedCard;
    const changedCard = props.expandedCard ?? previousExpandedCard ?? activeCard;

    const intrinsic = intrinsicElementRefs.current.get(changedCard);
    const host = morphHostRefs.current.get(changedCard);
    const compactContent = intrinsic ? findCompactContent(intrinsic) : null;
    if (!intrinsic || !host) return;
    const surface = findCompactSurface(intrinsic, compactContent ?? intrinsic);
    const currentSnapshot = captureWorkspaceDeckSurface(surface);
    const previousSnapshot = surfaceSnapshotByCardRef.current.get(changedCard);
    surfaceSnapshotByCardRef.current.set(changedCard, currentSnapshot);

    const expansionChanged = previousExpandedCard !== props.expandedCard;
    if (
      !expansionChanged ||
      !previousSnapshot ||
      resetChanged ||
      prefersReducedMotion ||
      props.selectionMode === "immediate" ||
      typeof intrinsic.animate !== "function"
    ) {
      cleanupExpansionMorph();
      return;
    }

    const visibleProxy = activeExpansionMorphRef.current
      ? host.querySelector<HTMLElement>('[data-surface-morph-proxy^="deck-"]')
      : null;
    const fromSnapshot = visibleProxy
      ? captureWorkspaceDeckSurface(visibleProxy)
      : previousSnapshot;
    cleanupExpansionMorph();
    const opening = props.expandedCard === changedCard;
    const duration = opening ? SURFACE_MORPH_SECONDARY_DURATION_MS : SURFACE_MORPH_EXIT_DURATION_MS;
    const descriptor = buildSurfaceMorphDescriptor({
      durationMs: duration,
      from: fromSnapshot.geometry,
      to: currentSnapshot.geometry,
    });
    try {
      const proxy = createWorkspaceDeckMorphProxy({
        descriptor,
        from: fromSnapshot.appearance,
        host,
        role: opening ? "incoming" : "outgoing",
        to: currentSnapshot.appearance,
      });
      const coordinator = createSurfaceMorphCoordinator({
        documentTarget: null,
        reducedMotion: () => prefersReducedMotion,
        windowTarget: null,
      });
      const deck = deckRef.current;
      if (deck) deck.dataset.deckExpansionMorph = opening ? "opening" : "closing";
      expansionMorphTokenRef.current += 1;
      const token = expansionMorphTokenRef.current;
      const cleanupCallbacks = [
        markWorkspaceDeckMorphSurface(surface),
        () => {
          if (deck) delete deck.dataset.deckExpansionMorph;
        },
      ];
      const animations = [proxy.appearanceAnimation, proxy.geometryAnimation].filter(
        (animation): animation is Animation => animation !== null,
      );
      activeExpansionMorphRef.current = {
        animations,
        cleanupCallbacks,
        coordinators: [coordinator],
        proxies: [proxy.element],
        backPeek: null,
        token,
      };
      const run = coordinator.run({
        animationId: `workspace-deck-${opening ? "expand" : "collapse"}-${String(changedCard)}`,
        durationMs: duration,
        element: intrinsic,
        from: fromSnapshot.geometry,
        to: currentSnapshot.geometry,
      });
      if (!run.started) {
        cleanupExpansionMorph();
        return;
      }
      void run.finished.then(() => {
        if (activeExpansionMorphRef.current?.token === token) cleanupExpansionMorph();
      });
    } catch {
      cleanupExpansionMorph();
    }
  }, [
    activeCard,
    cleanupExpansionMorph,
    prefersReducedMotion,
    props.expandedCard,
    props.resetKey,
    props.selectionMode,
  ]);

  const registerSection = useCallback((cardId: CardId, element: HTMLElement | null) => {
    if (element === null) {
      cardSectionRefs.current.delete(cardId);
      return;
    }
    cardSectionRefs.current.set(cardId, element);
  }, []);

  const registerIntrinsicElement = useCallback((cardId: CardId, element: HTMLDivElement | null) => {
    const previousElement = intrinsicElementRefs.current.get(cardId);
    const observer = observerRef.current;
    if (previousElement && observer) unobserveIntrinsicElements(observer, previousElement);
    if (element === null) {
      intrinsicElementRefs.current.delete(cardId);
      return;
    }
    intrinsicElementRefs.current.set(cardId, element);
    if (observer) observeIntrinsicElements(observer, element);
  }, []);

  const registerMorphHost = useCallback((cardId: CardId, element: HTMLDivElement | null) => {
    if (element === null) {
      morphHostRefs.current.delete(cardId);
      return;
    }
    morphHostRefs.current.set(cardId, element);
  }, []);

  const registerPeekSlot = useCallback((cardId: CardId, element: HTMLDivElement | null) => {
    if (element === null) {
      peekSlotRefs.current.delete(cardId);
      return;
    }
    peekSlotRefs.current.set(cardId, element);
  }, []);

  const compactHeight = resolveWorkspaceDeckCompactHeight({
    activeCard,
    cardIds,
    frozenHeight: frozenCompactHeight,
    referenceCard: compactHeightReferenceCard,
    measurements,
  });
  const activeExpandedHeight =
    props.expandedCard === activeCard && expandedMeasurement?.id === activeCard
      ? expandedMeasurement.height
      : null;
  const style: WorkspaceDeckStyle = {};
  if (compactHeight !== null) {
    style["--workspace-card-deck-compact-height"] = `${compactHeight}px`;
  }
  if (activeExpandedHeight !== null) {
    style["--workspace-card-deck-expanded-height"] = `${activeExpandedHeight}px`;
  }

  const roles = resolveWorkspaceDeckRoles(cardIds, activeCard);
  const roleById = new Map(roles.map((role) => [role.id, role.position]));
  const interactionLocked = collapsingCard !== null || props.selectionLocked === true;

  const onMotionEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.dataset.transitionRole !== "incoming") return;
    const currentTransition = transitionRef.current;
    if (currentTransition?.motion !== "fallback") return;
    finishTransition(currentTransition.token);
  };

  const recordKeyboardActivation = (cardId: CardId, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-workspace-card-peek-trigger="true"]')) return;
    keyboardRequestedCardRef.current = cardId;
  };

  const onViewportTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "height") return;
    finishCollapse();
  };

  return (
    <div
      ref={deckRef}
      className={cn("workspace-card-deck", props.className)}
      data-workspace-card-deck="true"
      data-active-card={activeCard}
      data-deck-collapsing={collapsingCard ?? undefined}
      data-expanded-card={props.expandedCard ?? undefined}
      data-deck-transition={transition?.direction}
      data-deck-motion={transition?.motion}
      data-deck-transition-token={transition?.token}
      onAnimationEnd={onMotionEnd}
    >
      <div
        className="workspace-card-deck__viewport"
        data-height-ready={compactHeight !== null ? "true" : undefined}
        data-expanded={props.expandedCard === activeCard ? "true" : undefined}
        data-collapsing={collapsingCard !== null ? "true" : undefined}
        onTransitionCancel={onViewportTransitionEnd}
        onTransitionEnd={onViewportTransitionEnd}
        style={style}
      >
        {props.cards.map((card) => {
          const position = roleById.get(card.id) ?? "hidden";
          const active = position === "active";
          const transitionRole =
            transition?.toId === card.id
              ? "incoming"
              : transition?.fromId === card.id
                ? "outgoing"
                : undefined;

          return (
            <section
              key={card.id}
              ref={(element) => registerSection(card.id, element)}
              className="workspace-card-deck__card"
              data-workspace-card-body={card.id}
              data-card-position={position}
              aria-label={card.label}
              aria-hidden={active ? undefined : true}
              inert={active ? undefined : true}
              tabIndex={active ? -1 : undefined}
              data-transition-role={transitionRole}
              onFocusCapture={(event) => {
                if (event.target instanceof HTMLElement) {
                  focusedElementByCardRef.current.set(card.id, event.target);
                }
              }}
            >
              <div
                ref={(element) => registerMorphHost(card.id, element)}
                className="workspace-card-deck__morph-host"
                data-workspace-card-morph-host={card.id}
                aria-hidden="true"
                inert
              />
              <div
                ref={(element) => registerIntrinsicElement(card.id, element)}
                className="workspace-card-deck__intrinsic"
                data-workspace-card-intrinsic={card.id}
              >
                {card.renderBody({
                  active,
                  expanded: props.expandedCard === card.id,
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="workspace-card-deck__peeks" data-workspace-card-peeks="true">
        {roles.flatMap((role) => {
          if (role.position !== "previous" && role.position !== "next") return [];
          const card = props.cards.find((candidate) => candidate.id === role.id);
          if (!card) return [];
          const direction: WorkspaceDeckDirection =
            role.position === "previous" ? "backward" : "forward";
          return [
            <div
              key={card.id}
              ref={(element) => registerPeekSlot(card.id, element)}
              className="workspace-card-deck__peek-slot"
              onKeyDownCapture={(event) => recordKeyboardActivation(card.id, event)}
              onPointerDownCapture={() => {
                keyboardRequestedCardRef.current = null;
              }}
            >
              {card.renderPeek({
                position: role.position,
                blocked: interactionLocked,
                requestActivation: () => {
                  if (interactionLocked) return;
                  const intent = {
                    direction,
                    fromId: activeCardRef.current,
                    toId: card.id,
                  } satisfies WorkspaceDeckMorphIntent<CardId>;
                  pendingMorphIntentRef.current = intent;
                  pendingMorphCaptureRef.current =
                    expandedCardRef.current === activeCardRef.current
                      ? null
                      : captureMorphRequest(intent);
                  const accepted = props.onRequestCard(card.id, direction);
                  if (accepted === false) {
                    pendingMorphIntentRef.current = null;
                    pendingMorphCaptureRef.current = null;
                    return;
                  }
                  cleanupActiveMorph();
                },
              })}
            </div>,
          ];
        })}
      </div>
    </div>
  );
}

export type {
  WorkspaceDeckDirection,
  WorkspaceDeckPosition,
  WorkspaceDeckSelectionMode,
  WorkspaceDeckTransition,
};
