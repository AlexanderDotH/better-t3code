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
import { useThemeColor } from "../../lib/useThemeColor";
import {
  mobileProjectGroupingModePatch,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";

const GROUPING_OPTIONS: ReadonlyArray<{
  readonly mode: SidebarProjectGroupingMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "repository",
    label: "Group by repository",
    description: "Matching repositories appear as one project.",
  },
  {
    mode: "repository_path",
    label: "Group by repository path",
    description: "Keep monorepo paths separate.",
  },
  {
    mode: "separate",
    label: "Keep separate",
    description: "Show every workspace as its own project.",
  },
];

export function SettingsProjectGroupingRouteScreen() {
  const checkmarkColor = useThemeColor("--color-icon");
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedMode = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileProjectGroupingSettings(preferencesResult.value).sidebarProjectGroupingMode
    : null;

  return (
    <AndroidScreenScaffold title="Project Grouping">
      <ScreenScaffoldScrollView contentContainerClassName="gap-3">
        <SettingsSection title="Default grouping">
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
                <Text className="text-lg text-foreground">{option.label}</Text>
                <Text className="text-sm leading-normal text-foreground-muted">
                  {option.description}
                </Text>
              </View>
              {selectedMode === option.mode ? (
                <SymbolView
                  name="checkmark"
                  size={18}
                  tintColor={checkmarkColor}
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
