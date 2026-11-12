import { getProviderClient } from "@t3tools/client-runtime/provider-clients";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerConfig,
  ServerProvider,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  readCustomModelEntries,
  toCustomModelSetting,
  type CustomModelDefinition,
} from "@t3tools/shared/model";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AgentSettingsButton } from "./AgentSettingsFields";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { MobileCustomModelEditor } from "./MobileCustomModelEditor";
import {
  moveMobileProviderModel,
  mobileProviderModelPreferencesPatch,
  orderedMobileProviderModels,
} from "./mobile-provider-instance-settings";

export function MobileProviderModelsEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly provider: ServerProvider;
  readonly canManage: boolean;
  readonly canWritePreferences: boolean;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const storedConfig =
    props.instance.config !== null && typeof props.instance.config === "object"
      ? (props.instance.config as Record<string, unknown>)
      : {};
  const storedCustomModels = readCustomModelEntries(storedConfig.customModels);
  const [customModels, setCustomModels] =
    useState<ReadonlyArray<CustomModelDefinition>>(storedCustomModels);
  const [customModelsChanged, setCustomModelsChanged] = useState(false);
  const preferences = props.config.settings.providerModelPreferences?.[props.instanceId];
  const [hiddenModels, setHiddenModels] = useState<ReadonlyArray<string>>(
    preferences?.hiddenModels ?? [],
  );
  const [modelOrder, setModelOrder] = useState<ReadonlyArray<string>>(
    preferences?.modelOrder ?? [],
  );
  const [preferencesChanged, setPreferencesChanged] = useState(false);
  const [editing, setEditing] = useState<CustomModelDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const driver = props.instance.driver;
  const schema = getProviderClient(driver)?.settingsSchema;
  const canEditCustomModels =
    props.canManage &&
    !!schema?.fields.customModels &&
    !["openrouter", "openaiCompatible", "lmstudio", "antigravity"].includes(driver);
  const models = useMemo(() => {
    const builtIn = props.provider.models.filter((model) => !model.isCustom);
    return [
      ...builtIn,
      ...customModels.map((entry) => ({
        ...entry,
        isCustom: true,
        capabilities: entry.capabilities ?? {},
      })),
    ];
  }, [props.provider.models, customModels]);
  const slugs = models.map((model) => model.slug);
  const ordered = orderedMobileProviderModels(slugs, modelOrder).flatMap((slug) => {
    const model = models.find((candidate) => candidate.slug === slug);
    return model ? [model] : [];
  });
  const save = async () => {
    if (saving) return;
    const patch: ServerSettingsPatch =
      preferencesChanged && props.canWritePreferences
        ? mobileProviderModelPreferencesPatch(props.config.settings, props.instanceId, {
            hiddenModels,
            modelOrder,
          })
        : {};
    const instance = {
      ...props.instance,
      config: {
        ...storedConfig,
        customModels: customModels.map((entry) => toCustomModelSetting(entry)),
      },
    };
    setSaving(true);
    const result = await update({
      environmentId: props.environmentId,
      input: {
        patch,
        ...(customModelsChanged && canEditCustomModels
          ? {
              providerInstanceMutation: {
                operation: "upsert",
                instanceId: props.instanceId,
                instance,
              } as const,
            }
          : {}),
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
  const setCustom = (next: ReadonlyArray<CustomModelDefinition>) => {
    setCustomModels(next);
    setCustomModelsChanged(true);
  };
  return (
    <AgentSettingsSheet
      title={translator.message("mobile.agents.providerModels")}
      onClose={props.onClose}
      onSave={() => void save()}
      closeDisabled={saving}
      saveDisabled={saving || (!props.canManage && !props.canWritePreferences)}
    >
      {ordered.map((model, index) => (
        <View key={model.slug} className="gap-3 rounded-2xl bg-card p-4">
          <Text className="text-base font-t3-semibold text-foreground">{model.name}</Text>
          <Text selectable className="text-sm text-foreground-muted">
            {model.slug}
          </Text>
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-foreground">
              {translator.message("mobile.agents.showModel")}
            </Text>
            <ThemedSwitch
              accessibilityLabel={`${model.name}: ${translator.message("mobile.agents.showModel")}`}
              disabled={saving || !props.canWritePreferences || model.isCustom}
              value={model.isCustom || !hiddenModels.includes(model.slug)}
              onValueChange={(visible) => {
                setHiddenModels(
                  visible
                    ? hiddenModels.filter((slug) => slug !== model.slug)
                    : [...new Set([...hiddenModels, model.slug])],
                );
                setPreferencesChanged(true);
              }}
            />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {([-1, 1] as const).map((direction) => (
              <AgentSettingsButton
                key={direction}
                label={translator.message(
                  direction === -1 ? "mobile.agents.moveUp" : "mobile.agents.moveDown",
                )}
                disabled={
                  saving ||
                  !props.canWritePreferences ||
                  (direction === -1 ? index === 0 : index === ordered.length - 1)
                }
                onPress={() => {
                  setModelOrder(moveMobileProviderModel(slugs, modelOrder, model.slug, direction));
                  setPreferencesChanged(true);
                }}
              />
            ))}
          </View>
          {model.isCustom && canEditCustomModels ? (
            <View className="flex-row flex-wrap gap-2">
              <AgentSettingsButton
                label={translator.message("common.edit")}
                disabled={saving}
                onPress={() => {
                  const entry = customModels.find((candidate) => candidate.slug === model.slug);
                  if (entry) setEditing(entry);
                }}
              />
              <AgentSettingsButton
                label={translator.message("mobile.settings.agents.remove")}
                destructive
                disabled={saving}
                onPress={() => setCustom(customModels.filter((entry) => entry.slug !== model.slug))}
              />
            </View>
          ) : null}
        </View>
      ))}
      {canEditCustomModels ? (
        <AgentSettingsButton
          label={translator.message("mobile.agents.addCustomModel")}
          disabled={saving}
          onPress={() => setEditing({ slug: "", name: "", capabilities: null })}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {editing ? (
        <MobileCustomModelEditor
          entry={editing}
          driver={driver}
          models={props.provider.models.filter((model) => !model.isCustom)}
          existingSlugs={models.map((model) => model.slug)}
          onClose={() => setEditing(null)}
          onSave={(entry) => {
            setCustom([
              ...customModels.filter((candidate) => candidate.slug !== editing.slug),
              entry,
            ]);
            setEditing(null);
          }}
        />
      ) : null}
    </AgentSettingsSheet>
  );
}
