import type { InterfaceLocalePreferenceV1 } from "@t3tools/contracts";
import {
  translateInterfaceMessage,
  type ResolvedInterfaceLanguage,
} from "@t3tools/shared/interfaceLanguage";

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
import { SettingResetButton, SettingsRow } from "./settingsLayout";

export interface InterfaceLanguageSettingViewProps {
  readonly language: ResolvedInterfaceLanguage;
  readonly preference: InterfaceLocalePreferenceV1;
  readonly searchTargetId: string;
  readonly status: string | null;
  readonly onPreferenceChange: (preference: InterfaceLocalePreferenceV1) => void;
}

export function InterfaceLanguageSettingView(props: InterfaceLanguageSettingViewProps) {
  const message = (
    key: Parameters<typeof translateInterfaceMessage>[1],
    values?: Readonly<Record<string, string | number>>,
  ) => translateInterfaceMessage(props.language, key, values);
  const label = message("settings.interfaceLanguage.title");
  return (
    <SettingsRow
      id={props.searchTargetId}
      title={label}
      description={message("settings.interfaceLanguage.description")}
      status={props.status}
      resetAction={
        props.preference !== "system" ? (
          <SettingResetButton label={label} onClick={() => props.onPreferenceChange("system")} />
        ) : null
      }
      control={
        <Select
          value={props.preference}
          onValueChange={(value) => {
            if (isInterfaceLanguagePreference(value)) props.onPreferenceChange(value);
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label={label}>
            <SelectValue>
              {message(interfaceLanguagePreferenceMessageId(props.preference))}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {INTERFACE_LANGUAGE_PREFERENCES.map((preference) => (
              <SelectItem key={preference} hideIndicator value={preference}>
                {message(interfaceLanguagePreferenceMessageId(preference))}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function InterfaceLanguageSetting(props: { readonly searchTargetId: string }) {
  const interfaceLanguage = useInterfaceLanguage();
  const setInterfaceLanguagePreference = useSetInterfaceLanguagePreference();
  const syncStatus = useInterfaceLanguageSyncStatus();
  const status =
    interfaceLanguageSyncStatusText(interfaceLanguage.language, syncStatus) ??
    (syncStatus.isSyncing
      ? translateInterfaceMessage(interfaceLanguage.language, "settings.interfaceLanguage.syncing")
      : null);

  return (
    <InterfaceLanguageSettingView
      language={interfaceLanguage.language}
      preference={interfaceLanguage.preference}
      searchTargetId={props.searchTargetId}
      status={status}
      onPreferenceChange={setInterfaceLanguagePreference}
    />
  );
}
