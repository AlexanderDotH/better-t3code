import {
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MAX_PROJECT_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_PROJECT_THREAD_PREVIEW_COUNT,
  type BetterT3FeatureControlStateV1,
  type BetterT3FeatureId,
  type CavemanMode,
  type ChatVisualMode,
  type ClientSettingsPatch,
  type ContextWindowSelector,
  type EnvironmentId,
  type ModelSelection,
  type ServerProvider,
  type ServerSettingsPatch,
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
  type UnifiedSettings,
  type VoiceInputOutputLanguage,
} from "@t3tools/contracts";
import { isFetchCapableProvider } from "@t3tools/shared/fetchMode";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { createModelSelection, stripAutoReasoning } from "@t3tools/shared/model";
import { Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";

import { useChatVisualMode, useSetChatVisualMode } from "../../chatVisualModeSync";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useProjectThreadPreviewCount } from "../../projectThreadPreviewSync";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

type BetterT3SettingsPatch = ClientSettingsPatch & ServerSettingsPatch;
type Translate = InterfaceTranslator["message"];

const WEB_BETTER_T3_PREPARED_CONTROL_IDS = [
  "agent.fetchModel",
  "agent.autoReasoningModel",
  "agent.parallelPlanReviewer",
  "agent.cavemanMode",
  "chat.presentation",
  "chat.contextWindowSelector",
  "chat.previewCount",
  "chat.sorting",
  "chat.settling",
  "voice.outputLanguage",
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

type WebBetterT3PreparedControlId = (typeof WEB_BETTER_T3_PREPARED_CONTROL_IDS)[number];

type BetterT3ScalarControlUpdate =
  | { readonly id: "agent.cavemanMode"; readonly value: CavemanMode }
  | { readonly id: "chat.contextWindowSelector"; readonly value: ContextWindowSelector }
  | { readonly id: "chat.sorting.projects"; readonly value: SidebarProjectSortOrder }
  | { readonly id: "chat.sorting.threads"; readonly value: SidebarThreadSortOrder }
  | { readonly id: "chat.settling.days"; readonly value: number | null }
  | { readonly id: "chat.settling.onMerge"; readonly value: boolean }
  | { readonly id: "voice.outputLanguage"; readonly value: VoiceInputOutputLanguage };

const SETTLE_DAY_OPTIONS = [1, 3, 7, 14, 30, 90] as const;

export function buildBetterT3ScalarControlPatch(
  update: BetterT3ScalarControlUpdate,
): BetterT3SettingsPatch {
  switch (update.id) {
    case "agent.cavemanMode":
      return { agentEnhancement: { cavemanMode: update.value } };
    case "chat.contextWindowSelector":
      return { contextWindowSelector: update.value };
    case "chat.sorting.projects":
      return { sidebarProjectSortOrder: update.value };
    case "chat.sorting.threads":
      return { sidebarThreadSortOrder: update.value };
    case "chat.settling.days":
      return { sidebarAutoSettleAfterDays: update.value };
    case "chat.settling.onMerge":
      return { sidebarAutoSettleOnMerge: update.value };
    case "voice.outputLanguage":
      return { voiceInputOutputLanguage: update.value };
  }
}

function availableFeature(
  features: ReadonlyArray<BetterT3FeatureControlStateV1>,
  featureId: BetterT3FeatureId,
): boolean {
  return (
    features.find((feature) => feature.descriptor.id === featureId)?.availability.state ===
    "available"
  );
}

function selectableProviderEntries(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  predicate: (provider: ServerProvider) => boolean,
): ReadonlyArray<ProviderInstanceEntry> {
  const filteredProviders = providers.filter(
    (provider) => provider.enabled && provider.models.length > 0 && predicate(provider),
  );
  return sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(filteredProviders), settings),
  ).filter((entry) => entry.enabled && entry.models.some((model) => model.isSelectable !== false));
}

const AUTO_REASONING_EVALUATION_DRIVER_KINDS: ReadonlySet<string> = new Set([
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "gemini",
  "chatgpt",
  "openrouter",
  "openai",
]);

export function supportsAutoReasoningEvaluationProvider(
  provider: Pick<ServerProvider, "driver">,
): boolean {
  return AUTO_REASONING_EVALUATION_DRIVER_KINDS.has(provider.driver);
}

export function buildAutoReasoningModelSelectionPatch(
  selection: ModelSelection | null,
): ServerSettingsPatch {
  return {
    autoReasoningModelSelection: selection === null ? null : stripAutoReasoning(selection),
  };
}

