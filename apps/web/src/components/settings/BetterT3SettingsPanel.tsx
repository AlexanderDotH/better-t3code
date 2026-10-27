import type {
  BetterT3FeatureControlStateV1,
  BetterT3FeatureId,
  BetterT3SettingsInitialization,
  BetterT3SwitchFeatureId,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  BETTER_T3_FEATURE_REGISTRY,
  CHAT_VISUAL_MODES,
  resolveBetterT3FeatureFlag,
  type SidebarPosition,
} from "@t3tools/contracts";
import {
  DEFAULT_CHAT_WIDTH_ADJUSTMENT_PERCENT,
  DEFAULT_CHAT_WIDTH_CUSTOMIZATION_ENABLED,
  DEFAULT_UNIFIED_SETTINGS,
  MAX_CHAT_WIDTH_ADJUSTMENT_PERCENT,
  MAX_GLASS_OPACITY,
  MIN_CHAT_WIDTH_ADJUSTMENT_PERCENT,
  MIN_GLASS_OPACITY,
} from "@t3tools/contracts/settings";
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
import {
  BETTER_T3_SETTINGS_SUBGROUPS,
  getBetterT3SettingsSubgroups,
  type BetterT3SettingsSubgroupId,
} from "@t3tools/client-runtime/better-t3-settings-layout";
import { Link } from "@tanstack/react-router";
import { agentSettingsEnvironment } from "../../state/agentSettings";
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { ChatVisualModeSyncNotice } from "./ChatVisualModeSyncNotice";
import { isElectron } from "../../env";
import { useChatVisualMode, useSetChatVisualMode } from "../../chatVisualModeSync";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import {
  useClientSettings,
  useUpdateClientSettings,
  useEnvironmentSettings,
  useUpdateEnvironmentSettings,
} from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  SettingsSearchTarget,
} from "./settingsLayout";
import {
  buildBetterT3ControlStates,
  buildBetterT3SwitchSettingsPatch,
  buildReasoningDisplaySettingsPatch,
  resolveBetterT3DescriptorMessageKeys,
  resolveSelectedBetterT3EnvironmentId,
} from "./BetterT3SettingsPanel.logic";
import {
  buildBetterT3SubgroupSummaries,
  useBetterT3PreparedControls,
} from "./BetterT3SettingsPanel.controls";
import {
  BetterT3SettingsExpansionProvider,
  BetterT3SettingsSubgroup,
  useBetterT3SettingsExpansion,
} from "./BetterT3SettingsSubgroup";
import {
  BetterT3SettingsSearchItemsProvider,
  buildBetterT3FeatureSearchItems,
} from "./BetterT3SettingsSearch";
import {
  BETTER_T3_VISUAL_FEATURE_IDS,
  BetterT3FeatureChoice,
  type BetterT3VisualChoiceValue,
} from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";
import { ProjectIndexingPreview, SidebarSettingsPreview } from "./BetterT3SettingsExamples";
import { useProjectThreadPreviewCount } from "../../projectThreadPreviewSync";
import { InterfaceLanguageSettings } from "./InterfaceLanguageSettings";
import { UsagePacingSettings } from "./UsagePacingSettings";
import { VoiceInputSettings } from "./VoiceInputSettings";
import { ProjectIndexingGlobalSettings } from "../project-indexing/ProjectIndexingGlobalSettings";
import { searchableSetting } from "./settingsSearch";
import { BetterT3SettingsNavigation } from "./BetterT3SettingsNavigation";
import { ChatWidthPreview } from "./ChatWidthPreview";
import { ContextWindowMeterChoice } from "./ContextWindowMeterPreview";

type Translate = InterfaceTranslator["message"];

const BETTER_T3_SETTINGS_GROUPS = [
  ...new Set(BETTER_T3_SETTINGS_SUBGROUPS.map((group) => group.categoryId)),
].map((id) => ({ id, labelMessageId: `settings.betterT3.tab.${id}` as const }));

