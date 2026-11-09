import { type FocusEvent, useEffect, useRef, useState } from "react";

import { useBetterT3DeviceFeature } from "~/hooks/useBetterT3Feature";

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
  readonly onExpandedCardChange: (
    card: ChatWorkspaceCardId | null,
  ) => boolean | Promise<boolean> | void;
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
  const cardMorphingEnabled = useBetterT3DeviceFeature("chat.cardMorphing");
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedChatElementRef = useRef<HTMLElement | null>(null);
  const previousActiveCardRef = useRef({ resetKey: props.resetKey, card: props.activeCard });
  const didRunBeforeHideRef = useRef(false);
  const [pendingCardRequest, setPendingCardRequest] = useState<PendingCardRequest | null>(null);
  const [selectionMode, setSelectionMode] = useState<WorkspaceDeckSelectionMode>("immediate");
  // A new scope starts like a fresh deck, but stays mounted so the chat card keeps its composer.
  const [scopeKey, setScopeKey] = useState(props.resetKey);
  if (scopeKey !== props.resetKey) {
    setScopeKey(props.resetKey);
    setPendingCardRequest(null);
    setSelectionMode("immediate");
  }

  const cardIds = props.cards.map((card) => card.id);
  const resolvedActiveCard =
    resolveWorkspaceDeckActiveCard({
      activeCard: props.activeCard,
      cardIds,
      fallbackCard: "chat",
    }) ?? "chat";
  const chatAvailable = cardIds.includes("chat");
  const policyActiveCard = props.actionRequired && chatAvailable ? "chat" : resolvedActiveCard;
  const selectionLocked =
    pendingCardRequest !== null &&
    !props.actionRequired &&
    pendingCardRequest.fromCard === policyActiveCard &&
    cardIds.includes(pendingCardRequest.fromCard) &&
    cardIds.includes(pendingCardRequest.requestedCard);
  if (pendingCardRequest !== null && !selectionLocked) setPendingCardRequest(null);
  const deckSelectionMode =
    !cardMorphingEnabled || props.actionRequired || resolvedActiveCard !== props.activeCard
      ? "immediate"
      : selectionMode;

  const cards = props.cards.map((card) =>
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
  );

  const rememberChatFocus = () => {
    if (typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    if (!chatBodyRef.current?.contains(activeElement)) return;
    previouslyFocusedChatElementRef.current = activeElement;
  };

  const restoreChatFocus = () => {
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
  };

  const clearPendingCardRequest = () => {
    setPendingCardRequest(null);
  };

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (chatBodyRef.current?.contains(event.target)) {
      previouslyFocusedChatElementRef.current = event.target;
    }
    if (policyActiveCard !== "chat") return;
    if (event.target.dataset.workspaceCardBody !== "chat") return;
    scheduleFrame(restoreChatFocus);
  };

  const requestCard = (requestedCard: ChatWorkspaceCardId, direction: WorkspaceDeckDirection) => {
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
      const pendingRequest = {
        direction,
        fromCard: policyActiveCard,
        requestedCard: result.nextCard,
      };
      setPendingCardRequest(pendingRequest);
      const collapse = props.onExpandedCardChange(null);
      const cancelRequest = () =>
        setPendingCardRequest((current) => (current === pendingRequest ? null : current));
      if (collapse === false) {
        cancelRequest();
        return false;
      }
      if (collapse instanceof Promise)
        void collapse.then((accepted) => {
          if (!accepted) cancelRequest();
        }, cancelRequest);
      return true;
    }
    if (result.nextCard !== policyActiveCard) {
      setSelectionMode("animate");
      props.onActiveCardChange(result.nextCard, direction);
      return true;
    }
    return false;
  };

  const completeExpandedCardCollapse = (collapsedCard: ChatWorkspaceCardId) => {
    const pendingRequest = pendingCardRequest;
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
  };

  const { onBeforeHideChat, resetKey } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- preserves DOM focus and dismisses the imperative composer UI when its card is hidden
  useEffect(() => {
    const previous = previousActiveCardRef.current;
    previousActiveCardRef.current = { resetKey, card: policyActiveCard };
    if (previous.resetKey !== resetKey) {
      previouslyFocusedChatElementRef.current = null;
      didRunBeforeHideRef.current = false;
      return;
    }
    const previousActiveCard = previous.card;

    if (previousActiveCard === "chat" && policyActiveCard !== "chat") {
      rememberChatFocus();
      if (!didRunBeforeHideRef.current) onBeforeHideChat?.();
      didRunBeforeHideRef.current = false;
      return;
    }

    didRunBeforeHideRef.current = false;
    if (previousActiveCard === "chat" || policyActiveCard !== "chat") return;

    return scheduleFrame(restoreChatFocus);
  }, [onBeforeHideChat, rememberChatFocus, policyActiveCard, resetKey, restoreChatFocus]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the first animation-frame boundary so a new deck scope starts without a transition
  useEffect(() => {
    if (selectionMode === "animate") return;
    return scheduleFrame(() => setSelectionMode("animate"));
  }, [selectionMode]);

  return (
    <div
      className={props.className}
      data-chat-workspace-deck="true"
      data-active-card={policyActiveCard}
      data-selection-locked={selectionLocked ? "true" : undefined}
      onFocusCapture={handleFocusCapture}
    >
      <WorkspaceCardDeck
        activeCard={policyActiveCard}
        cards={cards}
        compactHeightReferenceCard="chat"
        expandedCard={props.actionRequired ? null : props.expandedCard}
        resetKey={props.resetKey}
        selectionMode={deckSelectionMode}
        selectionLocked={selectionLocked}
        onExpandedCardCollapseComplete={completeExpandedCardCollapse}
        onRequestCard={requestCard}
      />
    </div>
  );
}
