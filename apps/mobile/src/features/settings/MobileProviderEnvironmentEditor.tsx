import { SecretProviderId, type SecretReference, type ServerConfig } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { uuidv4 } from "../../lib/uuid";
import { AgentSettingsButton, AgentSettingsInput } from "./AgentSettingsFields";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { AppText as Text } from "../../components/ui/AppText";
import {
  editMobileProviderVariable,
  type MobileProviderVariableDraft,
} from "./mobile-provider-instance-settings";

export function MobileSecretValueEditor(props: {
  readonly config: ServerConfig;
  readonly label: string;
  readonly value: string | SecretReference;
  readonly redacted?: boolean;
  readonly sensitive?: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: string | SecretReference) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [sourceOpen, setSourceOpen] = useState(false);
  const reference = typeof props.value === "string" ? null : props.value;
  const sources =
    props.config.secretReferences === true
      ? Object.entries(props.config.settings.secretProviders).filter(
          ([, provider]) => provider.kind === "one_password",
        )
      : [];
  return (
    <View className="gap-2">
      {sources.length > 0 || reference ? (
        <AgentSettingsButton
          disabled={props.disabled}
          label={`${translator.message("mobile.agents.secretSource")}: ${reference ? (props.config.settings.secretProviders[reference.provider]?.label ?? reference.provider) : translator.message("mobile.agents.variableValue")}`}
          onPress={() => setSourceOpen(true)}
        />
      ) : null}
      <AgentSettingsInput
        label={reference ? translator.message("mobile.agents.secretReference") : props.label}
        value={
          reference
            ? reference.reference
            : props.redacted
              ? ""
              : typeof props.value === "string"
                ? props.value
                : ""
        }
        placeholder={
          reference
            ? "op://vault/item/field"
            : props.redacted
              ? translator.message("mobile.agents.storedSecret")
              : undefined
        }
        secret={!reference && props.sensitive !== false}
        disabled={props.disabled}
        onChange={(value) => props.onChange(reference ? { ...reference, reference: value } : value)}
      />
      {sourceOpen ? (
        <AgentSettingsSheet
          title={translator.message("mobile.agents.secretSource")}
          onClose={() => setSourceOpen(false)}
        >
          <ListChoiceRow
            label={translator.message("mobile.agents.variableValue")}
            selected={reference === null}
            onPress={() => {
              if (reference) props.onChange("");
              setSourceOpen(false);
            }}
          />
          {sources.map(([id, source]) => (
            <ListChoiceRow
              key={id}
              label={source.label}
              selected={reference?.provider === id}
              onPress={() => {
                if (reference?.provider !== id)
                  props.onChange({ provider: SecretProviderId.make(id), reference: "" });
                setSourceOpen(false);
              }}
            />
          ))}
        </AgentSettingsSheet>
      ) : null}
    </View>
  );
}

export function MobileProviderEnvironmentEditor(props: {
  readonly config: ServerConfig;
  readonly environment: ReadonlyArray<MobileProviderVariableDraft>;
  readonly disabled: boolean;
  readonly onChange: (environment: ReadonlyArray<MobileProviderVariableDraft>) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [rows, setRows] = useState(() =>
    props.environment.map((variable) => ({ ...variable, id: uuidv4() })),
  );
  const publish = (next: typeof rows) => {
    setRows(next);
    props.onChange(next.map(({ id: _id, ...variable }) => variable));
  };
  const edit = (id: string, patch: Partial<MobileProviderVariableDraft>) =>
    publish(
      rows.map((row) => {
        if (row.id !== id) return row;
        const next = editMobileProviderVariable(row, patch);
        return next ? { ...next, id: row.id } : row;
      }),
    );
  return (
    <View className="gap-4">
      <Text className="text-base font-t3-semibold text-foreground">
        {translator.message("settings.providers.environment.title")}
      </Text>
      <Text className="text-sm text-foreground-muted">
        {translator.message("settings.providers.environment.description")}
      </Text>
      {rows.map((variable, index) => (
        <View key={variable.id} className="gap-3 rounded-2xl bg-card p-4">
          <AgentSettingsInput
            label={translator.message("settings.providers.environment.nameAria", {
              index: index + 1,
            })}
            value={variable.name}
            disabled={props.disabled || variable.valueRedacted}
            placeholder={translator.message("settings.providers.environment.namePlaceholder")}
            onChange={(name) => edit(variable.id, { name })}
          />
          <MobileSecretValueEditor
            config={props.config}
            label={translator.message("settings.providers.environment.valueAria", {
              index: index + 1,
            })}
            value={variable.value}
            redacted={variable.valueRedacted}
            sensitive={variable.sensitive}
            disabled={props.disabled}
            onChange={(value) => edit(variable.id, { value })}
          />
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-foreground">
              {translator.message("mobile.agents.sensitive")}
            </Text>
            <ThemedSwitch
              accessibilityLabel={translator.message("mobile.agents.sensitive")}
              value={variable.sensitive}
              disabled={
                props.disabled || variable.valueRedacted || typeof variable.value !== "string"
              }
              onValueChange={(sensitive) => edit(variable.id, { sensitive })}
            />
          </View>
          <AgentSettingsButton
            label={translator.message("mobile.settings.agents.remove")}
            destructive
            disabled={props.disabled}
            onPress={() => publish(rows.filter((row) => row.id !== variable.id))}
          />
        </View>
      ))}
      <AgentSettingsButton
        label={translator.message("settings.providers.environment.add")}
        disabled={props.disabled}
        onPress={() => publish([...rows, { id: uuidv4(), name: "", value: "", sensitive: true }])}
      />
      <Text className="text-xs text-foreground-muted">
        {translator.message("settings.providers.environment.storageNote")}
        {rows.some((row) => row.valueRedacted)
          ? ` ${translator.message("settings.providers.environment.redactedHint")}`
          : ""}
      </Text>
    </View>
  );
}
