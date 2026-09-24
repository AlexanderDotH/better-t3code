import { type ModelSelection, type ServerConfig } from "@t3tools/contracts";
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { buildModelOptions, type ModelOption } from "../../lib/modelOptions";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

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

export function ModelSelectionModal(props: {
  readonly config: ServerConfig;
  readonly current: ModelSelection | null;
  readonly defaultLabel?: string;
  readonly allowDefault?: boolean;
  readonly visible: boolean;
  readonly optionPredicate?: (option: ModelOption) => boolean;
  readonly auxiliaryModels?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly selectedAuxiliaryModel?: string | null;
  readonly onSelectAuxiliaryModel?: (model: string) => void;
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const options = useMemo(() => {
    const available = buildModelOptions(props.config, props.current);
    return props.optionPredicate ? available.filter(props.optionPredicate) : available;
  }, [props.config, props.current, props.optionPredicate]);
  const selectedKey = props.current
    ? `${props.current.instanceId}:${props.current.model}`
    : "default";

  const renderOption = (option: ModelOption | null, index: number) => {
    const key = option?.key ?? "default";
    const selected = key === selectedKey;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
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
          props.onSelect(option?.selection ?? null);
          props.onClose();
        }}
      >
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base text-foreground">
            {option?.label ??
              props.defaultLabel ??
              translator.message("mobile.settings.agents.defaultTextModel")}
          </Text>
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

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={props.visible}>
      <View className="flex-1 bg-sheet">
        <View className="flex-row items-center border-b border-border px-5 py-4">
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">
            {translator.message("mobile.settings.agents.chooseModel")}
          </Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} className="px-2 py-1">
            <Text className="text-base font-t3-medium text-foreground">
              {translator.message("common.done")}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {props.auxiliaryModels?.length ? (
            <View className="mb-4 overflow-hidden rounded-[24px] bg-card">
              <Text className="px-4 py-3 text-sm font-t3-medium text-foreground-muted">
                AssemblyAI Gateway
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
          <View className="overflow-hidden rounded-[24px] bg-card">
            {(props.allowDefault === false ? options : [null, ...options]).map(renderOption)}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
