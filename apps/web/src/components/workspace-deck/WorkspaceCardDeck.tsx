import { type CSSProperties, useEffect, useState } from "react";

import { cn } from "~/lib/utils";

import {
  resolveWorkspaceDeckCompactHeight,
  type WorkspaceDeckDirection,
  type WorkspaceDeckPosition,
  type WorkspaceDeckSelectionMode,
  type WorkspaceDeckTransition,
} from "./workspaceCardDeck.logic";
import {
  prepareWorkspaceCardDeckView,
  type WorkspaceDeckCardDefinition,
} from "./workspaceCardDeck.model";
import {
  WorkspaceCardDeckActiveBody,
  WorkspaceCardDeckPeeks,
} from "./WorkspaceCardDeckPresentation";
import { useWorkspaceCardDeckActivation } from "./useWorkspaceCardDeckActivation";
import { useWorkspaceCardDeckMeasurements } from "./useWorkspaceCardDeckMeasurements";
import { useWorkspaceCardDeckMorphLifecycle } from "./useWorkspaceCardDeckMorphLifecycle";
import { useWorkspaceCardDeckNavigation } from "./useWorkspaceCardDeckNavigation";
import "./WorkspaceCardDeck.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

function workspaceDeckStyle(input: {
  readonly activeCardExpanded: boolean;
  readonly compactHeight: number | null;
  readonly expandedHeight: number | null;
}): WorkspaceDeckStyle {
  return {
    ...(input.compactHeight === null
      ? {}
      : { "--workspace-card-deck-compact-height": `${input.compactHeight}px` }),
    ...(!input.activeCardExpanded || input.expandedHeight === null
      ? {}
      : { "--workspace-card-deck-expanded-height": `${input.expandedHeight}px` }),
  };
}

export function WorkspaceCardDeck<CardId extends string>(props: WorkspaceCardDeckProps<CardId>) {
  const view = prepareWorkspaceCardDeckView({
    activeCard: props.activeCard,
    cards: props.cards,
    compactHeightReferenceCard: props.compactHeightReferenceCard,
  });
  const prefersReducedMotion = usePrefersReducedMotion();
  const navigation = useWorkspaceCardDeckNavigation<CardId>();
  const measurements = useWorkspaceCardDeckMeasurements({
    cardIds: view.cardIds,
    compactHeightReferenceCard: view.compactHeightReferenceCard,
    expandedCard: props.expandedCard,
    resetKey: props.resetKey,
  });
  const lifecycle = useWorkspaceCardDeckMorphLifecycle({
    activeCard: view.activeCard,
    cardIds: view.cardIds,
    compactHeightReferenceCard: view.compactHeightReferenceCard,
    expandedCard: props.expandedCard,
    focusDestination: navigation.focusDestination,
    intrinsicElementRefs: measurements.intrinsicElementRefs,
    measurements: measurements.measurements,
    onExpandedCardCollapseComplete: props.onExpandedCardCollapseComplete,
    prefersReducedMotion,
    requestedActiveCard: props.activeCard,
    resetKey: props.resetKey,
    selectionMode: props.selectionMode,
  });
  const interactionLocked = lifecycle.collapsingCard !== null || props.selectionLocked === true;
  const requestActivation = useWorkspaceCardDeckActivation({
    activeCardRef: lifecycle.activeCardRef,
    captureMorphRequest: lifecycle.captureMorphRequest,
    cleanupActiveMorph: lifecycle.cleanupActiveMorph,
    expandedCardRef: lifecycle.expandedCardRef,
    interactionLocked,
    onRequestCard: props.onRequestCard,
    pendingMorphCaptureRef: lifecycle.pendingMorphCaptureRef,
    pendingMorphIntentRef: lifecycle.pendingMorphIntentRef,
  });
  const compactHeight = resolveWorkspaceDeckCompactHeight({
    activeCard: view.activeCard,
    cardIds: view.cardIds,
    frozenHeight: lifecycle.frozenCompactHeight,
    referenceCard: view.compactHeightReferenceCard,
    measurements: measurements.measurements,
  });
  const activeExpandedHeight =
    measurements.expandedMeasurement?.id === view.activeCard
      ? measurements.expandedMeasurement.height
      : null;
  const style = workspaceDeckStyle({
    activeCardExpanded: props.expandedCard === view.activeCard,
    compactHeight,
    expandedHeight: activeExpandedHeight,
  });

  return (
    <div
      ref={lifecycle.deckRef}
      className={cn("workspace-card-deck", props.className)}
      data-workspace-card-deck="true"
      data-active-card={view.activeCard}
      data-deck-collapsing={lifecycle.collapsingCard ?? undefined}
      data-expanded-card={props.expandedCard ?? undefined}
      data-deck-transition={lifecycle.transition?.direction}
      data-deck-motion={lifecycle.transition?.motion}
      data-deck-transition-token={lifecycle.transition?.token}
      onAnimationEnd={lifecycle.onMotionEnd}
    >
      <div
        className="workspace-card-deck__viewport"
        data-height-ready={compactHeight !== null ? "true" : undefined}
        data-expanded={props.expandedCard === view.activeCard ? "true" : undefined}
        data-collapsing={lifecycle.collapsingCard !== null ? "true" : undefined}
        onTransitionCancel={lifecycle.onViewportTransitionEnd}
        onTransitionEnd={lifecycle.onViewportTransitionEnd}
        style={style}
      >
        <WorkspaceCardDeckActiveBody
          activeCard={view.activeCard}
          card={view.activeCardDefinition}
          expandedCard={props.expandedCard}
          transition={lifecycle.transition}
          recordFocusedElement={navigation.recordFocusedElement}
          registerIntrinsicElement={measurements.registerIntrinsicElement}
          registerMorphHost={lifecycle.registerMorphHost}
          registerSection={navigation.registerSection}
        />
      </div>

      <WorkspaceCardDeckPeeks
        clearKeyboardActivation={navigation.clearKeyboardActivation}
        interactionLocked={interactionLocked}
        onRequestActivation={requestActivation}
        peeks={view.peekCards}
        recordKeyboardActivation={navigation.recordKeyboardActivation}
        registerPeekSlot={lifecycle.registerPeekSlot}
      />
    </div>
  );
}

export type { WorkspaceDeckCardDefinition } from "./workspaceCardDeck.model";
export type {
  WorkspaceDeckDirection,
  WorkspaceDeckPosition,
  WorkspaceDeckSelectionMode,
  WorkspaceDeckTransition,
};
