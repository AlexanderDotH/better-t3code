import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/AppText";
import { SymbolView } from "../../../../components/AppSymbol";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import { CHAT_VISUAL_MODE_OPTIONS, chatVisualModeSyncMessages } from "../chatVisualsAppearance";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";

export function ChatVisualsAppearanceSection() {
  const translator = useMobileInterfaceTranslator();
  const { chatVisualMode, chatVisualModeSyncStatus, isReady, setChatVisualMode } =
    useAppearancePreferences();
  const messages = chatVisualModeSyncMessages(chatVisualModeSyncStatus);

  return (
    <SettingsSection card title={translator.message("mobile.appearance.chatVisuals")}>
      {CHAT_VISUAL_MODE_OPTIONS.map((option, index) => (
        <Pressable
          key={option.mode}
          accessibilityRole="radio"
          accessibilityState={{
            checked: chatVisualMode === option.mode,
            disabled: !isReady,
          }}
          accessibilityHint={option.description}
          disabled={!isReady}
          onPress={() => setChatVisualMode(option.mode)}
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
          {chatVisualMode === option.mode ? (
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
