import type { FocusEvent, KeyboardEvent } from "react";

import type {
  PreparedWorkspaceDeckPeek,
  WorkspaceDeckCardDefinition,
} from "./workspaceCardDeck.model";
import type { WorkspaceDeckTransition } from "./workspaceCardDeck.logic";

export function WorkspaceCardDeckActiveBody<CardId extends string>(props: {
  readonly activeCard: CardId;
  readonly card: WorkspaceDeckCardDefinition<CardId>;
  readonly expandedCard: CardId | null;
  readonly transition: WorkspaceDeckTransition<CardId> | null;
  readonly recordFocusedElement: (cardId: CardId, target: EventTarget) => void;
  readonly registerIntrinsicElement: (cardId: CardId, element: HTMLDivElement | null) => void;
  readonly registerMorphHost: (cardId: CardId, element: HTMLDivElement | null) => void;
  readonly registerSection: (cardId: CardId, element: HTMLElement | null) => void;
}) {
  const { card } = props;
  return (
    <section
      key={card.id}
      ref={(element) => props.registerSection(card.id, element)}
      className="workspace-card-deck__card"
      data-workspace-card-body={card.id}
      data-card-position="active"
      aria-label={card.label}
      tabIndex={-1}
      data-transition-role={props.transition?.toId === card.id ? "incoming" : undefined}
      onFocusCapture={(event: FocusEvent<HTMLElement>) => {
        props.recordFocusedElement(card.id, event.target);
      }}
    >
      <div
        ref={(element) => props.registerMorphHost(card.id, element)}
        className="workspace-card-deck__morph-host"
        data-workspace-card-morph-host={card.id}
        aria-hidden="true"
        inert
      />
      <div
        ref={(element) => props.registerIntrinsicElement(card.id, element)}
        className="workspace-card-deck__intrinsic"
        data-workspace-card-intrinsic={card.id}
      >
        {card.renderBody({
          active: true,
          expanded: props.expandedCard === card.id,
        })}
      </div>
    </section>
  );
}

export function WorkspaceCardDeckPeeks<CardId extends string>(props: {
  readonly clearKeyboardActivation: () => void;
  readonly interactionLocked: boolean;
  readonly onRequestActivation: (peek: PreparedWorkspaceDeckPeek<CardId>) => void;
  readonly peeks: readonly PreparedWorkspaceDeckPeek<CardId>[];
  readonly recordKeyboardActivation: (cardId: CardId, event: KeyboardEvent<HTMLDivElement>) => void;
  readonly registerPeekSlot: (cardId: CardId, element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="workspace-card-deck__peeks" data-workspace-card-peeks="true">
      {props.peeks.map((peek) => (
        <div
          key={peek.card.id}
          ref={(element) => props.registerPeekSlot(peek.card.id, element)}
          className="workspace-card-deck__peek-slot"
          onKeyDownCapture={(event) => props.recordKeyboardActivation(peek.card.id, event)}
          onPointerDownCapture={props.clearKeyboardActivation}
        >
          {peek.card.renderPeek({
            position: peek.position,
            blocked: props.interactionLocked,
            requestActivation: () => props.onRequestActivation(peek),
          })}
        </div>
      ))}
    </div>
  );
}
