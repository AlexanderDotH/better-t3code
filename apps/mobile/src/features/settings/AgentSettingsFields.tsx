import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";

export function AgentSettingsButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className="rounded-xl bg-subtle px-4 py-3 disabled:opacity-40"
    >
      <Text
        className={
          props.destructive
            ? "font-t3-medium text-danger-foreground"
            : "font-t3-medium text-foreground"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function AgentSettingsInput(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly secret?: boolean;
  readonly multiline?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!props.disabled}
        secureTextEntry={props.secret}
        multiline={props.multiline}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
      />
    </View>
  );
}

export function AgentSettingsDraftInput(props: {
  readonly label: string;
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly secret?: boolean;
}) {
  const [draft, setDraft] = useState<{ readonly source: string; readonly value: string } | null>(
    null,
  );
  const value = draft?.source === props.value ? draft.value : props.value;
  return (
    <View className="gap-2">
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!props.disabled}
        secureTextEntry={props.secret}
        value={value}
        onChangeText={(value) => setDraft({ source: props.value, value })}
        onEndEditing={() => {
          if (value !== props.value) props.onCommit(value);
        }}
        placeholder={props.placeholder}
        className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
      />
    </View>
  );
}
