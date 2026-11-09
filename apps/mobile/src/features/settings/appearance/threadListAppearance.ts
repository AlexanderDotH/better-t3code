import { currentInterfaceTranslator } from "../../../localization/currentInterfaceTranslator";
export type MobileThreadListLayout = "current" | "classic";

export const THREAD_LIST_LAYOUT_OPTIONS: ReadonlyArray<{
  readonly layout: MobileThreadListLayout;
  readonly label: string;
  readonly description: string;
}> = [
  {
    layout: "current",
    get label() {
      return currentInterfaceTranslator().message("settings.betterT3.value.current");
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
];

export function resolveMobileThreadListLayout(
  legacyThreadListEnabled: boolean | undefined,
): MobileThreadListLayout {
  return legacyThreadListEnabled === true ? "classic" : "current";
}

export function mobileThreadListLayoutPatch(layout: MobileThreadListLayout): {
  readonly legacyThreadListEnabled: boolean;
} {
  return { legacyThreadListEnabled: layout === "classic" };
}