export interface BetterT3SettingsPanelViewProps {
  readonly features: ReadonlyArray<BetterT3FeatureControlStateV1>;
  readonly translate: Translate;
  readonly controls: Partial<Record<BetterT3FeatureId, ReactNode>>;
  readonly onSwitchChange: (featureId: BetterT3SwitchFeatureId, enabled: boolean) => void;
  readonly introduction?: ReactNode;
  readonly languageControl?: ReactNode;
  readonly usagePacingControl?: ReactNode;
  readonly chatWidthSettings?: ReactNode;
  readonly chatSettings?: ReactNode;
  readonly composerSettings?: ReactNode;
  readonly voiceSettings?: ReactNode;
  readonly projectIndexingSettings?: ReactNode;
  readonly visualSettings?: ReactNode;
  readonly featureVisuals?: Partial<Record<BetterT3FeatureId, ReactNode>>;
  readonly featureChoices?: Partial<Record<BetterT3FeatureId, ReactNode>>;
  readonly subgroupSummaries?: Partial<Record<BetterT3SettingsSubgroupId, string>>;
  readonly consumedFeatureIds?: ReadonlyArray<BetterT3FeatureId>;
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

function BetterT3ChatWidthSettings(props: {
  readonly chatWidthAdjustmentPercent: number;
  readonly chatWidthCustomizationEnabled: boolean;
  readonly translate: Translate;
  readonly onChatWidthAdjustmentPercentChange: (adjustmentPercent: number) => void;
  readonly onChatWidthCustomizationEnabledChange: (enabled: boolean) => void;
  readonly onChatWidthReset: () => void;
}) {
  const chatWidthAdjustmentRatio =
    (props.chatWidthAdjustmentPercent - MIN_CHAT_WIDTH_ADJUSTMENT_PERCENT) /
    (MAX_CHAT_WIDTH_ADJUSTMENT_PERCENT - MIN_CHAT_WIDTH_ADJUSTMENT_PERCENT);
  const chatWidthAdjustmentPosition = chatWidthAdjustmentRatio * 100;
  const chatContentWidthSliderStyle = {
    "--settings-slider-range-start": `${Math.min(50, chatWidthAdjustmentPosition)}%`,
    "--settings-slider-range-end": `${Math.max(50, chatWidthAdjustmentPosition)}%`,
  } as CSSProperties;
  const chatWidthIsCustomized =
    props.chatWidthCustomizationEnabled !== DEFAULT_CHAT_WIDTH_CUSTOMIZATION_ENABLED ||
    props.chatWidthAdjustmentPercent !== DEFAULT_CHAT_WIDTH_ADJUSTMENT_PERCENT;
  const formattedChatWidthAdjustment = `${
    props.chatWidthAdjustmentPercent > 0 ? "+" : props.chatWidthAdjustmentPercent < 0 ? "−" : ""
  }${Math.abs(props.chatWidthAdjustmentPercent)}%`;

  return (
    <>
      <SettingsRow
        {...searchableSetting("setting-chat-content-width")}
        title={props.translate("settings.betterT3.chatWidth.label")}
        description={props.translate("settings.betterT3.chatWidth.description")}
        resetAction={
          chatWidthIsCustomized ? (
            <SettingResetButton
              label={props.translate("settings.betterT3.chatWidth.label")}
              onClick={props.onChatWidthReset}
            />
          ) : null
        }
        control={
          <Switch
            aria-controls="chat-width-adjustment-controls"
            aria-expanded={props.chatWidthCustomizationEnabled}
            aria-label={props.translate("settings.betterT3.chatWidth.label")}
            checked={props.chatWidthCustomizationEnabled}
            onCheckedChange={(checked) =>
              props.onChatWidthCustomizationEnabledChange(Boolean(checked))
            }
          />
        }
      >
        {props.chatWidthCustomizationEnabled ? (
          <div className="mt-3 border-t border-border/50 py-3" id="chat-width-adjustment-controls">
            <div className="flex items-center justify-between gap-3">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="chat-width-adjustment"
              >
                {props.translate("settings.betterT3.chatWidth.adjustment")}
              </label>
              <output
                className="min-w-14 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="chat-width-adjustment"
              >
                {formattedChatWidthAdjustment}
              </output>
            </div>
            <input
              aria-label={props.translate("settings.betterT3.chatWidth.adjustment")}
              className="settings-slider settings-slider-bipolar mt-2 w-full"
              id="chat-width-adjustment"
              max={MAX_CHAT_WIDTH_ADJUSTMENT_PERCENT}
              min={MIN_CHAT_WIDTH_ADJUSTMENT_PERCENT}
              onChange={(event) => {
                const adjustmentPercent = Number(event.currentTarget.value);
                if (
                  Number.isInteger(adjustmentPercent) &&
                  adjustmentPercent >= MIN_CHAT_WIDTH_ADJUSTMENT_PERCENT &&
                  adjustmentPercent <= MAX_CHAT_WIDTH_ADJUSTMENT_PERCENT
                ) {
                  props.onChatWidthAdjustmentPercentChange(adjustmentPercent);
                }
              }}
              step={10}
              style={chatContentWidthSliderStyle}
              type="range"
              value={props.chatWidthAdjustmentPercent}
            />
            <div
              aria-hidden="true"
              className="flex justify-between px-0.5 font-mono text-3xs tabular-nums text-muted-foreground/70"
            >
              <span>−100%</span>
              <span>0%</span>
              <span>+100%</span>
            </div>
            <ChatWidthPreview
              adjustmentPercent={props.chatWidthAdjustmentPercent}
              customizationEnabled={props.chatWidthCustomizationEnabled}
              translate={props.translate}
              valueLabel={formattedChatWidthAdjustment}
            />
          </div>
        ) : null}
      </SettingsRow>
    </>
  );
}

function BetterT3AppearanceSettings(props: {
  readonly glassOpacity: number;
  readonly macosWindowTransparency: boolean;
  readonly translate: Translate;
  readonly onGlassOpacityChange: (glassOpacity: number) => void;
  readonly onMacosWindowTransparencyChange: (enabled: boolean) => void;
}) {
  const glassOpacityRatio =
    (props.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;

  return (
    <>
      <SettingsRow
        {...searchableSetting("setting-glass-opacity")}
        description={props.translate("settings.appearance.glassDescription")}
        resetAction={
          props.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
            <SettingResetButton
              label={props.translate("settings.appearance.glassOpacity")}
              onClick={() => props.onGlassOpacityChange(DEFAULT_UNIFIED_SETTINGS.glassOpacity)}
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              htmlFor="glass-opacity"
            >
              {props.glassOpacity}%
            </output>
            <input
              aria-label={props.translate("settings.appearance.glassOpacity")}
              className="settings-slider min-w-0 flex-1"
              id="glass-opacity"
              max={MAX_GLASS_OPACITY}
              min={MIN_GLASS_OPACITY}
              onChange={(event) => {
                const glassOpacity = Number(event.currentTarget.value);
                if (
                  Number.isInteger(glassOpacity) &&
                  glassOpacity >= MIN_GLASS_OPACITY &&
                  glassOpacity <= MAX_GLASS_OPACITY
                ) {
                  props.onGlassOpacityChange(glassOpacity);
                }
              }}
              step={5}
              style={glassOpacitySliderStyle}
              type="range"
              value={props.glassOpacity}
            />
          </div>
        }
      />

      {isElectron && window.desktopBridge?.getClientPlatform?.() === "darwin" ? (
        <SettingsRow
          id="macos-window-transparency"
          title={props.translate("settings.application.title.macosTransparency")}
          description={props.translate("settings.appearance.macosTransparencyDescription")}
          control={
            <Switch
              checked={props.macosWindowTransparency}
              onCheckedChange={(checked) => props.onMacosWindowTransparencyChange(Boolean(checked))}
              aria-label={props.translate("settings.application.title.macosTransparency")}
            />
          }
        />
      ) : null}
    </>
  );
}

function ResponseMetricsSettings() {
  const enabled = useClientSettings((settings) => settings.responseMetricsEnabled);
  const updateSettings = useUpdateClientSettings();
  const translate = useInterfaceTranslator().message;
  return (
    <SettingsRow
      {...searchableSetting("response-metrics")}
      title={translate("settings.responseMetrics.label")}
      description={translate("settings.responseMetrics.description")}
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            updateSettings({ responseMetricsEnabled: Boolean(checked) })
          }
          aria-label={translate("settings.responseMetrics.label")}
        />
      }
    />
  );
}