function firstSelectableModel(entry: ProviderInstanceEntry): string | null {
  return (
    entry.models.find((model) => model.isDefault && model.isSelectable !== false)?.slug ??
    entry.models.find((model) => model.isSelectable !== false)?.slug ??
    null
  );
}

export function resolveBetterT3ModelSelection(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  preferred: ModelSelection | null,
): ModelSelection | null {
  const preferredModel = preferred?.model ?? null;
  const preferredEntry = preferred
    ? entries.find((entry) => entry.instanceId === preferred.instanceId)
    : undefined;
  if (preferredEntry) {
    const selectedModel = preferredEntry.models.find(
      (model) => model.slug === preferredModel && model.isSelectable !== false,
    );
    if (selectedModel && preferred) return stripAutoReasoning(preferred);
    const fallbackModel = firstSelectableModel(preferredEntry);
    if (fallbackModel) {
      return createModelSelection(preferredEntry.instanceId, fallbackModel);
    }
  }
  const fallbackEntry = entries[0];
  if (!fallbackEntry) return null;
  const fallbackModel = firstSelectableModel(fallbackEntry);
  return fallbackModel ? createModelSelection(fallbackEntry.instanceId, fallbackModel) : null;
}

function BetterT3ModelSelectionControl(props: {
  readonly featureId: BetterT3FeatureId;
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selection: ModelSelection | null;
  readonly fallbackSelection: ModelSelection | null;
  readonly allowAutomatic: boolean;
  readonly disabled: boolean;
  readonly predicate: (provider: ServerProvider) => boolean;
  readonly translate: Translate;
  readonly onChange: (selection: ModelSelection | null) => void;
}) {
  const entries = useMemo(
    () => selectableProviderEntries(props.settings, props.providers, props.predicate),
    [props.predicate, props.providers, props.settings],
  );
  const resolvedSelection = resolveBetterT3ModelSelection(
    entries,
    props.selection ?? props.fallbackSelection,
  );
  if (!resolvedSelection) {
    return (
      <span className="text-xs text-muted-foreground">
        {props.translate("settings.betterT3.value.unavailable")}
      </span>
    );
  }
  return (
    <fieldset
      disabled={props.disabled}
      aria-disabled={props.disabled}
      className="m-0 flex min-w-0 flex-wrap items-center justify-end gap-1.5 border-0 p-0 disabled:opacity-60"
    >
      {props.allowAutomatic ? (
        <Button
          size="xs"
          variant={props.selection === null ? "secondary" : "outline"}
          onClick={() => props.onChange(null)}
        >
          {props.translate("settings.betterT3.value.automatic")}
        </Button>
      ) : null}
      {resolvedSelection ? (
        <ProviderModelPicker
          activeInstanceId={resolvedSelection.instanceId}
          model={resolvedSelection.model}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={getCustomModelOptionsByInstance(
            props.settings,
            props.providers,
            resolvedSelection.instanceId,
            resolvedSelection.model,
          )}
          disabled={props.disabled}
          triggerVariant="outline"
          triggerClassName="min-w-0 max-w-56 shrink-0 text-foreground/90 hover:text-foreground"
          triggerAriaLabel={props.translate(`betterT3.${props.featureId}.label`)}
          onInstanceModelChange={(instanceId, model) =>
            props.onChange(createModelSelection(instanceId, model))
          }
        />
      ) : (
        <Link
          to="/settings/providers"
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          {props.translate("knowledgeGraph.configureProvider")}
        </Link>
      )}
    </fieldset>
  );
}

