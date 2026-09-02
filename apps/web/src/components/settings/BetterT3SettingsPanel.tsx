import type {
  BetterT3FeatureControlStateV1,
  BetterT3FeatureId,
  BetterT3FeatureSection,
  BetterT3SettingsInitialization,
  BetterT3SwitchFeatureId,
  EnvironmentId,
} from "@t3tools/contracts";
import { BETTER_T3_FEATURE_REGISTRY, type SidebarPosition } from "@t3tools/contracts";
import {
  prepareBetterT3StatusModel,
  type BetterT3PreparedStatusModel,
  type BetterT3PreparedStatusState,
} from "@t3tools/client-runtime/better-t3-status";
import {
  isInterfaceMessageKey,
  type InterfaceMessageKey,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useChatVisualMode, useSetChatVisualMode } from "../../chatVisualModeSync";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import {
  useClientSettings,
  useEnvironmentSettings,
  useUpdateEnvironmentSettings,
} from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import {
  buildBetterT3ControlStates,
  buildBetterT3SwitchSettingsPatch,
  resolveBetterT3DescriptorMessageKeys,
  resolveSelectedBetterT3EnvironmentId,
} from "./BetterT3SettingsPanel.logic";
import {
  useBetterT3PreparedControls,
  WEB_BETTER_T3_PREPARED_CONTROL_IDS,
} from "./BetterT3SettingsPanel.controls";
import {
  BETTER_T3_VISUAL_FEATURE_IDS,
  BetterT3FeatureChoice,
  type BetterT3VisualChoiceValue,
} from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";
import { InterfaceLanguageSetting } from "./InterfaceLanguageSetting";
import { requireSettingsEnvironment } from "./settingsEnvironment";

type Translate = InterfaceTranslator["message"];

const BETTER_T3_SECTIONS = [
  "agent-workflows",
  "chat-layout",
  "workspace-source-control",
  "voice-synchronization",
  "knowledge-automation",
  "resource-protection",
  "integration-status",
] as const satisfies ReadonlyArray<BetterT3FeatureSection>;

export type BetterT3SettingsTabId =
  | "general"
  | "agents"
  | "visual"
  | "workspace"
  | "voice"
  | "knowledge"
  | "system"
  | "integrations";

export const BETTER_T3_SETTINGS_TABS = [
  { id: "general", section: null, labelMessageId: "settings.betterT3.tab.general" },
  { id: "agents", section: "agent-workflows", labelMessageId: "settings.betterT3.tab.agents" },
  { id: "visual", section: "chat-layout", labelMessageId: "settings.betterT3.tab.visual" },
  {
    id: "workspace",
    section: "workspace-source-control",
    labelMessageId: "settings.betterT3.tab.workspace",
  },
  {
    id: "voice",
    section: "voice-synchronization",
    labelMessageId: "settings.betterT3.tab.voice",
  },
  {
    id: "knowledge",
    section: "knowledge-automation",
    labelMessageId: "settings.betterT3.tab.knowledge",
  },
  {
    id: "system",
    section: "resource-protection",
    labelMessageId: "settings.betterT3.tab.system",
  },
  {
    id: "integrations",
    section: "integration-status",
    labelMessageId: "settings.betterT3.tab.integrations",
  },
] as const satisfies ReadonlyArray<{
  readonly id: BetterT3SettingsTabId;
  readonly section: BetterT3FeatureSection | null;
  readonly labelMessageId: InterfaceMessageKey;
}>;

export const BETTER_T3_ADVANCED_FEATURE_IDS: ReadonlySet<BetterT3FeatureId> = new Set([
  "agent.fetchModel",
  "agent.parallelPlanReviewer",
  "agent.autoReasoningModel",
  "agent.cavemanMode",
  "chat.cardMorphing",
  "chat.previewCount",
  "chat.sorting",
  "chat.settling",
  "chat.shiftClickShowLess",
  "workspace.checkpoints",
  "workspace.chatPortability",
  "voice.outputLanguage",
  "voice.transcriptPortability",
  "voice.credentials",
  "knowledge.model",
  "knowledge.progress",
  "knowledge.rebuild",
  "knowledge.pause",
  "knowledge.clear",
  "resource.diagnostics",
  "integration.mcp",
  "integration.skills",
]);

