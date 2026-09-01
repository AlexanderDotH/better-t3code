import {
  type AnimationEvent,
  type TransitionEvent as ReactTransitionEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";

import {
  buildSurfaceMorphDescriptor,
  createSurfaceMorphCoordinator,
  SURFACE_MORPH_EXIT_DURATION_MS,
  SURFACE_MORPH_SECONDARY_DURATION_MS,
} from "../chat/surfaceMorph";
import {
  resolveWorkspaceDeckCompactHeight,
  resolveWorkspaceDeckDirection,
  resolveWorkspaceDeckMorphRoles,
  type WorkspaceDeckSelectionMode,
} from "./workspaceCardDeck.logic";
import {
  adaptWorkspaceDeckFrameMorphDescriptor,
  animateWorkspaceDeckBackPeek,
  animateWorkspaceDeckContentHandoff,
  buildWorkspaceDeckFrameMorphDescriptor,
  captureWorkspaceDeckContentHandoffState,
  captureWorkspaceDeckSurface,
  createWorkspaceDeckMorphProxy,
  disposeWorkspaceDeckMorph,
  markWorkspaceDeckMorphSurface,
  resolveWorkspaceDeckContentHandoffOffset,
  WORKSPACE_DECK_MORPH_DURATION_MS,
  type ActiveWorkspaceDeckMorph,
  type WorkspaceDeckContentHandoffState,
  type WorkspaceDeckMorphCapture,
  type WorkspaceDeckMorphIntent,
  type WorkspaceDeckSurfaceSnapshot,
} from "./workspaceCardDeck.morph";
import {
  findWorkspaceDeckCompactContent,
  findWorkspaceDeckCompactSurface,
  type WorkspaceDeckMeasurements,
} from "./useWorkspaceCardDeckMeasurements";
import { useWorkspaceCardDeckRetainedState } from "./useWorkspaceCardDeckRetainedState";

const TRANSITION_FALLBACK_MS = WORKSPACE_DECK_MORPH_DURATION_MS + 120;
const COLLAPSE_FALLBACK_MS = SURFACE_MORPH_EXIT_DURATION_MS + 60;
const PEEK_CONTENT_SELECTOR = ".workspace-card-deck__peek-content";
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useWorkspaceCardDeckMorphLifecycle<CardId extends string>(input: {
  readonly activeCard: CardId;
  readonly cardIds: readonly CardId[];
  readonly compactHeightReferenceCard: CardId;
  readonly expandedCard: CardId | null;
  readonly focusDestination: (cardId: CardId) => void;
  readonly intrinsicElementRefs: WorkspaceDeckMeasurements<CardId>["intrinsicElementRefs"];
  readonly measurements: WorkspaceDeckMeasurements<CardId>["measurements"];
  readonly onExpandedCardCollapseComplete: ((cardId: CardId) => void) | undefined;
  readonly prefersReducedMotion: boolean;
  readonly requestedActiveCard: CardId;
  readonly resetKey: string;
  readonly selectionMode: WorkspaceDeckSelectionMode;
}) {
  const retained = useWorkspaceCardDeckRetainedState({
    activeCard: input.activeCard,
    cardIds: input.cardIds,
    expandedCard: input.expandedCard,
    onExpandedCardCollapseComplete: input.onExpandedCardCollapseComplete,
    resetKey: input.resetKey,
  });
  const {
    activeExpansionMorphRef,
    activeMorphRef,
    cardIdsRef,
    collapseCompleteCallbackRef,
    collapsingCard,
    collapsingCardRef,
    deckRef,
    expansionMorphTokenRef,
    morphHostRefs,
    peekSlotRefs,
    pendingMorphCaptureRef,
    pendingMorphIntentRef,
    previousActiveCardRef,
    previousCollapseResetKeyRef,
    previousExpandedCardRef,
    previousMorphExpandedCardRef,
    previousMorphResetKeyRef,
    previousResetKeyRef,
    setCollapsingCard,
    setFrozenCompactHeight,
    setTransition,
    surfaceSnapshotByCardRef,
    transition,
    transitionRef,
    transitionTokenRef,
  } = retained;

  const cleanupActiveMorph = useCallback(() => {
    const activeMorph = activeMorphRef.current;
    if (activeMorph === null) return;
    activeMorphRef.current = null;
    disposeWorkspaceDeckMorph(activeMorph);
  }, [activeMorphRef]);

  const cleanupExpansionMorph = useCallback(() => {
    const activeMorph = activeExpansionMorphRef.current;
    if (activeMorph === null) return;
    activeExpansionMorphRef.current = null;
    disposeWorkspaceDeckMorph(activeMorph);
  }, [activeExpansionMorphRef]);

  const findPeek = useCallback(
    (cardId: CardId) => {
      const slot = peekSlotRefs.current.get(cardId);
      return slot?.querySelector<HTMLElement>("[data-workspace-card-peek]") ?? null;
    },
    [peekSlotRefs],
  );

  const capturePeekSurface = useCallback(
    (cardId: CardId) => {
      const peek = findPeek(cardId);
      return peek ? captureWorkspaceDeckSurface(peek) : null;
    },
    [findPeek],
  );

  const captureMorphRequest = useCallback(
    (intent: WorkspaceDeckMorphIntent<CardId>) => {
      const activeIntrinsic = input.intrinsicElementRefs.current.get(intent.fromId);
      if (!activeIntrinsic) return null;
      const activeProxy = morphHostRefs.current
        .get(intent.fromId)
        ?.querySelector<HTMLElement>('[data-surface-morph-proxy^="deck-"]');
      const activeSurface =
        activeProxy ??
        findWorkspaceDeckCompactSurface(
          activeIntrinsic,
          findWorkspaceDeckCompactContent(activeIntrinsic) ?? activeIntrinsic,
        );
      const contentStates = new Map<CardId, WorkspaceDeckContentHandoffState>();
      const activeContent = findWorkspaceDeckCompactContent(activeIntrinsic);
      if (activeContent) {
        contentStates.set(intent.fromId, captureWorkspaceDeckContentHandoffState(activeContent));
      }
      const peeks = new Map<CardId, WorkspaceDeckSurfaceSnapshot>();
      for (const cardId of cardIdsRef.current) {
        const snapshot = capturePeekSurface(cardId);
        if (snapshot) peeks.set(cardId, snapshot);
      }
      if (!peeks.has(intent.toId)) return null;
      return {
        ...intent,
        active: captureWorkspaceDeckSurface(activeSurface),
        contentStates,
        peeks,
      } satisfies WorkspaceDeckMorphCapture<CardId>;
    },
    [capturePeekSurface, cardIdsRef, input.intrinsicElementRefs, morphHostRefs],
  );

  const finishTransition = useCallback(
    (token?: number) => {
      const currentTransition = transitionRef.current;
      if (currentTransition === null) return;
      if (token !== undefined && currentTransition.token !== token) return;
      cleanupActiveMorph();
      pendingMorphCaptureRef.current = null;
      pendingMorphIntentRef.current = null;
      input.focusDestination(currentTransition.toId);
      transitionRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
    },
    [
      cleanupActiveMorph,
      input.focusDestination,
      pendingMorphCaptureRef,
      pendingMorphIntentRef,
      setFrozenCompactHeight,
      setTransition,
      transitionRef,
    ],
  );

  const cancelCollapse = useCallback(() => {
    collapsingCardRef.current = null;
    setCollapsingCard(null);
  }, [collapsingCardRef, setCollapsingCard]);

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
  }, [
    captureMorphRequest,
    cleanupExpansionMorph,
    collapseCompleteCallbackRef,
    collapsingCardRef,
    pendingMorphCaptureRef,
    pendingMorphIntentRef,
    setCollapsingCard,
  ]);

  useIsomorphicLayoutEffect(() => {
    const resetChanged = previousCollapseResetKeyRef.current !== input.resetKey;
    previousCollapseResetKeyRef.current = input.resetKey;
    const previousExpandedCard = previousExpandedCardRef.current;
    previousExpandedCardRef.current = input.expandedCard;

    if (resetChanged) {
      cancelCollapse();
      return;
    }
    if (input.expandedCard !== null) {
      cancelCollapse();
      return;
    }
    if (previousExpandedCard === null) return;

    collapsingCardRef.current = previousExpandedCard;
    setCollapsingCard(previousExpandedCard);
  }, [
    cancelCollapse,
    collapsingCardRef,
    input.expandedCard,
    input.resetKey,
    previousCollapseResetKeyRef,
    previousExpandedCardRef,
    setCollapsingCard,
  ]);

  useEffect(() => {
    if (collapsingCard === null) return;
    if (input.prefersReducedMotion || input.selectionMode === "immediate") {
      finishCollapse();
      return;
    }
    const fallback = window.setTimeout(finishCollapse, COLLAPSE_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [collapsingCard, finishCollapse, input.prefersReducedMotion, input.selectionMode]);

  useIsomorphicLayoutEffect(() => {
    const resetChanged = previousResetKeyRef.current !== input.resetKey;
    previousResetKeyRef.current = input.resetKey;
    if (resetChanged) {
      cleanupActiveMorph();
      previousActiveCardRef.current = input.activeCard;
      pendingMorphCaptureRef.current = null;
      pendingMorphIntentRef.current = null;
      transitionRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
      return;
    }

    const previousActiveCard = previousActiveCardRef.current;
    if (previousActiveCard === input.activeCard) return;
    previousActiveCardRef.current = input.activeCard;
    cleanupExpansionMorph();

    const direction = resolveWorkspaceDeckDirection(
      input.cardIds,
      previousActiveCard,
      input.activeCard,
    );
    const activeCardWasRemoved = !input.cardIds.includes(input.requestedActiveCard);
    if (
      direction === null ||
      activeCardWasRemoved ||
      input.selectionMode === "immediate" ||
      input.prefersReducedMotion
    ) {
      cleanupActiveMorph();
      pendingMorphCaptureRef.current = null;
      pendingMorphIntentRef.current = null;
      transitionRef.current = null;
      setTransition(null);
      setFrozenCompactHeight(null);
      input.focusDestination(input.activeCard);
      return;
    }

    const compactHeight = resolveWorkspaceDeckCompactHeight({
      activeCard: previousActiveCard,
      cardIds: input.cardIds,
      referenceCard: input.compactHeightReferenceCard,
      measurements: input.measurements,
    });
    const capture = pendingMorphCaptureRef.current;
    const capturedIntentMatches =
      capture?.fromId === previousActiveCard && capture.toId === input.activeCard;
    const incomingIntrinsic = input.intrinsicElementRefs.current.get(input.activeCard);
    const motion =
      capturedIntentMatches && typeof incomingIntrinsic?.animate === "function"
        ? "morph"
        : "fallback";
    transitionTokenRef.current += 1;
    const nextTransition = {
      fromId: previousActiveCard,
      toId: input.activeCard,
      direction,
      motion,
      token: transitionTokenRef.current,
    } as const;
    setFrozenCompactHeight(compactHeight);
    transitionRef.current = nextTransition;
    setTransition(nextTransition);
  }, [
    cleanupActiveMorph,
    cleanupExpansionMorph,
    input.activeCard,
    input.cardIds,
    input.compactHeightReferenceCard,
    input.focusDestination,
    input.intrinsicElementRefs,
    input.measurements,
    input.prefersReducedMotion,
    input.requestedActiveCard,
    input.resetKey,
    input.selectionMode,
    pendingMorphCaptureRef,
    pendingMorphIntentRef,
    previousActiveCardRef,
    previousResetKeyRef,
    setFrozenCompactHeight,
    setTransition,
    transitionRef,
    transitionTokenRef,
  ]);

  useIsomorphicLayoutEffect(() => {
    if (input.selectionMode !== "immediate" || transition === null) return;
    cleanupActiveMorph();
    input.focusDestination(input.activeCard);
    transitionRef.current = null;
    setTransition(null);
    setFrozenCompactHeight(null);
  }, [
    cleanupActiveMorph,
    input.activeCard,
    input.focusDestination,
    input.selectionMode,
    setFrozenCompactHeight,
    setTransition,
    transition,
    transitionRef,
  ]);

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

    const incomingIntrinsic = input.intrinsicElementRefs.current.get(transition.toId);
    const incomingHost = morphHostRefs.current.get(transition.toId);
    const incomingContent = incomingIntrinsic
      ? findWorkspaceDeckCompactContent(incomingIntrinsic)
      : null;
    const sourcePeek = capture.peeks.get(transition.toId);
    const targetPeekElement = findPeek(transition.fromId);
    const targetPeek = targetPeekElement ? captureWorkspaceDeckSurface(targetPeekElement) : null;
    const targetPeekContent =
      targetPeekElement?.querySelector<HTMLElement>(PEEK_CONTENT_SELECTOR) ?? null;
    if (!incomingIntrinsic || !incomingHost || !sourcePeek || !targetPeek) {
      transitionRef.current = { ...transition, motion: "fallback" };
      setTransition(transitionRef.current);
      return;
    }

    const incomingSurface = findWorkspaceDeckCompactSurface(
      incomingIntrinsic,
      incomingContent ?? incomingIntrinsic,
    );
    const incomingTarget = captureWorkspaceDeckSurface(incomingSurface);
    const incomingDescriptor = buildWorkspaceDeckFrameMorphDescriptor({
      direction: transition.direction,
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: sourcePeek.geometry,
      role: "incoming",
      to: incomingTarget.geometry,
    });
    const outgoingDescriptor = buildWorkspaceDeckFrameMorphDescriptor({
      direction: transition.direction,
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: capture.active.geometry,
      role: "outgoing",
      to: targetPeek.geometry,
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
        host: incomingHost,
        role: "outgoing",
        to: targetPeek.appearance,
      });
      const animations: Animation[] = [];
      const cleanupCallbacks = [markWorkspaceDeckMorphSurface(incomingSurface)];
      const contentElements: HTMLElement[] = [];
      const stagedMorph: ActiveWorkspaceDeckMorph = {
        animations,
        cleanupCallbacks,
        coordinators: [],
        contentElements,
        proxies: [incomingProxy.element, outgoingProxy.element],
        backPeek: null,
        token: transition.token,
      };
      activeMorphRef.current = stagedMorph;
      const outgoingContentState = capture.contentStates.get(transition.fromId);
      const contentHandoffOffset = resolveWorkspaceDeckContentHandoffOffset(outgoingContentState);

      if (incomingContent) {
        const incomingContentMotion = animateWorkspaceDeckContentHandoff({
          duration: WORKSPACE_DECK_MORPH_DURATION_MS,
          element: incomingContent,
          handoffOffset: contentHandoffOffset,
          role: "incoming",
        });
        incomingContentMotion.animation.id = `workspace-deck-${transition.token}-incoming-content`;
        animations.push(incomingContentMotion.animation);
        cleanupCallbacks.push(incomingContentMotion.restoreStyles);
        contentElements.push(incomingContent);
      }
      if (targetPeekContent) {
        const targetPeekContentMotion = animateWorkspaceDeckContentHandoff({
          duration: WORKSPACE_DECK_MORPH_DURATION_MS,
          element: targetPeekContent,
          handoffOffset: contentHandoffOffset,
          role: "peek",
        });
        targetPeekContentMotion.animation.id = `workspace-deck-${transition.token}-target-peek-content`;
        animations.push(targetPeekContentMotion.animation);
        cleanupCallbacks.push(targetPeekContentMotion.restoreStyles);
        contentElements.push(targetPeekContent);
      }
      if (incomingProxy.geometryAnimation) {
        incomingProxy.geometryAnimation.id = `workspace-deck-${transition.token}-incoming-chrome`;
        animations.push(incomingProxy.geometryAnimation);
      }
      if (outgoingProxy.geometryAnimation) {
        outgoingProxy.geometryAnimation.id = `workspace-deck-${transition.token}-outgoing-chrome`;
        animations.push(outgoingProxy.geometryAnimation);
      }
      if (incomingProxy.cornerAnimation) {
        incomingProxy.cornerAnimation.id = `workspace-deck-${transition.token}-incoming-corners`;
        animations.push(incomingProxy.cornerAnimation);
      }
      if (outgoingProxy.cornerAnimation) {
        outgoingProxy.cornerAnimation.id = `workspace-deck-${transition.token}-outgoing-corners`;
        animations.push(outgoingProxy.cornerAnimation);
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
        input.cardIds,
        transition.fromId,
        transition.toId,
      ).find((role) => role.morph === "orbiting");
      const backPeek = backRole
        ? (peekSlotRefs.current
            .get(backRole.id)
            ?.querySelector<HTMLElement>("[data-workspace-card-peek]") ?? null)
        : null;
      if (backPeek) {
        const backPeekAnimation = animateWorkspaceDeckBackPeek({
          duration: WORKSPACE_DECK_MORPH_DURATION_MS,
          element: backPeek,
        });
        backPeekAnimation.id = `workspace-deck-${transition.token}-back-peek`;
        animations.push(backPeekAnimation);
      }

      activeMorphRef.current = { ...stagedMorph, backPeek };
      const completionAnimation = incomingProxy.geometryAnimation;
      if (!completionAnimation) {
        cleanupActiveMorph();
        transitionRef.current = { ...transition, motion: "fallback" };
        setTransition(transitionRef.current);
        return;
      }
      const settleTransition = () => {
        if (activeMorphRef.current?.token === transition.token) {
          finishTransition(transition.token);
        }
      };
      void completionAnimation.finished.then(settleTransition, settleTransition);
    } catch {
      cleanupActiveMorph();
      transitionRef.current = { ...transition, motion: "fallback" };
      setTransition(transitionRef.current);
    }
  }, [
    activeMorphRef,
    capturePeekSurface,
    cleanupActiveMorph,
    findPeek,
    finishTransition,
    input.cardIds,
    input.intrinsicElementRefs,
    morphHostRefs,
    peekSlotRefs,
    pendingMorphCaptureRef,
    setTransition,
    transition,
    transitionRef,
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
  }, [deckRef, finishTransition, transitionRef]);

  useIsomorphicLayoutEffect(() => {
    const resetChanged = previousMorphResetKeyRef.current !== input.resetKey;
    previousMorphResetKeyRef.current = input.resetKey;
    const previousExpandedCard = previousMorphExpandedCardRef.current;
    previousMorphExpandedCardRef.current = input.expandedCard;
    const changedCard = input.expandedCard ?? previousExpandedCard ?? input.activeCard;

    const intrinsic = input.intrinsicElementRefs.current.get(changedCard);
    const host = morphHostRefs.current.get(changedCard);
    const compactContent = intrinsic ? findWorkspaceDeckCompactContent(intrinsic) : null;
    if (!intrinsic || !host) return;
    const surface = findWorkspaceDeckCompactSurface(intrinsic, compactContent ?? intrinsic);
    const currentSnapshot = captureWorkspaceDeckSurface(surface);
    const previousSnapshot = surfaceSnapshotByCardRef.current.get(changedCard);
    surfaceSnapshotByCardRef.current.set(changedCard, currentSnapshot);

    const expansionChanged = previousExpandedCard !== input.expandedCard;
    if (
      !expansionChanged ||
      !previousSnapshot ||
      resetChanged ||
      input.prefersReducedMotion ||
      input.selectionMode === "immediate" ||
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
    const opening = input.expandedCard === changedCard;
    const duration = opening ? SURFACE_MORPH_SECONDARY_DURATION_MS : SURFACE_MORPH_EXIT_DURATION_MS;
    const descriptor = buildSurfaceMorphDescriptor({
      durationMs: duration,
      from: fromSnapshot.geometry,
      to: currentSnapshot.geometry,
    });
    const proxyDescriptor = adaptWorkspaceDeckFrameMorphDescriptor(descriptor);
    try {
      const proxy = createWorkspaceDeckMorphProxy({
        descriptor: proxyDescriptor,
        from: fromSnapshot.appearance,
        host,
        role: opening ? "incoming" : "outgoing",
        to: currentSnapshot.appearance,
      });
      const coordinator = createSurfaceMorphCoordinator({
        documentTarget: null,
        reducedMotion: () => input.prefersReducedMotion,
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
      const animations = [
        proxy.appearanceAnimation,
        proxy.geometryAnimation,
        proxy.cornerAnimation,
      ].filter((animation): animation is Animation => animation !== null);
      activeExpansionMorphRef.current = {
        animations,
        cleanupCallbacks,
        coordinators: [coordinator],
        contentElements: [],
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
    activeExpansionMorphRef,
    cleanupExpansionMorph,
    deckRef,
    expansionMorphTokenRef,
    input.activeCard,
    input.expandedCard,
    input.intrinsicElementRefs,
    input.prefersReducedMotion,
    input.resetKey,
    input.selectionMode,
    morphHostRefs,
    previousMorphExpandedCardRef,
    previousMorphResetKeyRef,
    surfaceSnapshotByCardRef,
  ]);

  const registerMorphHost = useCallback(
    (cardId: CardId, element: HTMLDivElement | null) => {
      if (element === null) {
        morphHostRefs.current.delete(cardId);
        return;
      }
      morphHostRefs.current.set(cardId, element);
    },
    [morphHostRefs],
  );

  const registerPeekSlot = useCallback(
    (cardId: CardId, element: HTMLDivElement | null) => {
      if (element === null) {
        peekSlotRefs.current.delete(cardId);
        return;
      }
      peekSlotRefs.current.set(cardId, element);
    },
    [peekSlotRefs],
  );

  const onMotionEnd = useCallback(
    (event: AnimationEvent<HTMLDivElement>) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.dataset.transitionRole !== "incoming") return;
      const currentTransition = transitionRef.current;
      if (currentTransition?.motion !== "fallback") return;
      finishTransition(currentTransition.token);
    },
    [finishTransition, transitionRef],
  );

  const onViewportTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || event.propertyName !== "height") return;
      finishCollapse();
    },
    [finishCollapse],
  );

  return {
    ...retained,
    captureMorphRequest,
    cleanupActiveMorph,
    onMotionEnd,
    onViewportTransitionEnd,
    registerMorphHost,
    registerPeekSlot,
  };
}
