import {
  readProviderConfigString,
  readProviderConfigStringArray,
} from "@t3tools/client-runtime/providerSettingsForm";
import { getProviderClient } from "@t3tools/client-runtime/provider-clients";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { AgentSettingsButton, AgentSettingsInput } from "./AgentSettingsFields";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { MobileProviderSettingsForm } from "./MobileProviderSettingsForm";
import { isMobileProviderConfigValid } from "./mobile-provider-settings";
import { MobileProviderAccentColorPicker } from "./MobileProviderAccentColorPicker";
import { MobileProviderEnvironmentEditor } from "./MobileProviderEnvironmentEditor";
import {
  buildMobileProviderInstance,
  serializeMobileProviderEnvironment,
  type MobileProviderVariableDraft,
} from "./mobile-provider-instance-settings";

export function MobileProviderInstanceEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: ServerConfig;
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly instance?: ProviderInstanceConfig;
  readonly provider?: ServerProvider;
  readonly disabled: boolean;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const definition = getProviderClient(props.driver);
  const [displayName, setDisplayName] = useState(
    props.instance?.displayName ?? definition?.label ?? props.driver,
  );
  const [accentColor, setAccentColor] = useState(props.instance?.accentColor ?? "");
  const [config, setConfig] = useState<unknown>(props.instance?.config ?? {});
  const [environment, setEnvironment] = useState<ReadonlyArray<MobileProviderVariableDraft>>(
    props.instance?.environment ?? [],
  );
  const [argumentsDraft, setArgumentsDraft] = useState(() =>
    readProviderConfigStringArray(props.instance?.config, "commandArgs").map((value) => ({
      id: uuidv4(),
      value,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutate = useAtomCommand(serverEnvironment.mutateProviderInstance, { reportFailure: false });
  const disabled = props.disabled || saving;
  const configuration =
    config !== null && typeof config === "object" ? (config as Record<string, unknown>) : {};

  const save = async () => {
    if (disabled) return;
    if (accentColor.trim() && !normalizeProviderAccentColor(accentColor)) {
      setError(translator.message("mobile.agents.invalidColor"));
      return;
    }
    const variables = serializeMobileProviderEnvironment(environment);
    if (!variables) {
      setError(translator.message("mobile.agents.environmentInvalid"));
      return;
    }
    const nextConfig =
      props.driver === "acpRegistry"
        ? { ...configuration, commandArgs: argumentsDraft.map((argument) => argument.value) }
        : configuration;
    if (!isMobileProviderConfigValid(props.driver, nextConfig)) {
      setError(translator.message("mobile.agents.invalidConfig"));
      return;
    }
    const instance = buildMobileProviderInstance(
      props.instance ?? { driver: props.driver, enabled: true },
      { displayName, accentColor, config: nextConfig, environment: variables },
    );
    setSaving(true);
    setError(null);
    const result = await mutate({
      environmentId: props.environmentId,
      input: {
        patch: {},
        providerInstanceMutation: {
          operation: props.instance ? "upsert" : "create",
          instanceId: props.instanceId,
          instance,
        },
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error
            ? failure.message
            : translator.message("mobile.agents.providerSaveFailed"),
        );
      }
      return;
    }
    props.onClose();
  };

  return (
    <AgentSettingsSheet
      title={translator.message("mobile.agents.editProvider")}
      onClose={props.onClose}
      onSave={() => void save()}
      closeDisabled={saving}
      saveDisabled={disabled}
    >
      <AgentSettingsInput
        label={translator.message("mobile.agents.displayName")}
        value={displayName}
        onChange={setDisplayName}
        disabled={disabled}
      />
      <MobileProviderAccentColorPicker
        displayName={displayName || definition?.label || props.driver}
        value={accentColor}
        onChange={setAccentColor}
        disabled={disabled}
      />
      {props.driver === "codex" ? (
        <View className="gap-2">
          <Text className="text-base font-t3-semibold text-foreground">
            {translator.message("mobile.agents.runtimeMode")}
          </Text>
          {(["managed", "existing"] as const).map((mode) => (
            <ListChoiceRow
              key={mode}
              label={translator.message(
                mode === "managed"
                  ? "mobile.agents.managedRuntime"
                  : "mobile.agents.existingRuntime",
              )}
              disabled={disabled}
              selected={readProviderConfigString(configuration, "setupMode", "existing") === mode}
              onPress={() => setConfig({ ...configuration, setupMode: mode })}
            />
          ))}
        </View>
      ) : null}
      <MobileProviderSettingsForm
        provider={{ driver: props.driver, models: props.provider?.models ?? [] }}
        config={props.serverConfig}
        value={config}
        disabled={disabled}
        commitWhileEditing
        onChange={setConfig}
      />
      {props.driver === "acpRegistry" ? (
        <View className="gap-3">
          <Text className="text-base font-t3-semibold text-foreground">
            {translator.message("mobile.agents.arguments")}
          </Text>
          {argumentsDraft.map((argument, index) => (
            <View key={argument.id} className="gap-2">
              <AgentSettingsInput
                label={`${translator.message("mobile.agents.arguments")} ${index + 1}`}
                value={argument.value}
                disabled={disabled}
                onChange={(value) =>
                  setArgumentsDraft(
                    argumentsDraft.map((entry) =>
                      entry.id === argument.id ? { ...entry, value } : entry,
                    ),
                  )
                }
              />
              <AgentSettingsButton
                label={translator.message("mobile.settings.agents.remove")}
                destructive
                disabled={disabled}
                onPress={() =>
                  setArgumentsDraft(argumentsDraft.filter((entry) => entry.id !== argument.id))
                }
              />
            </View>
          ))}
          <AgentSettingsButton
            label={translator.message("mobile.agents.addArgument")}
            disabled={disabled}
            onPress={() => setArgumentsDraft([...argumentsDraft, { id: uuidv4(), value: "" }])}
          />
        </View>
      ) : null}
      <MobileProviderEnvironmentEditor
        config={props.serverConfig}
        environment={environment}
        disabled={disabled}
        onChange={setEnvironment}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </AgentSettingsSheet>
  );
}
