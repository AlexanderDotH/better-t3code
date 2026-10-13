import {
  classifyMessageReplyPointerIntent,
  isMessageReplySwipeDirection,
  shouldTriggerMessageReply,
  MESSAGE_REPLY_SWIPE_THRESHOLD,
} from "@t3tools/client-runtime/messageReplies";
import { ReplyIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { readLocalApi } from "../../localApi";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const INTERACTIVE_CONTENT =
  "a,button,input,textarea,select,[contenteditable=true],[role=button],[role=link],audio,video,img,canvas,iframe,pre,code,table,[data-reply-gesture-ignore]";
const MESSAGE_TEXT =
  "[data-reply-message-content],p,li,blockquote,h1,h2,h3,h4,h5,h6,span,strong,em,a,pre,code,td,th";
const MAX_REPLY_TRANSLATION = 72;
const REPLY_ACTION_REVEAL_DISTANCE = 64;

const DIRECT_MANIPULATION_CONTENT =
  "input,textarea,select,[contenteditable=true],audio,video,canvas,iframe,[role=slider],[data-reply-gesture-ignore]";

function canStartMessageReplyGesture(
  target: EventTarget | null,
  surface: HTMLElement,
  role: "user" | "assistant",
) {
  if (!(target instanceof Element)) return false;
  if (target.closest(DIRECT_MANIPULATION_CONTENT)) return false;
  if (window.getSelection()?.isCollapsed === false) return false;
  for (
    let element: Element | null = target;
    element && element !== surface;
    element = element.parentElement
  ) {
    const scrollRange = element.scrollWidth - element.clientWidth;
    if (
      scrollRange > 0 &&
      /^(auto|scroll)$/.test(window.getComputedStyle(element).overflowX) &&
      (role === "assistant" ? element.scrollLeft > 0 : element.scrollLeft < scrollRange)
    )
      return false;
  }
  return true;
}

interface ReplyPointer {
  id: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  locked: boolean;
  startedAt: number;
  pathLength: number;
  canSelectText: boolean;
}

/** Only this message moves; the virtualized list never observes drag coordinates. */
export function MessageReplyGesture({
  children,
  onReply,
  role,
}: {
  children: ReactNode;
  role: "user" | "assistant";
  onReply: (() => void) | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const affordanceRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<ReplyPointer | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupPointerListenersRef = useRef<(() => void) | null>(null);

  const revealAction = (nearby: boolean) => {
    const action = actionRef.current;
    if (action && action.dataset.nearby !== String(nearby)) action.dataset.nearby = String(nearby);
  };

  const reset = () => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    cleanupPointerListenersRef.current?.();
    cleanupPointerListenersRef.current = null;
    if (pointer && surfaceRef.current?.hasPointerCapture?.(pointer.id))
      surfaceRef.current.releasePointerCapture(pointer.id);
    if (contentRef.current) {
      contentRef.current.style.removeProperty("transition");
      contentRef.current.style.removeProperty("transform");
      contentRef.current.style.removeProperty("user-select");
    }
    if (affordanceRef.current) affordanceRef.current.style.opacity = "0";
  };

  const advancePointer = (event: PointerEvent) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return null;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    pointer.pathLength += Math.hypot(dx - pointer.dx, dy - pointer.dy);
    pointer.dx = dx;
    pointer.dy = dy;
    const selectionActive = window.getSelection()?.isCollapsed === false;
    if (!pointer.locked) {
      const intent = classifyMessageReplyPointerIntent({
        role,
        deltaX: dx,
        deltaY: dy,
        elapsedMs: event.timeStamp - pointer.startedAt,
        pathLength: pointer.pathLength,
        canSelectText: pointer.canSelectText,
        selectionActive,
      });
      if (intent === "wait") return pointer;
      if (intent === "cancel") {
        reset();
        return null;
      }
      pointer.locked = true;
      if (event.type === "pointermove") surfaceRef.current?.setPointerCapture?.(event.pointerId);
    }
    if (selectionActive) window.getSelection()?.removeAllRanges();
    return pointer;
  };

  const handlePointerMove = (event: PointerEvent) => {
    const pointer = advancePointer(event);
    if (!pointer?.locked) return;
    event.preventDefault();
    suppressClickRef.current = true;
    const distance = isMessageReplySwipeDirection(pointer.dx, role) ? pointer.dx : 0;
    const translation = Math.sign(distance) * Math.min(Math.abs(distance), MAX_REPLY_TRANSLATION);
    if (contentRef.current) {
      contentRef.current.style.transition = "none";
      contentRef.current.style.userSelect = "none";
      contentRef.current.style.transform = `translateX(${translation}px)`;
    }
    if (affordanceRef.current) {
      affordanceRef.current.style.opacity = String(
        Math.min(Math.abs(distance) / MESSAGE_REPLY_SWIPE_THRESHOLD, 1),
      );
      affordanceRef.current.style.left = role === "assistant" ? "0" : "auto";
      affordanceRef.current.style.right = role === "user" ? "0" : "auto";
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (pointerRef.current?.id !== event.pointerId) return;
    const pointer = advancePointer(event);
    const trigger = pointer?.locked && shouldTriggerMessageReply(pointer.dx, pointer.dy, role);
    if (pointer?.locked) suppressClickRef.current = true;
    reset();
    if (trigger) onReply?.();
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (pointerRef.current?.id === event.pointerId) reset();
  };

  useEffect(() => () => cleanupPointerListenersRef.current?.(), []);

  useEffect(() => {
    if (!onReply) return;
    const surface = surfaceRef.current;
    // A pan-y ancestor would also disable horizontal code/table scrolling. Keep
    // native gestures until Pointer Events identify an eligible horizontal drag.
    const keepReplyGesture = (event: TouchEvent) => {
      if (pointerRef.current?.locked && event.cancelable) event.preventDefault();
    };
    const keepReplySelection = (event: Event) => {
      if (pointerRef.current?.locked) event.preventDefault();
    };
    surface?.addEventListener("touchmove", keepReplyGesture, { passive: false });
    surface?.addEventListener("selectstart", keepReplySelection);
    return () => {
      surface?.removeEventListener("touchmove", keepReplyGesture);
      surface?.removeEventListener("selectstart", keepReplySelection);
    };
  }, [onReply]);

  return (
    <div
      ref={surfaceRef}
      className="relative min-w-0"
      data-message-reply-gesture={onReply ? "enabled" : undefined}
      onPointerMoveCapture={(event) => {
        const action = actionRef.current;
        if (!action || pointerRef.current || event.buttons !== 0 || event.pointerType === "touch")
          return;
        // Only the hovered message measures proximity; no list state or global
        // hover listeners are needed.
        const rect = action.getBoundingClientRect();
        revealAction(
          Math.hypot(
            event.clientX - (rect.left + rect.width / 2),
            event.clientY - (rect.top + rect.height / 2),
          ) <= REPLY_ACTION_REVEAL_DISTANCE,
        );
      }}
      onPointerLeave={() => revealAction(false)}
      onPointerDown={(event) => {
        suppressClickRef.current = false;
        if (!event.isPrimary) {
          reset();
          return;
        }
        if (
          !onReply ||
          event.button !== 0 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.detail > 1
        )
          return;
        if (!canStartMessageReplyGesture(event.target, event.currentTarget, role)) return;
        reset();
        revealAction(false);
        pointerRef.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dx: 0,
          dy: 0,
          locked: false,
          startedAt: event.nativeEvent.timeStamp,
          pathLength: 0,
          canSelectText:
            event.pointerType !== "touch" &&
            event.target instanceof Element &&
            event.target.closest(MESSAGE_TEXT) !== null &&
            window.getComputedStyle(event.target).userSelect !== "none",
        };
        // Track only the active drag globally: selection stays native while
        // pending, even when the pointer leaves this message before recognition.
        window.addEventListener("pointermove", handlePointerMove, {
          capture: true,
          passive: false,
        });
        window.addEventListener("pointerup", handlePointerUp, true);
        window.addEventListener("pointercancel", handlePointerCancel, true);
        window.addEventListener("blur", reset);
        cleanupPointerListenersRef.current = () => {
          window.removeEventListener("pointermove", handlePointerMove, true);
          window.removeEventListener("pointerup", handlePointerUp, true);
          window.removeEventListener("pointercancel", handlePointerCancel, true);
          window.removeEventListener("blur", reset);
        };
      }}
      onMouseMoveCapture={(event) => {
        if (pointerRef.current?.locked) event.preventDefault();
      }}
      onDragStartCapture={(event) => {
        if (pointerRef.current) event.preventDefault();
      }}
      onLostPointerCapture={(event) => {
        if (pointerRef.current?.id === event.pointerId) reset();
      }}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        if (event.target instanceof Element && event.target.closest("[data-message-reply-action]"))
          return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        if (!onReply || event.defaultPrevented) return;
        const target = event.target;
        if (!(target instanceof Element) || target.closest(INTERACTIVE_CONTENT)) return;
        if (window.getSelection()?.isCollapsed === false) return;
        const api = readLocalApi();
        if (!api) return;
        event.preventDefault();
        void api.contextMenu
          .show(
            [
              {
                id: "message-reply",
                label: translate("chat.reply.action"),
                icon: "message-square-plus",
              },
            ],
            { x: event.clientX, y: event.clientY },
          )
          .then((action) => {
            if (action === "message-reply") onReply();
          });
      }}
    >
      <div
        ref={affordanceRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-3 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0"
      >
        <ReplyIcon className="size-4" />
      </div>
      <div
        ref={contentRef}
        className="transition-transform duration-150 ease-out motion-reduce:transition-none"
      >
        {children}
      </div>
      {onReply ? (
        <div
          ref={actionRef}
          data-message-reply-action
          data-reply-gesture-ignore
          data-side={role === "assistant" ? "left" : "right"}
          className="absolute flex opacity-0 transition-opacity duration-150 motion-reduce:transition-none data-[side=left]:top-0.5 data-[side=left]:right-full data-[side=left]:pr-1.5 data-[side=right]:top-2 data-[side=right]:left-full data-[side=right]:pl-1.5 data-[nearby=true]:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={translate("chat.reply.action")}
                  onClick={onReply}
                />
              }
            >
              <ReplyIcon />
            </TooltipTrigger>
            <TooltipPopup>{translate("chat.reply.action")}</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