export function ContextWindowMeterSettings() {
  const enabled = useClientSettings((settings) => settings.contextWindowMeterEnabled);
  const updateSettings = useUpdateClientSettings();
  const translator = useInterfaceTranslator();
  const translate = translator.message;

  return (
    <SettingsRow
      {...searchableSetting("legacy-context-window-indicator")}
      title={translate("settings.contextMeter.label")}
      description={translate("settings.contextMeter.description")}
      resetAction={
        enabled !== DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled ? (
          <SettingResetButton
            label={translate("settings.contextMeter.label")}
            onClick={() =>
              updateSettings({
                contextWindowMeterEnabled: DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled,
              })
            }
          />
        ) : null
      }
    >
      <ContextWindowMeterChoice
        enabled={enabled}
        onChange={(contextWindowMeterEnabled) => updateSettings({ contextWindowMeterEnabled })}
        translator={translator}
      />
    </SettingsRow>
  );
}

function visibleBetterT3Features(props: BetterT3SettingsPanelViewProps) {
  return props.features.filter((feature) => {
    const id = feature.descriptor.id;
    if (
      id === "agent.reasoningWorkingOverlay" ||
      id === "agent.reasoningInMessage" ||
      props.consumedFeatureIds?.includes(id)
    )
      return false;
    if (props.voiceSettings && id === "voice.credentials") return false;
    return !(
      props.projectIndexingSettings &&
      id.startsWith("knowledge.projectIndexing") &&
      id !== "knowledge.projectIndexingDecisionModel"
    );
  });
}

