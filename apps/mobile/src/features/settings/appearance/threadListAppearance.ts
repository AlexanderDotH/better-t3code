import { currentInterfaceTranslator } from "../../../localization/currentInterfaceTranslator";
export type MobileThreadListLayout = "current" | "classic" | "boring";

export const THREAD_LIST_LAYOUT_OPTIONS: ReadonlyArray<{
  readonly layout: MobileThreadListLayout;
  readonly label: string;
  readonly description: string;
}> = [
  {
    layout: "current",
    get label() {
      return currentInterfaceTranslator().message("settings.betterT3.sidebarStyle.standard");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.activeWorkAppearsAsCardsWhileSettled");
    },
  },
  {
    layout: "classic",
    get label() {
      return currentInterfaceTranslator().message("settings.betterT3.value.classic");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.useTheOriginalThreadListGroupedBy");
    },
  },
  {
    layout: "boring",
    get label() {
      return currentInterfaceTranslator().message("settings.betterT3.sidebarStyle.boring");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.boringThreadListDescription");
    },
  },
];

export function resolveMobileThreadListLayout(
  legacyThreadListEnabled: boolean | undefined,
  boringThreadListEnabled?: boolean,
): MobileThreadListLayout {
  if (boringThreadListEnabled === true) return "boring";
  return legacyThreadListEnabled === true ? "classic" : "current";
}

export function mobileThreadListLayoutPatch(layout: MobileThreadListLayout): {
  readonly legacyThreadListEnabled: boolean;
  readonly boringThreadListEnabled: boolean;
} {
  return {
    legacyThreadListEnabled: layout === "classic",
    boringThreadListEnabled: layout === "boring",
  };
}
