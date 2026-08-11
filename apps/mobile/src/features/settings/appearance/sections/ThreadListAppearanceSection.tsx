import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/AppText";
import { SymbolView } from "../../../../components/AppSymbol";
import { useThemeColor } from "../../../../lib/useThemeColor";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../../state/preferences";
import { SettingsSection } from "../../components/SettingsSection";
import {
  mobileThreadListLayoutPatch,
  resolveMobileThreadListLayout,
  THREAD_LIST_LAYOUT_OPTIONS,
} from "../threadListAppearance";

export function ThreadListAppearanceSection() {
  const checkmarkColor = useThemeColor("--color-icon");
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedLayout = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileThreadListLayout(preferencesResult.value.legacyThreadListEnabled)
    : null;

  return (
    <SettingsSection card title="Thread list layout">
      {THREAD_LIST_LAYOUT_OPTIONS.map((option, index) => (
        <Pressable
          key={option.layout}
          accessibilityRole="radio"
          accessibilityState={{
            checked: selectedLayout === option.layout,
            disabled: !preferencesReady,
          }}
          disabled={!preferencesReady}
          onPress={() => savePreferences(mobileThreadListLayoutPatch(option.layout))}
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
          {selectedLayout === option.layout ? (
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
  );
}
