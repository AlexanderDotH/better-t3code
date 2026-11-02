import { useAtomValue } from "@effect/atom-react";
import { createMessageReplyReference } from "@t3tools/client-runtime/messageReplies";
import { SubagentId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { mobileMessageRepliesEnabled } from "../../lib/message-replies";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";
import { setComposerDraftMessageReply } from "../../state/use-composer-drafts";
import { memo, type ReactNode } from "react";
import { MessageReplyGesture } from "./MessageReplyGesture";
import { Platform, Pressable, type ColorValue } from "react-native";
import { Menu as ControlPillMenu } from "../../components/ui/Menu";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

const MessageReplyAction = memo(function MessageReplyAction(props: {
  readonly onReply: () => void;
  readonly tintColor: ColorValue;
}) {
  const translator = useMobileInterfaceTranslator();
  const label = translator.message("chat.reply.action");
  return (
    <ControlPillMenu
      shouldOpenOnLongPress
      actions={[
        {
          id: "reply",
          title: label,
          image: Platform.OS === "ios" ? "arrowshape.turn.up.left" : "ic_menu_send",
        },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "reply") props.onReply();
      }}
    >
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={10}
        onPress={props.onReply}
        className="size-7 items-center justify-center rounded-lg active:opacity-50"
      >
        <SymbolView name="arrow.uturn.backward" size={14} tintColor={props.tintColor} />
      </Pressable>
    </ControlPillMenu>
  );
});

type ThreadReplyTarget = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly message: Parameters<typeof createMessageReplyReference>[0] & {
    readonly role: "user" | "assistant";
  };
};

function useReplyTarget(props: ThreadReplyTarget) {
  const config = useEnvironmentServerConfig(props.environmentId);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const translator = useMobileInterfaceTranslator();
  const enabled = mobileMessageRepliesEnabled(
    config?.environment.capabilities,
    AsyncResult.isSuccess(preferences) ? preferences.value.betterT3Device : undefined,
  );
  const select = () => {
    const replyTo = createMessageReplyReference(
      props.message,
      translator.message(props.message.role === "user" ? "chat.reply.you" : "chat.reply.assistant"),
    );
    if (enabled && replyTo)
      setComposerDraftMessageReply(scopedThreadKey(props.environmentId, props.threadId), {
        replyTo,
        replyTopicId: props.message.replyTopicId ?? SubagentId.make(uuidv4()),
      });
  };
  return { enabled, select };
}

export function ThreadMessageReplyAction(
  props: ThreadReplyTarget & { readonly tintColor: ColorValue },
) {
  const reply = useReplyTarget(props);
  return reply.enabled ? (
    <MessageReplyAction tintColor={props.tintColor} onReply={reply.select} />
  ) : null;
}

export function ThreadMessageReplyGesture(
  props: ThreadReplyTarget & { readonly children: ReactNode; readonly disabled?: boolean },
) {
  const reply = useReplyTarget(props);
  return (
    <MessageReplyGesture
      message={props.message}
      enabled={reply.enabled && !props.disabled}
      onReply={reply.select}
    >
      {props.children}
    </MessageReplyGesture>
  );
}
