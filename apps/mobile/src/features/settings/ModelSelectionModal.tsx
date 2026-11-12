import {
  createModelSelection,
  buildProviderOptionSelectionsFromDescriptors,
  enableAutoReasoning,
  isAutoReasoningEnabled,
  selectManualReasoningEffort,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  resolveModelSelectionSupport,
  supportsModelSelectionPurpose,
} from "@t3tools/shared/model";
import { selectableProviderOptionChoices } from "@t3tools/client-runtime/model-traits";
import {
  CODEX_REASONING_EFFORT_OPTION_ID,
  T3_AUTO_REASONING_OPTION_ID,
  type ModelSelection,
  type ModelSelectionPurpose,
  type ProjectId,
  type ServerConfig,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { buildModelOptions, type ModelOption } from "../../lib/modelOptions";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { AgentSettingsButton } from "./AgentSettingsFields";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { updateSettingsModelOption } from "./mobile-model-settings";

export function modelSelectionLabel(
  config: ServerConfig,
  selection: ModelSelection | null,
): string {
  if (selection === null) return "Default text model";
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  const model = provider?.models.find((candidate) => candidate.slug === selection.model);
  return model?.name ?? selection.model;
}

interface ModelSelectionModalProps {
  readonly config: ServerConfig;
  readonly current: ModelSelection | null;
  readonly defaultLabel?: string;
  readonly allowDefault?: boolean;
  readonly purpose?: ModelSelectionPurpose;
  readonly visible: boolean;
  readonly disabled?: boolean;
  readonly projectId?: ProjectId | null;
  readonly optionPredicate?: (option: ModelOption) => boolean;
  readonly auxiliaryModels?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly selectedAuxiliaryModel?: string | null;
  readonly onSelectAuxiliaryModel?: (model: string) => void;
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection | null) => void;
}

export function ModelSelectionModal(props: ModelSelectionModalProps) {
  return props.visible ? <ModelSelectionEditor {...props} /> : null;
}

