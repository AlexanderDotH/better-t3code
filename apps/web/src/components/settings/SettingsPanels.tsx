import { ArchiveIcon, ArchiveX, ChevronRightIcon, LoaderIcon, SettingsIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  type BackgroundActivityProfile,
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  type DesktopUpdateChannel,
  ProviderDriverKind,
  type ScopedThreadRef,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type EnvironmentIdentificationMode,
  MAX_APPEARANCE_CONTRAST,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_APPEARANCE_CONTRAST,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "@t3tools/contracts/settings";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { primaryServerObservabilityAtom, primaryServerProvidersAtom } from "../../state/server";
import { useProjects } from "../../state/entities";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
  isFontFamilyAvailable,
  isMonospaceFamily,
  resolveDefaultFamilyLabel,
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import { CodeFontPreview, PromptFontPreview, TerminalFontPreview } from "./SettingsFontPreviews";
import { discoverInstalledFonts, FontFamilyPicker, useFontEnumeration } from "./FontFamilyPicker";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThemeLibrary } from "./ThemeSettings";
import { useProjectThreadPreviewCount } from "../../projectThreadPreviewSync";
import {
  backgroundActivityOverrideSettings,
  backgroundActivitySharedPolicySettings,
  durationToSeconds,
  formatDiagnosticsDescription,
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  normalizeIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  resolveBackgroundActivityProfileOption,
} from "./SettingsPanels.logic";
import {
  PolicyTooltip,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { ProjectFavicon } from "../ProjectFavicon";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

const ENVIRONMENT_IDENTIFICATION_MESSAGE_IDS = {
  artwork: "settings.panels.appearance.environment.artwork",
  pill: "settings.panels.appearance.environment.pill",
  none: "settings.common.none",
} as const satisfies Record<EnvironmentIdentificationMode, string>;

const TIMESTAMP_FORMAT_MESSAGE_IDS = {
  locale: "settings.panels.appearance.timestamp.system",
  "12-hour": "settings.panels.appearance.timestamp.twelveHour",
  "24-hour": "settings.panels.appearance.timestamp.twentyFourHour",
} as const;

const BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS = {
  balanced: "settings.panels.background.profile.balanced",
  performance: "settings.panels.background.profile.performance",
  "battery-saver": "settings.panels.background.profile.batterySaver",
} as const satisfies Record<BackgroundActivityProfile, string>;

type BackgroundActivityProfileOption = BackgroundActivityProfile | "advanced";

const BACKGROUND_ACTIVITY_PROFILE_OPTION_MESSAGE_IDS = {
  ...BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS,
  advanced: "settings.panels.background.profile.advanced",
} as const satisfies Record<BackgroundActivityProfileOption, string>;

const BACKGROUND_ACTIVITY_PROFILE_DESCRIPTION_MESSAGE_IDS = {
  balanced: "settings.panels.background.profile.balancedDescription",
  performance: "settings.panels.background.profile.performanceDescription",
  "battery-saver": "settings.panels.background.profile.batterySaverDescription",
} as const satisfies Record<BackgroundActivityProfile, string>;

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES: ReadonlyArray<{
  readonly key:
    | "pauseWhenHostLocked"
    | "pauseWhenHostLowPower"
    | "pauseWhenClientLowPower"
    | "pauseWhenOnBattery";
  readonly messageId:
    | "settings.panels.background.pause.hostLocked"
    | "settings.panels.background.pause.hostLowPower"
    | "settings.panels.background.pause.clientLowPower"
    | "settings.panels.background.pause.onBattery";
}> = [
  { key: "pauseWhenHostLocked", messageId: "settings.panels.background.pause.hostLocked" },
  { key: "pauseWhenHostLowPower", messageId: "settings.panels.background.pause.hostLowPower" },
  { key: "pauseWhenClientLowPower", messageId: "settings.panels.background.pause.clientLowPower" },
  { key: "pauseWhenOnBattery", messageId: "settings.panels.background.pause.onBattery" },
];

function resetBackgroundActivitySettings() {
  return {
    backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  };
}

function backgroundActivityProfileSettings(profile: BackgroundActivityProfile) {
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile,
      overrides: {},
    },
  };
}

