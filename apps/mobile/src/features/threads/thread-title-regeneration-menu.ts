import type { MenuAction } from "@react-native-menu/menu";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export function buildThreadTitleRegenerationMenuItems(input: {
  readonly supported: boolean;
  readonly isRegenerating: boolean;
}): MenuAction[] {
  if (!input.supported) return [];

  return [
    {
      id: "regenerate-title",
      title: input.isRegenerating
        ? currentInterfaceTranslator().message("sidebar.thread.menu.regenerating")
        : currentInterfaceTranslator().message("sidebar.thread.menu.regenerate"),
      image: "arrow.clockwise",
      ...(input.isRegenerating ? { attributes: { disabled: true } } : {}),
    },
  ];
}
