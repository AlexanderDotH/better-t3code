import { useState } from "react";
import { View } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { parseSettingsInteger } from "./server-controls-settings";

const MAX_INTERVAL_SECONDS = 2_147_483;

export function ProjectSettingsNumberRow(props: {
  readonly label: string;
  readonly value: number | null;
  readonly minimum: number;
  readonly maximum?: number;
  readonly nullable?: boolean;
  readonly disabled: boolean;
  readonly mixed?: boolean;
  readonly onCommit: (value: number | null) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const source = `${props.value}:${props.mixed}`;
  const [edit, setEdit] = useState<{ source: string; text: string } | null>(null);
  const draft = edit?.source === source ? edit.text : props.mixed ? "" : String(props.value ?? "");
  const parsed = parseSettingsInteger(
    draft,
    props.minimum,
    props.maximum ?? MAX_INTERVAL_SECONDS,
    props.nullable,
  );
  return (
    <View className="gap-2 px-4 py-3">
      <AppText className="text-sm font-t3-medium text-foreground">{props.label}</AppText>
      <AppTextInput
        accessibilityLabel={props.label}
        value={draft}
        editable={!props.disabled}
        keyboardType="number-pad"
        placeholder={
          props.mixed
            ? translator.message("git.operation.mixed")
            : props.nullable
              ? translator.message("mobile.projects.emptyDisables")
              : undefined
        }
        onChangeText={(text) => setEdit({ source, text })}
        onEndEditing={() => {
          if (props.disabled) return;
          if (edit?.source === source && parsed !== undefined) {
            setEdit(null);
            if (props.mixed || parsed !== props.value) props.onCommit(parsed);
          }
        }}
        className="min-h-12 rounded-xl bg-subtle px-3 py-2 text-base text-foreground"
      />
      {edit !== null && parsed === undefined ? (
        <AppText className="text-sm text-danger">
          {translator.message("mobile.projects.numberRange", {
            minimum: props.minimum,
            maximum: props.maximum ?? MAX_INTERVAL_SECONDS,
          })}
        </AppText>
      ) : null}
    </View>
  );
}
