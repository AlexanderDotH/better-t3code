import type { MenuAction } from "@react-native-menu/menu";
import { Pressable } from "react-native";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

const PHOTOS_ACTION: MenuAction = {
  id: "photos",
  get title() {
    return currentInterfaceTranslator().message("mobile.ui.photoLibrary");
  },
  image: "photo",
};
const FILES_ACTION: MenuAction = {
  id: "files",
  get title() {
    return currentInterfaceTranslator().message("mobile.ui.chooseFiles");
  },
  image: "folder",
};
const DRAFTS_ACTION: MenuAction = {
  id: "drafts",
  get title() {
    return currentInterfaceTranslator().message("mobile.composer.draftsAndHistory");
  },
  image: "clock.arrow.circlepath",
};

export function ComposerAttachmentButton(props: {
  readonly disabled?: boolean;
  readonly size?: "regular" | "large";
  readonly supportsFiles: boolean;
  readonly onPickMedia: () => Promise<void>;
  readonly onPickFiles: () => Promise<void>;
  readonly onOpenDrafts?: (() => void) | undefined;
}) {
  const translator = useMobileInterfaceTranslator();
  const { scale } = useAndroidControlSizing();
  const actions = [
    PHOTOS_ACTION,
    ...(props.supportsFiles ? [FILES_ACTION] : []),
    ...(props.onOpenDrafts ? [DRAFTS_ACTION] : []),
  ];
  const opensMenu = actions.length > 1;
  const button = (
    <Pressable
      accessibilityLabel={translator.message("mobile.thread.addAttachment")}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
      disabled={props.disabled}
      onPress={opensMenu ? undefined : () => void props.onPickMedia()}
    >
      <SymbolView
        name="plus"
        size={Math.round((props.size === "large" ? 26 : 20) * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    </Pressable>
  );

  if (props.disabled || !opensMenu) {
    return button;
  }

  return (
    <Menu
      accessible
      accessibilityLabel={translator.message("mobile.thread.addAttachment")}
      accessibilityRole="button"
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "photos") {
          void props.onPickMedia();
        } else if (nativeEvent.event === "files") {
          void props.onPickFiles();
        } else if (nativeEvent.event === "drafts") {
          props.onOpenDrafts?.();
        }
      }}
    >
      {button}
    </Menu>
  );
}
