import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { pruneWorkspaceDeckMeasurements } from "./workspaceCardDeck.logic";

const COMPACT_CONTENT_SELECTOR = '[data-workspace-card-compact-content="true"]';
const COMPACT_SURFACE_SELECTOR = '[data-workspace-card-compact-surface="true"]';
const EXPANDED_SURFACE_SELECTOR = '[data-workspace-card-expanded-surface="true"]';
const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface WorkspaceDeckExpandedMeasurement<CardId extends string> {
  readonly id: CardId;
  readonly height: number;
}

export interface WorkspaceDeckMeasurements<CardId extends string> {
  readonly expandedMeasurement: WorkspaceDeckExpandedMeasurement<CardId> | null;
  readonly intrinsicElementRefs: RefObject<Map<CardId, HTMLDivElement>>;
  readonly measurements: Partial<Record<CardId, number>>;
  readonly registerIntrinsicElement: (cardId: CardId, element: HTMLDivElement | null) => void;
}

export function findWorkspaceDeckCompactContent(intrinsic: HTMLElement): HTMLElement | null {
  return intrinsic.querySelector<HTMLElement>(COMPACT_CONTENT_SELECTOR);
}

export function findWorkspaceDeckCompactSurface(
  intrinsic: HTMLElement,
  compactContent: HTMLElement,
): HTMLElement {
  const markedSurface = intrinsic.querySelector<HTMLElement>(COMPACT_SURFACE_SELECTOR);
  if (markedSurface) return markedSurface;
  let surface = compactContent;
  for (let parent = compactContent.parentElement; parent && parent !== intrinsic; ) {
    if (window.getComputedStyle(parent).display !== "contents") surface = parent;
    parent = parent.parentElement;
  }
  return surface;
}

export function findWorkspaceDeckExpandedSurface(intrinsic: HTMLElement): HTMLElement {
  return intrinsic.querySelector<HTMLElement>(EXPANDED_SURFACE_SELECTOR) ?? intrinsic;
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

function readNaturalCompactBlockSize(intrinsic: HTMLElement): number {
  const compactContent = findWorkspaceDeckCompactContent(intrinsic);
  if (!compactContent || compactContent.hidden) {
    return Math.ceil(Math.max(intrinsic.scrollHeight, intrinsic.offsetHeight));
  }
  const compactSurface = findWorkspaceDeckCompactSurface(intrinsic, compactContent);
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
  const compactContent = findWorkspaceDeckCompactContent(intrinsic);
  if (compactContent) observer.observe(compactContent);
  const expandedSurface = findWorkspaceDeckExpandedSurface(intrinsic);
  if (expandedSurface !== intrinsic) observer.observe(expandedSurface, { box: "border-box" });
}

function unobserveIntrinsicElements(observer: ResizeObserver, intrinsic: HTMLElement): void {
  observer.unobserve(intrinsic);
  const compactContent = findWorkspaceDeckCompactContent(intrinsic);
  if (compactContent) observer.unobserve(compactContent);
  const expandedSurface = findWorkspaceDeckExpandedSurface(intrinsic);
  if (expandedSurface !== intrinsic) observer.unobserve(expandedSurface);
}

function sameMeasurements<CardId extends string>(
  left: Partial<Record<CardId, number>>,
  right: Partial<Record<CardId, number>>,
): boolean {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const id of ids) {
    if (left[id as CardId] !== right[id as CardId]) return false;
  }
  return true;
}