function ModelSelectionEditor(props: ModelSelectionModalProps) {
  const translator = useMobileInterfaceTranslator();
  const [selection, setSelection] = useState(props.current);
  const [choosingModel, setChoosingModel] = useState(
    props.current === null || !!props.auxiliaryModels?.length,
  );
  const preferences = useAtomValue(mobilePreferencesAtom);
  const planModeEnabled =
    AsyncResult.isSuccess(preferences) && preferences.value.planModeEnabled === true;
  const purpose = props.purpose ?? "agent";
  const options = useMemo(() => {
    const available = buildModelOptions(props.config, selection, undefined, props.projectId ?? null)
      .filter((option) => supportsModelSelectionPurpose(option, purpose))
      .map((option) => ({
        ...option,
        isSelectable: option.isUnavailable !== true,
        unavailableReason: option.isUnavailable
          ? translator.message("mobile.ui.modelUnavailable")
          : null,
      }));
    return props.optionPredicate ? available.filter(props.optionPredicate) : available;
  }, [props.config, selection, props.projectId, props.optionPredicate, purpose, translator]);
  const selectedKey = selection ? `${selection.instanceId}:${selection.model}` : "default";

  const renderOption = (
    option:
      | (ModelOption & {
          readonly isSelectable: boolean;
          readonly unavailableReason: string | null;
        })
      | null,
    index: number,
  ) => {
    const key = option?.key ?? "default";
    const selected = key === selectedKey;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        disabled={props.disabled || option?.isSelectable === false}
        accessibilityHint={option?.unavailableReason ?? undefined}
        accessibilityState={{ checked: selected, disabled: option?.isSelectable === false }}
        className={cn(
          index === 0
            ? "flex-row items-center gap-3 px-4 py-3"
            : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3",
          option?.isSelectable === false && "opacity-50",
        )}
        onPress={() => {
          if (option?.isSelectable === false) return;
          setSelection(option?.selection ?? null);
          setChoosingModel(false);
        }}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="min-w-0 shrink text-base text-foreground">
              {option?.label ??
                props.defaultLabel ??
                translator.message("mobile.settings.agents.defaultTextModel")}
            </Text>
            {option && purpose === "decision" ? (
              <Text className="rounded-full bg-subtle px-2 py-0.5 text-xs font-t3-medium text-foreground-muted">
                {translator.message(
                  resolveModelSelectionSupport(option).decision === "native"
                    ? "chat.model.decision.native"
                    : "chat.model.decision.prompted",
                )}
              </Text>
            ) : null}
          </View>
          {option ? (
            <Text className="text-sm text-foreground-muted">
              {option.unavailableReason ?? option.providerLabel}
            </Text>
          ) : null}
        </View>
        {selected ? (
          <SymbolView
            name="checkmark"
            size={17}
            tintColorClassName="accent-icon"
            type="monochrome"
            weight="semibold"
          />
        ) : null}
      </Pressable>
    );
  };

  const selectedOption = options.find((option) => option.key === selectedKey);
  const capabilities = selectedOption?.capabilities;
  const descriptors =
    capabilities && selection
      ? getProviderOptionDescriptors({ caps: capabilities, selections: selection.options })
      : [];

  return (
    <AgentSettingsSheet
      title={translator.message("mobile.settings.agents.chooseModel")}
      onClose={props.onClose}
      contentKey={choosingModel ? "models" : "options"}
      saveDisabled={
        props.disabled ||
        (selection !== null && selectedOption?.isSelectable !== true) ||
        (selection === null && props.allowDefault === false)
      }
      onSave={() => {
        props.onSelect(selection);
        props.onClose();
      }}
    >
      {!choosingModel ? (
        <View className="gap-3">
          <Text className="text-base font-t3-semibold text-foreground">
            {selectedOption?.label ??
              props.defaultLabel ??
              translator.message("mobile.settings.agents.defaultTextModel")}
          </Text>
          <AgentSettingsButton
            label={translator.message("mobile.agents.changeModel")}
            disabled={props.disabled}
            onPress={() => setChoosingModel(true)}
          />
        </View>
      ) : null}
      {!choosingModel && selection && capabilities && descriptors.length > 0 ? (
        <View className="gap-4 rounded-[24px] bg-card p-4">
          {descriptors.map((descriptor) => {
            const currentValue = getProviderOptionCurrentValue(descriptor, selection);
            const offersAuto =
              selectedOption?.providerDriver === "codex" &&
              descriptor.type === "select" &&
              descriptor.id === CODEX_REASONING_EFFORT_OPTION_ID &&
              descriptor.options.length > 0;
            const displayedValue =
              offersAuto && isAutoReasoningEnabled(selection)
                ? T3_AUTO_REASONING_OPTION_ID
                : currentValue;
            const change = (value: string | boolean) => {
              if (offersAuto && value === T3_AUTO_REASONING_OPTION_ID) {
                setSelection(
                  enableAutoReasoning(
                    createModelSelection(
                      selection.instanceId,
                      selection.model,
                      buildProviderOptionSelectionsFromDescriptors(descriptors, selection.options),
                    ),
                  ),
                );
                return;
              }
              const next = updateSettingsModelOption(selection, capabilities, {
                id: descriptor.id,
                value,
              });
              if (next)
                setSelection(
                  offersAuto && typeof value === "string"
                    ? selectManualReasoningEffort(next, value)
                    : next,
                );
            };
            if (descriptor.type === "boolean")
              return (
                <View key={descriptor.id} className="flex-row items-center gap-3">
                  <Text className="flex-1 text-foreground">{descriptor.label}</Text>
                  <ThemedSwitch
                    accessibilityLabel={descriptor.label}
                    disabled={props.disabled}
                    value={currentValue === true}
                    onValueChange={change}
                  />
                </View>
              );
            const choices = [
              ...(offersAuto
                ? [
                    {
                      id: T3_AUTO_REASONING_OPTION_ID,
                      label: translator.message("chat.traits.auto"),
                    },
                  ]
                : []),
              ...selectableProviderOptionChoices(descriptor).filter(
                (choice) =>
                  descriptor.id !== "agent" ||
                  choice.id !== "plan" ||
                  planModeEnabled ||
                  currentValue === "plan",
              ),
            ];
            return (
              <View key={descriptor.id} className="gap-2">
                <Text className="text-sm font-t3-medium text-foreground-muted">
                  {descriptor.label}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {choices.map((choice) => (
                    <Pressable
                      key={choice.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: displayedValue === choice.id }}
                      disabled={props.disabled}
                      onPress={() => change(choice.id)}
                      className={cn(
                        "rounded-xl px-3 py-3",
                        displayedValue === choice.id ? "bg-foreground" : "bg-subtle",
                      )}
                    >
                      <Text
                        className={displayedValue === choice.id ? "text-screen" : "text-foreground"}
                      >
                        {choice.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
          {selection.options?.length ? (
            <Pressable
              accessibilityRole="button"
              disabled={props.disabled}
              onPress={() =>
                setSelection(createModelSelection(selection.instanceId, selection.model))
              }
              className="py-2"
            >
              <Text className="text-foreground-muted">
                {translator.message("mobile.agents.resetOptions")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {choosingModel && props.auxiliaryModels?.length ? (
        <View className="mb-4 overflow-hidden rounded-[24px] bg-card">
          <Text className="px-4 py-3 text-sm font-t3-medium text-foreground-muted">
            {translator.message("mobile.ui.assemblyaiGateway")}
          </Text>
          {props.auxiliaryModels.map((model) => (
            <Pressable
              key={model.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: props.selectedAuxiliaryModel === model.id }}
              className="flex-row items-center border-t border-border-subtle px-4 py-3"
              onPress={() => {
                props.onSelectAuxiliaryModel?.(model.id);
                props.onClose();
              }}
            >
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground">{model.name}</Text>
                <Text className="text-sm text-foreground-muted">{model.id}</Text>
              </View>
              {props.selectedAuxiliaryModel === model.id ? (
                <SymbolView
                  name="checkmark"
                  size={17}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                  weight="semibold"
                />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {choosingModel ? (
        <View className="overflow-hidden rounded-[24px] bg-card">
          {(props.allowDefault === false ? options : [null, ...options]).map(renderOption)}
        </View>
      ) : null}
    </AgentSettingsSheet>
  );
}
