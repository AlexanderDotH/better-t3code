import {
  DESCRIPTOR_PRESETS_BY_KIND,
  definitionFromDraft,
  descriptorFromPreset,
  descriptorsFromCapabilities,
  draftFromDefinition,
  emptyEditorChoice,
  emptyEditorDescriptor,
  validateDraft,
  type EditorChoice,
  type EditorDescriptor,
} from "@t3tools/client-runtime/custom-model-editor";
import type { ProviderDriverKind, ServerProviderModel } from "@t3tools/contracts";
import type { CustomModelDefinition } from "@t3tools/shared/model";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { AgentSettingsButton, AgentSettingsInput } from "./AgentSettingsFields";
import { AgentSettingsSheet } from "./AgentSettingsSheet";

const MAX_CUSTOM_MODEL_SLUG_LENGTH = 256;

export function MobileCustomModelEditor(props: {
  readonly entry: CustomModelDefinition;
  readonly driver: ProviderDriverKind;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly existingSlugs: ReadonlyArray<string>;
  readonly onClose: () => void;
  readonly onSave: (model: CustomModelDefinition) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [draft, setDraft] = useState(() => draftFromDefinition(props.entry));
  const [error, setError] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const updateDescriptor = (key: string, patch: Partial<EditorDescriptor>) =>
    setDraft((current) => ({
      ...current,
      descriptors: current.descriptors.map((descriptor) =>
        descriptor.key === key ? { ...descriptor, ...patch } : descriptor,
      ),
    }));
  const updateChoice = (descriptor: EditorDescriptor, key: string, patch: Partial<EditorChoice>) =>
    updateDescriptor(descriptor.key, {
      choices: descriptor.choices.map((choice) =>
        choice.key === key
          ? { ...choice, ...patch }
          : patch.isDefault
            ? { ...choice, isDefault: false }
            : choice,
      ),
    });
  const addDescriptor = (descriptor: EditorDescriptor) =>
    setDraft((current) => ({ ...current, descriptors: [...current.descriptors, descriptor] }));
  const save = () => {
    const slug = draft.slug.trim();
    if (
      !slug ||
      slug.length > MAX_CUSTOM_MODEL_SLUG_LENGTH ||
      props.existingSlugs.some((existing) => existing === slug && existing !== props.entry.slug) ||
      validateDraft(draft)
    ) {
      setError(true);
      return;
    }
    const definition = definitionFromDraft({ ...draft, slug });
    props.onSave({
      ...definition,
      ...(props.entry.capabilities?.selectionSupport
        ? {
            capabilities: {
              ...definition.capabilities,
              selectionSupport: props.entry.capabilities.selectionSupport,
            },
          }
        : {}),
    });
  };
  return (
    <AgentSettingsSheet
      title={translator.message("mobile.agents.customModel")}
      onClose={props.onClose}
      onSave={save}
    >
      <AgentSettingsInput
        label={translator.message("mobile.agents.modelSlug")}
        value={draft.slug}
        onChange={(slug) => setDraft({ ...draft, slug })}
      />
      <>
        <AgentSettingsInput
          label={translator.message("mobile.agents.displayName")}
          value={draft.name}
          placeholder={draft.slug}
          onChange={(name) => setDraft({ ...draft, name })}
        />
        {props.models.some((model) => (model.capabilities?.optionDescriptors?.length ?? 0) > 0) ? (
          <AgentSettingsButton
            label={translator.message("mobile.agents.copyOptions")}
            onPress={() => setCopyOpen(true)}
          />
        ) : null}
        {draft.descriptors.map((descriptor) => (
          <View key={descriptor.key} className="gap-3 rounded-2xl bg-card p-4">
            <AgentSettingsInput
              label={translator.message("mobile.agents.optionId")}
              value={descriptor.id}
              onChange={(id) => updateDescriptor(descriptor.key, { id })}
            />
            <AgentSettingsInput
              label={translator.message("mobile.agents.optionLabel")}
              value={descriptor.label}
              onChange={(label) => updateDescriptor(descriptor.key, { label })}
            />
            <View className="flex-row flex-wrap gap-2">
              {(["select", "boolean"] as const).map((type) => (
                <ListChoiceRow
                  key={type}
                  label={translator.message(
                    type === "select"
                      ? "mobile.agents.optionChoices"
                      : "mobile.agents.optionToggle",
                  )}
                  selected={descriptor.type === type}
                  onPress={() => updateDescriptor(descriptor.key, { type })}
                />
              ))}
            </View>
            {descriptor.type === "boolean" ? (
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 text-foreground">
                  {translator.message("mobile.agents.defaultChoice")}
                </Text>
                <ThemedSwitch
                  accessibilityLabel={translator.message("mobile.agents.defaultChoice")}
                  value={descriptor.currentBooleanValue === true}
                  onValueChange={(currentBooleanValue) =>
                    updateDescriptor(descriptor.key, { currentBooleanValue })
                  }
                />
              </View>
            ) : (
              <>
                {descriptor.choices.map((choice) => (
                  <View key={choice.key} className="gap-2 rounded-xl bg-subtle p-3">
                    <AgentSettingsInput
                      label={translator.message("mobile.agents.choiceValue")}
                      value={choice.id}
                      onChange={(id) => updateChoice(descriptor, choice.key, { id })}
                    />
                    <AgentSettingsInput
                      label={translator.message("mobile.agents.choiceLabel")}
                      value={choice.label}
                      onChange={(label) => updateChoice(descriptor, choice.key, { label })}
                    />
                    <View className="flex-row items-center gap-3">
                      <Text className="flex-1 text-foreground">
                        {translator.message("mobile.agents.defaultChoice")}
                      </Text>
                      <ThemedSwitch
                        accessibilityLabel={translator.message("mobile.agents.defaultChoice")}
                        value={choice.isDefault}
                        onValueChange={(isDefault) =>
                          updateChoice(descriptor, choice.key, { isDefault })
                        }
                      />
                    </View>
                    <AgentSettingsButton
                      label={translator.message("mobile.settings.agents.remove")}
                      destructive
                      onPress={() =>
                        updateDescriptor(descriptor.key, {
                          choices: descriptor.choices.filter((entry) => entry.key !== choice.key),
                        })
                      }
                    />
                  </View>
                ))}
                <AgentSettingsButton
                  label={translator.message("mobile.agents.addChoice")}
                  onPress={() =>
                    updateDescriptor(descriptor.key, {
                      choices: [...descriptor.choices, emptyEditorChoice()],
                    })
                  }
                />
              </>
            )}
            <AgentSettingsButton
              label={translator.message("mobile.settings.agents.remove")}
              destructive
              onPress={() =>
                setDraft({
                  ...draft,
                  descriptors: draft.descriptors.filter((entry) => entry.key !== descriptor.key),
                })
              }
            />
          </View>
        ))}
        {(DESCRIPTOR_PRESETS_BY_KIND[props.driver] ?? [])
          .filter((preset) => !draft.descriptors.some((descriptor) => descriptor.id === preset.id))
          .map((preset) => (
            <AgentSettingsButton
              key={preset.id}
              label={`${translator.message("mobile.agents.addOption")}: ${preset.label}`}
              onPress={() => addDescriptor(descriptorFromPreset(preset))}
            />
          ))}
        <AgentSettingsButton
          label={translator.message("mobile.agents.addOption")}
          onPress={() => addDescriptor(emptyEditorDescriptor())}
        />
      </>
      {error ? (
        <Text accessibilityRole="alert" className="text-danger-foreground">
          {translator.message("mobile.agents.customModelInvalid")}
        </Text>
      ) : null}
      {copyOpen ? (
        <AgentSettingsSheet
          title={translator.message("mobile.agents.copyOptions")}
          onClose={() => setCopyOpen(false)}
        >
          {props.models
            .filter((model) => (model.capabilities?.optionDescriptors?.length ?? 0) > 0)
            .map((model) => (
              <ListChoiceRow
                key={model.slug}
                label={model.name}
                selected={false}
                onPress={() => {
                  setDraft({
                    ...draft,
                    descriptors: descriptorsFromCapabilities(model.capabilities, props.driver),
                  });
                  setCopyOpen(false);
                }}
              />
            ))}
        </AgentSettingsSheet>
      ) : null}
    </AgentSettingsSheet>
  );
}