export function resolveBetterT3SettingsSearchTarget(
  targetId: string | null,
): { readonly tabId: BetterT3SettingsTabId; readonly advanced: boolean } | null {
  if (targetId === "better-t3-interface" || targetId === "better-t3-interface-language") {
    return { tabId: "general", advanced: false };
  }
  const descriptor = BETTER_T3_FEATURE_REGISTRY.find((feature) => feature.id === targetId);
  if (!descriptor) return null;
  const tab = BETTER_T3_SETTINGS_TABS.find((candidate) => candidate.section === descriptor.section);
  if (!tab) return null;
  return {
    tabId: tab.id,
    advanced: BETTER_T3_ADVANCED_FEATURE_IDS.has(descriptor.id),
  };
}

export interface BetterT3SettingsPanelViewProps {
  readonly features: ReadonlyArray<BetterT3FeatureControlStateV1>;
  readonly sectionTitles: Readonly<Record<BetterT3FeatureSection, string>>;
  readonly translate: Translate;
  readonly controls: Partial<Record<BetterT3FeatureId, ReactNode>>;
  readonly onSwitchChange: (featureId: BetterT3SwitchFeatureId, enabled: boolean) => void;
  readonly introduction?: ReactNode;
  readonly languageControl?: ReactNode;
  readonly featureVisuals?: Partial<Record<BetterT3FeatureId, ReactNode>>;
  readonly featureChoices?: Partial<Record<BetterT3FeatureId, ReactNode>>;
}

const availabilityStatus = (
  feature: BetterT3FeatureControlStateV1,
  translate: Translate,
): string | null => {
  if (feature.availability.state === "available") return null;
  const fallbackMessageId: InterfaceMessageKey = `settings.betterT3.availability.${feature.availability.state}`;
  const reasonMessageId = feature.availability.reasonMessageId;
  return translate(
    reasonMessageId && isInterfaceMessageKey(reasonMessageId) ? reasonMessageId : fallbackMessageId,
  );
};

function FeatureControl({
  feature,
  control,
  translate,
  onSwitchChange,
}: {
  readonly feature: BetterT3FeatureControlStateV1;
  readonly control: ReactNode;
  readonly translate: BetterT3SettingsPanelViewProps["translate"];
  readonly onSwitchChange: BetterT3SettingsPanelViewProps["onSwitchChange"];
}) {
  if (feature.descriptor.controlKind !== "switch") return control;
  const featureId = feature.descriptor.id as BetterT3SwitchFeatureId;
  const messageIds = resolveBetterT3DescriptorMessageKeys(feature.descriptor);
  return (
    <Switch
      checked={feature.value === true}
      disabled={feature.availability.state !== "available"}
      aria-label={translate(messageIds.labelMessageId)}
      onCheckedChange={(checked) => onSwitchChange(featureId, Boolean(checked))}
    />
  );
}

function BetterT3InterfaceSection(props: {
  readonly control: ReactNode;
  readonly translate: Translate;
}) {
  return (
    <SettingsSection
      id="better-t3-interface"
      title={props.translate("settings.betterT3.section.interface")}
    >
      {props.control}
    </SettingsSection>
  );
}

