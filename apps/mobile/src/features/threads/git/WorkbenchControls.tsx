import { Pressable, View } from "react-native";
import type { ReactNode } from "react";
import { AppText, AppTextInput } from "../../../components/ui/AppText";

export function WorkbenchButton(props: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly destructive?: boolean;
  readonly selected?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={
        props.selected
          ? "rounded-xl bg-primary/15 px-3 py-2 disabled:opacity-40"
          : "rounded-xl bg-subtle px-3 py-2 disabled:opacity-40"
      }
    >
      <AppText
        className={
          props.destructive
            ? "text-sm font-t3-medium text-red-500"
            : "text-sm font-t3-medium text-foreground"
        }
      >
        {props.label}
      </AppText>
    </Pressable>
  );
}

export function WorkbenchCard(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View className="gap-3 rounded-[22px] border border-border bg-card p-4">
      <AppText className="text-base font-t3-semibold text-foreground">{props.title}</AppText>
      {props.children}
    </View>
  );
}

export function WorkbenchInput(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly multiline?: boolean;
  readonly editable?: boolean;
}) {
  return (
    <View className="gap-1">
      <AppText className="text-xs text-foreground-muted">{props.label}</AppText>
      <AppTextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        editable={props.editable}
        multiline={props.multiline}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical={props.multiline ? "top" : "center"}
        className="rounded-xl border border-border bg-screen px-3 py-2 text-sm text-foreground"
      />
    </View>
  );
}
