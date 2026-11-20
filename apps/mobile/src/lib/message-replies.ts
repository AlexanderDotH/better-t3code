import {
  resolveBetterT3FeatureFlag,
  makeBetterT3SettingsV1,
  DEFAULT_REPLY_PRESENTATION,
  type BetterT3SettingsV1,
  type ReplyPresentation,
  type ServerConfig,
} from "@t3tools/contracts";

const DEFAULT_MESSAGE_REPLY_SETTINGS = makeBetterT3SettingsV1("clean-install");

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

export function mobileReplyPresentation(
  capabilities: ServerConfig["environment"]["capabilities"] | undefined,
  preference: ReplyPresentation | undefined,
): ReplyPresentation {
  return capabilities?.inlineMessageReplies === true
    ? (preference ?? DEFAULT_REPLY_PRESENTATION)
    : "side-chat";
}