function BetterT3SettingsTabs(props: BetterT3SettingsPanelViewProps) {
  const searchTargetId = useSettingsSearchTargetId();
  const initialSearchTarget = resolveBetterT3SettingsSearchTarget(searchTargetId);
  const [activeTab, setActiveTab] = useState<BetterT3SettingsTabId>(
    initialSearchTarget?.tabId ?? "general",
  );
  const [advancedOpen, setAdvancedOpen] = useState(initialSearchTarget?.advanced ?? false);

  useEffect(() => {
    const searchTarget = resolveBetterT3SettingsSearchTarget(searchTargetId);
    if (!searchTarget) return;
    setActiveTab(searchTarget.tabId);
    if (searchTarget.advanced) setAdvancedOpen(true);
  }, [searchTargetId]);

  const activeTabDefinition =
    BETTER_T3_SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? BETTER_T3_SETTINGS_TABS[0];
  const sectionFeatures =
    activeTabDefinition.section === null
      ? []
      : props.features.filter(
          (feature) => feature.descriptor.section === activeTabDefinition.section,
        );
  const basicFeatures = sectionFeatures.filter(
    (feature) => !BETTER_T3_ADVANCED_FEATURE_IDS.has(feature.descriptor.id),
  );
  const advancedFeatures = sectionFeatures.filter((feature) =>
    BETTER_T3_ADVANCED_FEATURE_IDS.has(feature.descriptor.id),
  );
  const renderFeatureRows = (visibleFeatures: ReadonlyArray<BetterT3FeatureControlStateV1>) =>
    visibleFeatures.map((feature) => {
      const messageIds = resolveBetterT3DescriptorMessageKeys(feature.descriptor);
      const featureChoice = props.featureChoices?.[feature.descriptor.id];
      return (
        <SettingsRow
          key={feature.descriptor.id}
          id={feature.descriptor.id}
          data-better-t3-feature={feature.descriptor.id}
          title={props.translate(messageIds.labelMessageId)}
          description={props.translate(messageIds.descriptionMessageId)}
          status={availabilityStatus(feature, props.translate)}
          visual={featureChoice ? null : props.featureVisuals?.[feature.descriptor.id]}
          control={
            featureChoice ? null : (
              <FeatureControl
                feature={feature}
                control={props.controls[feature.descriptor.id] ?? null}
                translate={props.translate}
                onSwitchChange={props.onSwitchChange}
              />
            )
          }
        >
          {featureChoice}
        </SettingsRow>
      );
    });

  return (
    <div className="min-w-0 space-y-8">
      <div
        aria-label={props.translate("settings.betterT3.title")}
        className="mx-3 flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-border/60 bg-background/30 p-1 sm:mx-4"
        role="tablist"
      >
        {BETTER_T3_SETTINGS_TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              role="tab"
              aria-controls={`better-t3-tabpanel-${tab.id}`}
              aria-selected={selected}
              className={`inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
              id={`better-t3-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {props.translate(tab.labelMessageId)}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`better-t3-tab-${activeTab}`}
        id={`better-t3-tabpanel-${activeTab}`}
        role="tabpanel"
      >
        {activeTabDefinition.section === null ? (
          props.languageControl ? (
            <BetterT3InterfaceSection control={props.languageControl} translate={props.translate} />
          ) : null
        ) : (
          <SettingsSection title={props.sectionTitles[activeTabDefinition.section]}>
            {renderFeatureRows(basicFeatures)}
            {advancedFeatures.length > 0 ? (
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger
                  className="group flex min-h-10 w-full items-center gap-2 border-t border-border/60 px-3 pt-3 text-left text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
                  data-better-t3-advanced-trigger
                  type="button"
                >
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 transition-transform duration-200 group-data-panel-open:rotate-90"
                  />
                  {props.translate("settings.betterT3.advancedSettings")}
                </CollapsibleTrigger>
                <CollapsiblePanel data-better-t3-advanced-panel>
                  <div className="space-y-1 pt-2">{renderFeatureRows(advancedFeatures)}</div>
                </CollapsiblePanel>
              </Collapsible>
            ) : null}
          </SettingsSection>
        )}
      </div>
    </div>
  );
}

export function BetterT3SettingsPanelView(props: BetterT3SettingsPanelViewProps) {
  return (
    <SettingsPageContainer>
      {props.introduction}
      <BetterT3SettingsTabs {...props} />
    </SettingsPageContainer>
  );
}

type BetterT3Destination =
  | "/settings/general"
  | "/settings/projects"
  | "/settings/appearance"
  | "/settings/mcp"
  | "/settings/skills"
  | "/settings/integrations"
  | "/settings/source-control"
  | "/settings/import-chats"
  | "/settings/connections"
  | "/settings/diagnostics";

export function resolveBetterT3ControlDestination(
  featureId: BetterT3FeatureId,
): BetterT3Destination | null {
  if (featureId === "workspace.checkpoints") return "/settings/projects";
  if (featureId === "workspace.chatPortability") return "/settings/projects";
  if (featureId === "voice.transcriptPortability") return "/settings/projects";
  if (featureId === "voice.credentials") return "/settings/connections";
  if (featureId === "workspace.gitWorkbench") return "/settings/source-control";
  if (featureId === "integration.mcp") return "/settings/mcp";
  if (featureId === "integration.skills") return "/settings/skills";
  if (featureId === "resource.diagnostics") return "/settings/diagnostics";
  if (featureId.startsWith("chat.")) return "/settings/appearance";
  if (featureId.startsWith("voice.")) return "/settings/general";
  if (featureId.startsWith("integration.")) return "/settings/integrations";
  if (featureId.startsWith("agent.")) return "/settings/general";
  return null;
}

export type WebBetterT3ControlRenderingPath =
  | "switch"
  | "prepared-control"
  | "sidebar-position"
  | "status"
  | "deep-link"
  | "missing";

const WEB_PREPARED_CONTROL_IDS = new Set<BetterT3FeatureId>(WEB_BETTER_T3_PREPARED_CONTROL_IDS);

export function resolveWebBetterT3ControlRenderingPath(
  feature: Pick<BetterT3FeatureControlStateV1["descriptor"], "id" | "controlKind">,
): WebBetterT3ControlRenderingPath {
  if (feature.controlKind === "switch") return "switch";
  if (WEB_PREPARED_CONTROL_IDS.has(feature.id)) return "prepared-control";
  if (feature.id === "chat.sidebarPosition") return "sidebar-position";
  if (feature.controlKind === "status-only") return "status";
  if (resolveBetterT3ControlDestination(feature.id) !== null) return "deep-link";
  return "missing";
}

function CapabilityControl(props: {
  readonly feature: BetterT3FeatureControlStateV1;
  readonly translate: Translate;
}) {
  const destination = resolveBetterT3ControlDestination(props.feature.descriptor.id);
  const disabled = props.feature.availability.state !== "available";
  if (props.feature.descriptor.controlKind === "status-only" || destination === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {props.translate(`settings.betterT3.availability.${props.feature.availability.state}`)}
      </span>
    );
  }
  return (
    <Button render={<Link to={destination} />} size="xs" variant="outline" disabled={disabled}>
      {props.translate(
        props.feature.descriptor.controlKind === "link"
          ? "settings.betterT3.control.open"
          : "settings.betterT3.control.configure",
      )}
    </Button>
  );
}