function searchableBetterT3Features(props: BetterT3SettingsPanelViewProps) {
  return props.features.filter((feature) => {
    const id = feature.descriptor.id;
    if (id === "agent.reasoningWorkingOverlay" || id === "agent.reasoningInMessage") return false;
    if (props.voiceSettings && id === "voice.credentials") return false;
    return !(
      props.projectIndexingSettings &&
      id.startsWith("knowledge.projectIndexing") &&
      id !== "knowledge.projectIndexingDecisionModel"
    );
  });
}

function renderBetterT3FeatureRow(
  feature: BetterT3FeatureControlStateV1,
  props: Pick<
    BetterT3SettingsPanelViewProps,
    "translate" | "controls" | "onSwitchChange" | "featureChoices" | "featureVisuals"
  >,
) {
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
      {featureChoice ?? props.featureVisuals?.[feature.descriptor.id]}
    </SettingsRow>
  );
}

function BetterT3SettingsContentBody(props: BetterT3SettingsPanelViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const visibleFeatures = visibleBetterT3Features(props);
  const additionalContent: Partial<Record<BetterT3SettingsSubgroupId, ReactNode>> = {
    language: props.languageControl ? (
      <SettingsSearchTarget id="better-t3-interface">{props.languageControl}</SettingsSearchTarget>
    ) : null,
    glass: props.visualSettings,
    "context-display": props.composerSettings,
    "response-metrics": props.chatSettings,
    "chat-width": props.chatWidthSettings,
  };

  const groups = BETTER_T3_SETTINGS_GROUPS.filter(
    (category) =>
      getBetterT3SettingsSubgroups(category.id).some(
        (subgroup) =>
          additionalContent[subgroup.id] ||
          visibleFeatures.some((feature) => subgroup.featureIds.includes(feature.descriptor.id)),
      ) ||
      (category.id === "usage" && props.usagePacingControl) ||
      (category.id === "voice" && props.voiceSettings) ||
      (category.id === "knowledge" && props.projectIndexingSettings),
  );

  return (
    <div
      ref={contentRef}
      className="min-w-0 space-y-8 [--better-t3-scroll-offset:calc(var(--better-t3-navigation-height,0px)+1rem)] [&_[data-settings-scroll-target]]:scroll-mt-(--better-t3-scroll-offset) [&_[tabindex='-1']]:scroll-mt-(--better-t3-scroll-offset)"
    >
      <BetterT3SettingsNavigation
        contentRef={contentRef}
        groups={groups}
        translate={props.translate}
      />
      {groups.map((group) => {
        const subgroups = getBetterT3SettingsSubgroups(group.id).flatMap((subgroup) => {
          const features = visibleFeatures.filter((feature) =>
            subgroup.featureIds.includes(feature.descriptor.id),
          );
          const additional = additionalContent[subgroup.id];
          if (features.length === 0 && !additional) return [];
          const fallbackSummary = features
            .map(
              (feature) =>
                availabilityStatus(feature, props.translate) ??
                (typeof feature.value === "boolean"
                  ? props.translate(
                      feature.value
                        ? "settings.betterT3.summary.on"
                        : "settings.betterT3.summary.off",
                    )
                  : null),
            )
            .filter(Boolean)
            .join(" · ");
          return [
            <BetterT3SettingsSubgroup
              key={subgroup.id}
              groupId={subgroup.id}
              title={props.translate(subgroup.titleMessageId)}
              hideTitle={
                !subgroup.collapsible &&
                ((features.length === 1 && !additional) ||
                  subgroup.id === "language" ||
                  subgroup.id === "response-metrics")
              }
              summary={props.subgroupSummaries?.[subgroup.id] ?? fallbackSummary}
            >
              {features.map((feature) => renderBetterT3FeatureRow(feature, props))}
              {additional}
            </BetterT3SettingsSubgroup>,
          ];
        });
        const specialized =
          group.id === "usage"
            ? props.usagePacingControl
            : group.id === "voice"
              ? props.voiceSettings
              : group.id === "knowledge"
                ? props.projectIndexingSettings
                : null;
        if (subgroups.length === 0 && !specialized) return null;
        return (
          <SettingsSearchTarget
            aria-labelledby={`better-t3-group-title-${group.id}`}
            className="better-t3-settings-group space-y-4 border-t border-border/70 pt-6 outline-none last:min-h-[calc(100dvh-var(--workspace-topbar-height)-4rem)]"
            data-better-t3-group={group.id}
            id={`better-t3-group-${group.id}`}
            key={group.id}
            role="region"
          >
            <h2
              className="px-3 text-lg font-semibold tracking-tight text-foreground sm:px-4"
              data-settings-scroll-target="start"
              id={`better-t3-group-title-${group.id}`}
            >
              {props.translate(group.labelMessageId)}
            </h2>
            {subgroups.length > 0 ? (
              <SettingsSection title={props.translate(group.labelMessageId)} hideTitle>
                {subgroups}
              </SettingsSection>
            ) : null}
            {specialized}
          </SettingsSearchTarget>
        );
      })}
    </div>
  );
}

