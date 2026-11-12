import { useNavigation } from "@react-navigation/native";
import { SettingsRow } from "./components/SettingsRow";
import { BrowserSearchSettings } from "../browser/BrowserSearchSettings";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { AppText as Text } from "../../components/ui/AppText";
import {
  type ResponseStreamingMode,
  type ServerSettings,
  type ServerSettingsPatch,
  type ThreadEnvMode,
  type WorktreeSubmodules,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectScopedServerSettingKey,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  RUNTIME_MODE_CHOICES,
  withManagedRuntimeModeLimits,
} from "../threads/thread-settings-options";
import { SettingsScreen } from "./components/SettingsScreen";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { BranchNamingSettings } from "./components/BranchNamingSettings";
import { DatabaseStorageNotice } from "./components/DatabaseStorageNotice";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SourceControlSignInSection } from "./components/SourceControlSignInSection";
import { SettingsProjectOverridesSection } from "./components/SettingsProjectOverridesSection";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { useSettingsWriter } from "./useSettingsWriter";
import {
  managedSettingReason,
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
  type ScopedMobileSettingsTarget,
} from "./settings-scoped-server";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { AutoSettleSettingsRows } from "./ThreadSettingsSections";
import { SourceControlWritingSettings } from "./components/SourceControlWritingSettings";
import { SettingsTextFieldSection } from "./components/SettingsTextFieldSection";
import {
  buildBackgroundActivityProfilePatch,
  uniformBackgroundActivityProfile,
  planMobileScopedSettingsTransform,
} from "./server-controls-settings";
import type { BackgroundActivityProfile } from "@t3tools/contracts";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

import { SnoozePresetsSettings } from "./SnoozePresetsSettings";
import { WorktreeCleanupSettings, StorageRetentionSettings } from "./StorageCleanupSettings";
import { BackgroundActivityOverrides } from "./BackgroundActivityOverrides";
import { ProjectSettingsSelect } from "./ProjectSettingsFields";

type SettingsPage = "threads" | "source-control" | "worktrees" | "maintenance";

const PAGE_TITLE_KEYS = {
  threads: "mobile.settings.section.threads",
  "source-control": "settings.application.title.sourceControl",
  worktrees: "mobile.settings.worktrees",
  maintenance: "mobile.settings.maintenance",
} as const satisfies Record<SettingsPage, string>;

const PAGE_PROJECT_KEYS: Record<SettingsPage, readonly ProjectScopedServerSettingKey[]> = {
  threads: [
    "defaultThreadEnvMode",
    "defaultRuntimeMode",
    "responseStreamingMode",
    "enableAgentBrowserAccess",
    "sidebarAutoSettleOnMerge",
    "sidebarAutoSettleAfterDays",
    "sidebarAutoSettleKeepPullRequests",
    "threadTitleInstructions",
  ],
  "source-control": [
    "pullRequestMergeMethod",
    "defaultAutoPull",
    "removeAgentCreditsOnMerge",
    "sourceControlWritingStyle",
    "sourceControlWriterModelSelection",
    "reviewGuideModelSelection",
    "reviewGuideInstructions",
  ],
  worktrees: [
    "worktreeCleanup",
    "newWorktreesStartFromOrigin",
    "worktreeSubmodules",
    "branchNamingMode",
    "branchNamePrefix",
    "branchNameInstructions",
  ],
  maintenance: ["continueThreadsAfterServerUpdate"],
};

const BACKGROUND_PROFILES = [
  [
    "balanced",
    "settings.panels.background.profile.balanced",
    "settings.panels.background.profile.balancedDescription",
  ],
  [
    "performance",
    "settings.panels.background.profile.performance",
    "settings.panels.background.profile.performanceDescription",
  ],
  [
    "battery-saver",
    "settings.panels.background.profile.batterySaver",
    "settings.panels.background.profile.batterySaverDescription",
  ],
] as const satisfies ReadonlyArray<readonly [BackgroundActivityProfile, string, string]>;

