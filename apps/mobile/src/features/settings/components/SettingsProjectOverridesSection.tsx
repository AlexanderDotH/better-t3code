import { View } from "react-native";

import { Button } from "../../../components/ui/Button";
import { AppText as Text } from "../../../components/ui/AppText";
import { SettingsSection } from "./SettingsSection";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";

export function SettingsProjectOverridesSection(props: {
  readonly projectLabel: string;
  readonly hasOverrides: boolean;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly onClear: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <SettingsSection title={translator.message("mobile.navigation.project")}>
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
        <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={2}>
          {props.projectLabel}
        </Text>
        {!props.pending && props.hasOverrides ? (
          <Button
            label={translator.message("mobile.ui.useDefaults")}
            accessibilityHint={translator.message("mobile.ui.useEnvironmentDefaultsForThisProject")}
            tone="text"
            disabled={props.disabled}
            onPress={props.onClear}
          />
        ) : null}
      </View>
    </SettingsSection>
  );
}
