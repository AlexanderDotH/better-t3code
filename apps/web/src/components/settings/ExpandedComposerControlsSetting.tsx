import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ExpandedComposerControlsSetting(props: {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <SettingsRow
      {...searchableSetting("expanded-chat-controls", translate)}
      description={translate("settings.appearance.expandedControlsDescription")}
      resetAction={
        props.enabled !== DEFAULT_UNIFIED_SETTINGS.showExpandedComposerControls ? (
          <SettingResetButton
            label={translate("settings.appearance.expandedControls")}
            onClick={() => props.onChange(DEFAULT_UNIFIED_SETTINGS.showExpandedComposerControls)}
          />
        ) : null
      }
      control={
        <Switch
          aria-label={translate("settings.appearance.showExpandedControls")}
          checked={props.enabled}
          onCheckedChange={(checked) => props.onChange(Boolean(checked))}
        />
      }
    />
  );
}