const SUBMODULE_CHOICES: ReadonlyArray<{
  readonly mode: WorktreeSubmodules | null;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: null,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.inherit");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.useTheRepositorysT3JsonOrInitialize");
    },
  },
  {
    mode: "recursive",
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.recursive");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.initializeNestedSubmodulesToo");
    },
  },
  {
    mode: "top-level",
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.topLevelOnly");
    },
    get description() {
      return currentInterfaceTranslator().message(
        "mobile.ui.skipSubmodulesDeclaredInsideOtherSubmodules",
      );
    },
  },
  {
    mode: "none",
    get label() {
      return currentInterfaceTranslator().message("git.operation.skip");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.leaveSubmodulesEmptyForASetupScript");
    },
  },
];

const WORKSPACE_CHOICES: ReadonlyArray<{
  readonly mode: ThreadEnvMode | null;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: null,
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.inherit");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.useTheRepositorysT3JsonOrThe");
    },
  },
  {
    mode: "local",
    get label() {
      return currentInterfaceTranslator().message(
        "settings.projects.detail.workspace.currentCheckout",
      );
    },
    get description() {
      return currentInterfaceTranslator().message(
        "mobile.ui.startNewThreadsInTheExistingWorkspace",
      );
    },
  },
  {
    mode: "worktree",
    get label() {
      return currentInterfaceTranslator().message("mobile.settings.projects.settings.newWorktree");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.giveEachNewThreadASeparateCheckout");
    },
  },
];

const STREAMING_CHOICES: ReadonlyArray<{
  readonly mode: ResponseStreamingMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "turn",
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.afterTheTurn");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.showTheAnswerWhenTheAgentFinishes");
    },
  },
  {
    mode: "paragraph",
    get label() {
      return currentInterfaceTranslator().message("mobile.ui.finishedParagraphs");
    },
    get description() {
      return currentInterfaceTranslator().message("mobile.ui.showEachParagraphOrCodeBlockAs");
    },
  },
];

// Only servers with thread auto-settlement store these, so other targets get the rest of a patch.
const AUTO_SETTLE_SETTING_KEYS: ReadonlySet<string> = new Set([
  "sidebarAutoSettleOnMerge",
  "sidebarAutoSettleAfterDays",
  "sidebarAutoSettleKeepPullRequests",
  "autoResumeLimitedThreads",
  "snoozeLimitedThreads",
]);

function planServerSettingsWrites(
  targets: readonly ScopedMobileSettingsTarget[],
  projectSelected: boolean,
  patch: ServerSettingsPatch,
) {
  const capable = targets.filter((target) => supportsSharedSettingsSync(target.environment));
  const others = targets.filter((target) => !supportsSharedSettingsSync(target.environment));
  const othersPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => !AUTO_SETTLE_SETTING_KEYS.has(key)),
  ) as ServerSettingsPatch;
  return [
    ...planMobileScopedSettingsPatch(capable, projectSelected, patch),
    ...(Object.keys(othersPatch).length > 0
      ? planMobileScopedSettingsPatch(others, projectSelected, othersPatch)
      : []),
  ];
}

export function SettingsThreadsRouteScreen() {
  return <ServerSettingsDetail page="threads" />;
}

export function SettingsEnvironmentSourceControlRouteScreen() {
  return <ServerSettingsDetail page="source-control" />;
}

export function SettingsWorktreesRouteScreen() {
  return <ServerSettingsDetail page="worktrees" />;
}

export function SettingsEnvironmentMaintenanceRouteScreen() {
  return <ServerSettingsDetail page="maintenance" />;
}