function AboutVersionTitle() {
  const translate = useInterfaceTranslator().message;
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>{translate("settings.general.version")}</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const translate = useInterfaceTranslator().message;
  const updateState = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;

  const handleUpdateChannelChange = useCallback(
    (channel: DesktopUpdateChannel) => {
      const bridge = window.desktopBridge;
      if (
        !bridge ||
        typeof bridge.setUpdateChannel !== "function" ||
        channel === selectedUpdateChannel
      ) {
        return;
      }

      setIsChangingUpdateChannel(true);
      void bridge
        .setUpdateChannel(channel)
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translate("settings.panels.update.trackChangeFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translate("settings.panels.update.trackChangeError"),
            }),
          );
        })
        .finally(() => {
          setIsChangingUpdateChannel(false);
        });
    },
    [selectedUpdateChannel, translate],
  );

  const handleButtonClick = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge.downloadUpdate().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translate("settings.panels.update.downloadFailed"),
            description:
              error instanceof Error
                ? error.message
                : translate("settings.panels.update.downloadError"),
          }),
        );
      });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
          ),
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translate("settings.panels.update.confirmFailed"),
            description:
              error instanceof Error
                ? error.message
                : translate("settings.panels.update.confirmError"),
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translate("settings.panels.update.installFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translate("settings.panels.update.installError"),
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translate("settings.panels.update.checkFailed"),
              description: result.state.message ?? translate("settings.panels.update.unavailable"),
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translate("settings.panels.update.checkFailed"),
            description:
              error instanceof Error
                ? error.message
                : translate("settings.panels.update.checkError"),
          }),
        );
      });
  }, [isUpdateActionPending, translate, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = {
    download: translate("settings.panels.update.download"),
    install: translate("settings.panels.update.install"),
  };
  const statusLabel: Record<string, string> = {
    checking: translate("settings.panels.update.checking"),
    downloading: translate("settings.panels.update.downloading"),
    "up-to-date": translate("settings.panels.update.upToDate"),
  };
  const buttonLabel =
    actionLabel[action] ??
    statusLabel[updateState?.status ?? ""] ??
    translate("settings.panels.update.check");
  const description =
    action === "download" || action === "install"
      ? translate("settings.panels.update.available")
      : translate("settings.about.versionDescription");

  return (
    <>
      <SettingsRow
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant={action === "install" ? "default" : "outline"}
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          title={translate("settings.general.updateTrack")}
          description={translate("settings.general.updateTrack.desktopDescription")}
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label={translate("settings.general.updateTrack")}
                disabled={isChangingUpdateChannel}
              >
                <SelectValue>
                  {translate(
                    selectedUpdateChannel === "nightly"
                      ? "settings.panels.update.nightly"
                      : "settings.panels.update.stable",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {translate("settings.panels.update.stable")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {translate("settings.panels.update.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          title={translate("settings.general.updateTrack")}
          description={translate("settings.general.updateTrack.hostedDescription")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label={translate("settings.general.updateTrack")}
              >
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  {translate("settings.panels.update.latest")}
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  {translate("settings.panels.update.nightly")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const translate = useInterfaceTranslator().message;
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const { count: projectThreadPreviewCount, setCount: setProjectThreadPreviewCount } =
    useProjectThreadPreviewCount();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? [translate("settings.application.title.themes")] : []),
      ...(!followSystem ? [translate("settings.panels.restore.followSystem")] : []),
      ...(themeHalves !== null ? [translate("settings.panels.restore.themeMix")] : []),
      ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
        ? [translate("settings.application.title.contrast")]
        : []),
      ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity
        ? [translate("settings.application.title.glassOpacity")]
        : []),
      ...(settings.environmentIdentificationMode !==
      DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
        ? [translate("settings.application.title.environmentIdentification")]
        : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? [translate("settings.application.title.timeFormat")]
        : []),
      ...(projectThreadPreviewCount !== DEFAULT_PROJECT_THREAD_PREVIEW_COUNT
        ? [translate("settings.application.title.chatsPerProject")]
        : []),
      ...(settings.sidebarProjectGroupingMode !==
      DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
        ? [translate("settings.application.title.projectGrouping")]
        : []),
      ...(settings.sidebarAutoSettleAfterDays !==
      DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
        ? [translate("settings.application.title.autoSettleInactive")]
        : []),
      ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
        ? [translate("settings.application.title.autoSettleMerged")]
        : []),
      ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap
        ? [translate("settings.application.title.wordWrap")]
        : []),
      ...getChangedTypographySettingLabels(settings, translate),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? [translate("settings.application.title.hideWhitespace")]
        : []),
      ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
        ? [translate("settings.application.title.skillsSlashMenu")]
        : []),
      ...(settings.enableLegacyTokenStreaming !==
      DEFAULT_UNIFIED_SETTINGS.enableLegacyTokenStreaming
        ? [translate("settings.application.title.legacyTokenStreaming")]
        : []),
      ...(settings.enableProviderUpdateChecks !==
      DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
        ? [translate("settings.application.title.providerUpdateChecks")]
        : []),
      ...(isBackgroundActivityDirty ? [translate("settings.general.backgroundActivity")] : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? [translate("settings.application.title.newThreads")]
        : []),
      ...(settings.newWorktreesStartFromOrigin !==
      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
        ? [translate("settings.application.title.startFromOrigin")]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? [translate("settings.application.title.addProjectStartsIn")]
        : []),
      ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
        ? [translate("settings.application.title.unpinConfirmation")]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? [translate("settings.application.title.archiveConfirmation")]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? [translate("settings.application.title.deleteConfirmation")]
        : []),
      ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit
        ? [translate("settings.application.title.quitConfirmation")]
        : []),
      ...(isTextGenerationModelDirty
        ? [translate("settings.application.title.textGenerationModel")]
        : []),
      ...(settings.improvePromptBeforeSend !== DEFAULT_UNIFIED_SETTINGS.improvePromptBeforeSend
        ? [translate("settings.application.title.promptImprovement")]
        : []),
      ...getChangedBrowserSettingLabels(settings, translate),
      ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
        ? [translate("settings.application.title.agentBrowserAccess")]
        : []),
    ],
    [
      isTextGenerationModelDirty,
      isBackgroundActivityDirty,
      settings.browserDefaultViewport,
      settings.browserDefaultZoomFactor,
      settings.browserDefaultAppearance,
      settings.browserAutoShowFloatingPreview,
      settings.appearanceContrast,
      settings.enableAgentBrowserAccess,
      settings.confirmQuit,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.confirmThreadUnpin,
      settings.addProjectBaseDirectory,
      settings.defaultThreadEnvMode,
      settings.newWorktreesStartFromOrigin,
      settings.diffIgnoreWhitespace,
      settings.environmentIdentificationMode,
      settings.fontFamilyCode,
      settings.fontFamilyComposer,
      settings.fontFamilySans,
      settings.fontFamilyTerminal,
      settings.fontSizeCode,
      settings.fontSizeInterface,
      settings.fontSizePrompt,
      settings.fontSizeTerminal,
      settings.glassOpacity,
      settings.enableLegacyTokenStreaming,
      settings.enableProviderUpdateChecks,
      settings.sidebarAutoSettleAfterDays,
      settings.sidebarAutoSettleOnMerge,
      settings.sidebarProjectGroupingMode,
      settings.improvePromptBeforeSend,
      projectThreadPreviewCount,
      settings.showSkillsInSlashMenu,
      settings.timestampFormat,
      settings.wordWrap,
      followSystem,
      theme,
      themeHalves,
      translate,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      [
        translate("settings.panels.restore.confirmTitle"),
        translate("settings.panels.restore.confirmDescription", {
          settings: changedSettingLabels.join(", "),
        }),
      ].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Only touch the theme keys that are actually dirty, so a theme-storage
    // failure cannot block restoring unrelated settings. Preferences are
    // re-read after the confirmation dialog: they may have changed (another
    // tab, an OS flip) while it was open, and rollback must restore the live
    // values rather than the ones captured at render time.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {
      // Storage is unreadable; the render-time value is the best rollback.
    }
    // The mix may have changed while the confirmation dialog was open; both
    // the dirty check and the rollback must see the live value.
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    // Same for the appearance mode: trusting the render-time value would skip
    // the reset and report success while a non-system mode stayed in storage.
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translate("settings.panels.restoreThemeFailed"),
          description: translate("settings.panels.tryAgain"),
        }),
      );
    };
    // Rollback restores the base preference first (which clears any mix) and
    // then re-applies the captured mix on top, so no failure path can leave
    // the pair of keys half-restored.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      enableLegacyTokenStreaming: DEFAULT_UNIFIED_SETTINGS.enableLegacyTokenStreaming,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      improvePromptBeforeSend: DEFAULT_UNIFIED_SETTINGS.improvePromptBeforeSend,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      // Re-granted like any other default. The confirmation dialog lists it by
      // name, so a user restoring defaults is told the agent regains access
      // rather than discovering it later.
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    setProjectThreadPreviewCount(DEFAULT_PROJECT_THREAD_PREVIEW_COUNT);
    onRestored?.();
  }, [
    changedSettingLabels,
    clearThemeHalves,
    onRestored,
    setFollowSystem,
    setProjectThreadPreviewCount,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
    translate,
    updateSettings,
  ]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function BackgroundActivityAdvancedDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const activeProfile = resolvedBackgroundActivity.profile;
  const automaticGitFetchIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.automaticGitFetchInterval,
  );
  const providerHealthRefreshIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.providerHealthRefreshInterval,
  );
  const hostPowerMonitorActiveIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.hostPowerMonitorActiveInterval,
  );
  const hostPowerMonitorIdleIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.hostPowerMonitorIdleInterval,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{translate("settings.background.title")}</DialogTitle>
          <DialogDescription>{translate("settings.panels.background.intro")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-0 px-6 pb-5">
          <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {translate("settings.background.sharedPolicy")}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {translate("settings.panels.background.sharedDescription")}
                </p>
              </div>
              <Select
                value={activeProfile}
                onValueChange={(value) => {
                  if (
                    value === "balanced" ||
                    value === "performance" ||
                    value === "battery-saver"
                  ) {
                    updateSettings({
                      backgroundActivity: backgroundActivitySharedPolicySettings(settings, value),
                    });
                  }
                }}
              >
                <SelectTrigger
                  className="w-full sm:w-40"
                  aria-label={translate("settings.panels.background.sharedAria")}
                >
                  <SelectValue>
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS[activeProfile])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="balanced">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS.balanced)}
                  </SelectItem>
                  <SelectItem hideIndicator value="performance">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS.performance)}
                  </SelectItem>
                  <SelectItem hideIndicator value="battery-saver">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS["battery-saver"])}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>

            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {translate("settings.background.gitFetchInterval")}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {translate("settings.panels.background.gitDescription")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={automaticGitFetchIntervalSeconds}
                  min={0}
                  step={5}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          automaticGitFetchInterval: Duration.seconds(
                            normalizeIntervalSeconds(value),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement
                      aria-label={translate("settings.background.decreaseGit")}
                    />
                    <NumberFieldInput aria-label={translate("settings.background.gitSeconds")} />
                    <NumberFieldIncrement
                      aria-label={translate("settings.background.increaseGit")}
                    />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">
                  {translate("settings.background.seconds")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {translate("settings.background.providerHealthInterval")}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {translate("settings.panels.background.providerDescription")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={providerHealthRefreshIntervalSeconds}
                  min={0}
                  step={PROVIDER_HEALTH_INTERVAL_STEP_SECONDS}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          providerHealthRefreshInterval: Duration.seconds(
                            normalizeIntervalSeconds(value),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement
                      aria-label={translate("settings.background.decreaseProvider")}
                    />
                    <NumberFieldInput
                      aria-label={translate("settings.background.providerSeconds")}
                    />
                    <NumberFieldIncrement
                      aria-label={translate("settings.background.increaseProvider")}
                    />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">
                  {translate("settings.background.seconds")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {translate("settings.background.hostPowerMonitor")}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {translate("settings.panels.background.hostDescription")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={hostPowerMonitorActiveIntervalSeconds}
                  min={5}
                  step={5}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          hostPowerMonitorActiveInterval: Duration.seconds(
                            normalizeIntervalSeconds(value, 5),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement
                      aria-label={translate("settings.background.decreaseActiveHost")}
                    />
                    <NumberFieldInput
                      aria-label={translate("settings.background.activeHostSeconds")}
                    />
                    <NumberFieldIncrement
                      aria-label={translate("settings.background.increaseActiveHost")}
                    />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">
                  {translate("settings.background.seconds")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {translate("settings.background.idleHostMonitor")}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {translate("settings.panels.background.idleDescription")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={hostPowerMonitorIdleIntervalSeconds}
                  min={5}
                  step={30}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          hostPowerMonitorIdleInterval: Duration.seconds(
                            normalizeIntervalSeconds(value, 5),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement
                      aria-label={translate("settings.background.decreaseIdleHost")}
                    />
                    <NumberFieldInput
                      aria-label={translate("settings.background.idleHostSeconds")}
                    />
                    <NumberFieldIncrement
                      aria-label={translate("settings.background.increaseIdleHost")}
                    />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">
                  {translate("settings.background.seconds")}
                </span>
              </div>
            </div>

            <div className="grid gap-0 border-t sm:grid-cols-2">
              {BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES.map(({ key, messageId }) => {
                const label = translate(messageId);
                return (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 sm:border-r sm:even:border-r-0"
                  >
                    <span className="text-sm font-medium">{label}</span>
                    <Switch
                      checked={resolvedBackgroundActivity[key]}
                      onCheckedChange={(checked) =>
                        updateSettings(
                          backgroundActivityOverrideSettings(
                            settings.backgroundActivity,
                            resolvedBackgroundActivity,
                            {
                              [key]: Boolean(checked),
                            },
                          ),
                        )
                      }
                      aria-label={label}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => updateSettings(resetBackgroundActivitySettings())}
          >
            {translate("settings.panels.background.resetAll")}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{translate("settings.common.done")}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function AppearanceSettingsPanel() {
  const translate = useInterfaceTranslator().message;
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const showEnvironmentIdentification =
    resolveEnvironmentIdentificationPillLabel(environmentStageLabel) !== null;
  const appearanceContrastRatio =
    (settings.appearanceContrast - MIN_APPEARANCE_CONTRAST) /
    (MAX_APPEARANCE_CONTRAST - MIN_APPEARANCE_CONTRAST);
  const appearanceContrastSliderStyle = {
    "--settings-slider-progress": `${appearanceContrastRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - appearanceContrastRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title={translate("settings.appearance.title")}>
        <div id={searchableSetting("theme", translate).id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>

        <SettingsRow
          {...searchableSetting("setting-appearance-contrast", translate)}
          description={translate("settings.appearance.contrastDescription")}
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                label={translate("settings.appearance.contrast")}
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="appearance-contrast"
              >
                {settings.appearanceContrast}%
              </output>
              <input
                aria-label={translate("settings.appearance.contrast")}
                className="settings-slider min-w-0 flex-1"
                id="appearance-contrast"
                max={MAX_APPEARANCE_CONTRAST}
                min={MIN_APPEARANCE_CONTRAST}
                onChange={(event) => {
                  const appearanceContrast = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(appearanceContrast) &&
                    appearanceContrast >= MIN_APPEARANCE_CONTRAST &&
                    appearanceContrast <= MAX_APPEARANCE_CONTRAST
                  ) {
                    updateSettings({ appearanceContrast });
                  }
                }}
                step={5}
                style={appearanceContrastSliderStyle}
                type="range"
                value={settings.appearanceContrast}
              />
            </div>
          }
        />

        {showEnvironmentIdentification ? (
          <SettingsRow
            {...searchableSetting("environment-identification", translate)}
            description={translate("settings.appearance.environmentIdentificationDescription")}
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  label={translate("settings.appearance.environmentIdentification")}
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  if (value === "artwork" || value === "pill" || value === "none") {
                    updateSettings({ environmentIdentificationMode: value });
                  }
                }}
              >
                <SelectTrigger
                  className="w-full sm:w-40"
                  aria-label={translate("settings.appearance.environmentIdentification")}
                >
                  <SelectValue>
                    {translate(
                      ENVIRONMENT_IDENTIFICATION_MESSAGE_IDS[
                        settings.environmentIdentificationMode
                      ],
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(ENVIRONMENT_IDENTIFICATION_MESSAGE_IDS).map(
                    ([value, messageId]) => (
                      <SelectItem hideIndicator key={value} value={value}>
                        {translate(messageId)}
                      </SelectItem>
                    ),
                  )}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}

function useFontDefaultFamilies() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  // An unset preference shows the font it resolves to on this machine; the
  // default stacks are the platform's own faces, so the name is probed, not
  // hardcoded.
  const defaults = useMemo(
    () => ({
      sans:
        resolveDefaultFamilyLabel(DEFAULT_SANS_FONT_STACK) ??
        translate("settings.panels.appearance.timestamp.system"),
      code:
        resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK) ??
        translate("settings.panels.appearance.systemMonospace"),
    }),
    [translate],
  );
  return {
    sans: defaults.sans,
    code: defaults.code,
    // The composer inherits whatever the interface preference resolves to.
    interfaceFamily: settings.fontFamilySans.trim() || defaults.sans,
  };
}

function InterfaceFontRow({ preview }: { preview?: ReactNode }) {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("interface-font", translate)}
      description={translate("settings.appearance.uiFontDescription")}
      defaultFamily={defaults.sans}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilySans}
      value={settings.fontFamilySans}
      onValueChange={(fontFamilySans) => updateSettings({ fontFamilySans })}
      onReset={() =>
        updateSettings({
          fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
          fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
        })
      }
      size={{
        label: translate("settings.panels.appearance.interfaceFontSize"),
        min: MIN_INTERFACE_FONT_SIZE,
        max: MAX_INTERFACE_FONT_SIZE,
        value: settings.fontSizeInterface,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
        onChange: (fontSizeInterface) => updateSettings({ fontSizeInterface }),
      }}
      {...(preview !== undefined ? { preview } : {})}
    />
  );
}

function PromptFontRow() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("prompt-font", translate)}
      description={translate("settings.appearance.promptFontDescription")}
      defaultFamily={defaults.interfaceFamily}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer}
      value={settings.fontFamilyComposer}
      onValueChange={(fontFamilyComposer) => updateSettings({ fontFamilyComposer })}
      onReset={() =>
        updateSettings({
          fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
          fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
        })
      }
      size={{
        label: translate("settings.panels.appearance.promptFontSize"),
        min: MIN_PROMPT_FONT_SIZE,
        max: MAX_PROMPT_FONT_SIZE,
        value: settings.fontSizePrompt,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
        onChange: (fontSizePrompt) => updateSettings({ fontSizePrompt }),
      }}
      preview={<PromptFontPreview />}
    />
  );
}

function CodeFontRow({
  title,
  description,
  preview,
}: {
  title?: string;
  description?: string;
  preview?: ReactNode;
}) {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("code-font", translate)}
      {...(title !== undefined ? { title } : {})}
      description={description ?? translate("settings.appearance.codeFontDescription")}
      defaultFamily={defaults.code}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilyCode}
      value={settings.fontFamilyCode}
      onValueChange={(fontFamilyCode) => updateSettings({ fontFamilyCode })}
      onReset={() =>
        updateSettings({
          fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
          fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
        })
      }
      requireMonospace
      size={{
        label: translate("settings.panels.appearance.codeFontSize"),
        min: MIN_CODE_FONT_SIZE,
        max: MAX_CODE_FONT_SIZE,
        value: settings.fontSizeCode,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
        onChange: (fontSizeCode) => updateSettings({ fontSizeCode }),
      }}
      preview={preview ?? <CodeFontPreview />}
    />
  );
}

function TerminalFontRow() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const defaults = useFontDefaultFamilies();
  return (
    <FontFamilySettingsRow
      {...searchableSetting("terminal-font", translate)}
      description={translate("settings.appearance.terminalFontDescription")}
      defaultFamily={defaults.code}
      defaultValue={DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal}
      value={settings.fontFamilyTerminal}
      onValueChange={(fontFamilyTerminal) => updateSettings({ fontFamilyTerminal })}
      onReset={() =>
        updateSettings({
          fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
          fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
        })
      }
      requireMonospace
      size={{
        label: translate("settings.panels.appearance.terminalFontSize"),
        min: MIN_TERMINAL_FONT_SIZE,
        max: MAX_TERMINAL_FONT_SIZE,
        value: settings.fontSizeTerminal,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
        onChange: (fontSizeTerminal) => updateSettings({ fontSizeTerminal }),
      }}
      preview={
        <TerminalFontPreview
          family={resolveTerminalFontPreference({
            advanced: true,
            code: settings.fontFamilyCode,
            terminal: settings.fontFamilyTerminal,
          })}
          size={settings.fontSizeTerminal}
        />
      }
    />
  );
}

function FontSmoothingRow() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  if (!isMacPlatform(navigator.platform)) return null;
  return (
    <SettingsRow
      {...searchableSetting("font-smoothing", translate)}
      description={translate("settings.appearance.fontSmoothingDescription")}
      resetAction={
        settings.fontSmoothing !== DEFAULT_UNIFIED_SETTINGS.fontSmoothing ? (
          <SettingResetButton
            label={translate("settings.appearance.fontSmoothing")}
            onClick={() =>
              updateSettings({ fontSmoothing: DEFAULT_UNIFIED_SETTINGS.fontSmoothing })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.fontSmoothing}
          onCheckedChange={(checked) => updateSettings({ fontSmoothing: Boolean(checked) })}
          aria-label={translate("settings.appearance.fontSmoothing")}
        />
      }
    />
  );
}

function WordWrapRow() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  return (
    <SettingsRow
      {...searchableSetting("word-wrap", translate)}
      description={translate("settings.appearance.wordWrapDescription")}
      resetAction={
        settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? (
          <SettingResetButton
            label={translate("settings.appearance.wordWrap")}
            onClick={() => updateSettings({ wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap })}
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.wordWrap}
          onCheckedChange={(checked) => updateSettings({ wordWrap: Boolean(checked) })}
          aria-label={translate("settings.appearance.wordWrapAria")}
        />
      }
    />
  );
}

function FontSettingsGroup() {
  return (
    <>
      <InterfaceFontRow />
      <PromptFontRow />
      <CodeFontRow />
      <TerminalFontRow />
      <FontSmoothingRow />
    </>
  );
}

/**
 * The two-font view: one sans, one monospace. The prompt follows the
 * interface font and the terminal follows the monospace font, so the demos
 * under each row show every surface the choice reaches.
 */
function SimpleFontRows() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  return (
    <>
      <InterfaceFontRow preview={<PromptFontPreview />} />
      <CodeFontRow
        title={translate("settings.appearance.monospaceFont")}
        description={translate("settings.appearance.monospaceDescription")}
        preview={
          <>
            <CodeFontPreview />
            <TerminalFontPreview
              family={resolveTerminalFontPreference({
                advanced: false,
                code: settings.fontFamilyCode,
                terminal: settings.fontFamilyTerminal,
              })}
              size={resolveTerminalFontSizePreference({
                advanced: false,
                code: settings.fontSizeCode,
                terminal: settings.fontSizeTerminal,
              })}
            />
          </>
        }
      />
    </>
  );
}

// Font smoothing only renders on macOS, so a search jump to it elsewhere
// must not flip the section - the target would never mount to be scrolled to.
const ADVANCED_TYPOGRAPHY_TARGET_IDS: ReadonlySet<string> = new Set([
  "prompt-font",
  "terminal-font",
  ...(typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
    ? ["font-smoothing"]
    : []),
]);

/**
 * The two-font view by default - one sans, one monospace, each cascading to
 * every surface it reaches - with an Advanced switch in the section header
 * that reveals the per-surface override rows. The choice persists locally,
 * and a settings-search jump to an override row flips Advanced on so the
 * target exists to scroll to.
 */
function TypographySection() {
  const translate = useInterfaceTranslator().message;
  const [advanced, setAdvanced] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const searchTargetId = useSettingsSearchTargetId();
  // Flip Advanced on once per search jump so the hidden target can mount and
  // scroll; tracking the handled id lets the user turn it back off without
  // the still-set target immediately re-expanding the section.
  const lastExpandedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (searchTargetId === null || !ADVANCED_TYPOGRAPHY_TARGET_IDS.has(searchTargetId)) return;
    if (lastExpandedTargetRef.current === searchTargetId) return;
    lastExpandedTargetRef.current = searchTargetId;
    setAdvanced(true);
  }, [searchTargetId, setAdvanced]);
  return (
    <SettingsSection
      title={translate("settings.appearance.typography")}
      headerAction={
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          {translate("settings.panels.appearance.advanced")}
          <Switch
            checked={advanced}
            onCheckedChange={(checked) => setAdvanced(Boolean(checked))}
            aria-label={translate("settings.appearance.advancedTypography")}
          />
        </label>
      }
    >
      {advanced ? <FontSettingsGroup /> : <SimpleFontRows />}
      <WordWrapRow />
    </SettingsSection>
  );
}

function FontFamilySettingsRow({
  id,
  title,
  description,
  defaultFamily,
  defaultValue,
  preview,
  value,
  onValueChange,
  onReset,
  requireMonospace = false,
  size,
}: {
  id?: string;
  title: string;
  description: string;
  /** What an unset preference renders as, e.g. "Menlo". */
  defaultFamily: string;
  /** The persisted family value supplied by the unified settings defaults. */
  defaultValue: string;
  preview?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  onReset: () => void;
  requireMonospace?: boolean;
  size: {
    label: string;
    min: number;
    max: number;
    value: number;
    defaultValue: number;
    onChange: (v: number) => void;
  };
}) {
  const translate = useInterfaceTranslator().message;
  const trimmed = value.trim();
  // The fallback input edits a draft; the preference only commits once typing
  // pauses and the text probes as an available font (or is an explicit
  // clear), so the current font holds and nothing reflows mid-word.
  const [draft, setDraft] = useState(value);
  const [draftSettled, setDraftSettled] = useState(true);
  const commitTimerRef = useRef<number | null>(null);
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value) {
    // The committed value changed externally (hydration, reset, picker
    // selection); adopt it and drop any pending commit of a stale draft.
    lastValueRef.current = value;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setDraft(value);
    setDraftSettled(true);
  }
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );
  const acceptsFamily = (candidate: string) =>
    isFontFamilyAvailable(candidate) && (!requireMonospace || isMonospaceFamily(candidate));
  const commitDraft = (next: string) => {
    setDraftSettled(true);
    // A rejected name stays in the field, flagged: the terminal would silently
    // fall back to its default, so the row must not claim it took the value.
    if (next.trim().length === 0 || acceptsFamily(next)) {
      onValueChange(next);
    }
  };
  const flushDraft = () => {
    if (commitTimerRef.current === null) return;
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    commitDraft(draft);
  };
  const draftTrimmed = draft.trim();
  // Flag an unknown name only once typing pauses, and never for an empty
  // field - that is the starting state, not a rejected entry.
  const draftPending = draftSettled && draftTrimmed.length > 0 && draftTrimmed !== trimmed;
  const resetToDefault = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setDraft(defaultValue);
    setDraftSettled(true);
    onReset();
  };
  const resetAction =
    value !== defaultValue || size.value !== size.defaultValue ? (
      <SettingResetButton label={title.toLowerCase()} onClick={resetToDefault} />
    ) : null;
  const fontEnumeration = useFontEnumeration();
  // Everyone starts on the plain input; focusing it is the user gesture that
  // runs font discovery. Where the engine can enumerate, the control then
  // upgrades to the picker - popped open when the swap happens under focus,
  // so the interaction continues without a second click.
  const inputFocusedRef = useRef(false);
  const familyControl =
    fontEnumeration.status === "granted" ? (
      <FontFamilyPicker
        ariaLabel={translate("settings.panels.appearance.fontFamilyAria", { title })}
        defaultFamily={defaultFamily}
        selectedFamily={trimmed}
        requireMonospace={requireMonospace}
        initialOpen={inputFocusedRef.current}
        onSelect={onValueChange}
      />
    ) : (
      <Input
        aria-label={translate("settings.panels.appearance.fontFamilyAria", { title })}
        aria-invalid={draftPending || undefined}
        autoCapitalize="off"
        autoComplete="off"
        className="min-w-0 flex-1"
        maxLength={200}
        onFocus={() => {
          inputFocusedRef.current = true;
          discoverInstalledFonts();
        }}
        onBlur={() => {
          inputFocusedRef.current = false;
          flushDraft();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          setDraftSettled(false);
          if (commitTimerRef.current !== null) {
            window.clearTimeout(commitTimerRef.current);
          }
          commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            commitDraft(next);
          }, 400);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") flushDraft();
          if (event.key === "Escape") {
            // Discard uncommitted typing without closing the settings page,
            // which is what an unhandled Escape does.
            event.preventDefault();
            event.stopPropagation();
            if (commitTimerRef.current !== null) {
              window.clearTimeout(commitTimerRef.current);
              commitTimerRef.current = null;
            }
            setDraft(value);
            setDraftSettled(true);
          }
        }}
        placeholder={defaultFamily}
        spellCheck={false}
        value={draft}
      />
    );
  const control = (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">{familyControl}</div>
      <Select
        value={String(size.value)}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          const parsed = Number(next);
          if (Number.isInteger(parsed) && parsed >= size.min && parsed <= size.max) {
            size.onChange(parsed);
          }
        }}
      >
        <SelectTrigger className="w-22 shrink-0" aria-label={size.label}>
          <SelectValue>
            {size.value} {translate("settings.panels.appearance.pixels")}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {Array.from({ length: size.max - size.min + 1 }, (_, index) => size.min + index).map(
            (px) => (
              <SelectItem hideIndicator key={px} value={String(px)}>
                {px} {translate("settings.panels.appearance.pixels")}
              </SelectItem>
            ),
          )}
        </SelectPopup>
      </Select>
    </div>
  );
  return (
    <SettingsRow
      {...(id !== undefined ? { id } : {})}
      title={title}
      description={description}
      resetAction={resetAction}
      control={control}
    >
      {preview}
    </SettingsRow>
  );
}

// The legacy rows sit behind the fold, so a settings-search jump has to
// expand the section before its target can mount and scroll.
const LEGACY_FEATURE_TARGET_IDS: ReadonlySet<string> = new Set(["legacy-token-streaming"]);

/**
 * Retired features kept only for users who still depend on them. Collapsed by
 * default so they stay out of the everyday settings path; a settings-search
 * jump to one of the rows unfolds the section.
 */
function LegacyFeaturesSection() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [open, setOpen] = useState(false);
  const searchTargetId = useSettingsSearchTargetId();
  // Unfold once per search jump; tracking the handled id lets the user fold
  // the section back up without the still-set target immediately reopening it.
  const lastExpandedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (searchTargetId === null) {
      // A handled jump clears the target; forgetting it here lets a later
      // jump to the same row expand the section again.
      lastExpandedTargetRef.current = null;
      return;
    }
    if (!LEGACY_FEATURE_TARGET_IDS.has(searchTargetId)) return;
    if (lastExpandedTargetRef.current === searchTargetId) return;
    lastExpandedTargetRef.current = searchTargetId;
    setOpen(true);
  }, [searchTargetId]);

  return (
    <section className="space-y-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex min-h-8 w-full items-center gap-2 px-3 sm:px-4">
          <h2 className="text-lg font-semibold tracking-[-0.025em] text-muted-foreground transition-colors group-hover:text-foreground">
            {translate("settings.panels.legacy.title")}
          </h2>
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="relative space-y-1 overflow-visible pt-3 text-foreground">
            <SettingsRow
              {...searchableSetting("legacy-token-streaming", translate)}
              description={translate("settings.experimental.tokenDescription")}
              control={
                <Switch
                  checked={settings.enableLegacyTokenStreaming}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      updateSettings({
                        enableLegacyTokenStreaming: false,
                        enableAssistantStreaming: false,
                      });
                      return;
                    }
                    void (async () => {
                      const api = readLocalApi();
                      const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
                        [
                          translate("settings.panels.legacy.tokenConfirmTitle"),
                          translate("settings.panels.legacy.tokenConfirmDescription"),
                        ].join("\n"),
                      );
                      if (confirmed) {
                        updateSettings({
                          enableLegacyTokenStreaming: true,
                          enableAssistantStreaming: true,
                        });
                      }
                    })();
                  }}
                  aria-label={translate("settings.experimental.tokenAria")}
                />
              }
            />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}

export function GeneralSettingsPanel() {
  const translate = useInterfaceTranslator().message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [backgroundActivityDialogOpen, setBackgroundActivityDialogOpen] = useState(false);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const observability = useAtomValue(primaryServerObservabilityAtom);
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const diagnosticsDescription = formatDiagnosticsDescription(
    {
      localTracingEnabled: observability?.localTracingEnabled ?? false,
      otlpTracesEnabled: observability?.otlpTracesEnabled ?? false,
      otlpTracesUrl: observability?.otlpTracesUrl,
      otlpMetricsEnabled: observability?.otlpMetricsEnabled ?? false,
      otlpMetricsUrl: observability?.otlpMetricsUrl,
    },
    translate,
  );

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const activeBackgroundActivityProfile = resolvedBackgroundActivity.profile;
  const backgroundActivityProfileOption = resolveBackgroundActivityProfileOption(settings);
  const backgroundActivityDescription =
    backgroundActivityProfileOption === "advanced"
      ? translate("settings.panels.background.profile.advancedCurrentPolicy", {
          profile: translate(
            BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS[activeBackgroundActivityProfile],
          ),
        })
      : translate(
          BACKGROUND_ACTIVITY_PROFILE_DESCRIPTION_MESSAGE_IDS[resolvedBackgroundActivity.profile],
        );
  const canResetBackgroundActivity = !Equal.equals(
    settings.backgroundActivity,
    DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title={translate("settings.general.title")}>
        <SettingsRow
          {...searchableSetting("project-grouping", translate)}
          description={translate("settings.general.projectGroupingDescription")}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label={translate("settings.general.projectGrouping")}
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={translate("settings.general.projectGrouping")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("time-format", translate)}
          description={translate("settings.general.timeDescription")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label={translate("settings.general.timeFormat")}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label={translate("settings.general.timestampAria")}
              >
                <SelectValue>
                  {translate(TIMESTAMP_FORMAT_MESSAGE_IDS[settings.timestampFormat])}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {translate(TIMESTAMP_FORMAT_MESSAGE_IDS.locale)}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {translate(TIMESTAMP_FORMAT_MESSAGE_IDS["12-hour"])}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {translate(TIMESTAMP_FORMAT_MESSAGE_IDS["24-hour"])}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("hide-whitespace-changes", translate)}
          description={translate("settings.general.diffDescription")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label={translate("settings.general.diffWhitespace")}
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={translate("settings.general.diffWhitespaceAria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("skills-in-slash-menu", translate)}
          description={translate("settings.general.skillsSlashDescription")}
          resetAction={
            settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
              <SettingResetButton
                label={translate("settings.general.skillsSlash")}
                onClick={() =>
                  updateSettings({
                    showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.showSkillsInSlashMenu}
              onCheckedChange={(checked) =>
                updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
              }
              aria-label={translate("settings.general.skillsSlashAria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("provider-update-checks", translate)}
          description={translate("settings.general.providerUpdatesDescription")}
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label={translate("settings.general.providerUpdates")}
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={translate("settings.general.providerUpdatesAria")}
            />
          }
        />

        <SettingsRow
          title={
            <span className="inline-flex items-center gap-1.5">
              {translate("settings.general.backgroundActivity")}
              <PolicyTooltip>
                {translate("settings.panels.background.gateDescription")}
              </PolicyTooltip>
            </span>
          }
          description={backgroundActivityDescription}
          resetAction={
            canResetBackgroundActivity ? (
              <SettingResetButton
                label={translate("settings.general.backgroundActivity")}
                onClick={() => updateSettings(resetBackgroundActivitySettings())}
              />
            ) : null
          }
          control={
            <>
              <Select
                value={backgroundActivityProfileOption}
                onValueChange={(value) => {
                  if (value === "advanced") {
                    setBackgroundActivityDialogOpen(true);
                    return;
                  }
                  if (
                    value === "balanced" ||
                    value === "performance" ||
                    value === "battery-saver"
                  ) {
                    updateSettings(backgroundActivityProfileSettings(value));
                  }
                }}
              >
                <SelectTrigger
                  className="w-full sm:w-40"
                  aria-label={translate("settings.general.backgroundProfileAria")}
                >
                  <SelectValue>
                    {translate(
                      BACKGROUND_ACTIVITY_PROFILE_OPTION_MESSAGE_IDS[
                        backgroundActivityProfileOption
                      ],
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="balanced">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS.balanced)}
                  </SelectItem>
                  <SelectItem hideIndicator value="performance">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS.performance)}
                  </SelectItem>
                  <SelectItem hideIndicator value="battery-saver">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_MESSAGE_IDS["battery-saver"])}
                  </SelectItem>
                  <SelectItem hideIndicator value="advanced">
                    {translate(BACKGROUND_ACTIVITY_PROFILE_OPTION_MESSAGE_IDS.advanced)}
                  </SelectItem>
                </SelectPopup>
              </Select>
              {backgroundActivityProfileOption === "advanced" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={translate("settings.panels.background.advancedAria")}
                        onClick={() => setBackgroundActivityDialogOpen(true)}
                      >
                        <SettingsIcon className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">
                    {translate("settings.background.configure")}
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              <BackgroundActivityAdvancedDialog
                open={backgroundActivityDialogOpen}
                onOpenChange={setBackgroundActivityDialogOpen}
              />
            </>
          }
        />

        <SettingsRow
          {...searchableSetting("new-threads", translate)}
          description={translate("settings.general.defaultWorkspaceDescription")}
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ||
            settings.newWorktreesStartFromOrigin !==
              DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
              <SettingResetButton
                label={translate("settings.general.newThreads")}
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                    newWorktreesStartFromOrigin:
                      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger
                className="w-full sm:w-44"
                aria-label={translate("settings.general.defaultThreadModeAria")}
              >
                <SelectValue>
                  {translate(
                    settings.defaultThreadEnvMode === "worktree"
                      ? "settings.panels.general.newWorktree"
                      : "settings.panels.general.local",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  {translate("settings.panels.general.local")}
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  {translate("settings.panels.general.newWorktree")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        {settings.defaultThreadEnvMode === "worktree" ? (
          <SettingsRow
            className="bg-muted/20 sm:pl-9"
            title={searchableSetting("start-from-origin", translate).title}
            description={translate("settings.general.originWorktreeDescription")}
            resetAction={
              settings.newWorktreesStartFromOrigin !==
              DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
                <SettingResetButton
                  label={translate("settings.general.originWorktree")}
                  onClick={() =>
                    updateSettings({
                      newWorktreesStartFromOrigin:
                        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.newWorktreesStartFromOrigin}
                onCheckedChange={(checked) =>
                  updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
                }
                aria-label={translate("settings.general.originWorktreeAria")}
              />
            }
          />
        ) : null}

        <SettingsRow
          {...searchableSetting("add-project-starts-in", translate)}
          description={translate("settings.general.projectBaseDescription")}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label={translate("settings.general.projectBase")}
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              value={settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder="~/"
              spellCheck={false}
              aria-label={translate("settings.general.projectBase")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("unpin-confirmation", translate)}
          description={translate("settings.general.unpinDescription")}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                label={translate("settings.general.unpinConfirmation")}
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={translate("settings.general.unpinAria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("archive-confirmation", translate)}
          description={translate("settings.general.archiveDescription")}
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label={translate("settings.general.archiveConfirmation")}
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={translate("settings.general.archiveAria")}
            />
          }
        />

        <SettingsRow
          {...searchableSetting("delete-confirmation", translate)}
          description={translate("settings.general.deleteDescription")}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label={translate("settings.general.deleteConfirmation")}
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={translate("settings.general.deleteAria")}
            />
          }
        />

        {isElectron ? (
          <SettingsRow
            {...searchableSetting("quit-confirmation", translate)}
            description={translate("settings.general.quitDescription")}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  label={translate("settings.general.quitConfirmation")}
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.confirmQuit}
                onCheckedChange={(checked) => updateSettings({ confirmQuit: Boolean(checked) })}
                aria-label={translate("settings.general.quitAria")}
              />
            }
          />
        ) : null}

        <SettingsRow
          {...searchableSetting("text-generation-model", translate)}
          description={translate("settings.general.textModelDescription")}
          resetAction={
            isTextGenerationModelDirty ? (
              <SettingResetButton
                label={translate("settings.general.textModel")}
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={textGenerationModelInstanceEntries}
                modelOptionsByInstance={textGenerationModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={
                  // Use the exact instance's models (rather than the
                  // first-kind-match) so a custom text-gen instance like
                  // `codex_personal` gets its own model list, not the
                  // default Codex one.
                  textGenInstanceEntry?.models ?? []
                }
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                planModeEnabled={settings.planModeEnabled}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title={translate("settings.about.title")}>
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description={translate("settings.about.versionDescription")}
          />
        )}
        <SettingsRow
          {...searchableSetting("diagnostics", translate)}
          description={diagnosticsDescription}
          control={
            <Button render={<Link to="/settings/diagnostics" />} size="xs" variant="outline">
              {translate("settings.panels.about.viewDiagnostics")}
            </Button>
          }
        />
      </SettingsSection>

      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const translate = useInterfaceTranslator().message;
  const projects = useProjects();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);

  const archivedGroups = useMemo(() => {
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects.map(
          (project) =>
            [
              `${environmentId}:${project.id}`,
              {
                id: project.id,
                environmentId,
                name: project.title,
                cwd: project.workspaceRoot,
                faviconPath: project.faviconPath,
              },
            ] as const,
        ),
      ),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => ({
        ...thread,
        environmentId,
      })),
    );

    const archivedProjects = Array.from(projectsByEnvironmentAndId.values());
    const groups: Array<{
      readonly project: (typeof archivedProjects)[number];
      readonly threads: Array<(typeof threads)[number]>;
    }> = [];
    for (const project of archivedProjects) {
      const projectThreads: Array<(typeof threads)[number]> = [];
      for (const thread of threads) {
        if (thread.projectId === project.id && thread.environmentId === project.environmentId) {
          projectThreads.push(thread);
        }
      }
      if (projectThreads.length > 0) {
        groups.push({
          project,
          threads: projectThreads.toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
        });
      }
    }
    return groups;
  }, [archivedSnapshots]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: translate("settings.thread.unarchive") },
          { id: "delete", label: translate("settings.common.delete"), destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        const result = await unarchiveThread(threadRef);
        if (result._tag === "Success") {
          refreshArchivedThreads();
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translate("settings.panels.archive.unarchiveFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translate("settings.panels.archive.unexpectedError"),
            }),
          );
        }
        return;
      }

      if (clicked === "delete") {
        const result = await confirmAndDeleteThread(threadRef);
        if (result._tag === "Success") {
          refreshArchivedThreads();
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translate("settings.panels.archive.deleteFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translate("settings.panels.archive.unexpectedError"),
            }),
          );
        }
      }
    },
    [confirmAndDeleteThread, refreshArchivedThreads, translate, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection
          id={isLoadingArchive ? undefined : searchableSetting("archive", translate).id}
          title={searchableSetting("archive", translate).title}
        >
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? translate("settings.panels.archive.loading")
                  : archiveError
                    ? translate("settings.panels.archive.loadFailed")
                    : translate("settings.panels.archive.empty")}
              </span>
            }
            description={
              isLoadingArchive
                ? translate("settings.panels.archive.checking")
                : (archiveError ?? translate("settings.panels.archive.emptyDescription"))
            }
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }, index) => (
          <SettingsSection
            key={project.id}
            id={index === 0 ? searchableSetting("archive", translate).id : undefined}
            title={project.name}
            icon={
              <ProjectFavicon
                environmentId={project.environmentId}
                cwd={project.cwd}
                faviconPath={project.faviconPath}
              />
            }
          >
            {projectThreads.map((thread) => (
              <SettingsRow
                key={thread.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void (async () => {
                    const result = await settlePromise(() =>
                      handleArchivedThreadContextMenu(
                        scopeThreadRef(thread.environmentId, thread.id),
                        {
                          x: event.clientX,
                          y: event.clientY,
                        },
                      ),
                    );
                    if (result._tag === "Failure") {
                      const error = squashAtomCommandFailure(result);
                      toastManager.add(
                        stackedThreadToast({
                          type: "error",
                          title: translate("settings.panels.archive.actionFailed"),
                          description:
                            error instanceof Error
                              ? error.message
                              : translate("settings.panels.archive.unexpectedError"),
                        }),
                      );
                    }
                  })();
                }}
                title={thread.title}
                description={
                  translate("settings.panels.archive.archivedAt", {
                    date: formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt),
                  }) +
                  " \u00b7 " +
                  translate("settings.panels.archive.createdAt", {
                    date: formatRelativeTimeLabel(thread.createdAt),
                  })
                }
                control={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                    onClick={() => {
                      void (async () => {
                        const result = await unarchiveThread(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        if (result._tag === "Success") {
                          refreshArchivedThreads();
                          return;
                        }
                        if (!isAtomCommandInterrupted(result)) {
                          const error = squashAtomCommandFailure(result);
                          toastManager.add(
                            stackedThreadToast({
                              type: "error",
                              title: translate("settings.panels.archive.unarchiveFailed"),
                              description:
                                error instanceof Error
                                  ? error.message
                                  : translate("settings.panels.archive.unexpectedError"),
                            }),
                          );
                        }
                      })();
                    }}
                  >
                    <ArchiveX className="size-3.5" />
                    <span>{translate("settings.thread.unarchive")}</span>
                  </Button>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
