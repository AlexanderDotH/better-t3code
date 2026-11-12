import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { MAX_APPEARANCE_CONTRAST, MIN_APPEARANCE_CONTRAST } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../../state/preferences";
import { SettingsSection } from "../../components/SettingsSection";
import { MobileClientPreferenceRows } from "../../MobileClientPreferenceRows";
import { SliderRow } from "../../../../components/ui/SliderRow";
import { AppText as Text } from "../../../../components/ui/AppText";

export function InterfaceAppearanceSection() {
  const translator = useMobileInterfaceTranslator();
  const result = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const contrast = AsyncResult.isSuccess(result)
    ? (result.value.appearanceContrast ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS.appearanceContrast)
    : MOBILE_CLIENT_PREFERENCE_DEFAULTS.appearanceContrast;
  return (
    <>
      <SettingsSection title={translator.message("mobile.prefs.appearanceContrast")}>
        <SliderRow
          icon="paintbrush"
          label={translator.message("mobile.prefs.appearanceContrast")}
          min={MIN_APPEARANCE_CONTRAST}
          max={MAX_APPEARANCE_CONTRAST}
          step={5}
          value={contrast}
          valueLabel={`${contrast}%`}
          disabled={!AsyncResult.isSuccess(result) || result.waiting}
          onChange={(appearanceContrast) => save({ appearanceContrast })}
          minimumIcon="minus"
          maximumIcon="plus"
        />
        <Text className="px-4 pb-4 text-sm text-foreground-muted">
          {translator.message("mobile.prefs.contrastDescription")}
        </Text>
      </SettingsSection>
      <MobileClientPreferenceRows group="appearance" />
    </>
  );
}