function ServerSettingsDetail(props: { readonly page: SettingsPage }) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const writableEnvironments = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const projectSelected = selectedProjectKey !== null;
  const targets = resolveMobileSettingsTargets(
    selectedTargets,
    projectSelected ? (selectedProject?.members.map((member) => member.project) ?? []) : null,
  );
  const [pendingWrites, setPendingWrites] = useState(0);
  const writeInFlight = useRef(false);
  // Closing views can save after controls disable; queue those patches behind the pending write.
  const queuedPatch = useRef<{ key: string; patch: ServerSettingsPatch } | null>(null);
  const targetsKey = targets
    .map((target) => `${target.environment.environmentId}:${target.projectId}`)
    .join(",");
  const [pendingTargets, setPendingTargets] = useState<
    readonly ScopedMobileSettingsTarget[] | null
  >(null);
  const canWriteSettings =
    targets.length > 0 &&
    targets.every((target) => writableEnvironments.has(target.environment.environmentId));
  const displayTargets = pendingWrites > 0 && pendingTargets !== null ? pendingTargets : targets;
  const hasConnectedSelection = targets.length > 0;
  const reference = displayTargets[0] ?? null;
  const uniform = <K extends keyof ServerSettings>(key: K) =>
    uniformMobileSetting(displayTargets, key);
  // `uniform` folds a real null into "mixed"; nullable keys need the distinction.
  const isMixed = (key: keyof ServerSettings) =>
    reference === null ||
    displayTargets.some((entry) => entry.settings[key] !== reference.settings[key]);
  const writeSettings = useSettingsWriter();
  const write = (patch: ServerSettingsPatch) => {
    if (writeInFlight.current) {
      const queued = queuedPatch.current;
      queuedPatch.current = {
        key: targetsKey,
        patch: queued?.key === targetsKey ? { ...queued.patch, ...patch } : patch,
      };
      return;
    }
    if (
      !hasConnectedSelection ||
      !targets.every((target) =>
        readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes = planServerSettingsWrites(targets, projectSelected, patch);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(targets);
    setPendingWrites((count) => count + 1);
    void writeSettings(targets, writes).finally(() => {
      writeInFlight.current = false;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
      const queued = queuedPatch.current;
      queuedPatch.current = null;
      // These targets may not show this write yet, so send it again with the
      // queued patch; project overrides are replaced whole.
      if (queued?.key === targetsKey) write({ ...patch, ...queued.patch });
    });
  };
  const clearProjectOverrides = () => {
    if (
      writeInFlight.current ||
      !targets.every((target) =>
        readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes = planMobileScopedSettingsClear(targets, PAGE_PROJECT_KEYS[props.page]);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(targets);
    setPendingWrites((count) => count + 1);
    void writeSettings(targets, writes).finally(() => {
      writeInFlight.current = false;
      // Resending a draft over these pre-clear targets would undo the clear.
      queuedPatch.current = null;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
    });
  };
  const writeEach = (build: (settings: ServerSettings) => ServerSettingsPatch) => {
    if (
      writeInFlight.current ||
      targets.length === 0 ||
      !targets.every((target) =>
        readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes = planMobileScopedSettingsTransform(targets, projectSelected, build);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(targets);
    setPendingWrites((count) => count + 1);
    void writeSettings(targets, writes).finally(() => {
      writeInFlight.current = false;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
      const queued = queuedPatch.current;
      queuedPatch.current = null;
      if (queued?.key === targetsKey) write(queued.patch);
    });
  };
  const disabled = !canWriteSettings || pendingWrites > 0 || !hasConnectedSelection;
  const managed = (...keys: string[]) => managedSettingReason(targets, ...keys);
  // A locked row keeps its explanation and says who manages it.
  const managedSubtitle = (key: string, subtitle: string) => {
    const reason = managed(key);
    return reason === undefined ? subtitle : `${subtitle} ${reason}`;
  };
  const runtimeModeChoices = withManagedRuntimeModeLimits(
    RUNTIME_MODE_CHOICES,
    targets.map((target) => target.environment.serverConfig.managedPolicy),
  );
  const disabledFor = (key: string) =>
    disabled ||
    managed(key) !== undefined ||
    (projectSelected &&
      !PROJECT_SCOPED_SERVER_SETTING_KEYS.includes(
        key as (typeof PROJECT_SCOPED_SERVER_SETTING_KEYS)[number],
      ));

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen
        title={translator.message(PAGE_TITLE_KEYS[props.page])}
        trailing={<AndroidSettingsEnvironmentFilter />}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {!hasConnectedSelection || reference === null ? (
            <Text className="px-2 text-base text-foreground-muted">
              {projectSelected
                ? translator.message("mobile.ui.selectAProjectWithACheckoutOn")
                : translator.message("mobile.ui.useTheFilterAboveToSelectA")}
            </Text>
          ) : (
            <>
              <ManagedPolicyNotice targets={targets} />
              {projectSelected ? (
                <SettingsProjectOverridesSection
                  projectLabel={
                    selectedProject?.label ??
                    translator.message("settings.application.scope.unavailableProject")
                  }
                  hasOverrides={targets.some((target) =>
                    PAGE_PROJECT_KEYS[props.page].some((key) => target.sources[key] === "project"),
                  )}
                  pending={pendingWrites > 0}
                  disabled={!canWriteSettings}
                  onClear={clearProjectOverrides}
                />
              ) : null}
              {props.page === "threads" ? (
                <>
                  <SettingsSection
                    title={translator.message("mobile.ui.defaultWorkspace")}
                    footer={managed("defaultThreadEnvMode")}
                    trailing={
                      pendingWrites === 0 && isMixed("defaultThreadEnvMode") ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {WORKSPACE_CHOICES.filter(
                      (choice) => choice.mode !== null || !projectSelected,
                    ).map((choice, index) => (
                      <SettingsChoiceRow
                        key={choice.mode ?? "inherit"}
                        label={choice.label}
                        description={choice.description}
                        selected={
                          !isMixed("defaultThreadEnvMode") &&
                          uniform("defaultThreadEnvMode") === choice.mode
                        }
                        separated={index > 0}
                        disabled={disabledFor("defaultThreadEnvMode")}
                        onPress={() => write({ defaultThreadEnvMode: choice.mode })}
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection
                    title={translator.message("mobile.ui.defaultPermissions")}
                    footer={managed("defaultRuntimeMode")}
                    trailing={
                      pendingWrites === 0 && uniform("defaultRuntimeMode") === null ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {runtimeModeChoices.map((choice, index) => (
                      <SettingsChoiceRow
                        key={choice.mode}
                        label={choice.label}
                        description={choice.disabledReason ?? choice.description}
                        selected={uniform("defaultRuntimeMode") === choice.mode}
                        separated={index > 0}
                        disabled={
                          disabledFor("defaultRuntimeMode") || choice.disabledReason !== undefined
                        }
                        onPress={() => write({ defaultRuntimeMode: choice.mode })}
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection
                    title={translator.message("mobile.ui.responseStreaming")}
                    footer={managed("responseStreamingMode")}
                    trailing={
                      pendingWrites === 0 && uniform("responseStreamingMode") === null ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {STREAMING_CHOICES.map((choice, index) => (
                      <SettingsChoiceRow
                        key={choice.mode}
                        label={choice.label}
                        description={choice.description}
                        selected={uniform("responseStreamingMode") === choice.mode}
                        separated={index > 0}
                        disabled={disabledFor("responseStreamingMode")}
                        onPress={() => write({ responseStreamingMode: choice.mode })}
                      />
                    ))}
                  </SettingsSection>
                  <SettingsSection title={translator.message("mobile.ui.previewBrowser")}>
                    <SettingsSwitchRow
                      icon="globe"
                      label={translator.message("settings.application.title.agentBrowserAccess")}
                      subtitle={managedSubtitle(
                        "enableAgentBrowserAccess",
                        translator.message("mobile.ui.allowAgentsToUseTheInApp"),
                      )}
                      value={uniform("enableAgentBrowserAccess")}
                      disabled={disabledFor("enableAgentBrowserAccess")}
                      onValueChange={(value) => write({ enableAgentBrowserAccess: value })}
                    />
                  </SettingsSection>
                  <BrowserSearchSettings />
                  <SettingsSection title={translator.message("mobile.projects.scripts.title")}>
                    <SettingsRow
                      icon="terminal"
                      label={translator.message("mobile.projects.scripts.title")}
                      target="SettingsProjectScripts"
                    />
                  </SettingsSection>
                  <AutoSettleSettingsRows write={write} pending={pendingWrites > 0} />
                  {!projectSelected ? (
                    <SnoozePresetsSettings
                      key={`${targetsKey}:${JSON.stringify(reference.settings.snoozePresets)}`}
                      presets={reference.settings.snoozePresets}
                      disabled={disabledFor("snoozePresets")}
                      onSave={(snoozePresets) => write({ snoozePresets })}
                    />
                  ) : null}
                  <SettingsTextFieldSection
                    key={targetsKey}
                    title={translator.message("mobile.ui.threadTitles")}
                    footer={
                      managed("threadTitleInstructions") ??
                      translator.message("mobile.ui.threadTitleInstructionsDescription")
                    }
                    label={translator.message("mobile.ui.threadTitleInstructions")}
                    placeholder={translator.message("mobile.ui.threadTitleInstructionsPlaceholder")}
                    mixedPlaceholder={translator.message(
                      "mobile.ui.mixedEnterInstructionsForAllSelectedTargets",
                    )}
                    value={uniform("threadTitleInstructions")}
                    disabled={disabledFor("threadTitleInstructions")}
                    onCommit={(threadTitleInstructions) => write({ threadTitleInstructions })}
                  />
                </>
              ) : null}

              {props.page === "source-control" ? (
                <>
                  {projectSelected ? null : (
                    <SourceControlSignInSection
                      environments={selectedTargets}
                      canWrite={(environmentId) => writableEnvironments.has(environmentId)}
                    />
                  )}
                  <SettingsSection title={translator.message("mobile.ui.pullRequests")}>
                    <SettingsSwitchRow
                      icon={PullRequestGlyph.merged}
                      label={translator.message("mobile.ui.removeAgentCreditsWhenMerging")}
                      subtitle={managedSubtitle(
                        "removeAgentCreditsOnMerge",
                        translator.message("mobile.ui.removeRecognizedAgentCreditsFromMergeAnd"),
                      )}
                      value={uniform("removeAgentCreditsOnMerge")}
                      disabled={disabledFor("removeAgentCreditsOnMerge")}
                      onValueChange={(value) => write({ removeAgentCreditsOnMerge: value })}
                    />
                  </SettingsSection>
                  <SettingsSection title={translator.message("mobile.projects.merge.title")}>
                    <ProjectSettingsSelect
                      label={translator.message("mobile.projects.merge.title")}
                      value={
                        isMixed("pullRequestMergeMethod")
                          ? null
                          : (reference.settings.pullRequestMergeMethod ?? "last")
                      }
                      options={(["last", "merge", "squash", "rebase"] as const).map((value) => ({
                        value,
                        label: translator.message(`mobile.projects.merge.${value}`),
                      }))}
                      disabled={disabledFor("pullRequestMergeMethod")}
                      onChange={(value) =>
                        write({ pullRequestMergeMethod: value === "last" ? null : value })
                      }
                    />
                  </SettingsSection>
                  <SourceControlWritingSettings
                    key={targetsKey}
                    targets={displayTargets}
                    projectSelected={projectSelected}
                    pending={pendingWrites > 0}
                    disabledFor={disabledFor}
                    managed={managed}
                    write={write}
                  />
                  <SettingsSection title={translator.message("mobile.git.defaultBranch")}>
                    <SettingsSwitchRow
                      icon="arrow.down.circle"
                      label={translator.message("mobile.ui.automaticallyPull")}
                      subtitle={managedSubtitle(
                        "defaultAutoPull",
                        translator.message("mobile.ui.keepTheDefaultBranchCurrentWhenThere"),
                      )}
                      value={uniform("defaultAutoPull")}
                      disabled={disabledFor("defaultAutoPull")}
                      onValueChange={(value) => write({ defaultAutoPull: value })}
                    />
                  </SettingsSection>
                </>
              ) : null}

              {props.page === "worktrees" ? (
                <>
                  <SettingsSection title={translator.message("mobile.ui.newWorktrees")}>
                    <SettingsSwitchRow
                      icon="arrow.triangle.branch"
                      label={translator.message("mobile.ui.startFromRemote")}
                      subtitle={managedSubtitle(
                        "newWorktreesStartFromOrigin",
                        translator.message("mobile.ui.usesTheLatestCommitOfTheBase"),
                      )}
                      value={uniform("newWorktreesStartFromOrigin")}
                      disabled={disabledFor("newWorktreesStartFromOrigin")}
                      onValueChange={(value) => write({ newWorktreesStartFromOrigin: value })}
                    />
                  </SettingsSection>
                  <SettingsSection
                    title={translator.message("mobile.ui.worktreeSubmodules")}
                    footer={managed("worktreeSubmodules")}
                    trailing={
                      pendingWrites === 0 && isMixed("worktreeSubmodules") ? (
                        <MixedValuesLabel projectSelected={projectSelected} />
                      ) : null
                    }
                  >
                    {SUBMODULE_CHOICES.filter(
                      (choice) => choice.mode !== null || !projectSelected,
                    ).map((choice, index) => (
                      <SettingsChoiceRow
                        key={choice.mode ?? "inherit"}
                        label={choice.label}
                        description={choice.description}
                        selected={
                          !isMixed("worktreeSubmodules") &&
                          uniform("worktreeSubmodules") === choice.mode
                        }
                        separated={index > 0}
                        disabled={disabledFor("worktreeSubmodules")}
                        onPress={() => write({ worktreeSubmodules: choice.mode })}
                      />
                    ))}
                  </SettingsSection>
                  <BranchNamingSettings
                    key={targetsKey}
                    mode={uniform("branchNamingMode")}
                    prefix={uniform("branchNamePrefix")}
                    instructions={uniform("branchNameInstructions")}
                    disabled={{
                      mode: disabledFor("branchNamingMode"),
                      prefix: disabledFor("branchNamePrefix"),
                      instructions: disabledFor("branchNameInstructions"),
                    }}
                    onChange={write}
                  />
                  <WorktreeCleanupSettings
                    key={targetsKey}
                    targets={displayTargets}
                    projectSelected={projectSelected}
                    disabledFor={disabledFor}
                    writeEach={writeEach}
                  />
                  {!projectSelected ? (
                    <SettingsTextFieldSection
                      key={`worktrees-path:${targetsKey}`}
                      title={translator.message("mobile.projects.cleanup.directory")}
                      label={translator.message("mobile.projects.cleanup.directory")}
                      footer={
                        managed("worktreesDirectory") ??
                        translator.message("mobile.projects.cleanup.directoryDescription")
                      }
                      placeholder=""
                      mixedPlaceholder={translator.message("git.operation.mixed")}
                      value={uniform("worktreesDirectory")}
                      disabled={disabledFor("worktreesDirectory")}
                      onCommit={(worktreesDirectory) => write({ worktreesDirectory })}
                    />
                  ) : null}
                </>
              ) : null}

              {props.page === "maintenance" ? (
                <>
                  {!projectSelected ? (
                    <DatabaseStorageNotice
                      targets={selectedTargets.filter(
                        (target) =>
                          target.serverConfig.environment.capabilities.databaseStorage === true,
                      )}
                    />
                  ) : null}
                  {!projectSelected ? (
                    <SettingsSection title={translator.message("mobile.ui.manageEnvironments")}>
                      {selectedTargets.map((target) => (
                        <SettingsRow
                          key={target.environmentId}
                          icon="server.rack"
                          label={target.label}
                          value={translator.message("mobile.ui.serverAndProviderUpdates")}
                          onPress={() =>
                            navigation.navigate("SettingsEnvironmentDetail", {
                              environmentId: target.environmentId,
                            })
                          }
                        />
                      ))}
                    </SettingsSection>
                  ) : null}
                  {!projectSelected ? (
                    <SettingsSection
                      title={translator.message("settings.general.backgroundActivity")}
                      footer={managed("backgroundActivity")}
                      trailing={
                        pendingWrites === 0 &&
                        uniformBackgroundActivityProfile(displayTargets) === null ? (
                          <MixedValuesLabel projectSelected={false} />
                        ) : null
                      }
                    >
                      {BACKGROUND_PROFILES.map(([profile, label, description], index) => (
                        <SettingsChoiceRow
                          key={profile}
                          label={translator.message(label)}
                          description={translator.message(description)}
                          selected={uniformBackgroundActivityProfile(displayTargets) === profile}
                          separated={index > 0}
                          disabled={disabledFor("backgroundActivity")}
                          onPress={() =>
                            writeEach((settings) =>
                              buildBackgroundActivityProfilePatch(settings, profile),
                            )
                          }
                        />
                      ))}
                    </SettingsSection>
                  ) : null}
                  {!projectSelected ? (
                    <SettingsSection title={translator.message("mobile.projects.devices.title")}>
                      <SettingsRow
                        icon="iphone"
                        label={translator.message("mobile.projects.devices.title")}
                        target="SettingsDevices"
                      />
                    </SettingsSection>
                  ) : null}
                  {!projectSelected ? (
                    <>
                      <BackgroundActivityOverrides
                        key={targetsKey}
                        targets={displayTargets}
                        disabledFor={disabledFor}
                        writeEach={writeEach}
                      />
                      <StorageRetentionSettings
                        key={targetsKey}
                        targets={displayTargets}
                        disabledFor={disabledFor}
                        write={write}
                      />
                    </>
                  ) : null}
                  <SettingsSection title={translator.message("mobile.ui.updates")}>
                    <SettingsSwitchRow
                      icon="arrow.clockwise"
                      label={translator.message("mobile.ui.checkProviderUpdates")}
                      subtitle={managedSubtitle(
                        "enableProviderUpdateChecks",
                        projectSelected
                          ? translator.message(
                              "mobile.ui.environmentWideSettingSelectAllProjectsTo",
                            )
                          : translator.message(
                              "mobile.ui.checkInstalledProviderClisForNewerVersions",
                            ),
                      )}
                      value={uniform("enableProviderUpdateChecks")}
                      disabled={disabledFor("enableProviderUpdateChecks")}
                      onValueChange={(value) => write({ enableProviderUpdateChecks: value })}
                    />
                    <View className="border-t border-border-subtle">
                      <SettingsSwitchRow
                        icon="arrow.uturn.forward"
                        label={translator.message("mobile.ui.continueAfterRestart")}
                        subtitle={managedSubtitle(
                          "continueThreadsAfterServerUpdate",
                          translator.message("mobile.ui.resumeInterruptedThreadsAfterAnUpdateOr"),
                        )}
                        value={uniform("continueThreadsAfterServerUpdate")}
                        disabled={disabledFor("continueThreadsAfterServerUpdate")}
                        onValueChange={(value) =>
                          write({ continueThreadsAfterServerUpdate: value })
                        }
                      />
                    </View>
                  </SettingsSection>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function MixedValuesLabel(props: { readonly projectSelected: boolean }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Text
      accessibilityLabel={
        props.projectSelected
          ? translator.message("mobile.ui.selectedProjectCheckoutsUseDifferentValues")
          : translator.message("mobile.ui.selectedEnvironmentsUseDifferentValues")
      }
      className="px-2 text-sm text-foreground-muted android:px-4"
    >
      {translator.message("git.operation.mixed")}
    </Text>
  );
}

/** Locked settings are refused when saved; say so before the user tries. */
function ManagedPolicyNotice(props: { readonly targets: readonly ScopedMobileSettingsTarget[] }) {
  const organizations = [
    ...new Set(
      props.targets.flatMap((target) => {
        const policy = target.environment.serverConfig.managedPolicy;
        return policy !== undefined && policy.lockedSettings.length > 0
          ? [policy.organization]
          : [];
      }),
    ),
  ];
  if (organizations.length === 0) return null;
  return (
    <Text className="px-2 text-sm text-foreground-muted android:px-4">
      Some settings are managed by {organizations.join(", ")} and cannot be changed here.
    </Text>
  );
}