function BetterT3SelectControl<Value extends string>(props: {
  readonly value: Value;
  readonly options: ReadonlyArray<{ readonly value: Value; readonly label: string }>;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        const option = props.options.find((candidate) => candidate.value === value);
        if (option) props.onChange(option.value);
      }}
    >
      <SelectTrigger size="sm" className="w-36" aria-label={props.ariaLabel}>
        <SelectValue>
          {props.options.find((option) => option.value === props.value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end">
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ChatSortingControl(props: {
  readonly projectOrder: SidebarProjectSortOrder;
  readonly threadOrder: SidebarThreadSortOrder;
  readonly disabled: boolean;
  readonly translate: Translate;
  readonly updateSettings: (patch: BetterT3SettingsPatch) => void;
}) {
  const projectOptions: ReadonlyArray<{
    readonly value: SidebarProjectSortOrder;
    readonly label: string;
  }> = [
    { value: "updated_at", label: props.translate("settings.betterT3.value.updated") },
    { value: "created_at", label: props.translate("settings.betterT3.value.created") },
    { value: "manual", label: props.translate("settings.betterT3.value.manual") },
  ];
  const threadOptions: ReadonlyArray<{
    readonly value: SidebarThreadSortOrder;
    readonly label: string;
  }> = projectOptions.filter(
    (option): option is { readonly value: SidebarThreadSortOrder; readonly label: string } =>
      option.value !== "manual",
  );
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <BetterT3SelectControl
        value={props.projectOrder}
        options={projectOptions}
        ariaLabel={props.translate("settings.betterT3.value.projectSort")}
        disabled={props.disabled}
        onChange={(value) =>
          props.updateSettings(
            buildBetterT3ScalarControlPatch({ id: "chat.sorting.projects", value }),
          )
        }
      />
      <BetterT3SelectControl
        value={props.threadOrder}
        options={threadOptions}
        ariaLabel={props.translate("settings.betterT3.value.threadSort")}
        disabled={props.disabled}
        onChange={(value) =>
          props.updateSettings(
            buildBetterT3ScalarControlPatch({ id: "chat.sorting.threads", value }),
          )
        }
      />
    </div>
  );
}

function ChatSettlingControl(props: {
  readonly days: number | null;
  readonly settleOnMerge: boolean;
  readonly disabled: boolean;
  readonly translate: Translate;
  readonly updateSettings: (patch: BetterT3SettingsPatch) => void;
}) {
  const supportedDays =
    props.days === null
      ? null
      : SETTLE_DAY_OPTIONS.includes(props.days as (typeof SETTLE_DAY_OPTIONS)[number])
        ? props.days
        : Math.min(
            MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
            Math.max(MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS, Math.round(props.days)),
          );
  const dayOptions = [
    ...new Set<number>([...SETTLE_DAY_OPTIONS, ...(supportedDays ? [supportedDays] : [])]),
  ]
    .sort((left, right) => left - right)
    .map((value) => ({
      value: String(value),
      label: props.translate("settings.betterT3.value.days", { count: value }),
    }));
  const options = [
    { value: "off", label: props.translate("settings.betterT3.value.off") },
    ...dayOptions,
  ];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <BetterT3SelectControl
        value={supportedDays === null ? "off" : String(supportedDays)}
        options={options}
        ariaLabel={props.translate("betterT3.chat.settling.label")}
        disabled={props.disabled}
        onChange={(value) =>
          props.updateSettings(
            buildBetterT3ScalarControlPatch({
              id: "chat.settling.days",
              value: value === "off" ? null : Number(value),
            }),
          )
        }
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {props.translate("settings.betterT3.value.settleOnMerge")}
        <Switch
          checked={props.settleOnMerge}
          disabled={props.disabled}
          aria-label={props.translate("settings.betterT3.value.settleOnMerge")}
          onCheckedChange={(checked) =>
            props.updateSettings(
              buildBetterT3ScalarControlPatch({
                id: "chat.settling.onMerge",
                value: Boolean(checked),
              }),
            )
          }
        />
      </label>
    </div>
  );
}

