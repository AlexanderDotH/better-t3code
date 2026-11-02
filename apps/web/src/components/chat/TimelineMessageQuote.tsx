import { use } from "react";
import type { MessageReplyReference } from "@t3tools/contracts";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { toastManager } from "../ui/toast";
import { MessageReplyQuote } from "./MessageReplyPreview";
import { TimelineRowCtx } from "./timelineRowContext";

export function TimelineMessageQuote({ replyTo }: { replyTo: MessageReplyReference }) {
  const ctx = use(TimelineRowCtx);
  const translate = useInterfaceTranslator().message;
  return (
    <MessageReplyQuote
      replyTo={replyTo}
      onJumpToSource={(source) => {
        const index = ctx.listRef.current
          ?.getState()
          .data.findIndex(
            (entry) => entry.kind === "message" && entry.message.id === source.messageId,
          );
        if (index !== undefined && index >= 0)
          void ctx.listRef.current?.scrollToIndex({ index, animated: false });
        else if (ctx.replySourceThreadId) ctx.onOpenThread(ctx.replySourceThreadId);
        else toastManager.add({ type: "info", title: translate("chat.reply.sourceUnavailable") });
      }}
    />
  );
}
