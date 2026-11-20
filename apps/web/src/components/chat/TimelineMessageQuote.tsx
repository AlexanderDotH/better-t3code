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
        if (ctx.onJumpToReplySource?.(source)) return;
        toastManager.add({ type: "info", title: translate("chat.reply.sourceUnavailable") });
      }}
    />
  );
}
