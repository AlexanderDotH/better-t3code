import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { use } from "react";
import { GitForkIcon, PencilIcon } from "lucide-react";
import type { ChatMessage } from "../../types";
import { Button } from "../ui/button";
import { TimelineRowCtx } from "./timelineRowContext";
import { MessageReplyButton } from "./MessageReplyGesture";

export function TimelineMessageActions({
  message,
  editable,
}: {
  readonly message: ChatMessage;
  readonly editable: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const ctx = use(TimelineRowCtx);
  if (message.role === "system" || message.streaming) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {editable && ctx.onEditMessage ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={translate("chat.edit.title")}
          onClick={() => ctx.onEditMessage?.(message)}
        >
          <PencilIcon />
        </Button>
      ) : null}
      {ctx.onForkBoundary ? (
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Fork chat from here"
          disabled={ctx.forkPending}
          onClick={() => ctx.onForkBoundary?.({ kind: "message", messageId: message.id })}
        >
          <GitForkIcon />
        </Button>
      ) : null}
      {ctx.onReplyMessage ? (
        <MessageReplyButton onReply={() => ctx.onReplyMessage?.(message)} />
      ) : null}
    </span>
  );
}
