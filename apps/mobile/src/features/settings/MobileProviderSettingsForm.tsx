import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
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
import {
  acceptsSecretReference,
  isSecretReference,
  isSecretSetting,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { MobileSecretValueEditor } from "./MobileProviderEnvironmentEditor";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AgentSettingsSheet } from "./AgentSettingsSheet";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  mobileProviderCatalogModels,
  mobileProviderSettingsDefinition,
  parseMobileNumberDraft,
} from "./mobile-provider-settings";

interface MobileProviderSettingsFormProps {
  readonly provider: Pick<ServerProvider, "driver" | "models">;
  readonly config?: ServerConfig;
  readonly commitWhileEditing?: boolean;
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
  readonly commitWhileEditing?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  const selected = readProviderConfigString(
    props.value,
    props.field.key,
    props.field.defaultStringValue,
  );
  const selectedOption = props.field.options?.find((option) => option.value === selected);
  const [manualEdit, setManualEdit] = useState<{
    readonly source: string;
    readonly value: string;
  } | null>(null);
  const manualDraft = manualEdit?.source === selected ? manualEdit.value : selected;
  const setManualDraft = (value: string) => setManualEdit({ source: selected, value });
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
      {props.field.allowCustomValue ? (
        <TextInput
          accessibilityLabel={props.field.label}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!props.disabled}
          onChangeText={(text) => {
            setManualDraft(text);
            if (props.commitWhileEditing) props.onCommit(text);
          }}
          onEndEditing={() => {
            if (!props.commitWhileEditing && manualDraft !== selected) props.onCommit(manualDraft);
          }}
          placeholder={props.field.placeholder ?? translator.message("mobile.ui.modelId")}
          value={manualDraft}
          className="rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.field.label}
        disabled={disabled || props.field.options?.length === 0}
        onPress={() => setOpen(true)}
        className="rounded-2xl bg-subtle px-4 py-3 disabled:opacity-40"
      >
        <Text className="text-base text-foreground">{displayValue}</Text>
      </Pressable>
      {open ? (
        <AgentSettingsSheet title={props.field.label} onClose={() => setOpen(false)}>
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
        </AgentSettingsSheet>
      ) : null}
    </View>
  );
}

function textDraft(field: ProviderSettingsFieldModel, value: unknown): string {
  if (field.control === "password") return "";
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
  readonly commitWhileEditing?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const resolvedDraft = textDraft(props.field, props.value);
  const [edit, setEdit] = useState<{
    readonly source: string;
    readonly value: string;
    readonly invalid: boolean;
  } | null>(null);
  const draft = edit?.source === resolvedDraft ? edit.value : resolvedDraft;
  const invalid = edit?.source === resolvedDraft && edit.invalid;
  const setDraft = (value: string) => setEdit({ source: resolvedDraft, value, invalid: false });
  const setInvalid = (next: boolean) =>
    setEdit((current) => ({
      source: resolvedDraft,
      value: current?.source === resolvedDraft ? current.value : resolvedDraft,
      invalid: next,
    }));

  const commit = () => {
    if (draft === resolvedDraft) return;
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
        onEndEditing={commit}
        onChangeText={(text) => {
          setDraft(text);
          if (!props.commitWhileEditing) return;
          if (props.field.control === "number") {
            const parsed = parseMobileNumberDraft(text, props.field);
            props.onCommit(parsed.valid ? parsed.value : text);
          } else
            props.onCommit(
              props.field.control === "ordered-string-list" ? text.split(/\r?\n/) : text,
            );
        }}
        placeholder={
          props.field.control === "password" &&
          readProviderConfigString(props.value, props.field.key)
            ? translator.message("mobile.agents.storedSecret")
            : props.field.placeholder
        }
        secureTextEntry={props.field.control === "password"}
        value={draft}
        className={
          multiline
            ? "min-h-24 rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
            : "rounded-2xl bg-subtle px-4 py-3 text-base text-foreground"
        }
      />
      {props.field.control === "password" &&
      readProviderConfigString(props.value, props.field.key) ? (
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          onPress={() => {
            setDraft("");
            props.onCommit("");
          }}
          className="py-2"
        >
          <Text className="text-danger-foreground">{translator.message("common.clear")}</Text>
        </Pressable>
      ) : null}
      {props.field.control === "ordered-string-list" ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("mobile.settings.provider.onePerLine")}
        </Text>
      ) : null}
      {invalid ? (
        <Text className="text-xs text-danger-foreground">
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
  return (
    <View className="flex-row items-center gap-3">
      <View className="min-w-0 flex-1">
        <FieldLabel field={props.field} />
      </View>
      <ThemedSwitch
        accessibilityLabel={props.field.label}
        disabled={props.disabled}

        onValueChange={props.onCommit}

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
  const [secretDraftKeys, setSecretDraftKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [configEdit, setConfigEdit] = useState<{
    readonly source: unknown;
    readonly value: unknown;
  } | null>(null);
  const draftConfig =
    configEdit !== null && configEdit.source === props.value ? configEdit.value : props.value;
  const definition = mobileProviderSettingsDefinition(props.provider.driver);
  const models = mobileProviderCatalogModels(props.provider);

  const fields = useMemo(
    () =>
      definition
        ? deriveProviderSettingsFields(definition, { value: draftConfig, models }).flatMap(
            (field) => {
              if (
                props.provider.driver === "acpRegistry" &&
                readProviderConfigString(draftConfig, "source", "registry") === "local" &&
                !["source", "commandPath"].includes(field.key)
              )
                return [];
              const schema = definition.settingsSchema.fields[field.key];
              return [
                {
                  ...field,
                  ...(schema && isSecretSetting(schema) ? { control: "password" as const } : {}),
                },
              ];
            },
          )
        : [],
    [definition, draftConfig, models, props.provider.driver],
  );

  if (fields.length === 0) return null;

  const commit = (field: ProviderSettingsFieldModel, value: ProviderSettingsFieldValue) => {
    const next = nextProviderConfigWithFieldValue(draftConfig, field, value);
    setConfigEdit({ source: props.value, value: next });
    props.onChange(next);
  };

  return (
    <View className="gap-4 border-t border-border-subtle pt-4">
      <Text className="text-base font-t3-semibold text-foreground">
        {translator.message("mobile.settings.provider.configuration")}
      </Text>
      {fields.map((field) => {
        const schema = definition?.settingsSchema.fields[field.key];
        if (schema && acceptsSecretReference(schema) && props.config) {
          const raw =
            draftConfig !== null && typeof draftConfig === "object"
              ? (draftConfig as Record<string, unknown>)[field.key]
              : undefined;
          return (
            <View key={field.key} className="gap-2">
              <FieldLabel field={field} />
              <MobileSecretValueEditor
                config={props.config}
                label={field.label}
                value={isSecretReference(raw) || typeof raw === "string" ? raw : ""}
                disabled={props.disabled}
                redacted={
                  typeof raw === "string" && raw.length > 0 && !secretDraftKeys.has(field.key)
                }
                onChange={(value) => {
                  setSecretDraftKeys((keys) => new Set(keys).add(field.key));
                  const next = {
                    ...(draftConfig !== null && typeof draftConfig === "object" ? draftConfig : {}),
                    [field.key]: value,
                  };
                  setConfigEdit({ source: props.value, value: next });
                  props.onChange(next);
                }}
              />
            </View>
          );
        }
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
              commitWhileEditing={props.commitWhileEditing}
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
            commitWhileEditing={props.commitWhileEditing}
          />
        );
      })}
    </View>
  );
}