type BetterT3PreparedStatusFeatureId =
  | "workspace.checkpoints"
  | "integration.remoteReadiness"
  | "integration.analyticsRemoval"
  | "integration.lifecycleHealth"
  | "integration.mcp"
  | "integration.skills"
  | "integration.compatibility";

export function resolveBetterT3PreparedStatusMessageId(input: {
  readonly featureId: BetterT3PreparedStatusFeatureId;
  readonly state: BetterT3PreparedStatusState;
  readonly connectionPhase?: EnvironmentPresentation["connection"]["phase"];
}): InterfaceMessageKey {
  if (input.featureId === "integration.analyticsRemoval") {
    return "settings.betterT3.status.analyticsRemoved";
  }
  if (input.featureId === "integration.remoteReadiness" && input.state === "ready") {
    return "settings.betterT3.status.remoteReady";
  }
  if (input.featureId === "integration.remoteReadiness" && input.state === "degraded") {
    return "settings.betterT3.status.remoteLimited";
  }
  if (input.featureId === "integration.lifecycleHealth") {
    if (input.state === "ready") return "settings.betterT3.status.lifecycleHealthy";
    if (input.connectionPhase === "connecting" || input.connectionPhase === "reconnecting") {
      return "settings.betterT3.status.lifecycleReconnecting";
    }
    if (input.state === "unavailable" || input.state === "degraded") {
      return "settings.betterT3.status.lifecycleAttention";
    }
  }
  if (input.featureId === "integration.compatibility") {
    if (input.state === "ready") return "settings.betterT3.status.compatibilityCurrent";
    if (input.state === "degraded") return "settings.betterT3.status.compatibilityLimited";
  }
  if (input.state === "ready") return "settings.betterT3.status.supported";
  if (input.state === "disabled") return "settings.betterT3.control.statusDisabled";
  if (input.state === "unsupported") return "settings.betterT3.status.unsupported";
  if (input.state === "project-required") return "settings.betterT3.status.projectRequired";
  if (input.state === "unavailable") return "settings.betterT3.availability.unavailable";
  return "settings.betterT3.status.unknown";
}

