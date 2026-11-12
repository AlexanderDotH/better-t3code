import {
  normalizeProviderAccentColor,
  providerAccentForegroundColor,
  providerInstanceInitials,
} from "@t3tools/client-runtime/state/provider-instance-display";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { AgentSettingsButton, AgentSettingsInput } from "./AgentSettingsFields";

const PROVIDER_ACCENT_SWATCHES = [
  "#2563eb",
  "#0d9488",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#9333ea",
  "#64748b",
  "#111827",
];

export function MobileProviderAccentColorPicker(props: {
  readonly displayName: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (color: string) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const color = normalizeProviderAccentColor(props.value);
  return (
    <View className="gap-3">
      <Text className="text-sm font-t3-medium text-foreground">
        {translator.message("mobile.agents.accentColor")}
      </Text>
      <View className="flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-xl bg-subtle"
          style={color ? { backgroundColor: color } : undefined}
        >
          <Text
            className="font-t3-semibold text-foreground"
            style={color ? { color: providerAccentForegroundColor(color) } : undefined}
          >
            {providerInstanceInitials(props.displayName)}
          </Text>
        </View>
        <Text className="flex-1 text-foreground">{props.displayName}</Text>
      </View>
      <View className="flex-row flex-wrap gap-3">
        {PROVIDER_ACCENT_SWATCHES.map((swatch) => (
          <Pressable
            key={swatch}
            accessibilityRole="radio"
            accessibilityLabel={swatch}
            accessibilityState={{ checked: color?.toLowerCase() === swatch }}
            disabled={props.disabled}
            onPress={() => props.onChange(swatch)}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: swatch }}
          >
            {color?.toLowerCase() === swatch ? (
              <Text style={{ color: providerAccentForegroundColor(swatch) }}>✓</Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      <AgentSettingsInput
        label={translator.message("mobile.agents.customColor")}
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        placeholder="#2563eb"
      />
      {props.value && !color ? (
        <Text className="text-sm text-danger-foreground">
          {translator.message("mobile.agents.invalidColor")}
        </Text>
      ) : null}
      {props.value ? (
        <AgentSettingsButton
          label={translator.message("common.clear")}
          onPress={() => props.onChange("")}
          disabled={props.disabled}
        />
      ) : null}
    </View>
  );
}
