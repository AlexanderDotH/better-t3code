import {
  BASE_FONT_SIZE_STEP,
  MAX_BASE_FONT_SIZE,
  MIN_BASE_FONT_SIZE,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  TextAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";

export function TextAppearanceSection() {
  const translator = useMobileInterfaceTranslator();
  const { isReady, appearance, setBaseFontSize, mathRenderingEnabled, setMathRenderingEnabled } =
    useAppearancePreferences();

  return (
    <SettingsSection title={translator.message("mobile.appearance.text")}>
      <TextAppearancePreview fontSize={appearance.baseFontSize} />
      <AppearancePreviewSeparator />
      <FontSizeSliderRow
        disabled={!isReady}
        icon="textformat.size"
        label={translator.message("mobile.appearance.textSize")}
        max={MAX_BASE_FONT_SIZE}
        min={MIN_BASE_FONT_SIZE}
        onChange={setBaseFontSize}
        step={BASE_FONT_SIZE_STEP}
        value={appearance.baseFontSize}
        valueLabel={`${appearance.baseFontSize} pt`}
      />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="plusminus"
        label={translator.message("mobile.ui.renderMath")}
        value={mathRenderingEnabled}
        onValueChange={setMathRenderingEnabled}
      />
    </SettingsSection>
  );
}