export function resolveBetterT3PreparedStatusText(input: {
  readonly featureId: BetterT3PreparedStatusFeatureId;
  readonly statuses: BetterT3PreparedStatusModel;
  readonly connectionPhase: EnvironmentPresentation["connection"]["phase"];
  readonly translate: Translate;
}): string {
  const status = input.statuses[input.featureId];
  const baseStatus = input.translate(
    resolveBetterT3PreparedStatusMessageId({
      featureId: input.featureId,
      state: status.state,
      connectionPhase: input.connectionPhase,
    }),
  );

  if (input.featureId === "integration.mcp") {
    const configuredCount = input.statuses["integration.mcp"].configuredCount;
    return configuredCount === null
      ? baseStatus
      : input.translate("settings.betterT3.status.mcpConfiguredCount", {
          status: baseStatus,
          count: configuredCount,
        });
  }

  if (input.featureId === "integration.skills") {
    const skills = input.statuses["integration.skills"];
    if (skills.advertisedCount === null) return baseStatus;
    if (skills.loadedCount === null) {
      return input.translate("settings.betterT3.status.skillsAdvertised", {
        enabled: skills.advertisedEnabledCount ?? 0,
        total: skills.advertisedCount,
      });
    }
    return input.translate("settings.betterT3.status.skillsSummary", {
      advertised: skills.advertisedCount,
      loaded: skills.loadedCount,
    });
  }

  if (input.featureId === "integration.compatibility") {
    const compatibility = input.statuses["integration.compatibility"];
    return input.translate("settings.betterT3.status.compatibilityCount", {
      status: baseStatus,
      supported: compatibility.supportedFeatureCount,
      total: compatibility.totalFeatureCount,
    });
  }

  return baseStatus;
}

function BetterT3PreparedStatusControl(props: {
  readonly status: string;
  readonly destination?: BetterT3Destination;
  readonly translate: Translate;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">{props.status}</span>
      {props.destination ? (
        <Button render={<Link to={props.destination} />} size="xs" variant="outline">
          {props.translate("settings.betterT3.control.open")}
        </Button>
      ) : null}
    </div>
  );
}

function SidebarPositionControl(props: {
  readonly value: SidebarPosition;
  readonly disabled: boolean;
  readonly onChange: (value: SidebarPosition) => void;
  readonly translate: Translate;
}) {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value === "left" || value === "right") props.onChange(value);
      }}
    >
      <SelectTrigger
        size="sm"
        className="w-32"
        aria-label={props.translate("settings.betterT3.sidebarPosition.label")}
      >
        <SelectValue>
          {props.translate(`settings.betterT3.sidebarPosition.${props.value}`)}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end">
        <SelectItem value="left">
          {props.translate("settings.betterT3.sidebarPosition.left")}
        </SelectItem>
        <SelectItem value="right">
          {props.translate("settings.betterT3.sidebarPosition.right")}
        </SelectItem>
      </SelectPopup>
    </Select>
  );
}

export interface BetterT3EnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

function initializationMessageId(
  initialization: BetterT3SettingsInitialization,
): "settings.betterT3.initialization.clean" | "settings.betterT3.initialization.existing" {
  return initialization === "clean-install"
    ? "settings.betterT3.initialization.clean"
    : "settings.betterT3.initialization.existing";
}

