import type { ClientSettings } from "@t3tools/contracts";
import { isValidSearchUrlTemplate } from "@t3tools/shared/preview";
import { SettingsSection } from "../settings/components/SettingsSection";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { AppTextInput } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { View } from "react-native";
import * as Dialog from "../../components/ui/Dialog";
import { useState } from "react";
import { useBrowserSearchSettings } from "./useBrowserSearchSettings";

const ENGINES = [
  ["duckduckgo", "DuckDuckGo"],
  ["google", "Google"],
  ["bing", "Bing"],
  ["brave", "Brave"],
  ["kagi", "Kagi"],
  ["ecosia", "Ecosia"],
  ["custom", null],
] as const;

export function BrowserSearchSettings() {
  const t = useMobileInterfaceTranslator();
  const settings = useBrowserSearchSettings();
  const [pending, setPending] = useState(false);
  const write = (
    patch: Partial<Pick<ClientSettings, "browserSearchEngine" | "browserCustomSearchUrl">>,
  ) => {
    setPending(true);
    void settings
      .update(patch)
      .catch(() => Dialog.alert(t.message("mobile.panels.failed")))
      .finally(() => setPending(false));
  };
  return (
    <SettingsSection
      title={t.message("mobile.panels.searchEngine")}
      footer={
        settings.browserSearchEngine === "custom"
          ? t.message("mobile.panels.searchTemplate")
          : undefined
      }
    >
      {ENGINES.map(([engine, label], index) => (
        <ListChoiceRow
          key={engine}
          label={label ?? t.message("mobile.panels.custom")}
          selected={settings.browserSearchEngine === engine}
          disabled={pending}
          separated={index > 0}
          onPress={() => write({ browserSearchEngine: engine })}
        />
      ))}
      {settings.browserSearchEngine === "custom" ? (
        <View className="px-4 py-3">
          <AppTextInput
            key={settings.browserCustomSearchUrl}
            defaultValue={settings.browserCustomSearchUrl}
            accessibilityLabel={t.message("mobile.panels.customSearch")}
            placeholder="https://example.com/search?q=%s"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
            className="rounded-xl bg-input px-3 py-2 text-foreground"
            onEndEditing={(event) => {
              const url = event.nativeEvent.text.trim();
              if (url !== "" && !isValidSearchUrlTemplate(url)) {
                Dialog.alert(t.message("mobile.panels.searchTemplate"));
                return;
              }
              if (url !== settings.browserCustomSearchUrl) write({ browserCustomSearchUrl: url });
            }}
          />
        </View>
      ) : null}
    </SettingsSection>
  );
}
