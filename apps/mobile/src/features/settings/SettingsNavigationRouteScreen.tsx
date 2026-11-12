import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  moveNavigationTab,
  navigationCustomizationAvailable,
  toggleNavigationTabVisibility,
} from "../workspace/navigation-tab-order";
import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  NAVIGATION_TAB_ICONS,
  useWorkspaceTabLabels,
  useNavigationTabOrder,
  useHiddenNavigationTabs,
  useEnabledNavigationTabs,
} from "../workspace/navigation-tabs";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { resolveWorkspaceTabOrder } from "../workspace/workspace-tabs-state";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function SettingsNavigationRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const tabLabels = useWorkspaceTabLabels();
  const insets = useSafeAreaInsets();
  const order = useNavigationTabOrder();
  const { layout } = useAdaptiveWorkspaceLayout();
  const capacity = Platform.OS === "android" && layout.usesSplitView ? 5 : 4;
  const hidden = useHiddenNavigationTabs();
  const enabled = useEnabledNavigationTabs();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const customizable = navigationCustomizationAvailable();
  const ready = customizable && AsyncResult.isSuccess(preferences) && !preferences.waiting;
  const save = useAtomSet(updateMobilePreferencesAtom);
  return (
    <SettingsScreen title={translator.message("mobile.settings.navigationTabs")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <Text className="px-2 text-sm text-foreground-muted">
          {translator.message("mobile.prefs.navigationDescription")}
        </Text>
        <SettingsSection title={translator.message("mobile.ui.tabOrder")}>
          {order.map((tab, index) => (
            <View key={tab} className="flex-row items-center gap-3 px-4 py-3">
              <SymbolView
                name={NAVIGATION_TAB_ICONS[tab]}
                size={22}
                tintColorClassName="accent-icon"
              />
              <View className="flex-1">
                <Text>{tabLabels[tab]}</Text>
                <Text className="text-xs text-foreground-muted">
                  {hidden.includes(tab)
                    ? translator.message("mobile.ui.hidden")
                    : enabled.indexOf(tab) < capacity
                      ? `Tab ${enabled.indexOf(tab) + 1}`
                      : translator.message("mobile.ui.inSettings")}
                </Text>
              </View>
              <IconButton
                icon={hidden.includes(tab) ? "eye.slash" : "eye"}
                accessibilityLabel={translator.message(
                  hidden.includes(tab) ? "mobile.ui.showTab" : "mobile.ui.hideTab",
                  { tab: tabLabels[tab] },
                )}
                disabled={!ready || (!hidden.includes(tab) && enabled.length === 1)}
                onPress={() =>
                  save({
                    transform: (current) => ({
                      hiddenNavigationTabs: toggleNavigationTabVisibility(
                        current.hiddenNavigationTabs,
                        tab,
                      ),
                    }),
                  })
                }
              />
              <IconButton
                icon="arrow.up"
                accessibilityLabel={translator.message("mobile.prefs.moveUp", {
                  tab: tabLabels[tab],
                })}
                disabled={!ready || index === 0}
                onPress={() =>
                  save({
                    transform: (current) => ({
                      navigationTabOrder: moveNavigationTab(
                        resolveWorkspaceTabOrder(current.navigationTabOrder),
                        tab,
                        index - 1,
                      ),
                    }),
                  })
                }
              />
              <IconButton
                icon="arrow.down"
                accessibilityLabel={translator.message("mobile.prefs.moveDown", {
                  tab: tabLabels[tab],
                })}
                disabled={!ready || index === order.length - 1}
                onPress={() =>
                  save({
                    transform: (current) => ({
                      navigationTabOrder: moveNavigationTab(
                        resolveWorkspaceTabOrder(current.navigationTabOrder),
                        tab,
                        index + 1,
                      ),
                    }),
                  })
                }
              />
            </View>
          ))}
        </SettingsSection>
        <Button
          label={translator.message("mobile.ui.resetTabs")}
          tone="text"
          disabled={!ready}
          onPress={() => save({ navigationTabOrder: [], hiddenNavigationTabs: [] })}
        />
      </ScreenScrollView>
    </SettingsScreen>
  );
}
