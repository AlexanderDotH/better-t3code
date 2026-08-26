import type { InterfaceLanguagePreference } from "@t3tools/contracts";
import { translateInterfaceMessage } from "@t3tools/shared/interfaceLanguage";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/AppText";
import { SymbolView } from "../../../../components/AppSymbol";
import { useThemeColor } from "../../../../lib/useThemeColor";
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
] as const satisfies ReadonlyArray<{
  readonly preference: InterfaceLanguagePreference;
  readonly label:
    | "settings.interfaceLanguage.system"
    | "settings.interfaceLanguage.english"
    | "settings.interfaceLanguage.german";
  readonly description:
    | "settings.interfaceLanguage.systemDescription"
    | "settings.interfaceLanguage.englishDescription"
    | "settings.interfaceLanguage.germanDescription";
}>;

function formatEnvironmentLabels(language: "en" | "de", labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  const conjunction = language === "de" ? " und " : " and ";
  if (labels.length === 2) return `${labels[0]}${conjunction}${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}${conjunction}${labels.at(-1)}`;
}

export function InterfaceLanguageSection() {
  const checkmarkColor = useThemeColor("--color-icon");
  const { interfaceLanguage } = useAppearancePreferences();
  const t = (
    key: Parameters<typeof translateInterfaceMessage>[1],
    values?: Readonly<Record<string, string | number>>,
  ) => translateInterfaceMessage(interfaceLanguage.language, key, values);
  const messages: string[] = [];

  if (interfaceLanguage.isSyncing) {
    messages.push(t("settings.interfaceLanguage.syncing"));
  }
  if (interfaceLanguage.failedEnvironmentLabels.length > 0) {
    messages.push(
      t("settings.interfaceLanguage.syncFailed", {
        environments: formatEnvironmentLabels(
          interfaceLanguage.language,
          interfaceLanguage.failedEnvironmentLabels,
        ),
      }),
    );
  }
  if (interfaceLanguage.unsupportedEnvironmentLabels.length > 0) {
    messages.push(
      t("settings.interfaceLanguage.syncUnsupported", {
        environments: formatEnvironmentLabels(
          interfaceLanguage.language,
          interfaceLanguage.unsupportedEnvironmentLabels,
        ),
      }),
    );
  }
  if (interfaceLanguage.deferredEnvironmentLabels.length > 0) {
    messages.push(
      t("settings.interfaceLanguage.syncDeferred", {
        environments: formatEnvironmentLabels(
          interfaceLanguage.language,
          interfaceLanguage.deferredEnvironmentLabels,
        ),
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
              tintColor={checkmarkColor}
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
