import { type FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import {
  WorkspaceCardDeck,
  type WorkspaceDeckCardDefinition,
} from "../workspace-deck/WorkspaceCardDeck";
import {
  resolveWorkspaceDeckActiveCard,
  type WorkspaceDeckDirection,
  type WorkspaceDeckSelectionMode,
} from "../workspace-deck/workspaceCardDeck.logic";

export type ChatWorkspaceCardId = "chat" | "git" | "mcp";
export type ChatWorkspaceCardSelectionBlockedReason = "recording" | "action-required";

export interface ChatWorkspaceCardRequest {
  readonly actionRequired: boolean;
  readonly activeCard: ChatWorkspaceCardId;
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly isRecording: boolean;
  readonly requestedCard: ChatWorkspaceCardId;
}

export interface ChatWorkspaceCardRequestResult {
  readonly blockedReason: ChatWorkspaceCardSelectionBlockedReason | null;
  readonly nextCard: ChatWorkspaceCardId;
  readonly shouldCollapseExpandedCard: boolean;
  readonly shouldDismissChatUi: boolean;
}

export function resolveChatWorkspaceCardRequest(
  request: ChatWorkspaceCardRequest,
): ChatWorkspaceCardRequestResult {
  const leavingChat = request.activeCard === "chat" && request.requestedCard !== "chat";
  if (request.actionRequired && request.requestedCard !== "chat") {
    return {
      blockedReason: "action-required",
      nextCard: request.activeCard,
      shouldCollapseExpandedCard: false,
      shouldDismissChatUi: false,
    };
  }
  if (request.isRecording && leavingChat) {
    return {
      blockedReason: "recording",
      nextCard: request.activeCard,
      shouldCollapseExpandedCard: false,
      shouldDismissChatUi: false,
    };
  }
  return {
    blockedReason: null,
    nextCard: request.requestedCard,
    shouldCollapseExpandedCard:
      request.expandedCard === request.activeCard && request.requestedCard !== request.activeCard,
    shouldDismissChatUi: leavingChat,
  };
}

export interface ChatWorkspaceDeckProps {
  readonly activeCard: ChatWorkspaceCardId;
  readonly actionRequired: boolean;
  readonly cards: readonly WorkspaceDeckCardDefinition<ChatWorkspaceCardId>[];
  readonly expandedCard: ChatWorkspaceCardId | null;
  readonly isRecording: boolean;
  readonly resetKey: string;
  readonly className?: string;
  readonly onActiveCardChange: (
    card: ChatWorkspaceCardId,
    direction: WorkspaceDeckDirection | null,
  ) => void;
  readonly onBeforeHideChat?: () => void;
  readonly onCardSelectionBlocked?: (reason: ChatWorkspaceCardSelectionBlockedReason) => void;
  readonly onExpandedCardChange: (card: ChatWorkspaceCardId | null) => void;
  readonly onRestoreChatFocus?: () => void;
}

interface PendingCardRequest {
  readonly direction: WorkspaceDeckDirection;
  readonly fromCard: ChatWorkspaceCardId;
  readonly requestedCard: ChatWorkspaceCardId;
}

const scheduleFrame = (callback: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
  }
  const timeout = setTimeout(callback, 0);
  return () => clearTimeout(timeout);
};

