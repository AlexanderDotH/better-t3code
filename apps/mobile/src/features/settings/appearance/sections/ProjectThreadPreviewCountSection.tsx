import {
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  MAX_PROJECT_THREAD_PREVIEW_COUNT,
  MIN_PROJECT_THREAD_PREVIEW_COUNT,
} from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/AppText";
import { SymbolView } from "../../../../components/AppSymbol";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  projectThreadPreviewSyncMessages,
  stepProjectThreadPreviewCount,
} from "../projectThreadPreviewAppearance";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";

export function ProjectThreadPreviewCountSection() {
  const translator = useMobileInterfaceTranslator();
  const { appearance, isReady, projectThreadPreviewSyncStatus, setProjectThreadPreviewCount } =
    useAppearancePreferences();
  const count = appearance.projectThreadPreviewCount;
  const messages = projectThreadPreviewSyncMessages(projectThreadPreviewSyncStatus);
  const decrementDisabled = !isReady || count <= MIN_PROJECT_THREAD_PREVIEW_COUNT;
  const incrementDisabled = !isReady || count >= MAX_PROJECT_THREAD_PREVIEW_COUNT;
  const resetDisabled = !isReady || count === DEFAULT_PROJECT_THREAD_PREVIEW_COUNT;

  return (
    <SettingsSection card title={translator.message("mobile.appearance.sidebar")}>
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-4">
          <SymbolView
            name="text.bubble"
            size={22}
            tintColorClassName={"accent-icon"}
            type="monochrome"
            weight="regular"
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg text-foreground">
              {translator.message("mobile.appearance.chatsPerProject")}
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              {translator.message("mobile.appearance.chatLimitDescription")}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center justify-end gap-3">
          <Pressable
            accessibilityLabel={translator.message("mobile.appearance.showFewerChats")}
            accessibilityRole="button"
            disabled={decrementDisabled}
            onPress={() => setProjectThreadPreviewCount(stepProjectThreadPreviewCount(count, -1))}
            className={
              decrementDisabled
                ? "h-11 w-11 items-center justify-center rounded-full bg-secondary opacity-[0.35]"
                : "h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-70"
            }
          >
            <SymbolView
              name={{ ios: "minus", android: "remove" }}
              size={18}
              tintColorClassName={"accent-icon"}
              type="monochrome"
              weight="semibold"
            />
          </Pressable>
          <Text
            accessibilityLabel={translator.message("mobile.appearance.chatCount", { count })}
            className="min-w-10 text-center text-xl font-t3-semibold text-foreground"
          >
            {count}
          </Text>
          <Pressable
            accessibilityLabel={translator.message("mobile.appearance.showMoreChats")}
            accessibilityRole="button"
            disabled={incrementDisabled}
            onPress={() => setProjectThreadPreviewCount(stepProjectThreadPreviewCount(count, 1))}
            className={
              incrementDisabled
                ? "h-11 w-11 items-center justify-center rounded-full bg-secondary opacity-[0.35]"
                : "h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-70"
            }
          >
            <SymbolView
              name="plus"
              size={18}
              tintColorClassName={"accent-icon"}
              type="monochrome"
              weight="semibold"
            />
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={resetDisabled}
        onPress={() => setProjectThreadPreviewCount(DEFAULT_PROJECT_THREAD_PREVIEW_COUNT)}
        className={
          resetDisabled
            ? "border-t border-border-subtle p-4 opacity-[0.35]"
            : "border-t border-border-subtle p-4 active:opacity-70"
        }
      >
        <Text className="text-center text-base font-t3-medium text-primary">
          {translator.message("mobile.appearance.resetThree")}
        </Text>
      </Pressable>

      {messages.length > 0 ? (
        <View className="gap-1 border-t border-border-subtle p-4">
          {messages.map((message) => (
            <Text key={message} className="text-sm leading-normal text-foreground-muted">
              {message}
            </Text>
          ))}
        </View>
      ) : null}
    </SettingsSection>
  );
}
