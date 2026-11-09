import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { use, type ReactNode } from "react";
import { GitForkIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import type { ChatMessage } from "../../types";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TimelineRowActivityCtx, TimelineRowCtx } from "./timelineRowContext";
import { MessageReplyButton } from "./MessageReplyGesture";

/** Better T3 overlays actions inside the bubble so they never reserve text width. */
export function MessageActionsOverlay({ children }: { readonly children: ReactNode }) {
  return (
    <div className="better-chat-actions">
      <div className="better-chat-action-buttons">{children}</div>
    </div>
  );
}

export function EditMessageButton({
  message,
  editable,
}: {
  readonly message: ChatMessage;
  readonly editable: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const ctx = use(TimelineRowCtx);
  if (
    !editable ||
    !ctx.onEditMessage ||
    message.role === "system" ||
    message.streaming ||
    ctx.editingMessage?.messageId === message.id
  )
    return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={translate("chat.edit.title")}
            disabled={ctx.editAvailable !== true}
            onClick={() => ctx.onEditMessage?.(message)}
          />
        }
      >
        <PencilIcon />
      </TooltipTrigger>
      <TooltipPopup>{translate("chat.edit.title")}</TooltipPopup>
    </Tooltip>
  );
}

export function ForkMessageButton({
  message,
  projectedItem,
}: {
  readonly message: ChatMessage;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  const ctx = use(TimelineRowCtx);
  // An optimistic row has no server boundary yet, and an inherited one belongs to the source.
  if (
    !ctx.onForkBoundary ||
    projectedItem === undefined ||
    projectedItem.visibility === "inherited" ||
    message.role === "system" ||
    message.streaming
  )
    return null;
  const available = ctx.forkAvailable !== false;
  const pending = ctx.forkPendingBoundary ?? null;
  const busy = pending?.kind === "message" && pending.messageId === message.id;
  const label = translate(busy ? "chat.fork.busy" : "chat.fork.fromMessage");
  const tooltip = translate(
    !available
      ? "chat.fork.reconnect"
      : pending !== null
        ? "chat.fork.creating"
        : "chat.fork.fromMessage",
  );
  return (
    <Tooltip>
      {/* The span keeps the tooltip reachable while the disabled button ignores the pointer. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label={label}
          aria-busy={busy || undefined}
          disabled={!available || pending !== null}
          onClick={() => ctx.onForkBoundary?.({ kind: "message", messageId: message.id })}
        >
          <GitForkIcon />
        </Button>
      </TooltipTrigger>
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export function RetryMessageButton({ message }: { readonly message: ChatMessage }) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);
  const translate = useInterfaceTranslator().message;
  const action = ctx.retryAction;
  if (
    !action ||
    action.messageId !== message.id ||
    message.role !== "user" ||
    ctx.editingMessage?.messageId === message.id
  )
    return null;
  const label = translate(action.pending ? "chat.timeline.retrying" : "chat.timeline.retry");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={label}
            aria-busy={action.pending || undefined}
            disabled={
              !action.available ||
              action.pending ||
              activity.isWorking ||
              activity.isRevertingCheckpoint
            }
            onClick={() => action.onRetry(message.id)}
          />
        }
      >
        <RefreshCwIcon />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function ReplyMessageButton({ message }: { readonly message: ChatMessage }) {
  const ctx = use(TimelineRowCtx);
  if (!timelineMessageCanReply(ctx, message)) return null;
  return <MessageReplyButton onReply={() => ctx.onReplyMessage?.(message)} />;
}

/** A streaming or open-for-edit message has no settled text to reply to. */
export function timelineMessageCanReply(
  ctx: Pick<
    import("./timelineRowContext").TimelineRowSharedState,
    "onReplyMessage" | "editingMessage"
  >,
  message: ChatMessage,
) {
  return (
    ctx.onReplyMessage !== undefined &&
    message.role !== "system" &&
    !message.streaming &&
    ctx.editingMessage?.messageId !== message.id
  );
}
