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
  findDuplicateWorkspaceDeckCardId,
  pruneWorkspaceDeckMeasurements,
  resolveWorkspaceDeckActiveCard,
  resolveWorkspaceDeckCompactHeight,
  resolveWorkspaceDeckDirection,
  resolveWorkspaceDeckRoles,
  type WorkspaceDeckDirection,
  type WorkspaceDeckPosition,
  type WorkspaceDeckSelectionMode,
  type WorkspaceDeckTransition,
} from "./workspaceCardDeck.logic";
import "./WorkspaceCardDeck.css";

const TRANSITION_FALLBACK_MS = 600;
const COLLAPSE_FALLBACK_MS = 260;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const COMPACT_CONTENT_SELECTOR = '[data-workspace-card-compact-content="true"]';
const COMPACT_SURFACE_SELECTOR = '[data-workspace-card-compact-surface="true"]';
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
  readonly onRequestCard: (cardId: CardId, direction: WorkspaceDeckDirection) => void;
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
}

function unobserveIntrinsicElements(observer: ResizeObserver, intrinsic: HTMLElement): void {
  observer.unobserve(intrinsic);
  const compactContent = findCompactContent(intrinsic);
  if (compactContent) observer.unobserve(compactContent);
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
  const cardSectionRefs = useRef(new Map<CardId, HTMLElement>());
  const intrinsicElementRefs = useRef(new Map<CardId, HTMLDivElement>());
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
  const [measurements, setMeasurements] = useState<Partial<Record<CardId, number>>>({});
  const [expandedMeasurement, setExpandedMeasurement] =
    useState<ExpandedMeasurement<CardId> | null>(null);
  const [frozenCompactHeight, setFrozenCompactHeight] = useState<number | null>(null);
  const [collapsingCard, setCollapsingCard] = useState<CardId | null>(null);
  const [transition, setTransition] = useState<WorkspaceDeckTransition<CardId> | null>(null);

  expandedCardRef.current = props.expandedCard;
  compactHeightReferenceCardRef.current = compactHeightReferenceCard;
  cardIdsRef.current = cardIds;
  collapseCompleteCallbackRef.current = props.onExpandedCardCollapseComplete;

  const focusKeyboardDestination = useCallback((cardId: CardId) => {
    if (keyboardRequestedCardRef.current !== cardId) return;
    keyboardRequestedCardRef.current = null;
    const section = cardSectionRefs.current.get(cardId);
    if (!section) return;
    requestAnimationFrame(() => section.focus({ preventScroll: true }));
  }, []);

  const finishTransition = useCallback(() => {
    setTransition((currentTransition) => {
      if (currentTransition === null) return null;
      focusKeyboardDestination(currentTransition.toId);
      return null;
    });
    setFrozenCompactHeight(null);
  }, [focusKeyboardDestination]);

  const cancelCollapse = useCallback(() => {
    collapsingCardRef.current = null;
    setCollapsingCard(null);
  }, []);

  const finishCollapse = useCallback(() => {
    const collapsedCard = collapsingCardRef.current;
    if (collapsedCard === null) return;
    collapsingCardRef.current = null;
    setCollapsingCard(null);
    collapseCompleteCallbackRef.current?.(collapsedCard);
  }, []);

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
      previousActiveCardRef.current = activeCard;
      keyboardRequestedCardRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
      setMeasurements({});
      setExpandedMeasurement(null);
      return;
    }

    const previousActiveCard = previousActiveCardRef.current;
    if (previousActiveCard === activeCard) return;
    previousActiveCardRef.current = activeCard;

    const direction = resolveWorkspaceDeckDirection(cardIds, previousActiveCard, activeCard);
    const activeCardWasRemoved = !cardIds.includes(props.activeCard);
    if (
      direction === null ||
      activeCardWasRemoved ||
      props.selectionMode === "immediate" ||
      prefersReducedMotion
    ) {
      setTransition(null);
      setFrozenCompactHeight(null);
      focusKeyboardDestination(activeCard);
      return;
    }

    const compactHeight = resolveWorkspaceDeckCompactHeight({
      activeCard: previousActiveCard,
      cardIds,
      referenceCard: compactHeightReferenceCard,
      measurements,
    });
    transitionTokenRef.current += 1;
    setFrozenCompactHeight(compactHeight);
    setTransition({
      fromId: previousActiveCard,
      toId: activeCard,
      direction,
      token: transitionTokenRef.current,
    });
  }, [
    activeCard,
    cardIds,
    compactHeightReferenceCard,
    focusKeyboardDestination,
    measurements,
    prefersReducedMotion,
    props.activeCard,
    props.resetKey,
    props.selectionMode,
  ]);

  useIsomorphicLayoutEffect(() => {
    if (props.selectionMode !== "immediate" || transition === null) return;
    focusKeyboardDestination(activeCard);
    setTransition(null);
    setFrozenCompactHeight(null);
  }, [activeCard, focusKeyboardDestination, props.selectionMode, transition]);

  useEffect(() => {
    if (transition === null) return;
    const fallback = window.setTimeout(finishTransition, TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [finishTransition, transition]);

  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const onAnimationCancel = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.hasAttribute("data-transition-role")) return;
      finishTransition();
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
        if (cardId === currentExpandedCard && entry.target === intrinsic) {
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
  const transitionActive = transition !== null;
  const interactionLocked =
    transitionActive || collapsingCard !== null || props.selectionLocked === true;

  const onMotionEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.dataset.transitionRole !== "incoming") return;
    finishTransition();
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
            >
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
                  props.onRequestCard(card.id, direction);
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
