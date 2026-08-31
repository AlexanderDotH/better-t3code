import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SidebarProjectGroupingMode } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { Pressable, View } from "react-native";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import {
  mobileProjectGroupingModePatch,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

const GROUPING_OPTIONS: ReadonlyArray<{
  readonly mode: SidebarProjectGroupingMode;
}> = [{ mode: "repository" }, { mode: "repository_path" }, { mode: "separate" }];

export function SettingsProjectGroupingRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedMode = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileProjectGroupingSettings(preferencesResult.value).sidebarProjectGroupingMode
    : null;

  return (
    <AndroidScreenScaffold title={translator.message("mobile.settings.projectGrouping.title")}>
      <ScreenScaffoldScrollView contentContainerClassName="gap-3">
        <SettingsSection title={translator.message("mobile.settings.projectGrouping.default")}>
          {GROUPING_OPTIONS.map((option, index) => (
            <Pressable
              key={option.mode}
              accessibilityRole="radio"
              accessibilityState={{
                checked: selectedMode === option.mode,
                disabled: !preferencesReady,
              }}
              disabled={!preferencesReady}
              onPress={() => savePreferences(mobileProjectGroupingModePatch(option.mode))}
              className={
                index === 0
                  ? "flex-row items-center gap-4 p-4"
                  : "flex-row items-center gap-4 border-t border-border-subtle p-4"
              }
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-lg text-foreground">
                  {translator.message(
                    option.mode === "repository"
                      ? "mobile.settings.projectGrouping.repository"
                      : option.mode === "repository_path"
                        ? "mobile.settings.projectGrouping.path"
                        : "mobile.settings.projectGrouping.separate",
                  )}
                </Text>
                <Text className="text-sm leading-normal text-foreground-muted">
                  {translator.message(
                    option.mode === "repository"
                      ? "mobile.settings.projectGrouping.repositoryDescription"
                      : option.mode === "repository_path"
                        ? "mobile.settings.projectGrouping.pathDescription"
                        : "mobile.settings.projectGrouping.separateDescription",
                  )}
                </Text>
              </View>
              {selectedMode === option.mode ? (
                <SymbolView
                  name="checkmark"
                  size={18}
                  tintColorClassName={"accent-icon"}
                  type="monochrome"
                  weight="semibold"
                />
              ) : null}
            </Pressable>
          ))}
        </SettingsSection>
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}
