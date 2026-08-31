import type { InterfaceLocalePreferenceV1 } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/AppText";
import { SymbolView } from "../../../../components/AppSymbol";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

const OPTIONS = [
  {
    preference: "system",
    label: "settings.interfaceLanguage.system",
    description: "settings.interfaceLanguage.systemDescription",
  },
  {
    preference: "en",
    label: "settings.interfaceLanguage.english",
    description: "settings.interfaceLanguage.englishDescription",
  },
  {
    preference: "de",
    label: "settings.interfaceLanguage.german",
    description: "settings.interfaceLanguage.germanDescription",
  },
  {
    preference: "fr",
    label: "settings.interfaceLanguage.french",
    description: "settings.interfaceLanguage.frenchDescription",
  },
] as const satisfies ReadonlyArray<{
  readonly preference: InterfaceLocalePreferenceV1;
  readonly label:
    | "settings.interfaceLanguage.system"
    | "settings.interfaceLanguage.english"
    | "settings.interfaceLanguage.german"
    | "settings.interfaceLanguage.french";
  readonly description:
    | "settings.interfaceLanguage.systemDescription"
    | "settings.interfaceLanguage.englishDescription"
    | "settings.interfaceLanguage.germanDescription"
    | "settings.interfaceLanguage.frenchDescription";
}>;

export function InterfaceLanguageSection() {
  const { interfaceLanguage } = useAppearancePreferences();
  const translator = createInterfaceTranslator({
    language: interfaceLanguage.language,
    locale: interfaceLanguage.locale,
  });
  const t = (
    key: Parameters<typeof translator.message>[0],
    values?: Readonly<Record<string, string | number>>,
  ) => translator.message(key, values);
  const messages: string[] = [];

  if (interfaceLanguage.isSyncing) {
    messages.push(t("settings.interfaceLanguage.syncing"));
  }
  if (interfaceLanguage.failedEnvironmentLabels.length > 0) {
    messages.push(
      t("settings.interfaceLanguage.syncFailed", {
        environments: translator.list(interfaceLanguage.failedEnvironmentLabels),
      }),
    );
  }
  if (interfaceLanguage.unsupportedEnvironmentLabels.length > 0) {
    messages.push(
      t("settings.interfaceLanguage.syncUnsupported", {
        environments: translator.list(interfaceLanguage.unsupportedEnvironmentLabels),
      }),
    );
  }
  if (interfaceLanguage.deferredEnvironmentLabels.length > 0) {
    messages.push(
      t("settings.interfaceLanguage.syncDeferred", {
        environments: translator.list(interfaceLanguage.deferredEnvironmentLabels),
      }),
    );
  }

  return (
    <SettingsSection card title={t("settings.interfaceLanguage.title")}>
      {OPTIONS.map((option, index) => (
        <Pressable
          key={option.preference}
          accessibilityRole="radio"
          accessibilityState={{
            checked: interfaceLanguage.preference === option.preference,
            disabled: !interfaceLanguage.isReady,
          }}
          accessibilityHint={t(option.description)}
          disabled={!interfaceLanguage.isReady}
          onPress={() => interfaceLanguage.setPreference(option.preference)}
          className={
            index === 0
              ? "flex-row items-center gap-4 p-4"
              : "flex-row items-center gap-4 border-t border-border-subtle p-4"
          }
        >
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg text-foreground">{t(option.label)}</Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              {t(option.description)}
            </Text>
          </View>
          {interfaceLanguage.preference === option.preference ? (
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
