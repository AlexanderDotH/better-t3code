import type { ComposerDraft } from "./use-composer-drafts";

export function messageReplyDraftCompletion(
  current: ComposerDraft,
  sent: ComposerDraft,
): "clear" | "cancel-reply" | "retain" {
  if (current.messageReply !== sent.messageReply) return "retain";
  const contentUnchanged =
    current.text === sent.text &&
    current.context === sent.context &&
    current.attachments.length === sent.attachments.length &&
    current.attachments.every((attachment, index) => attachment.id === sent.attachments[index]?.id);
  return contentUnchanged ? "clear" : "cancel-reply";
}