export function BetterT3SettingsContent(props: BetterT3SettingsPanelViewProps) {
  const expansion = useBetterT3SettingsExpansion();
  const content = (
    <BetterT3SettingsSearchItemsProvider
      items={buildBetterT3FeatureSearchItems(searchableBetterT3Features(props), props.translate)}
    >
      <BetterT3SettingsContentBody {...props} />
    </BetterT3SettingsSearchItemsProvider>
  );
  return expansion ? (
    content
  ) : (
    <BetterT3SettingsExpansionProvider>{content}</BetterT3SettingsExpansionProvider>
  );
}

function BetterT3SettingsPanelView(props: BetterT3SettingsPanelViewProps) {
  return (
    <BetterT3SettingsExpansionProvider>
      <BetterT3SettingsSearchItemsProvider
        items={buildBetterT3FeatureSearchItems(searchableBetterT3Features(props), props.translate)}
      >
        <SettingsPageContainer>
          {props.introduction}
          <BetterT3SettingsContentBody {...props} />
        </SettingsPageContainer>
      </BetterT3SettingsSearchItemsProvider>
    </BetterT3SettingsExpansionProvider>
  );
}

type BetterT3Destination =
  | "/settings/better-t3"
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

function resolveBetterT3ControlDestination(
  featureId: BetterT3FeatureId,
): BetterT3Destination | null {
  if (featureId === "workspace.checkpoints") return "/settings/projects";
  if (featureId === "workspace.chatPortability") return "/settings/projects";
  if (featureId === "voice.transcriptPortability") return "/settings/projects";
  if (featureId === "voice.credentials") return "/settings/better-t3";
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

function resolveBetterT3PreparedStatusMessageId(input: {
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

function resolveBetterT3PreparedStatusText(input: {
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

function BetterT3SettingsIntroduction(props: {
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
      className="better-t3-settings-introduction overflow-hidden rounded-2xl border border-border/60 bg-card/45"
    >
      <div className="better-t3-settings-introduction-header space-y-1.5 p-4 sm:p-5">
        <h1 className="text-xl font-semibold tracking-tight">
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
              className="w-full max-w-72"
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
        <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground sm:justify-end">
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
  const loadedSkillsQuery = useEnvironmentQuery(
    environmentAvailable &&
      (props.environment.serverConfig?.environment.capabilities.environmentSettingsVersion ?? 0) >=
        1
      ? agentSettingsEnvironment.skills.listQuery({
          environmentId: props.environment.environmentId,
          input: { includeBody: false, forceReload: false },
        })
      : null,
  );
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
  const { count: sidebarPreviewCount } = useProjectThreadPreviewCount();
  const previewModel = useMemo(
    () =>
      buildBetterT3SettingsPreviewModel({
        features,
        chatVisualMode,
        contextWindowSelector: settings.contextWindowSelector,
        sidebarPosition: settings.sidebarPosition,
        showReasoning: settings.showReasoning,
        reasoningWorkingOverlay: resolveBetterT3FeatureFlag(
          settings.betterT3Device,
          "agent.reasoningWorkingOverlay",
        ),
        reasoningInMessage: resolveBetterT3FeatureFlag(
          settings.betterT3Device,
          "agent.reasoningInMessage",
        ),
        chatWidth: settings.chatWidth,
        chatWidthCustomizationEnabled: settings.chatWidthCustomizationEnabled,
        chatWidthAdjustmentPercent: settings.chatWidthAdjustmentPercent,
      }),
    [
      chatVisualMode,
      features,
      settings.contextWindowSelector,
      settings.sidebarPosition,
      settings.showReasoning,
      settings.betterT3Device,
      settings.chatWidth,
      settings.chatWidthCustomizationEnabled,
      settings.chatWidthAdjustmentPercent,
    ],
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
      if (featureId === "agent.reasoningVisibility") {
        if (value === "none" || value === "chat" || value === "working" || value === "message") {
          updateSettings(buildReasoningDisplaySettingsPatch(value));
        }
        return;
      }
      if (featureId === "chat.sidebarPosition") {
        if (value === "left" || value === "right") updateSettings({ sidebarPosition: value });
        return;
      }
      if (featureId === "chat.presentation") {
        const mode = CHAT_VISUAL_MODES.find((mode) => mode === value);
        if (mode) setChatVisualMode(mode);
        return;
      }
      if (featureId === "chat.contextWindowSelector") {
        if (value === "native" || value === "better-t3") {
          updateSettings({ contextWindowSelector: value });
        }
        return;
      }
      if (featureId === "voice.outputLanguage") {
        if (value === "native" || value === "english")
          updateSettings({ voiceInputOutputLanguage: value });
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
      let value: BetterT3VisualChoiceValue;
      switch (featureId) {
        case "voice.outputLanguage":
          value = settings.voiceInputOutputLanguage;
          break;
        case "agent.reasoningVisibility":
          value = !previewModel.agent.reasoningVisibility
            ? "none"
            : previewModel.agent.reasoningWorkingOverlay
              ? "working"
              : previewModel.agent.reasoningInMessage
                ? "message"
                : "chat";
          break;
        case "chat.sidebarPosition":
          value = previewModel.chat.sidebarPosition;
          break;
        case "chat.presentation":
          value = previewModel.chat.presentation;
          break;
        case "chat.contextWindowSelector":
          value = previewModel.chat.contextWindowSelector;
          break;
        case "chat.classicBubbleOnly":
          value = feature.availability.state === "available" && feature.value === true;
          break;
        default:
          value = feature.value === true;
      }
      choices[featureId] = (
        <div key={featureId}>
          <BetterT3FeatureChoice
            disabled={feature.availability.state !== "available"}
            featureId={featureId}
            key={featureId}
            model={previewModel}
            onChange={(nextValue) => onVisualChoiceChange(featureId, nextValue)}
            translate={translate}
            value={value}
          />
          {featureId === "chat.presentation" ? (
            <ChatVisualModeSyncNotice translate={translate} />
          ) : null}
        </div>
      );
    }
    return choices;
  }, [features, onVisualChoiceChange, previewModel, settings.voiceInputOutputLanguage, translate]);
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

  const featureRow = (id: BetterT3FeatureId) => {
    const feature = features.find((candidate) => candidate.descriptor.id === id);
    return feature
      ? renderBetterT3FeatureRow(feature, { translate, controls, featureChoices, onSwitchChange })
      : null;
  };
  const subgroupSummaries = buildBetterT3SubgroupSummaries({
    settings,
    providers: props.environment.serverConfig?.providers ?? [],
    features,
    translate,
  });

  return (
    <BetterT3SettingsPanelView
      features={features}
      translate={translate}
      controls={controls}
      subgroupSummaries={subgroupSummaries}
      consumedFeatureIds={[
        "voice.assemblyAi",
        "voice.outputLanguage",
        "voice.transcriptPortability",
        "knowledge.projectIndexingDecisionModel",
      ]}
      featureChoices={featureChoices}
      featureVisuals={{
        "chat.previewCount": (
          <SidebarSettingsPreview
            previewCount={sidebarPreviewCount}
            projectOrder={settings.sidebarProjectSortOrder}
            threadOrder={settings.sidebarThreadSortOrder}
            settleAfterDays={settings.sidebarAutoSettleAfterDays}
            settleOnMerge={settings.sidebarAutoSettleOnMerge}
            draftIndicators={previewModel.chat.draftIndicators}
            translate={translate}
          />
        ),
      }}
      composerSettings={<ContextWindowMeterSettings />}
      chatSettings={<ResponseMetricsSettings />}
      usagePacingControl={<UsagePacingSettings environmentId={props.environment.environmentId} />}
      projectIndexingSettings={
        <ProjectIndexingGlobalSettings
          environmentId={props.environment.environmentId}
          decisionModelSettings={featureRow("knowledge.projectIndexingDecisionModel")}
          preview={<ProjectIndexingPreview translate={translate} />}
        />
      }
      voiceSettings={
        <VoiceInputSettings
          key={props.environment.environmentId}
          environmentId={props.environment.environmentId}
          disabled={!environmentAvailable}
          accessSettings={featureRow("voice.assemblyAi")}
          translationSettings={featureRow("voice.outputLanguage")}
          transcriptTransferSettings={featureRow("voice.transcriptPortability")}
        />
      }
      languageControl={
        <div id="better-t3-interface-language">
          <InterfaceLanguageSettings />
        </div>
      }
      chatWidthSettings={
        <BetterT3ChatWidthSettings
          chatWidthAdjustmentPercent={settings.chatWidthAdjustmentPercent}
          chatWidthCustomizationEnabled={settings.chatWidthCustomizationEnabled}
          translate={translate}
          onChatWidthAdjustmentPercentChange={(chatWidthAdjustmentPercent) =>
            updateSettings({ chatWidthAdjustmentPercent })
          }
          onChatWidthCustomizationEnabledChange={(chatWidthCustomizationEnabled) =>
            updateSettings({ chatWidthCustomizationEnabled })
          }
          onChatWidthReset={() =>
            updateSettings({
              chatWidthCustomizationEnabled: DEFAULT_CHAT_WIDTH_CUSTOMIZATION_ENABLED,
              chatWidthAdjustmentPercent: DEFAULT_CHAT_WIDTH_ADJUSTMENT_PERCENT,
            })
          }
        />
      }
      visualSettings={
        <BetterT3AppearanceSettings
          glassOpacity={settings.glassOpacity}
          macosWindowTransparency={settings.macosWindowTransparency}
          translate={translate}
          onGlassOpacityChange={(glassOpacity) => updateSettings({ glassOpacity })}
          onMacosWindowTransparencyChange={(macosWindowTransparency) =>
            updateSettings({ macosWindowTransparency })
          }
        />
      }
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
      <BetterT3SettingsPanelView
        features={[]}
        controls={{}}
        onSwitchChange={() => undefined}
        translate={translator.message}
        chatSettings={<ResponseMetricsSettings />}
        composerSettings={<ContextWindowMeterSettings />}
        languageControl={
          <div id="better-t3-interface-language">
            <InterfaceLanguageSettings />
          </div>
        }
        introduction={
          <BetterT3SettingsIntroduction
            environmentOptions={environmentOptions}
            selectedEnvironmentId={null}
            deviceInitialization={deviceInitialization}
            environmentInitialization={null}
            translate={translator.message}
            onEnvironmentChange={setRequestedEnvironmentId}
          />
        }
      />
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
