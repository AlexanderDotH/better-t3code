import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  INTERFACE_LANGUAGE_PREFERENCES,
  interfaceLanguagePreferenceMessageId,
  interfaceLanguageSyncStatusText,
  isInterfaceLanguagePreference,
  useInterfaceLanguage,
  useInterfaceLanguageSyncStatus,
  useSetInterfaceLanguagePreference,
} from "../../interfaceLanguageSync";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function InterfaceLanguageSettings() {
  const language = useInterfaceLanguage();
  const setPreference = useSetInterfaceLanguagePreference();
  const syncStatus = useInterfaceLanguageSyncStatus();
  const translate = useInterfaceTranslator().message;
  const syncMessage = interfaceLanguageSyncStatusText(language.language, syncStatus);

  return (
    <SettingsRow
      {...searchableSetting("interface-language")}
      description={
        syncMessage ?? "Choose a language and synchronize it with your connected environments."
      }
      control={
        <Select
          value={language.preference}
          onValueChange={(value) => {
            if (isInterfaceLanguagePreference(value)) setPreference(value);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Interface language">
            <SelectValue>
              {translate(interfaceLanguagePreferenceMessageId(language.preference))}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {INTERFACE_LANGUAGE_PREFERENCES.map((preference) => (
              <SelectItem key={preference} value={preference}>
                {translate(interfaceLanguagePreferenceMessageId(preference))}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
