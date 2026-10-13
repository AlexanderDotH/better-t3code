import { getMessageReplyPreview } from "@t3tools/client-runtime/messageReplies";
import type { MessageReplyReference } from "@t3tools/contracts";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export const MESSAGE_REPLY_PREVIEW_MIN_HEIGHT = 52;

export const MessageReplyPreview = memo(function MessageReplyPreview(props: {
  readonly reference: MessageReplyReference;
  readonly onCancel?: () => void;
  readonly onOpenSource?: () => void;
  readonly sourceAvailable?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const author =
    props.reference.authorLabel ??
    translator.message(props.reference.role === "user" ? "chat.reply.you" : "chat.reply.assistant");
  const content = (
    <View className="min-w-0 flex-1 border-l-2 border-primary pl-2">
      <Text className="font-t3-medium text-xs text-foreground" numberOfLines={1}>
        {translator.message("chat.reply.replyingTo", { author })}
      </Text>
      <Text className="text-xs text-foreground-secondary" numberOfLines={1} ellipsizeMode="tail">
        {getMessageReplyPreview(props.reference, {
          attachmentLabel: translator.message("chat.reply.attachment"),
        })}
      </Text>
    </View>
  );
  return (
    <View
      className="flex-row items-center gap-2 py-1.5"
      style={{ minHeight: MESSAGE_REPLY_PREVIEW_MIN_HEIGHT }}
    >
      {props.onOpenSource ? (
        <Pressable
          className="min-w-0 flex-1"
          accessibilityRole="button"
          accessibilityLabel={translator.message(
            props.sourceAvailable === false
              ? "chat.reply.sourceUnavailable"
              : "chat.reply.jumpToSource",
          )}
          accessibilityState={{ disabled: props.sourceAvailable === false }}
          disabled={props.sourceAvailable === false}
          onPress={props.onOpenSource}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      {props.onCancel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translator.message("chat.reply.cancel")}
          className="items-center justify-center"
          style={{ minWidth: 44, minHeight: 44 }}
          onPress={props.onCancel}
        >
          <SymbolView name="xmark" size={16} tintColorClassName="accent-icon" />
        </Pressable>
      ) : null}
    </View>
  );
});