export function BetterT3SettingsIntroduction(props: {
  readonly environmentOptions: ReadonlyArray<BetterT3EnvironmentOption>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly deviceInitialization: BetterT3SettingsInitialization;
  readonly environmentInitialization: BetterT3SettingsInitialization | null;
  readonly translate: Translate;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
}) {
  const selectedEnvironment = props.environmentOptions.find(
    (option) => option.environmentId === props.selectedEnvironmentId,
  );
  return (
    <div
      data-better-t3-introduction
      className="mx-3 overflow-hidden rounded-2xl border border-border/60 bg-card/45 shadow-[0_18px_60px_-46px_rgb(0_0_0/75%)] sm:mx-4"
    >
      <div className="space-y-1.5 bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_58%)] p-4 sm:p-5">
        <h1 className="text-xl font-semibold tracking-[-0.025em]">
          {props.translate("settings.betterT3.title")}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {props.translate("settings.betterT3.description")}
        </p>
      </div>
      <div className="grid gap-3 border-t border-border/50 bg-muted/15 p-4 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center sm:px-5">
        {selectedEnvironment ? (
          <Select
            value={selectedEnvironment.environmentId}
            onValueChange={(value) => {
              const option = props.environmentOptions.find(
                (candidate) => candidate.environmentId === value,
              );
              if (option) props.onEnvironmentChange(option.environmentId);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full max-w-72 bg-background/70"
              aria-label={props.translate("settings.betterT3.selectEnvironment")}
            >
              <SelectValue>{selectedEnvironment.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start">
              {props.environmentOptions.map((option) => (
                <SelectItem key={option.environmentId} value={option.environmentId}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            {props.translate("settings.betterT3.noEnvironment")}
          </p>
        )}
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground sm:justify-end">
          <span
            data-better-t3-scope="device"
            className="rounded-full border border-border/60 bg-background/65 px-2.5 py-1"
          >
            {props.translate("settings.betterT3.deviceScope")}:{" "}
            {props.translate(initializationMessageId(props.deviceInitialization))}
          </span>
          {props.environmentInitialization ? (
            <span
              data-better-t3-scope="environment"
              className="rounded-full border border-border/60 bg-background/65 px-2.5 py-1"
            >
              {props.translate("settings.betterT3.environmentScope")}:{" "}
              {props.translate(initializationMessageId(props.environmentInitialization))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SelectedEnvironmentBetterT3SettingsPanel(props: {
  readonly environment: EnvironmentPresentation;
  readonly environmentOptions: ReadonlyArray<BetterT3EnvironmentOption>;
  readonly deviceInitialization: BetterT3SettingsInitialization;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
}) {
  const settings = useEnvironmentSettings(props.environment.environmentId);
  const updateSettings = useUpdateEnvironmentSettings(props.environment.environmentId);
  const translator = useInterfaceTranslator();
  const translate = useCallback<Translate>(
    (messageId, values) => translator.message(messageId, values),
    [translator],
  );
  const capabilities = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(props.environment.serverConfig?.environment.capabilities ?? {}).filter(
          (entry): entry is [string, number | boolean] =>
            typeof entry[1] === "number" || typeof entry[1] === "boolean",
        ),
      ),
    [props.environment.serverConfig?.environment.capabilities],
  );
  const environmentAvailable =
    props.environment.connection.phase === "connected" && props.environment.serverConfig !== null;
  const welcomeQuery = useEnvironmentQuery(
    environmentAvailable
      ? serverEnvironment.welcome({
          environmentId: props.environment.environmentId,
          input: {},
        })
      : null,
  );
  const loadedSkillsQuery = useQuery({
    queryKey: ["better-t3", props.environment.environmentId, "loaded-skills"],
    queryFn: () =>
      requireSettingsEnvironment({
        primaryEnvironmentId: null,
        selectedEnvironmentId: props.environment.environmentId,
      }).api.skills.list({ includeBody: false, forceReload: false }),
    enabled:
      environmentAvailable &&
      (props.environment.serverConfig?.environment.capabilities.environmentSettingsVersion ?? 0) >=
        1,
    staleTime: 30_000,
    retry: false,
  });
  const features = useMemo(
    () =>
      buildBetterT3ControlStates({
        registry: BETTER_T3_FEATURE_REGISTRY,
        device: settings.betterT3Device,
        environment: settings.betterT3Environment,
        surface: isElectron ? "desktop" : "web",
        capabilities,
        environmentAvailable,
      }),
    [capabilities, environmentAvailable, settings.betterT3Device, settings.betterT3Environment],
  );
  const chatVisualMode = useChatVisualMode();
  const setChatVisualMode = useSetChatVisualMode();
  const previewModel = useMemo(
    () =>
      buildBetterT3SettingsPreviewModel({
        features,
        chatVisualMode,
        sidebarPosition: settings.sidebarPosition,
      }),
    [chatVisualMode, features, settings.sidebarPosition],
  );
  const sectionTitles = useMemo(
    () =>
      Object.fromEntries(
        BETTER_T3_SECTIONS.map((section) => [
          section,
          translate(`settings.betterT3.section.${section}`),
        ]),
      ) as Readonly<Record<BetterT3FeatureSection, string>>,
    [translate],
  );
  const onSwitchChange = useCallback(
    (featureId: BetterT3SwitchFeatureId, enabled: boolean) => {
      const descriptor = BETTER_T3_FEATURE_REGISTRY.find((entry) => entry.id === featureId);
      if (!descriptor) return;
      updateSettings(buildBetterT3SwitchSettingsPatch(featureId, enabled, descriptor.scope));
    },
    [updateSettings],
  );
  const onVisualChoiceChange = useCallback(
    (
      featureId: (typeof BETTER_T3_VISUAL_FEATURE_IDS)[number],
      value: BetterT3VisualChoiceValue,
    ) => {
      if (featureId === "chat.sidebarPosition") {
        if (value === "left" || value === "right") updateSettings({ sidebarPosition: value });
        return;
      }
      if (featureId === "chat.presentation") {
        if (value === "current" || value === "classic") setChatVisualMode(value);
        return;
      }
      if (typeof value === "boolean") onSwitchChange(featureId, value);
    },
    [onSwitchChange, setChatVisualMode, updateSettings],
  );
  const featureChoices = useMemo(() => {
    const choices: Partial<Record<BetterT3FeatureId, ReactNode>> = {};
    for (const featureId of BETTER_T3_VISUAL_FEATURE_IDS) {
      const feature = features.find((entry) => entry.descriptor.id === featureId);
      if (!feature) continue;
      const value =
        featureId === "chat.sidebarPosition"
          ? settings.sidebarPosition
          : featureId === "chat.presentation"
            ? chatVisualMode
            : feature.value === true;
      choices[featureId] = (
        <BetterT3FeatureChoice
          disabled={feature.availability.state !== "available"}
          featureId={featureId}
          key={featureId}
          model={previewModel}
          onChange={(nextValue) => onVisualChoiceChange(featureId, nextValue)}
          translate={translate}
          value={value}
        />
      );
    }
    return choices;
  }, [
    chatVisualMode,
    features,
    onVisualChoiceChange,
    previewModel,
    settings.sidebarPosition,
    translate,
  ]);
  const preparedControls = useBetterT3PreparedControls({
    environmentId: props.environment.environmentId,
    settings,
    providers: props.environment.serverConfig?.providers ?? [],
    features,
    translate,
    updateSettings,
  });
  const preparedStatuses = useMemo(
    () =>
      prepareBetterT3StatusModel({
        surface: isElectron ? "desktop" : "web",
        connectionPhase: props.environment.connection.phase,
        capabilities: props.environment.serverConfig?.environment.capabilities ?? null,
        lifecycleReceipt: welcomeQuery.data === null ? null : "welcome",
        registry: BETTER_T3_FEATURE_REGISTRY,
        mcp: props.environment.serverConfig
          ? { configuredCount: settings.mcp.servers.length, runtimeServers: null }
          : null,
        skills: props.environment.serverConfig
          ? {
              advertisedSkills: props.environment.serverConfig.providers.flatMap(
                (provider) => provider.skills,
              ),
              loadedSkills: loadedSkillsQuery.data?.skills ?? null,
            }
          : null,
        project: null,
        knowledgeGraphStatus: null,
      }),
    [
      loadedSkillsQuery.data?.skills,
      props.environment.connection.phase,
      props.environment.serverConfig,
      settings.mcp.servers.length,
      welcomeQuery.data,
    ],
  );
  const preparedStatusControls = useMemo(() => {
    const controls: Partial<Record<BetterT3FeatureId, ReactNode>> = {};
    const addStatus = (
      featureId: BetterT3PreparedStatusFeatureId,
      destination?: BetterT3Destination,
    ) => {
      controls[featureId] = (
        <BetterT3PreparedStatusControl
          key={featureId}
          {...(destination === undefined ? {} : { destination })}
          status={resolveBetterT3PreparedStatusText({
            featureId,
            statuses: preparedStatuses,
            connectionPhase: props.environment.connection.phase,
            translate,
          })}
          translate={translate}
        />
      );
    };
    addStatus("workspace.checkpoints", "/settings/projects");
    addStatus("integration.remoteReadiness");
    addStatus("integration.analyticsRemoval");
    addStatus("integration.lifecycleHealth");
    addStatus("integration.mcp", "/settings/mcp");
    addStatus("integration.skills", "/settings/skills");
    addStatus("integration.compatibility");
    return controls;
  }, [preparedStatuses, props.environment.connection.phase, translate]);
  const controls = useMemo(() => {
    const entries: Array<readonly [BetterT3FeatureId, ReactNode]> = [];
    for (const feature of features) {
      if (feature.descriptor.controlKind === "switch") continue;
      const preparedStatusControl = preparedStatusControls[feature.descriptor.id];
      if (preparedStatusControl !== undefined) {
        entries.push([feature.descriptor.id, preparedStatusControl]);
        continue;
      }
      const preparedControl = preparedControls[feature.descriptor.id];
      if (preparedControl !== undefined) {
        entries.push([feature.descriptor.id, preparedControl]);
        continue;
      }
      if (feature.descriptor.id === "chat.sidebarPosition") {
        entries.push([
          feature.descriptor.id,
          <SidebarPositionControl
            key={feature.descriptor.id}
            value={settings.sidebarPosition}
            disabled={feature.availability.state !== "available"}
            onChange={(sidebarPosition) => updateSettings({ sidebarPosition })}
            translate={translate}
          />,
        ]);
        continue;
      }
      entries.push([
        feature.descriptor.id,
        <CapabilityControl key={feature.descriptor.id} feature={feature} translate={translate} />,
      ]);
    }
    return Object.fromEntries(entries) as Partial<Record<BetterT3FeatureId, ReactNode>>;
  }, [
    features,
    preparedControls,
    preparedStatusControls,
    settings.sidebarPosition,
    translate,
    updateSettings,
  ]);

  return (
    <BetterT3SettingsPanelView
      features={features}
      sectionTitles={sectionTitles}
      translate={translate}
      controls={controls}
      featureChoices={featureChoices}
      languageControl={<InterfaceLanguageSetting searchTargetId="better-t3-interface-language" />}
      onSwitchChange={onSwitchChange}
      introduction={
        <BetterT3SettingsIntroduction
          environmentOptions={props.environmentOptions}
          selectedEnvironmentId={props.environment.environmentId}
          deviceInitialization={props.deviceInitialization}
          environmentInitialization={settings.betterT3Environment.initialization}
          translate={translate}
          onEnvironmentChange={props.onEnvironmentChange}
        />
      }
    />
  );
}

export function BetterT3SettingsPanel() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const deviceInitialization = useClientSettings(
    (settings) => settings.betterT3Device.initialization,
  );
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId,
  );
  const selectedEnvironmentId = resolveSelectedBetterT3EnvironmentId(
    environments,
    requestedEnvironmentId,
    primaryEnvironmentId,
  );
  const selectedEnvironment =
    environments.find((environment) => environment.environmentId === selectedEnvironmentId) ?? null;
  const environmentOptions = useMemo(
    () =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
      })),
    [environments],
  );
  const translator = useInterfaceTranslator();

  if (!selectedEnvironment) {
    return (
      <SettingsPageContainer>
        <BetterT3SettingsIntroduction
          environmentOptions={environmentOptions}
          selectedEnvironmentId={null}
          deviceInitialization={deviceInitialization}
          environmentInitialization={null}
          translate={translator.message}
          onEnvironmentChange={setRequestedEnvironmentId}
        />
        <BetterT3InterfaceSection
          control={<InterfaceLanguageSetting searchTargetId="better-t3-interface-language" />}
          translate={translator.message}
        />
      </SettingsPageContainer>
    );
  }

  return (
    <SelectedEnvironmentBetterT3SettingsPanel
      environment={selectedEnvironment}
      environmentOptions={environmentOptions}
      deviceInitialization={deviceInitialization}
      onEnvironmentChange={setRequestedEnvironmentId}
    />
  );
}