export function useBetterT3PreparedControls(input: {
  readonly environmentId: EnvironmentId;
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly features: ReadonlyArray<BetterT3FeatureControlStateV1>;
  readonly translate: Translate;
  readonly updateSettings: (patch: BetterT3SettingsPatch) => void;
}): Partial<Record<BetterT3FeatureId, ReactNode>> {
  const chatVisualMode = useChatVisualMode();
  const setChatVisualMode = useSetChatVisualMode();
  const { count: previewCount, setCount: setPreviewCount } = useProjectThreadPreviewCount();
  const scalarControlDisabled = (featureId: BetterT3FeatureId) =>
    !availableFeature(input.features, featureId);

  return {
    "agent.fetchModel": (
      <BetterT3ModelSelectionControl
        featureId="agent.fetchModel"
        settings={input.settings}
        providers={input.providers}
        selection={input.settings.fetchModelSelection}
        fallbackSelection={input.settings.textGenerationModelSelection}
        allowAutomatic
        disabled={scalarControlDisabled("agent.fetchModel")}
        predicate={isFetchCapableProvider}
        translate={input.translate}
        onChange={(fetchModelSelection) => input.updateSettings({ fetchModelSelection })}
      />
    ),
    "agent.autoReasoningModel": (
      <BetterT3ModelSelectionControl
        featureId="agent.autoReasoningModel"
        settings={input.settings}
        providers={input.providers}
        selection={input.settings.autoReasoningModelSelection}
        fallbackSelection={input.settings.textGenerationModelSelection}
        allowAutomatic
        disabled={scalarControlDisabled("agent.autoReasoningModel")}
        predicate={supportsAutoReasoningEvaluationProvider}
        translate={input.translate}
        onChange={(autoReasoningModelSelection) =>
          input.updateSettings(buildAutoReasoningModelSelectionPatch(autoReasoningModelSelection))
        }
      />
    ),
    "agent.parallelPlanReviewer": (
      <BetterT3ModelSelectionControl
        featureId="agent.parallelPlanReviewer"
        settings={input.settings}
        providers={input.providers}
        selection={input.settings.parallelPlanReviewModelSelection}
        fallbackSelection={input.settings.parallelPlanReviewModelSelection}
        allowAutomatic={false}
        disabled={scalarControlDisabled("agent.parallelPlanReviewer")}
        predicate={supportsAutoReasoningEvaluationProvider}
        translate={input.translate}
        onChange={(parallelPlanReviewModelSelection) => {
          if (parallelPlanReviewModelSelection) {
            input.updateSettings({ parallelPlanReviewModelSelection });
          }
        }}
      />
    ),
    "agent.cavemanMode": (
      <BetterT3SelectControl<CavemanMode>
        value={input.settings.agentEnhancement.cavemanMode}
        options={(["off", "lite", "full", "ultra"] as const).map((value) => ({
          value,
          label: input.translate(`settings.betterT3.value.${value}`),
        }))}
        ariaLabel={input.translate("betterT3.agent.cavemanMode.label")}
        disabled={scalarControlDisabled("agent.cavemanMode")}
        onChange={(value) =>
          input.updateSettings(buildBetterT3ScalarControlPatch({ id: "agent.cavemanMode", value }))
        }
      />
    ),
    "chat.presentation": (
      <BetterT3SelectControl<ChatVisualMode>
        value={chatVisualMode}
        options={(["current", "classic"] as const).map((value) => ({
          value,
          label: input.translate(`settings.betterT3.value.${value}`),
        }))}
        ariaLabel={input.translate("betterT3.chat.presentation.label")}
        disabled={scalarControlDisabled("chat.presentation")}
        onChange={setChatVisualMode}
      />
    ),
    "chat.contextWindowSelector": (
      <BetterT3SelectControl<ContextWindowSelector>
        value={input.settings.contextWindowSelector}
        options={(["native", "better-t3"] as const).map((value) => ({
          value,
          label: input.translate(`settings.betterT3.value.${value}`),
        }))}
        ariaLabel={input.translate("betterT3.chat.contextWindowSelector.label")}
        disabled={scalarControlDisabled("chat.contextWindowSelector")}
        onChange={(value) =>
          input.updateSettings(
            buildBetterT3ScalarControlPatch({ id: "chat.contextWindowSelector", value }),
          )
        }
      />
    ),
    "chat.previewCount": (
      <BetterT3SelectControl
        value={String(previewCount)}
        options={Array.from(
          {
            length: MAX_PROJECT_THREAD_PREVIEW_COUNT - MIN_PROJECT_THREAD_PREVIEW_COUNT + 1,
          },
          (_, index) => {
            const value = MIN_PROJECT_THREAD_PREVIEW_COUNT + index;
            return { value: String(value), label: String(value) };
          },
        )}
        ariaLabel={input.translate("betterT3.chat.previewCount.label")}
        disabled={scalarControlDisabled("chat.previewCount")}
        onChange={(value) => setPreviewCount(Number(value))}
      />
    ),
    "chat.sorting": (
      <ChatSortingControl
        projectOrder={input.settings.sidebarProjectSortOrder}
        threadOrder={input.settings.sidebarThreadSortOrder}
        disabled={scalarControlDisabled("chat.sorting")}
        translate={input.translate}
        updateSettings={input.updateSettings}
      />
    ),
    "chat.settling": (
      <ChatSettlingControl
        days={input.settings.sidebarAutoSettleAfterDays}
        settleOnMerge={input.settings.sidebarAutoSettleOnMerge}
        disabled={scalarControlDisabled("chat.settling")}
        translate={input.translate}
        updateSettings={input.updateSettings}
      />
    ),
    "voice.outputLanguage": (
      <BetterT3SelectControl<VoiceInputOutputLanguage>
        value={input.settings.voiceInputOutputLanguage}
        options={(["native", "english"] as const).map((value) => ({
          value,
          label: input.translate(
            value === "native"
              ? "settings.betterT3.value.nativeLanguage"
              : "settings.betterT3.value.english",
          ),
        }))}
        ariaLabel={input.translate("betterT3.voice.outputLanguage.label")}
        disabled={scalarControlDisabled("voice.outputLanguage")}
        onChange={(value) =>
          input.updateSettings(
            buildBetterT3ScalarControlPatch({ id: "voice.outputLanguage", value }),
          )
        }
      />
    ),
  } satisfies Record<WebBetterT3PreparedControlId, ReactNode>;
}