export function ChatWorkspaceDeck(props: ChatWorkspaceDeckProps) {
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedChatElementRef = useRef<HTMLElement | null>(null);
  const previousActiveCardRef = useRef<ChatWorkspaceCardId>(props.activeCard);
  const didRunBeforeHideRef = useRef(false);
  const pendingCardRequestRef = useRef<PendingCardRequest | null>(null);
  const [selectionMode, setSelectionMode] = useState<WorkspaceDeckSelectionMode>("animate");
  const [selectionLocked, setSelectionLocked] = useState(false);

  const cardIds = useMemo(() => props.cards.map((card) => card.id), [props.cards]);
  const resolvedActiveCard =
    resolveWorkspaceDeckActiveCard({
      activeCard: props.activeCard,
      cardIds,
      fallbackCard: "chat",
    }) ?? "chat";
  const chatAvailable = cardIds.includes("chat");
  const policyActiveCard = props.actionRequired && chatAvailable ? "chat" : resolvedActiveCard;
  const deckSelectionMode =
    props.actionRequired || resolvedActiveCard !== props.activeCard ? "immediate" : selectionMode;

  const cards = useMemo(
    () =>
      props.cards.map((card) =>
        card.id === "chat"
          ? {
              ...card,
              renderBody: (context: { readonly active: boolean; readonly expanded: boolean }) => (
                <div ref={chatBodyRef} className="contents" data-chat-workspace-card-body="true">
                  {card.renderBody(context)}
                </div>
              ),
            }
          : card,
      ),
    [props.cards],
  );

  const rememberChatFocus = useCallback(() => {
    if (typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    if (!chatBodyRef.current?.contains(activeElement)) return;
    previouslyFocusedChatElementRef.current = activeElement;
  }, []);

  const restoreChatFocus = useCallback(() => {
    const previousElement = previouslyFocusedChatElementRef.current;
    if (previousElement?.isConnected) {
      try {
        previousElement.focus({ preventScroll: true });
        return;
      } catch {
        // The composer can replace its editor node while another card is active.
      }
    }
    props.onRestoreChatFocus?.();
  }, [props.onRestoreChatFocus]);

  const clearPendingCardRequest = useCallback(() => {
    pendingCardRequestRef.current = null;
    setSelectionLocked(false);
  }, []);

  const handleFocusCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (chatBodyRef.current?.contains(event.target)) {
        previouslyFocusedChatElementRef.current = event.target;
      }
      if (policyActiveCard !== "chat") return;
      if (event.target.dataset.workspaceCardBody !== "chat") return;
      scheduleFrame(restoreChatFocus);
    },
    [policyActiveCard, restoreChatFocus],
  );

  const requestCard = useCallback(
    (requestedCard: ChatWorkspaceCardId, direction: WorkspaceDeckDirection) => {
      if (selectionLocked) return;
      const result = resolveChatWorkspaceCardRequest({
        actionRequired: props.actionRequired,
        activeCard: policyActiveCard,
        expandedCard: props.expandedCard,
        isRecording: props.isRecording,
        requestedCard,
      });
      if (result.blockedReason !== null) {
        props.onCardSelectionBlocked?.(result.blockedReason);
        return false;
      }
      if (result.shouldDismissChatUi) {
        rememberChatFocus();
        props.onBeforeHideChat?.();
        didRunBeforeHideRef.current = true;
      }
      if (result.shouldCollapseExpandedCard) {
        pendingCardRequestRef.current = {
          direction,
          fromCard: policyActiveCard,
          requestedCard: result.nextCard,
        };
        setSelectionLocked(true);
        props.onExpandedCardChange(null);
        return true;
      }
      if (result.nextCard !== policyActiveCard) {
        setSelectionMode("animate");
        props.onActiveCardChange(result.nextCard, direction);
        return true;
      }
      return false;
    },
    [policyActiveCard, props, rememberChatFocus, selectionLocked],
  );

  const completeExpandedCardCollapse = useCallback(
    (collapsedCard: ChatWorkspaceCardId) => {
      const pendingRequest = pendingCardRequestRef.current;
      if (pendingRequest === null || pendingRequest.fromCard !== collapsedCard) return;
      clearPendingCardRequest();
      if (policyActiveCard !== pendingRequest.fromCard) return;
      if (!cardIds.includes(pendingRequest.requestedCard)) return;

      const result = resolveChatWorkspaceCardRequest({
        actionRequired: props.actionRequired,
        activeCard: policyActiveCard,
        expandedCard: null,
        isRecording: props.isRecording,
        requestedCard: pendingRequest.requestedCard,
      });
      if (result.blockedReason !== null) {
        props.onCardSelectionBlocked?.(result.blockedReason);
        return;
      }
      setSelectionMode("animate");
      props.onActiveCardChange(result.nextCard, pendingRequest.direction);
    },
    [
      cardIds,
      clearPendingCardRequest,
      policyActiveCard,
      props.actionRequired,
      props.isRecording,
      props.onActiveCardChange,
      props.onCardSelectionBlocked,
    ],
  );

  useEffect(() => {
    if (resolvedActiveCard === props.activeCard) return;
    setSelectionMode("immediate");
    props.onActiveCardChange(resolvedActiveCard, null);
  }, [props.activeCard, props.onActiveCardChange, resolvedActiveCard]);

  useEffect(() => {
    const previousActiveCard = previousActiveCardRef.current;
    previousActiveCardRef.current = policyActiveCard;

    if (previousActiveCard === "chat" && policyActiveCard !== "chat") {
      rememberChatFocus();
      if (!didRunBeforeHideRef.current) props.onBeforeHideChat?.();
      didRunBeforeHideRef.current = false;
      return;
    }

    didRunBeforeHideRef.current = false;
    if (previousActiveCard !== policyActiveCard && props.expandedCard === previousActiveCard) {
      props.onExpandedCardChange(null);
    }
    if (previousActiveCard === "chat" || policyActiveCard !== "chat") return;

    return scheduleFrame(restoreChatFocus);
  }, [
    props.expandedCard,
    props.onBeforeHideChat,
    props.onExpandedCardChange,
    rememberChatFocus,
    policyActiveCard,
    restoreChatFocus,
  ]);

  useEffect(() => {
    if (!props.actionRequired) return;
    if (props.activeCard === "chat" && props.expandedCard === null) return;
    clearPendingCardRequest();
    setSelectionMode("immediate");
    if (props.expandedCard !== null) props.onExpandedCardChange(null);
    if (props.activeCard !== "chat" && chatAvailable) props.onActiveCardChange("chat", null);
  }, [
    props.actionRequired,
    props.activeCard,
    props.expandedCard,
    props.onExpandedCardChange,
    props.onActiveCardChange,
    chatAvailable,
    clearPendingCardRequest,
  ]);

  useEffect(() => {
    const pendingRequest = pendingCardRequestRef.current;
    if (pendingRequest === null) return;
    if (
      cardIds.includes(pendingRequest.fromCard) &&
      cardIds.includes(pendingRequest.requestedCard)
    ) {
      return;
    }
    clearPendingCardRequest();
  }, [cardIds, clearPendingCardRequest]);

  useEffect(() => {
    previousActiveCardRef.current = policyActiveCard;
    previouslyFocusedChatElementRef.current = null;
    didRunBeforeHideRef.current = false;
    clearPendingCardRequest();
    setSelectionMode("immediate");
    return scheduleFrame(() => setSelectionMode("animate"));
    // A scope change deliberately resets transient deck policy state even when
    // the remembered active card is the same in both scopes.
  }, [clearPendingCardRequest, props.resetKey]);

  return (
    <div
      className={cn("chat-workspace-deck", props.className)}
      data-chat-workspace-deck="true"
      data-active-card={policyActiveCard}
      data-selection-locked={selectionLocked ? "true" : undefined}
      onFocusCapture={handleFocusCapture}
    >
      <WorkspaceCardDeck
        activeCard={policyActiveCard}
        cards={cards}
        compactHeightReferenceCard="chat"
        expandedCard={props.expandedCard}
        resetKey={props.resetKey}
        selectionMode={deckSelectionMode}
        selectionLocked={selectionLocked}
        onExpandedCardCollapseComplete={completeExpandedCardCollapse}
        onRequestCard={requestCard}
      />
    </div>
  );
}
