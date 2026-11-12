import { useEffect, useEffectEvent, useRef } from "react";
import { View } from "react-native";

import { AppTextInput } from "../../../components/ui/AppText";
import { SettingsSection } from "./SettingsSection";

/**
 * A multiline server setting that saves when editing ends or the section unmounts; Android Back
 * hides the keyboard without ending editing. `value` is null while targets disagree. The key
 * remounts the input when the saved value changes, so a draft typed over an older value is dropped.
 */
export function SettingsTextFieldSection(props: {
  readonly title: string;
  readonly footer?: string | undefined;
  readonly label: string;
  readonly placeholder: string;
  readonly mixedPlaceholder: string;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onCommit: (text: string) => void;
}) {
  const draft = useRef<{ text: string; over: string | null } | null>(null);
  const commit = () => {
    const pending = draft.current;
    draft.current = null;
    // Save even while disabled; the route queues behind pending writes and checks access.
    if (pending === null || pending.over !== props.value) return;
    const text = pending.text.trim();
    if (props.value === null || text !== props.value) props.onCommit(text);
  };
  const saveDraft = useEffectEvent(commit);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves an unsent draft to server settings when the section unmounts
  useEffect(() => () => saveDraft(), []);
  return (
    <SettingsSection title={props.title} footer={props.footer}>
      <View className="px-4 py-3">
        <AppTextInput
          key={props.value}
          accessibilityLabel={props.label}
          defaultValue={props.value ?? ""}
          placeholder={props.value === null ? props.mixedPlaceholder : props.placeholder}
          editable={!props.disabled}
          multiline
          autoCapitalize="sentences"
          className="min-h-24 rounded-xl px-3 py-2 text-base text-foreground"
          onChangeText={(text) => {
            draft.current = { text, over: props.value };
          }}
          onEndEditing={commit}
        />
      </View>
    </SettingsSection>
  );
}
