import { Button } from "../../components/ui/Button";
import {
  AuthSettingsWriteScope,
  isManagedSettingPath,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { useEnvironmentsWithScope } from "../../state/session";
import { AutoSettleDaysField } from "./components/AutoSettleDaysField";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { planAutoSettleSettingsSync, type AutoSettleSettings } from "./autoSettleSettingsSync";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import {
  managedSettingReason,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
} from "./settings-scoped-server";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";

export function SettingsLabsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();

  return (
    <SettingsScreen title={translator.message("mobile.settings.labs")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <BetaSettingsSection />
        <ParityLabsSettingsSection />
        <LegacySettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_SERVER_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

/**
 * Usage-limit and auto-settle rows. The Threads page owns their writes, so they share its queue
 * with the page's other project overrides, and their project override reset.
 */
export function AutoSettleSettingsRows(props: {
  readonly write: (patch: ServerSettingsPatch) => void;
  readonly pending: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const writableEnvironments = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const projectSelected = selectedProjectKey !== null;

  const projectMembers = projectSelected
    ? (selectedProject?.members.map((member) => member.project) ?? [])
    : null;
  const displayTargets = resolveMobileSettingsTargets(
    selectedTargets.filter(supportsSharedSettingsSync),
    projectMembers,
  );
  // The page saves to all its targets, so any read-only one blocks the save.
  const canWriteSettings =
    displayTargets.length > 0 &&
    resolveMobileSettingsTargets(selectedTargets, projectMembers).every((target) =>
      writableEnvironments.has(target.environment.environmentId),
    );
  const reference = displayTargets[0] ?? null;
  const referenceSettings = reference?.settings ?? null;

  if (reference === null || referenceSettings === null) {
    return null;
  }

  const writeToAll = (
    patch: Partial<AutoSettleSettings> & {
      autoResumeLimitedThreads?: boolean;
      snoozeLimitedThreads?: boolean;
      sidebarAutoSettleKeepPullRequests?: boolean;
    },
  ) => props.write(patch);

  const { patch: autoSettlePatch, mismatches } = planAutoSettleSettingsSync(
    {
      environmentId: reference.environment.environmentId,
      projectId: reference.projectId,
      settings: referenceSettings,
    },
    displayTargets.map((target) => ({
      environmentId: target.environment.environmentId,
      projectId: target.projectId,
      label: target.environment.label,
      settings: target.settings,
    })),
  );

  const disabled = !canWriteSettings || props.pending;
  const disabledFor = (...keys: string[]) =>
    disabled || managedSettingReason(displayTargets, ...keys) !== undefined;
  const afterDays = referenceSettings.sidebarAutoSettleAfterDays;

  return (
    <View className="gap-6">
      {!projectSelected ? (
        <SettingsSection title={translator.message("mobile.ui.usageLimits")}>
          <SettingsSwitchRow
            icon="clock"
            label={translator.message("mobile.ui.resumeAfterUsageLimits")}
            subtitle={translator.message(
              "mobile.ui.automaticallyResumeThreadsWhenTheirUsageLimits",
            )}
            value={uniformMobileSetting(displayTargets, "autoResumeLimitedThreads")}
            disabled={disabledFor("autoResumeLimitedThreads")}
            onValueChange={(value) => writeToAll({ autoResumeLimitedThreads: value })}
          />
          <SettingsSwitchRow
            icon="clock"
            label={translator.message("mobile.ui.snoozeUntilLimitsReset")}
            subtitle={translator.message("mobile.ui.snoozeThreadsUntilTheirUsageLimitsReset")}
            value={uniformMobileSetting(displayTargets, "snoozeLimitedThreads")}
            disabled={disabledFor("snoozeLimitedThreads")}
            onValueChange={(value) => writeToAll({ snoozeLimitedThreads: value })}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title={translator.message("settings.general.autoSettle")}>
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label={translator.message("mobile.settings.autoSettleMergedThreads")}
          value={referenceSettings.sidebarAutoSettleOnMerge}
          disabled={disabledFor("sidebarAutoSettleOnMerge")}
          onValueChange={(value) => writeToAll({ sidebarAutoSettleOnMerge: value })}
        />
        <SettingsSwitchRow
          icon="clock"
          label={translator.message("settings.application.title.autoSettleInactive")}
          value={afterDays !== null}
          disabled={disabledFor("sidebarAutoSettleAfterDays")}
          onValueChange={(value) =>
            writeToAll({ sidebarAutoSettleAfterDays: value ? AUTO_SETTLE_DEFAULT_DAYS : null })
          }
        />
        {afterDays !== null ? (
          <View className="flex-row items-center gap-4 px-4 py-4 android:min-h-14 android:py-3">
            <View className="w-[22px] android:w-6" />
            <Text className="flex-1 text-foreground text-lg android:text-base">
              {translator.message("mobile.ui.inactiveDays")}
            </Text>
            <AutoSettleDaysField
              value={afterDays}
              disabled={disabledFor("sidebarAutoSettleAfterDays")}
              onValueChange={(value) => writeToAll({ sidebarAutoSettleAfterDays: value })}
            />
          </View>
        ) : null}
        {afterDays !== null ? (
          <SettingsSwitchRow
            icon="arrow.triangle.branch"
            label={translator.message("mobile.ui.keepThreadsWithPullRequest")}
            subtitle={translator.message("mobile.ui.keepThreadsWithPullRequestDescription")}
            value={uniformMobileSetting(displayTargets, "sidebarAutoSettleKeepPullRequests")}
            disabled={disabledFor("sidebarAutoSettleKeepPullRequests")}
            onValueChange={(value) => writeToAll({ sidebarAutoSettleKeepPullRequests: value })}
          />
        ) : null}
      </SettingsSection>
      {!props.pending && mismatches.length > 0 ? (
        <SettingsSection title={translator.message("mobile.ui.acrossEnvironments")}>
          <View className="gap-3 p-4">
            <Text className="text-base text-foreground">
              {translator.message("mobile.ui.autoSettleDefaultsDiffer")}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {mismatches.map((mismatch) => mismatch.label).join(", ")}
            </Text>
            <Button
              label={translator.message("mobile.ui.applyAutoSettleDefaults")}
              tone="secondary"
              disabled={disabledFor("sidebarAutoSettleOnMerge", "sidebarAutoSettleAfterDays")}
              onPress={() => writeToAll(autoSettlePatch)}
            />
          </View>
        </SettingsSection>
      ) : null}
    </View>
  );
}

export function WorkingSectionSettings() {
  const translator = useMobileInterfaceTranslator();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const workingShelfEnabled =
    AsyncResult.isSuccess(preferences) && preferences.value.workingShelfEnabled !== false;

  return (
    <View className="gap-3">
      <SettingsSection title={translator.message("mobile.appearance.sidebar")}>
        <SettingsSwitchRow
          icon="bolt.circle"
          label={translator.message("mobile.ui.workingSection")}
          value={workingShelfEnabled}
          onValueChange={(value) => savePreferences({ workingShelfEnabled: value })}
        />
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        {translator.message("mobile.ui.foldWorkingAndMonitoringThreadsIntoA")}
      </Text>
    </View>
  );
}

export function NewThreadSettingsSection() {
  const translator = useMobileInterfaceTranslator();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const useLastProject =
    AsyncResult.isSuccess(preferences) && preferences.value.useLastProjectForNewThreads !== false;

  return (
    <SettingsSection title={translator.message("settings.application.title.newThreads")}>
      <SettingsSwitchRow
        icon="square.and.pencil"
        label={translator.message("mobile.ui.useLastProject")}
        subtitle={translator.message("mobile.ui.startNewThreadsInTheLastProject")}
        value={useLastProject}
        onValueChange={(value) => savePreferences({ useLastProjectForNewThreads: value })}
      />
    </SettingsSection>
  );
}

/** Per machine, since each machine's own setting decides whether it links and answers links. */
function BetaSettingsSection() {
  const translator = useMobileInterfaceTranslator();
  const { environments } = useEnvironments();
  const supported = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.peerLinks === true,
  );
  const writable = useEnvironmentsWithScope(supported, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "linked environments beta update",
    reportFailure: true,
  });
  if (supported.length === 0) return null;
  return (
    <View className="gap-3">
      <SettingsSection title={translator.message("mobile.ui.betaLinkedEnvironments")}>
        {supported.map((environment) => {
          const policy = environment.serverConfig?.managedPolicy;
          const managed = isManagedSettingPath(policy, "linkedEnvironmentsEnabled");
          return (
            <SettingsSwitchRow
              key={environment.environmentId}
              icon="link"
              label={environment.label}
              {...(managed ? { subtitle: `Managed by ${policy?.organization}.` } : {})}
              value={environment.serverConfig?.settings.linkedEnvironmentsEnabled === true}
              disabled={managed || !writable.has(environment.environmentId)}
              onValueChange={(value) =>
                void updateSettings({
                  environmentId: environment.environmentId,
                  input: { patch: { linkedEnvironmentsEnabled: value } },
                })
              }
            />
          );
        })}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        {translator.message("mobile.ui.letAgentsOnAMachineWorkOn")}
      </Text>
    </View>
  );
}

function ParityLabsSettingsSection() {
  const translator = useMobileInterfaceTranslator();
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const writable = useEnvironmentsWithScope(connected, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    label: "Labs settings",
    reportFailure: true,
  });
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  return (
    <View className="gap-4">
      {connected.map((environment) => (
        <SettingsSection key={environment.environmentId} title={environment.label}>
          {(["guestSharingEnabled", "simlockDeviceHostsEnabled"] as const).map((key) => (
            <SettingsSwitchRow
              key={key}
              icon="sparkles"
              label={translator.message(`mobile.projects.labs.${key}`)}
              value={environment.serverConfig?.settings[key] === true}
              disabled={
                !writable.has(environment.environmentId) ||
                isManagedSettingPath(environment.serverConfig?.managedPolicy, key)
              }
              onValueChange={(value) =>
                void update({
                  environmentId: environment.environmentId,
                  input: { patch: { [key]: value } },
                })
              }
            />
          ))}
        </SettingsSection>
      ))}
      <SettingsSection title={translator.message("mobile.appearance.sidebar")}>
        <SettingsSwitchRow
          icon="text.alignleft"
          label={translator.message("mobile.projects.labs.multiline")}
          subtitle={translator.message("mobile.projects.labs.multilineDescription")}
          value={
            AsyncResult.isSuccess(preferences)
              ? (preferences.value.boringThreadListMultilineRows ??
                MOBILE_CLIENT_PREFERENCE_DEFAULTS.boringThreadListMultilineRows)
              : MOBILE_CLIENT_PREFERENCE_DEFAULTS.boringThreadListMultilineRows
          }
          disabled={!AsyncResult.isSuccess(preferences) || preferences.waiting}
          onValueChange={(boringThreadListMultilineRows) =>
            savePreferences({ boringThreadListMultilineRows })
          }
        />
      </SettingsSection>
    </View>
  );
}

function LegacySettingsSection() {
  const translator = useMobileInterfaceTranslator();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const planModeEnabled =
    AsyncResult.isSuccess(preferences) && preferences.value.planModeEnabled === true;

  return (
    <View className="gap-3">
      <SettingsSection title={translator.message("mobile.thread.settings.legacy")}>
        <SettingsSwitchRow
          icon="hammer"
          label={translator.message("mobile.ui.planMode")}
          value={planModeEnabled}
          onValueChange={(value) => savePreferences({ planModeEnabled: value })}
        />
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        {translator.message("mobile.ui.optIntoRetiredInterfacesKeptForCompatibility")}
      </Text>
    </View>
  );
}
