import { useState } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsRow } from "./components/SettingsRow";

export function ProjectSettingsField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly numeric?: boolean;
  readonly secret?: boolean;
  readonly multiline?: boolean;
  readonly placeholder?: string;
}) {
  return (
    <View className="gap-2 px-4 py-3">
      <AppText className="text-sm font-t3-medium text-foreground">{props.label}</AppText>
      <AppTextInput
        accessibilityLabel={props.label}
        value={props.value}
        onChangeText={props.onChange}
        editable={!props.disabled}
        keyboardType={props.numeric ? "number-pad" : "default"}
        secureTextEntry={props.secret}
        multiline={props.multiline}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={props.placeholder}
        className="min-h-12 rounded-xl bg-subtle px-3 py-2 text-base text-foreground"
      />
    </View>
  );
}

export function ProjectSettingsSelect<T extends string>(props: {
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow
        icon="line.3.horizontal"
        label={props.label}
        value={
          props.options.find((option) => option.value === props.value)?.label ??
          translator.message("git.operation.mixed")
        }
        disabled={props.disabled}
        onPress={() => setOpen(true)}
      />
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View
          className="flex-1 bg-sheet"
          style={{ paddingTop: Platform.OS === "android" ? insets.top : 0 }}
        >
          <View className="flex-row items-center gap-3 px-5 py-4">
            <AppText className="flex-1 text-xl font-t3-semibold text-foreground">
              {props.label}
            </AppText>
            <Button
              label={translator.message("common.close")}
              tone="text"
              onPress={() => setOpen(false)}
            />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
            {props.options.map((option, index) => (
              <ListChoiceRow
                key={option.value}
                label={option.label}
                selected={option.value === props.value}
                separated={index > 0}
                onPress={() => {
                  props.onChange(option.value);
                  setOpen(false);
                }}
              />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
