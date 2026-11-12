import { Platform, Pressable } from "react-native";
import { Menu } from "../../components/ui/Menu";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { ThreadFeedMessage } from "../../lib/threadActivity";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import type { TimelineMessageActions } from "./use-timeline-message-actions";

export function TimelineMessageMenu(props: {
  readonly message: ThreadFeedMessage;
  readonly actions: TimelineMessageActions;
}) {
  const translator = useMobileInterfaceTranslator();
  const rewind = props.actions.rewindTarget(props.message);
  const actions = [
    ...(props.actions.canEdit(props.message)
      ? [
          {
            id: "edit",
            title: translator.message("mobile.timeline.editMessage"),
            image: Platform.OS === "ios" ? "pencil" : "ic_menu_edit",
          },
        ]
      : []),
    ...(rewind
      ? [
          {
            id: "rewind",
            title: translator.message("mobile.timeline.editFromHere"),
            image: Platform.OS === "ios" ? "arrow.uturn.backward" : "ic_menu_revert",
          },
        ]
      : []),
  ].map((action) => ({ ...action, attributes: { disabled: !props.actions.available } }));
  if (!actions.length) return null;
  return (
    <Menu
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "edit") props.actions.onEdit(props.message);
        else if (nativeEvent.event === "rewind") props.actions.onRewind(props.message);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translator.message("mobile.timeline.messageActions")}
        className="size-8 items-center justify-center active:opacity-50"
      >
        <SymbolView name="ellipsis" size={16} />
      </Pressable>
    </Menu>
  );
}
