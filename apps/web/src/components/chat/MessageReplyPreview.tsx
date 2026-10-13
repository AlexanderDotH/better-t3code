import { getMessageReplyPreview } from "@t3tools/client-runtime/messageReplies";
import type { MessageReplyReference } from "@t3tools/contracts";
import { ReplyIcon, XIcon } from "lucide-react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";

export function MessageReplyPreview({
  replyTo,
  onCancel,
}: {
  replyTo: MessageReplyReference;
  onCancel: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const author =
    replyTo.authorLabel ??
    translate(replyTo.role === "user" ? "chat.reply.you" : "chat.reply.assistant");
  return (
    <div
      className="mb-2 flex min-h-13 min-w-0 items-center gap-2 border-b border-border/70 pb-2"
      role="group"
      aria-label={translate("chat.reply.replyingTo", { author })}
    >
      <ReplyIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 border-s-2 border-primary/60 ps-2">
        <div className="truncate text-xs font-medium">
          {translate("chat.reply.replyingTo", { author })}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {getMessageReplyPreview(replyTo, { attachmentLabel: translate("chat.reply.attachment") })}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost-muted"
        size="icon-sm"
        aria-label={translate("chat.reply.cancel")}
        onClick={onCancel}
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function MessageReplyQuote({
  replyTo,
  onJumpToSource,
}: {
  replyTo: MessageReplyReference;
  onJumpToSource: (replyTo: MessageReplyReference) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const author =
    replyTo.authorLabel ??
    translate(replyTo.role === "user" ? "chat.reply.you" : "chat.reply.assistant");
  return (
    <button
      type="button"
      className="mb-2 block w-full min-w-0 border-s-2 border-primary/50 ps-2 text-start text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      aria-label={translate("chat.reply.jumpToSource")}
      onClick={() => onJumpToSource(replyTo)}
    >
      <span className="block truncate font-medium">
        {translate("chat.reply.replyingTo", { author })}
      </span>
      <span className="block truncate text-muted-foreground">
        {getMessageReplyPreview(replyTo, { attachmentLabel: translate("chat.reply.attachment") })}
      </span>
    </button>
  );
}
