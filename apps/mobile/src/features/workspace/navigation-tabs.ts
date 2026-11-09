import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform } from "react-native";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  enabledNavigationTabs,
  type NavigationTab,
} from "./navigation-tab-order";
import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { mobilePreferencesAtom } from "../../state/preferences";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { resolveWorkspaceTabOrder } from "./workspace-tabs-state";

export function useWorkspaceTabLabels(): Readonly<Record<NavigationTab, string>> {
  const translator = useMobileInterfaceTranslator();
  const ios = Platform.OS === "ios";
  return {
    threads: translator.message(ios ? "mobile.navigation.chats" : "mobile.navigation.threads"),
    pullRequests: translator.message(ios ? "mobile.navigation.prs" : "mobile.navigation.pulls"),
    usage: translator.message("sidebar.navigation.usage"),
  };
}

export const NAVIGATION_TAB_ICONS = {
  threads: "text.bubble",
  pullRequests: PullRequestGlyph.pullRequest,
  usage: "chart.bar.xaxis",
} as const satisfies Readonly<Record<NavigationTab, AppSymbolName>>;

export function useNavigationTabOrder() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.navigationTabOrder
    : undefined;
  return resolveWorkspaceTabOrder(saved);
}

export function useHiddenNavigationTabs() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.hiddenNavigationTabs
    : undefined;
  return navigationCustomizationAvailable() ? resolveHiddenNavigationTabs(saved) : [];
}

export function useEnabledNavigationTabs() {
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  return enabledNavigationTabs(order, hidden);
}
