import { observeResize } from "~/lib/observeResize";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

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
  for (let parent = compactContent.parentElement; parent && parent !== intrinsic;) {
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

function observeIntrinsicElements(
  observer: Pick<ResizeObserver, "observe" | "unobserve">,
  intrinsic: HTMLElement,
): void {
  observer.observe(intrinsic);
  const compactContent = findWorkspaceDeckCompactContent(intrinsic);
  if (compactContent) observer.observe(compactContent);
  const expandedSurface = findWorkspaceDeckExpandedSurface(intrinsic);
  if (expandedSurface !== intrinsic) observer.observe(expandedSurface, { box: "border-box" });
}

function unobserveIntrinsicElements(
  observer: Pick<ResizeObserver, "observe" | "unobserve">,
  intrinsic: HTMLElement,
): void {
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
  const { cardIds, compactHeightReferenceCard, expandedCard, resetKey } = input;
  const intrinsicElementRefs = useRef(new Map<CardId, HTMLDivElement>());
  const observerRef = useRef<Pick<ResizeObserver, "observe" | "unobserve" | "disconnect"> | null>(
    null,
  );
  const [state, setState] = useState({
    resetKey,
    cardIds,
    expandedCard,
    measurements: {} as Partial<Record<CardId, number>>,
    expandedMeasurement: null as WorkspaceDeckExpandedMeasurement<CardId> | null,
  });
  const cardsChanged =
    state.cardIds.length !== cardIds.length ||
    state.cardIds.some((id, index) => id !== cardIds[index]);
  if (state.resetKey !== resetKey || cardsChanged || state.expandedCard !== expandedCard) {
    setState({
      resetKey,
      cardIds,
      expandedCard,
      measurements:
        state.resetKey === resetKey
          ? pruneWorkspaceDeckMeasurements(cardIds, state.measurements)
          : {},
      expandedMeasurement:
        state.resetKey === resetKey && state.expandedCard === expandedCard
          ? state.expandedMeasurement
          : null,
    });
  }

  // Measure before paint so morph geometry and deck height stay aligned.
  useCommitEffect(() => {
    const subscriptions = new Map<Element, () => void>();
    const receiveMeasurements = (entries: readonly ResizeObserverEntry[]) => {
      const compact = new Map<CardId, number>();
      let expanded: WorkspaceDeckExpandedMeasurement<CardId> | null = null;
      for (const entry of entries) {
        const intrinsic = entry.target.matches("[data-workspace-card-intrinsic]")
          ? entry.target
          : entry.target.closest("[data-workspace-card-intrinsic]");
        if (!(intrinsic instanceof HTMLElement)) continue;
        const cardId = intrinsic.getAttribute("data-workspace-card-intrinsic") as CardId | null;
        if (cardId === null || !cardIds.includes(cardId)) continue;
        if (
          cardId === expandedCard &&
          entry.target === findWorkspaceDeckExpandedSurface(intrinsic)
        ) {
          expanded = { id: cardId, height: readObservedBlockSize(entry) };
        }
        if (cardId !== expandedCard && cardId === compactHeightReferenceCard) {
          compact.set(cardId, readNaturalCompactBlockSize(intrinsic));
        }
      }
      const expandedMeasurement = expanded;
      setState((current) => {
        const next = pruneWorkspaceDeckMeasurements(cardIds, current.measurements);
        for (const [id, height] of compact) next[id] = height;
        const measurement = expandedMeasurement ?? current.expandedMeasurement;
        if (
          sameMeasurements(current.measurements, next) &&
          current.expandedMeasurement?.id === measurement?.id &&
          current.expandedMeasurement?.height === measurement?.height
        )
          return current;
        return { ...current, measurements: next, expandedMeasurement: measurement };
      });
    };
    const observer = {
      observe: (element: Element) => {
        if (!subscriptions.has(element))
          subscriptions.set(element, observeResize(element, receiveMeasurements));
      },
      unobserve: (element: Element) => {
        subscriptions.get(element)?.();
        subscriptions.delete(element);
      },
      disconnect: () => {
        for (const unsubscribe of subscriptions.values()) unsubscribe();
        subscriptions.clear();
      },
    };
    observerRef.current = observer;
    for (const element of intrinsicElementRefs.current.values())
      observeIntrinsicElements(observer, element);
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [cardIds, compactHeightReferenceCard, expandedCard]);

  // Sample the expanded surface before its first paint.
  useCommitEffect(() => {
    if (expandedCard === null) return;
    const intrinsic = intrinsicElementRefs.current.get(expandedCard);
    if (!intrinsic) return;
    const expandedSurface = findWorkspaceDeckExpandedSurface(intrinsic);
    const height = Math.ceil(expandedSurface.getBoundingClientRect().height);
    if (height > 0)
      setState((current) =>
        current.expandedMeasurement?.id === expandedCard &&
        current.expandedMeasurement.height === height
          ? current
          : { ...current, expandedMeasurement: { id: expandedCard, height } },
      );
  }, [expandedCard, resetKey]);

  // Use the compact surface's natural height rather than the constrained viewport height.
  useCommitEffect(() => {
    if (compactHeightReferenceCard === expandedCard) return;
    const intrinsic = intrinsicElementRefs.current.get(compactHeightReferenceCard);
    if (!intrinsic) return;
    const height = readNaturalCompactBlockSize(intrinsic);
    setState((current) =>
      current.measurements[compactHeightReferenceCard] === height
        ? current
        : {
            ...current,
            measurements: { ...current.measurements, [compactHeightReferenceCard]: height },
          },
    );
  }, [cardIds, compactHeightReferenceCard, expandedCard, resetKey]);

  const registerIntrinsicElement = (cardId: CardId, element: HTMLDivElement | null) => {
    const previous = intrinsicElementRefs.current.get(cardId);
    const observer = observerRef.current;
    if (previous && observer) unobserveIntrinsicElements(observer, previous);
    if (element === null) {
      intrinsicElementRefs.current.delete(cardId);
      return;
    }
    intrinsicElementRefs.current.set(cardId, element);
    if (observer) observeIntrinsicElements(observer, element);
  };

  return {
    expandedMeasurement: state.expandedMeasurement,
    intrinsicElementRefs,
    measurements: state.measurements,
    registerIntrinsicElement,
  };
}
