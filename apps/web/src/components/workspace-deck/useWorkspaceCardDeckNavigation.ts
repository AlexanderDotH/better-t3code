import { type KeyboardEvent, useCallback, useRef } from "react";

export interface WorkspaceCardDeckNavigation<CardId extends string> {
  readonly clearKeyboardActivation: () => void;
  readonly focusDestination: (cardId: CardId) => void;
  readonly recordFocusedElement: (cardId: CardId, target: EventTarget) => void;
  readonly recordKeyboardActivation: (cardId: CardId, event: KeyboardEvent<HTMLDivElement>) => void;
  readonly registerSection: (cardId: CardId, element: HTMLElement | null) => void;
}

export function useWorkspaceCardDeckNavigation<
  CardId extends string,
>(): WorkspaceCardDeckNavigation<CardId> {
  const keyboardRequestedCardRef = useRef<CardId | null>(null);
  const focusedElementByCardRef = useRef(new Map<CardId, HTMLElement>());
  const cardSectionRefs = useRef(new Map<CardId, HTMLElement>());

  const clearKeyboardActivation = useCallback(() => {
    keyboardRequestedCardRef.current = null;
  }, []);

  const focusDestination = useCallback((cardId: CardId) => {
    if (keyboardRequestedCardRef.current === cardId) {
      keyboardRequestedCardRef.current = null;
      const section = cardSectionRefs.current.get(cardId);
      if (section === undefined) return;
      requestAnimationFrame(() => section.focus({ preventScroll: true }));
      return;
    }

    const previousFocus = focusedElementByCardRef.current.get(cardId);
    if (!previousFocus?.isConnected) return;
    requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
  }, []);

  const recordFocusedElement = useCallback((cardId: CardId, target: EventTarget) => {
    if (target instanceof HTMLElement) focusedElementByCardRef.current.set(cardId, target);
  }, []);

  const recordKeyboardActivation = useCallback(
    (cardId: CardId, event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-workspace-card-peek-trigger="true"]')) return;
      keyboardRequestedCardRef.current = cardId;
    },
    [],
  );

  const registerSection = useCallback((cardId: CardId, element: HTMLElement | null) => {
    if (element === null) {
      cardSectionRefs.current.delete(cardId);
      return;
    }
    cardSectionRefs.current.set(cardId, element);
  }, []);

  return {
    clearKeyboardActivation,
    focusDestination,
    recordFocusedElement,
    recordKeyboardActivation,
    registerSection,
  };
}
