import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { ModelSelection } from "@t3tools/contracts";
import type { ModelOption } from "../../lib/modelOptions";
import { AppText as Text } from "../../components/ui/AppText";
import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadDetailSheet } from "./ThreadDetailSheet";

export function ComposerMultiModelPicker(props: {
  readonly options: ReadonlyArray<ModelOption>;
  readonly primary: ModelSelection;
  readonly additional: ReadonlyArray<ModelSelection>;
  readonly disabled: boolean;
  readonly singleModelOnly?: boolean;
  readonly onChange: (models: ReadonlyArray<ModelSelection>) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = (a: ModelSelection, b: ModelSelection) =>
    a.instanceId === b.instanceId && a.model === b.model;
  const additional = props.additional.filter((selection) => !matches(selection, props.primary));
  const options = props.options.filter(
    (option) =>
      !option.isHidden &&
      `${option.label} ${option.providerLabel}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <ComposerInlineControl
        label={translator.message("mobile.composer.multipleModels", {
          count: additional.length + 1,
        })}
        icon="square.grid.2x2"
        disabled={props.disabled}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <ThreadDetailSheet
          title={translator.message("mobile.composer.multipleModels", {
            count: additional.length + 1,
          })}
          onClose={() => setOpen(false)}
        >
          <View className="gap-2">
            <Text className="text-sm text-foreground-muted">
              {translator.message(
                props.singleModelOnly
                  ? "mobile.composer.deepPlanSingleModel"
                  : "mobile.composer.multipleModelsHint",
              )}
            </Text>
            <TextInput
              accessibilityLabel={translator.message("mobile.ui.switchModel")}
              placeholder={translator.message("mobile.ui.switchModel")}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              className="min-h-11 rounded-xl border border-border px-3 text-foreground"
            />
            {options.map((option) => {
              const primary = matches(option.selection, props.primary);
              const checked =
                primary || additional.some((selection) => matches(selection, option.selection));
              const disabled =
                primary ||
                option.isUnavailable ||
                props.disabled ||
                (props.singleModelOnly && !checked);
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled }}
                  disabled={disabled}
                  className="min-h-12 flex-row items-center gap-3 border-b border-border py-3 disabled:opacity-50"
                  onPress={() =>
                    props.onChange(
                      checked
                        ? additional.filter((selection) => !matches(selection, option.selection))
                        : [...additional, option.selection],
                    )
                  }
                >
                  <Text className="text-base text-foreground">{checked ? "☑" : "☐"}</Text>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm text-foreground">{option.label}</Text>
                    <Text className="text-xs text-foreground-muted">{option.providerLabel}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ThreadDetailSheet>
      ) : null}
    </>
  );
}
