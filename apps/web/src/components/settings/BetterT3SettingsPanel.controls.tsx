import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
  type BetterT3FeatureControlStateV1,
  type BetterT3FeatureId,
  type CavemanMode,
  type ChatVisualMode,
  type ClientSettingsPatch,
  type EnvironmentId,
  type KnowledgeGraphStatusV1,
  type ModelSelection,
  type ProjectId,
  type ServerProvider,
  type ServerSettingsPatch,
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
  type ScopedThreadRef,
  type ThreadId,
  type UnifiedSettings,
  type VoiceInputOutputLanguage,
} from "@t3tools/contracts";
import { isFetchCapableProvider } from "@t3tools/shared/fetchMode";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { createModelSelection, stripAutoReasoning } from "@t3tools/shared/model";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { useChatVisualMode, useSetChatVisualMode } from "../../chatVisualModeSync";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useProjectThreadPreviewCount } from "../../projectThreadPreviewSync";
import { useProjects, useThreadShells } from "../../state/entities";
import { knowledgeGraphEnvironment } from "../../state/knowledgeGraph";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRightPanelStore } from "../../rightPanelStore";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

type BetterT3SettingsPatch = ClientSettingsPatch & ServerSettingsPatch;
type Translate = InterfaceTranslator["message"];

export const WEB_BETTER_T3_PREPARED_CONTROL_IDS = [
  "agent.fetchModel",
  "agent.autoReasoningModel",
  "agent.parallelPlanReviewer",
  "agent.cavemanMode",
  "chat.presentation",
  "chat.previewCount",
  "chat.sorting",
  "chat.settling",
  "voice.outputLanguage",
  "knowledge.model",
  "knowledge.progress",
  "knowledge.rebuild",
  "knowledge.pause",
  "knowledge.clear",
] as const satisfies ReadonlyArray<BetterT3FeatureId>;

type WebBetterT3PreparedControlId = (typeof WEB_BETTER_T3_PREPARED_CONTROL_IDS)[number];

type BetterT3ScalarControlUpdate =
  | { readonly id: "agent.cavemanMode"; readonly value: CavemanMode }
  | { readonly id: "chat.sorting.projects"; readonly value: SidebarProjectSortOrder }
  | { readonly id: "chat.sorting.threads"; readonly value: SidebarThreadSortOrder }
  | { readonly id: "chat.settling.days"; readonly value: number | null }
  | { readonly id: "chat.settling.onMerge"; readonly value: boolean }
  | { readonly id: "voice.outputLanguage"; readonly value: VoiceInputOutputLanguage };

interface KnowledgeGraphProjectOption {
  readonly projectId: ProjectId;
  readonly label: string;
}

