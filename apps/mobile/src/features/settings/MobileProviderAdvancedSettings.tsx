import {
  UsageLimitSourceId,
  globalIdleCompaction,
  idleCompactionPatch,
  readsIdleCompactionModes,
  isManagedSettingPath,
  type ServerConfig,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import { useState } from "react";
import { Alert, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { uuidv4 } from "../../lib/uuid";
import {
  AgentSettingsButton,
  AgentSettingsDraftInput,
  AgentSettingsInput,
} from "./AgentSettingsFields";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  buildMobileUsageLimitSourcePatch,
  providerHealthRefreshSettingsPatch,
} from "./mobile-provider-advanced-settings";

export function MobileProviderAdvancedSettings(props: {
  readonly config: ServerConfig;
  readonly disabled: boolean;
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
}) {
  const translator = useMobileInterfaceTranslator();
  const [editingSource, setEditingSource] = useState<UsageLimitSourceId | null>(null);
  const [intervalError, setIntervalError] = useState(false);
  const settings = props.config.settings;
  const disabledFor = (path: string) =>
    props.disabled || isManagedSettingPath(props.config.managedPolicy, path);
  const resolved = resolveServerBackgroundActivitySettings(settings);
  return (
    <>
      <SettingsSection title={translator.message("mobile.agents.usageSources")}>
        {Object.entries(settings.usageLimitSources).map(([rawId, source]) => {
          const id = UsageLimitSourceId.make(rawId);
          return (
            <View key={id} className="gap-3 p-4">
              <Text className="text-base font-t3-semibold text-foreground">
                {source.label ?? source.url}
              </Text>
              <Text className="text-sm text-foreground-muted">{source.url}</Text>
              <SettingsSwitchRow
                icon="arrow.triangle.2.circlepath"
                label={source.label ?? source.url}
                value={source.enabled}
                disabled={disabledFor(`usageLimitSources.${id}`)}
                onValueChange={(enabled) =>
                  void props.updateSettings(
                    { usageLimitSources: { [id]: { ...source, enabled } } },
                    translator.message("mobile.agents.usageSources"),
                  )
                }
              />
              <View className="flex-row flex-wrap gap-2">
                <AgentSettingsButton
                  label={translator.message("common.edit")}
                  disabled={disabledFor(`usageLimitSources.${id}`)}
                  onPress={() => setEditingSource(id)}
                />
                <AgentSettingsButton
                  label={translator.message("mobile.settings.agents.remove")}
                  destructive
                  disabled={disabledFor(`usageLimitSources.${id}`)}
                  onPress={() =>
                    Alert.alert(
                      translator.message("mobile.agents.removeHub"),
                      source.label ?? source.url,
                      [
                        { text: translator.message("common.cancel"), style: "cancel" },
                        {
                          text: translator.message("mobile.settings.agents.remove"),
                          style: "destructive",
                          onPress: () =>
                            void props.updateSettings(
                              { usageLimitSources: { [id]: null } },
                              translator.message("mobile.agents.usageSources"),
                            ),
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          );
        })}
        <View className="p-4">
          <AgentSettingsButton
            label={translator.message("mobile.agents.addUsageSource")}
            disabled={disabledFor("usageLimitSources")}
            onPress={() => setEditingSource(UsageLimitSourceId.make(`cliproxy-${uuidv4()}`))}
          />
        </View>
        <SettingsSwitchRow
          icon="lock"
          label={translator.message("mobile.agents.cursorKeychain")}
          value={settings.cursorKeychainUsageEnabled}
          disabled={disabledFor("cursorKeychainUsageEnabled")}
          onValueChange={(cursorKeychainUsageEnabled) =>
            void props.updateSettings(
              { cursorKeychainUsageEnabled },
              translator.message("mobile.agents.cursorKeychain"),
            )
          }
        />
      </SettingsSection>
      <SettingsSection title={translator.message("mobile.agents.advanced")}>
        <View className="gap-3 p-4">
          <Text className="text-base font-t3-semibold text-foreground">
            {translator.message("mobile.agents.idleCompaction")}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {translator.message("mobile.agents.idleDescription")}
          </Text>
          {(["onReturn", "beforeCacheExpires", "off"] as const).map((mode) => (
            <ListChoiceRow
              key={mode}
              label={translator.message(`mobile.agents.idle.${mode}`)}
              selected={globalIdleCompaction(settings) === mode}
              disabled={
                disabledFor("idleCompaction") ||
                disabledFor("compactIdleThreads") ||
                (mode === "off" && !readsIdleCompactionModes(settings))
              }
              onPress={() =>
                void props.updateSettings(
                  idleCompactionPatch(settings, mode),
                  translator.message("mobile.agents.idleCompaction"),
                )
              }
            />
          ))}
        </View>
        <View className="gap-2 border-t border-border-subtle p-4">
          <AgentSettingsDraftInput
            label={translator.message("mobile.agents.healthInterval")}
            value={String(Math.round(Duration.toSeconds(resolved.providerHealthRefreshInterval)))}
            disabled={disabledFor("backgroundActivity")}
            onCommit={(draft) => {
              const patch = providerHealthRefreshSettingsPatch(settings, draft);
              setIntervalError(patch === null);
              if (patch)
                void props.updateSettings(
                  patch,
                  translator.message("mobile.agents.healthInterval"),
                );
            }}
          />
          <Text className="text-sm text-foreground-muted">
            {translator.message("mobile.agents.healthDescription")}
          </Text>
          {intervalError ? (
            <Text className="text-sm text-danger-foreground">
              {translator.message("mobile.agents.invalidInterval")}
            </Text>
          ) : null}
        </View>
      </SettingsSection>
      {editingSource ? (
        <MobileUsageLimitSourceEditor
          key={editingSource}
          id={editingSource}
          config={props.config}
          disabled={disabledFor(`usageLimitSources.${editingSource}`)}
          updateSettings={props.updateSettings}
          onClose={() => setEditingSource(null)}
        />
      ) : null}
    </>
  );
}

function MobileUsageLimitSourceEditor(props: {
  readonly id: UsageLimitSourceId;
  readonly config: ServerConfig;
  readonly disabled: boolean;
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const existing = props.config.settings.usageLimitSources[props.id];
  const [url, setUrl] = useState(existing?.url ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [managementKey, setManagementKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const save = async () => {
    if (saving || props.disabled) return;
    const duplicate = Object.entries(props.config.settings.usageLimitSources).find(
      ([, source]) => source.url === url.trim(),
    );
    const id = !existing && duplicate ? UsageLimitSourceId.make(duplicate[0]) : props.id;
    const patch = buildMobileUsageLimitSourcePatch(props.config.settings, id, {
      url,
      label,
      managementKey,
    });
    if (!patch) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    const saved = await props.updateSettings(
      patch,
      translator.message("mobile.agents.usageSource"),
    );
    setSaving(false);
    if (saved) props.onClose();
  };
  return (
    <AgentSettingsSheet
      title={translator.message("mobile.agents.usageSource")}
      onClose={props.onClose}
      onSave={() => void save()}
      closeDisabled={saving}
      saveDisabled={props.disabled || saving}
    >
      <AgentSettingsInput
        label={translator.message("mobile.agents.hubUrl")}
        value={url}
        onChange={setUrl}
        disabled={props.disabled || saving}
        placeholder="https://hub.example"
      />
      <AgentSettingsInput
        label={translator.message("mobile.agents.managementKey")}
        value={managementKey}
        onChange={setManagementKey}
        disabled={props.disabled || saving}
        secret
        placeholder={
          existing?.managementKey ? translator.message("mobile.agents.storedSecret") : undefined
        }
      />
      <AgentSettingsInput
        label={translator.message("mobile.agents.hubLabel")}
        value={label}
        onChange={setLabel}
        disabled={props.disabled || saving}
      />
      {invalid ? (
        <Text accessibilityRole="alert" className="text-danger-foreground">
          {translator.message("mobile.agents.invalidHub")}
        </Text>
      ) : null}
    </AgentSettingsSheet>
  );
}
