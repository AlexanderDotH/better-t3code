import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigNumber,
  readProviderConfigString,
  readProviderConfigStringArray,
  type ProviderSettingsFieldModel,
  type ProviderSettingsFieldValue,
} from "@t3tools/client-runtime/providerSettingsForm";
import type { ServerProvider } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  mobileProviderCatalogModels,
  mobileProviderSettingsDefinition,
  parseMobileNumberDraft,
} from "./mobile-provider-settings";

interface MobileProviderSettingsFormProps {
  readonly provider: ServerProvider;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (config: Record<string, unknown> | undefined) => void;
}

function FieldLabel(props: { readonly field: ProviderSettingsFieldModel }) {
  return (
    <View className="gap-0.5">
      <Text className="text-sm font-t3-medium text-foreground">{props.field.label}</Text>
      {props.field.description ? (
        <Text className="text-xs leading-normal text-foreground-muted">
          {props.field.description}
        </Text>
      ) : null}
    </View>
  );
}

function MobileSelectField(props: {
  readonly field: ProviderSettingsFieldModel;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  const selected = readProviderConfigString(
    props.value,
    props.field.key,
    props.field.defaultStringValue,
  );
  const selectedOption = props.field.options?.find((option) => option.value === selected);
  const unavailable = props.field.disabled === true;
  const disabled = props.disabled || unavailable;
  const displayValue =
    selectedOption?.label ??
    (selected ||
      (unavailable
        ? translator.message("mobile.settings.provider.loadCatalog")
        : (props.field.placeholder ??
          translator.message("mobile.settings.provider.chooseOption"))));

  return (
    <View className="gap-2">
      <FieldLabel field={props.field} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.field.label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className="rounded-2xl bg-subtle px-4 py-3 disabled:opacity-40"
      >
        <Text className="text-base text-foreground">{displayValue}</Text>
      </Pressable>
      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-sheet">
          <View className="flex-row items-center border-b border-border px-5 py-4">
            <Text className="flex-1 text-xl font-t3-semibold text-foreground">
              {props.field.label}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
              <Text className="font-t3-medium text-foreground">
                {translator.message("common.close")}
              </Text>
            </Pressable>
          </View>
          <ScrollView className="flex-1" contentContainerClassName="p-5">
            <View className="overflow-hidden rounded-[24px] bg-card">
              {props.field.options?.map((option, index) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: option.value === selected }}
                  className={
                    index === 0
                      ? "gap-0.5 px-4 py-3"
                      : "gap-0.5 border-t border-border-subtle px-4 py-3"
                  }
                  onPress={() => {
                    props.onCommit(option.value);
                    setOpen(false);
                  }}
                >
                  <Text className="text-base text-foreground">{option.label}</Text>
                  {option.description ? (
                    <Text className="text-sm text-foreground-muted">{option.description}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function textDraft(field: ProviderSettingsFieldModel, value: unknown): string {
  if (field.control === "ordered-string-list") {
    return readProviderConfigStringArray(value, field.key, field.defaultStringArrayValue).join(
      "\n",
    );
  }
  if (field.control === "number") {
    const number = readProviderConfigNumber(value, field.key, field.defaultNumberValue);
    return number === undefined ? "" : String(number);
  }
  return readProviderConfigString(value, field.key, field.defaultStringValue);
}

function MobileTextField(props: {
  readonly field: ProviderSettingsFieldModel;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onCommit: (value: ProviderSettingsFieldValue) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const resolvedDraft = textDraft(props.field, props.value);
  const [draft, setDraft] = useState(resolvedDraft);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(resolvedDraft);
    setInvalid(false);
  }, [resolvedDraft]);

  const commit = () => {
    if (props.field.control === "number") {
      const parsed = parseMobileNumberDraft(draft, props.field);
      if (!parsed.valid) {
        setInvalid(true);
        return;
      }
      setInvalid(false);
      props.onCommit(parsed.value);
      return;
    }
    if (props.field.control === "ordered-string-list") {
      props.onCommit(draft.split(/\r?\n/));
      return;
    }
    props.onCommit(draft);
  };

  const multiline =
    props.field.control === "textarea" || props.field.control === "ordered-string-list";
  return (
    <View className="gap-2">
      <FieldLabel field={props.field} />
      <TextInput
        accessibilityLabel={props.field.label}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!props.disabled}
        keyboardType={props.field.control === "number" ? "decimal-pad" : "default"}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        onBlur={commit}
        onChangeText={setDraft}
        placeholder={props.field.placeholder}
        secureTextEntry={props.field.control === "password"}
        value={draft}
        className={
          multiline
            ? "min-h-24 rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            : "rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
        }
      />
      {props.field.control === "ordered-string-list" ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("mobile.settings.provider.onePerLine")}
        </Text>
      ) : null}
      {invalid ? (
        <Text className="text-xs text-destructive">
          {translator.message("mobile.settings.provider.finiteNumber")}
          {props.field.min === undefined
            ? ""
            : translator.message("mobile.settings.provider.minimum", { min: props.field.min })}
          {props.field.max === undefined
            ? ""
            : translator.message("mobile.settings.provider.maximum", { max: props.field.max })}
          .
        </Text>
      ) : null}
    </View>
  );
}

function MobileSwitchField(props: {
  readonly field: ProviderSettingsFieldModel;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onCommit: (value: boolean) => void;
}) {
  const theme = useUniwindTheme();
  const activeTrack = theme["--color-switch-active"];
  const track = theme["--color-secondary-border"];
  return (
    <View className="flex-row items-center gap-3">
      <View className="min-w-0 flex-1">
        <FieldLabel field={props.field} />
      </View>
      <Switch
        accessibilityLabel={props.field.label}
        disabled={props.disabled}
        ios_backgroundColor={track}
        onValueChange={props.onCommit}
        trackColor={{ false: track, true: activeTrack }}
        value={readProviderConfigBoolean(
          props.value,
          props.field.key,
          props.field.defaultBooleanValue,
        )}
      />
    </View>
  );
}

export function MobileProviderSettingsForm(props: MobileProviderSettingsFormProps) {
  const translator = useMobileInterfaceTranslator();
  const [draftConfig, setDraftConfig] = useState(props.value);
  const definition = mobileProviderSettingsDefinition(props.provider.driver);
  const models = mobileProviderCatalogModels(props.provider);

  useEffect(() => {
    setDraftConfig(props.value);
  }, [props.value]);

  const fields = useMemo(
    () =>
      definition ? deriveProviderSettingsFields(definition, { value: draftConfig, models }) : [],
    [definition, draftConfig, models],
  );

  if (fields.length === 0) return null;

  const commit = (field: ProviderSettingsFieldModel, value: ProviderSettingsFieldValue) => {
    const next = nextProviderConfigWithFieldValue(draftConfig, field, value);
    setDraftConfig(next);
    props.onChange(next);
  };

  return (
    <View className="gap-4 border-t border-border-subtle pt-4">
      <Text className="text-base font-t3-semibold text-foreground">
        {translator.message("mobile.settings.provider.configuration")}
      </Text>
      {fields.map((field) => {
        if (field.control === "switch") {
          return (
            <MobileSwitchField
              key={field.key}
              disabled={props.disabled}
              field={field}
              value={draftConfig}
              onCommit={(value) => commit(field, value)}
            />
          );
        }
        if (field.control === "select") {
          return (
            <MobileSelectField
              key={field.key}
              disabled={props.disabled}
              field={field}
              value={draftConfig}
              onCommit={(value) => commit(field, value)}
            />
          );
        }
        return (
          <MobileTextField
            key={field.key}
            disabled={props.disabled}
            field={field}
            value={draftConfig}
            onCommit={(value) => commit(field, value)}
          />
        );
      })}
    </View>
  );
}