export interface KnowledgeGraphOwnerThreadOption {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

const SETTLE_DAY_OPTIONS = [1, 3, 7, 14, 30, 90] as const;

export function buildBetterT3ScalarControlPatch(
  update: BetterT3ScalarControlUpdate,
): BetterT3SettingsPatch {
  switch (update.id) {
    case "agent.cavemanMode":
      return { agentEnhancement: { cavemanMode: update.value } };
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

export function resolveSelectedKnowledgeGraphProjectId(
  projects: ReadonlyArray<KnowledgeGraphProjectOption>,
  requestedProjectId: ProjectId | null,
): ProjectId | null {
  if (
    requestedProjectId !== null &&
    projects.some((project) => project.projectId === requestedProjectId)
  ) {
    return requestedProjectId;
  }
  return projects[0]?.projectId ?? null;
}

export function resolveKnowledgeGraphPauseAction(state: KnowledgeGraphStatusV1["state"] | null): {
  readonly paused: boolean;
  readonly messageId: "knowledgeGraph.pause" | "knowledgeGraph.resume";
} {
  return state === "paused"
    ? { paused: false, messageId: "knowledgeGraph.resume" }
    : { paused: true, messageId: "knowledgeGraph.pause" };
}

export function knowledgeGraphOwnerThreadKey(
  thread: Pick<KnowledgeGraphOwnerThreadOption, "environmentId" | "id">,
): string {
  return JSON.stringify([thread.environmentId, thread.id]);
}

export function buildKnowledgeGraphOwnerThreadOptions(
  threads: ReadonlyArray<KnowledgeGraphOwnerThreadOption>,
  environmentId: EnvironmentId,
): ReadonlyArray<KnowledgeGraphOwnerThreadOption> {
  return threads
    .filter((thread) => thread.environmentId === environmentId && thread.archivedAt === null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function resolveSelectedKnowledgeGraphOwnerThread(
  options: ReadonlyArray<KnowledgeGraphOwnerThreadOption>,
  selectedKey: string | null,
): KnowledgeGraphOwnerThreadOption | null {
  if (selectedKey === null) return null;
  return options.find((option) => knowledgeGraphOwnerThreadKey(option) === selectedKey) ?? null;
}

export function openKnowledgeGraphOwnerThread(
  thread: KnowledgeGraphOwnerThreadOption,
  open: (threadRef: ScopedThreadRef, kind: "knowledge-graph") => void,
): { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  open(threadRef, "knowledge-graph");
  return { environmentId: threadRef.environmentId, threadId: threadRef.threadId };
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

export function supportsKnowledgeGraphEnrichment(
  provider: Pick<ServerProvider, "driver">,
): boolean {
  return provider.driver === "openai";
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
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    props.settings,
    props.providers,
    resolvedSelection.instanceId,
    resolvedSelection.model,
  );
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
      <ProviderModelPicker
        activeInstanceId={resolvedSelection.instanceId}
        model={resolvedSelection.model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={modelOptionsByInstance}
        disabled={props.disabled}
        triggerVariant="outline"
        triggerClassName="min-w-0 max-w-56 shrink-0 text-foreground/90 hover:text-foreground"
        triggerAriaLabel={props.translate(`betterT3.${props.featureId}.label`)}
        onInstanceModelChange={(instanceId, model) =>
          props.onChange(createModelSelection(instanceId, model))
        }
      />
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

function KnowledgeGraphProjectSelect(props: {
  readonly projects: ReadonlyArray<KnowledgeGraphProjectOption>;
  readonly selectedProjectId: ProjectId | null;
  readonly disabled: boolean;
  readonly translate: Translate;
  readonly onChange: (projectId: ProjectId) => void;
}) {
  const selected = props.projects.find((project) => project.projectId === props.selectedProjectId);
  if (!selected) {
    return (
      <span className="text-xs text-muted-foreground">
        {props.translate("settings.betterT3.value.unavailable")}
      </span>
    );
  }
  return (
    <Select
      value={selected.projectId}
      disabled={props.disabled}
      onValueChange={(value) => {
        const project = props.projects.find((candidate) => candidate.projectId === value);
        if (project) props.onChange(project.projectId);
      }}
    >
      <SelectTrigger
        size="sm"
        className="max-w-52"
        aria-label={props.translate("knowledgeGraph.title")}
      >
        <SelectValue>{selected.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end">
        {props.projects.map((project) => (
          <SelectItem key={project.projectId} value={project.projectId}>
            {project.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function KnowledgeGraphStatusControl(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly translate: Translate;
}) {
  const result = useAtomValue(
    knowledgeGraphEnvironment.state({
      environmentId: props.environmentId,
      input: { scope: { projectId: props.projectId } },
    }),
  );
  const snapshot = Option.getOrNull(AsyncResult.value(result))?.snapshot ?? null;
  if (result._tag === "Failure") {
    return <span className="text-xs text-danger">{props.translate("knowledgeGraph.error")}</span>;
  }
  if (!snapshot) {
    return (
      <span className="text-xs text-muted-foreground">
        {props.translate("knowledgeGraph.loading")}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground" aria-live="polite">
      {props.translate(`knowledgeGraph.status.${snapshot.status.state}`)} ·{" "}
      {props.translate("knowledgeGraph.indexedFileCount", {
        count: snapshot.status.indexedFileCount,
      })}
      {" · "}
      {props.translate("knowledgeGraph.nodeCount", { count: snapshot.status.nodeCount })}
    </span>
  );
}

function KnowledgeGraphPauseControl(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly disabled: boolean;
  readonly translate: Translate;
}) {
  const result = useAtomValue(
    knowledgeGraphEnvironment.state({
      environmentId: props.environmentId,
      input: { scope: { projectId: props.projectId } },
    }),
  );
  const snapshot = Option.getOrNull(AsyncResult.value(result))?.snapshot ?? null;
  const pause = useAtomCommand(knowledgeGraphEnvironment.pause, "Knowledge Graph pause");
  const action = resolveKnowledgeGraphPauseAction(snapshot?.status.state ?? null);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={props.disabled || snapshot === null}
      onClick={() =>
        void pause({
          environmentId: props.environmentId,
          input: { scope: { projectId: props.projectId }, paused: action.paused },
        })
      }
    >
      {props.translate(action.messageId)}
    </Button>
  );
}

function KnowledgeGraphRebuildControl(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly disabled: boolean;
  readonly translate: Translate;
}) {
  const rebuild = useAtomCommand(knowledgeGraphEnvironment.rebuild, "Knowledge Graph rebuild");
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={props.disabled}
      onClick={() =>
        void rebuild({
          environmentId: props.environmentId,
          input: { scope: { projectId: props.projectId }, mode: "full" },
        })
      }
    >
      {props.translate("knowledgeGraph.rebuild")}
    </Button>
  );
}

function KnowledgeGraphOwnerControl(props: {
  readonly threads: ReadonlyArray<KnowledgeGraphOwnerThreadOption>;
  readonly disabled: boolean;
  readonly translate: Translate;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = resolveSelectedKnowledgeGraphOwnerThread(props.threads, selectedKey);
  if (props.threads.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {props.translate("settings.betterT3.knowledgeOwner.empty")}
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <Select
        value={selected ? selectedKey : null}
        disabled={props.disabled}
        onValueChange={setSelectedKey}
      >
        <SelectTrigger
          size="sm"
          className="w-full max-w-72 sm:w-72"
          aria-label={props.translate("settings.betterT3.knowledgeOwner.selectThread")}
        >
          <SelectValue>
            {selected?.title ?? props.translate("settings.betterT3.knowledgeOwner.selectThread")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="end">
          {props.threads.map((thread) => (
            <SelectItem
              key={knowledgeGraphOwnerThreadKey(thread)}
              value={knowledgeGraphOwnerThreadKey(thread)}
            >
              {thread.title}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {selected ? (
        <Button
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId: selected.environmentId, threadId: selected.id }}
            />
          }
          size="xs"
          variant="outline"
          disabled={props.disabled}
          onClick={() =>
            openKnowledgeGraphOwnerThread(selected, (threadRef, kind) =>
              useRightPanelStore.getState().open(threadRef, kind),
            )
          }
        >
          {props.translate("settings.betterT3.knowledgeOwner.open")}
        </Button>
      ) : null}
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
  const projects = useProjects();
  const threads = useThreadShells();
  const projectOptions = useMemo(
    () =>
      projects
        .filter((project) => project.environmentId === input.environmentId)
        .map((project) => ({ projectId: project.id, label: project.title })),
    [input.environmentId, projects],
  );
  const [requestedProjectId, setRequestedProjectId] = useState<ProjectId | null>(null);
  const selectedProjectId = resolveSelectedKnowledgeGraphProjectId(
    projectOptions,
    requestedProjectId,
  );
  const selectedProjectControl = (
    <KnowledgeGraphProjectSelect
      projects={projectOptions}
      selectedProjectId={selectedProjectId}
      disabled={!availableFeature(input.features, "knowledge.progress")}
      translate={input.translate}
      onChange={setRequestedProjectId}
    />
  );
  const knowledgeGraphOwnerThreads = useMemo(
    () => buildKnowledgeGraphOwnerThreadOptions(threads, input.environmentId),
    [input.environmentId, threads],
  );
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
    "chat.previewCount": (
      <BetterT3SelectControl
        value={String(previewCount)}
        options={Array.from(
          {
            length: MAX_SIDEBAR_THREAD_PREVIEW_COUNT - MIN_SIDEBAR_THREAD_PREVIEW_COUNT + 1,
          },
          (_, index) => {
            const value = MIN_SIDEBAR_THREAD_PREVIEW_COUNT + index;
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
    "knowledge.model": (
      <BetterT3ModelSelectionControl
        featureId="knowledge.model"
        settings={input.settings}
        providers={input.providers}
        selection={input.settings.knowledgeGraphModelSelection}
        fallbackSelection={input.settings.textGenerationModelSelection}
        allowAutomatic
        disabled={scalarControlDisabled("knowledge.model")}
        predicate={supportsKnowledgeGraphEnrichment}
        translate={input.translate}
        onChange={(knowledgeGraphModelSelection) =>
          input.updateSettings({ knowledgeGraphModelSelection })
        }
      />
    ),
    "knowledge.progress": (
      <div className="flex max-w-md flex-wrap items-center justify-end gap-2">
        {selectedProjectControl}
        {selectedProjectId ? (
          <KnowledgeGraphStatusControl
            environmentId={input.environmentId}
            projectId={selectedProjectId}
            translate={input.translate}
          />
        ) : null}
      </div>
    ),
    "knowledge.rebuild": selectedProjectId ? (
      <KnowledgeGraphRebuildControl
        environmentId={input.environmentId}
        projectId={selectedProjectId}
        disabled={scalarControlDisabled("knowledge.rebuild")}
        translate={input.translate}
      />
    ) : (
      selectedProjectControl
    ),
    "knowledge.pause": selectedProjectId ? (
      <KnowledgeGraphPauseControl
        environmentId={input.environmentId}
        projectId={selectedProjectId}
        disabled={scalarControlDisabled("knowledge.pause")}
        translate={input.translate}
      />
    ) : (
      selectedProjectControl
    ),
    "knowledge.clear": (
      <KnowledgeGraphOwnerControl
        threads={knowledgeGraphOwnerThreads}
        disabled={scalarControlDisabled("knowledge.clear")}
        translate={input.translate}
      />
    ),
  } satisfies Record<WebBetterT3PreparedControlId, ReactNode>;
}
