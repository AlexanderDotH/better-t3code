import { Pressable } from "react-native";

import { AppText as Text } from "../../components/AppText";

export function ProjectIndexActionButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly primary?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      className={`min-h-11 justify-center rounded-full px-4 py-3 ${
        props.primary
          ? "bg-primary"
          : props.destructive
            ? "border border-danger-border bg-card"
            : "border border-border bg-subtle"
      } disabled:opacity-45`}
      onPress={props.onPress}
    >
      <Text
        className={`text-center text-sm font-t3-semibold ${
          props.primary
            ? "text-primary-foreground"
            : props.destructive
              ? "text-danger-foreground"
              : "text-foreground"
        }`}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
