import {
  resolveBetterT3FeatureFlag,
  makeBetterT3SettingsV1,
  type BetterT3SettingsV1,
  type OrchestrationSubagentSummary,
} from "@t3tools/contracts";
import type { ComposerDraft } from "../../state/use-composer-drafts";

const DEFAULT_MESSAGE_REPLY_SETTINGS = makeBetterT3SettingsV1("clean-install");

export function mobileReplyMessageKey(message: {
  readonly id: string;
  readonly replyTopicId?: string;
}) {
  return message.replyTopicId ? `reply:${message.replyTopicId}:${message.id}` : message.id;
}

export function mobileMessageRepliesEnabled(
  capabilities: { readonly messageReplies?: boolean } | undefined,
  deviceSettings?: BetterT3SettingsV1,
) {
  return (
    capabilities?.messageReplies === true &&
    resolveBetterT3FeatureFlag(
      deviceSettings ?? DEFAULT_MESSAGE_REPLY_SETTINGS,
      "chat.messageReplies",
    )
  );
}

export function mobileReplyTopicActionsEnabled(
  capabilities: { readonly messageReplies?: boolean } | undefined,
  connected: boolean,
) {
  return connected && capabilities?.messageReplies === true;
}

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

export function messageReplyStatusKey(topic: Pick<OrchestrationSubagentSummary, "status">) {
  switch (topic.status) {
    case "running":
      return "chat.reply.status.running";
    case "waiting":
      return "chat.reply.status.waiting";
    case "completed":
      return "chat.reply.status.completed";
    case "interrupted":
      return "chat.reply.status.interrupted";
    case "error":
    case "unavailable":
      return "chat.reply.status.failed";
    default:
      return "chat.reply.status.pending";
  }
}
