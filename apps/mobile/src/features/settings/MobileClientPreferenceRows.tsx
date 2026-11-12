import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  mobileClientControlValue,
  MOBILE_CLIENT_CONTROL_LABELS,
  MOBILE_CLIENT_CONTROL_OPTIONS,
  MOBILE_CLIENT_PREFERENCE_GROUPS,
  type MobileClientPreferenceGroup,
} from "./mobile-client-preference-controls";

export function MobileClientPreferenceRows(props: { readonly group: MobileClientPreferenceGroup }) {
  const translator = useMobileInterfaceTranslator();
  const result = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(result) && !result.waiting;
  const preferences = AsyncResult.isSuccess(result) ? result.value : undefined;
  return MOBILE_CLIENT_PREFERENCE_GROUPS[props.group].map((key) => {
    const label = translator.message(MOBILE_CLIENT_CONTROL_LABELS[key]);
    const value = mobileClientControlValue(preferences, key);
    if (key === "timestampFormat" || key === "effortDisplay" || key === "diffColorScheme") {
      return (
        <SettingsSection key={key} title={label}>
          {MOBILE_CLIENT_CONTROL_OPTIONS[key].map((option, index) => (
            <ListChoiceRow
              key={option}
              label={translator.message(`mobile.prefs.${option}`)}
              selected={value === option}
              disabled={!ready}
              separated={index > 0}
              onPress={() => save({ [key]: option })}
            />
          ))}
        </SettingsSection>
      );
    }
    return (
      <SettingsSection key={key}>
        <SettingsSwitchRow
          icon={key === "inAppNotificationsEnabled" ? "bell.badge" : "gearshape"}
          label={label}
          value={value === true}
          disabled={!ready}
          onValueChange={(next) => save({ [key]: next })}
        />
      </SettingsSection>
    );
  });
}