export function useWorkspaceCardDeckMeasurements<CardId extends string>(input: {
  readonly cardIds: readonly CardId[];
  readonly compactHeightReferenceCard: CardId;
  readonly expandedCard: CardId | null;
  readonly resetKey: string;
}): WorkspaceDeckMeasurements<CardId> {
  const intrinsicElementRefs = useRef(new Map<CardId, HTMLDivElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const pendingCompactMeasurementsRef = useRef(new Map<CardId, number>());
  const pendingExpandedMeasurementRef = useRef<WorkspaceDeckExpandedMeasurement<CardId> | null>(
    null,
  );
  const measurementFrameRef = useRef<number | null>(null);
  const expandedCardRef = useRef<CardId | null>(input.expandedCard);
  const compactHeightReferenceCardRef = useRef(input.compactHeightReferenceCard);
  const cardIdsRef = useRef(input.cardIds);
  const previousResetKeyRef = useRef(input.resetKey);
  const [measurements, setMeasurements] = useState<Partial<Record<CardId, number>>>({});
  const [expandedMeasurement, setExpandedMeasurement] =
    useState<WorkspaceDeckExpandedMeasurement<CardId> | null>(null);

  expandedCardRef.current = input.expandedCard;
  compactHeightReferenceCardRef.current = input.compactHeightReferenceCard;
  cardIdsRef.current = input.cardIds;

  useCommitEffect(() => {
    if (previousResetKeyRef.current === input.resetKey) return;
    previousResetKeyRef.current = input.resetKey;
    setMeasurements({});
    setExpandedMeasurement(null);
  }, [input.resetKey]);

  useEffect(() => {
    setMeasurements((current) => {
      const pruned = pruneWorkspaceDeckMeasurements(input.cardIds, current);
      return sameMeasurements(current, pruned) ? current : pruned;
    });
  }, [input.cardIds]);

  useEffect(() => {
    if (input.expandedCard === null) {
      setExpandedMeasurement(null);
      return;
    }
    setExpandedMeasurement((current) => (current?.id === input.expandedCard ? current : null));
  }, [input.expandedCard]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    const flushMeasurements = () => {
      measurementFrameRef.current = null;
      const pendingCompact = new Map(pendingCompactMeasurementsRef.current);
      pendingCompactMeasurementsRef.current.clear();
      const pendingExpanded = pendingExpandedMeasurementRef.current;
      pendingExpandedMeasurementRef.current = null;
      const currentExpandedCard = expandedCardRef.current;
      if (currentExpandedCard !== null && pendingExpanded?.id === currentExpandedCard) {
        setExpandedMeasurement(pendingExpanded);
      }
      if (pendingCompact.size === 0) return;
      setMeasurements((current) => {
        const next = pruneWorkspaceDeckMeasurements(cardIdsRef.current, current);
        for (const [cardId, height] of pendingCompact) {
          if (cardIdsRef.current.includes(cardId)) next[cardId] = height;
        }
        return sameMeasurements(current, next) ? current : next;
      });
    };

    const observer = new ResizeObserver((entries) => {
      const compactCards = new Set<CardId>();
      for (const entry of entries) {
        const intrinsic = entry.target.matches("[data-workspace-card-intrinsic]")
          ? entry.target
          : entry.target.closest("[data-workspace-card-intrinsic]");
        if (!(intrinsic instanceof HTMLElement)) continue;
        const cardId = intrinsic.getAttribute("data-workspace-card-intrinsic") as CardId | null;
        if (cardId === null || !cardIdsRef.current.includes(cardId)) continue;
        const expandedSurface = findWorkspaceDeckExpandedSurface(intrinsic);
        if (cardId === expandedCardRef.current && entry.target === expandedSurface) {
          pendingExpandedMeasurementRef.current = {
            id: cardId,
            height: readObservedBlockSize(entry),
          };
        }
        if (
          cardId !== expandedCardRef.current &&
          cardId === compactHeightReferenceCardRef.current
        ) {
          compactCards.add(cardId);
        }
      }
      for (const cardId of compactCards) {
        const intrinsic = intrinsicElementRefs.current.get(cardId);
        if (intrinsic) {
          pendingCompactMeasurementsRef.current.set(cardId, readNaturalCompactBlockSize(intrinsic));
        }
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
  }, [input.resetKey]);

  useCommitEffect(() => {
    const expandedCard = input.expandedCard;
    if (expandedCard === null) return;
    const intrinsic = intrinsicElementRefs.current.get(expandedCard);
    if (!intrinsic) return;
    const expandedSurface = findWorkspaceDeckExpandedSurface(intrinsic);
    const observer = observerRef.current;
    if (observer && expandedSurface !== intrinsic) {
      observer.observe(expandedSurface, { box: "border-box" });
    }
    const height = Math.ceil(expandedSurface.getBoundingClientRect().height);
    if (height > 0) {
      setExpandedMeasurement((current) =>
        current?.id === expandedCard && current.height === height
          ? current
          : { id: expandedCard, height },
      );
    }
    return () => {
      if (observer && expandedSurface !== intrinsic) observer.unobserve(expandedSurface);
    };
  }, [input.expandedCard, input.resetKey]);

  useCommitEffect(() => {
    if (input.compactHeightReferenceCard === input.expandedCard) return;
    const intrinsic = intrinsicElementRefs.current.get(input.compactHeightReferenceCard);
    if (!intrinsic) return;
    const height = readNaturalCompactBlockSize(intrinsic);
    setMeasurements((current) =>
      current[input.compactHeightReferenceCard] === height
        ? current
        : { ...current, [input.compactHeightReferenceCard]: height },
    );
  }, [input.cardIds, input.compactHeightReferenceCard, input.expandedCard, input.resetKey]);

  const registerIntrinsicElement = useCallback((cardId: CardId, element: HTMLDivElement | null) => {
    const previous = intrinsicElementRefs.current.get(cardId);
    const observer = observerRef.current;
    if (previous && observer) unobserveIntrinsicElements(observer, previous);
    if (element === null) {
      intrinsicElementRefs.current.delete(cardId);
      return;
    }
    intrinsicElementRefs.current.set(cardId, element);
    if (observer) observeIntrinsicElements(observer, element);
  }, []);

  return {
    expandedMeasurement,
    intrinsicElementRefs,
    measurements,
    registerIntrinsicElement,
  };
}
