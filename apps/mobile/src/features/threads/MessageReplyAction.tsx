import { memo } from "react";
import { Platform, Pressable, type ColorValue } from "react-native";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export const MessageReplyAction = memo(function MessageReplyAction(props: {
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
