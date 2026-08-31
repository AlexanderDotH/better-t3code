import { useAuth, useUser } from "@clerk/expo";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useNavigation } from "@react-navigation/native";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { SymbolView } from "../../components/AppSymbol";
import * as Effect from "effect/Effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Linking, Platform, Pressable, View } from "react-native";

import {
  isAtomCommandInterrupted,
  reportAtomCommandResult,
  settleAsyncResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { supportsAgentAwarenessPush } from "../agent-awareness/capabilities";
import { setLiveActivityUpdatesEnabled } from "../agent-awareness/liveActivityPreferences";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import {
  getAgentAwarenessRegistrationStatus,
  refreshAgentAwarenessRegistration,
  subscribeAgentAwarenessRegistrationStatus,
} from "../agent-awareness/remoteRegistration";
import { refreshManagedRelayEnvironments } from "../cloud/managedRelayState";
import { hasCloudPublicConfig, resolveRelayClerkTokenOptions } from "../cloud/publicConfig";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import { WorkspaceSidebarToolbar } from "../layout/workspace-sidebar-toolbar";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { resolveMobileSidebarSettlingPreferences } from "../../persistence/mobile-preferences";
import {
  type AppUpdateCheckState,
  isAppUpdateCheckAvailable,
  registerHiddenUpdateTap,
  runAppUpdateCheck,
} from "../updates/app-updates";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { resolveAgentAwarenessPlatformPresentation } from "./SettingsRouteScreen.logic";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

type NotificationStatus = "checking" | "enabled" | "disabled" | "unsupported";
type LiveActivityStatus = "checking" | "enabled" | "disabled" | "signed-out" | "linking";

// Reflects whether the relay actually accepted this device's registration.
// The notification and Live Activity switches are gated on this so they can
// never read as enabled when the device cannot receive anything (e.g. the
// registration request timed out).
function useDeviceRegistered(): boolean {
  const status = useSyncExternalStore(
    subscribeAgentAwarenessRegistrationStatus,
    getAgentAwarenessRegistrationStatus,
    () => "unknown" as const,
  );
  return status === "registered";
}

export function SettingsRouteScreen() {
  const navigation = useNavigation();
  const translator = useMobileInterfaceTranslator();

  return (
    <>
      <WorkspaceSidebarToolbar />
      {Platform.OS !== "android" ? (
        <NativeStackScreenOptions
          options={{
            title: translator.message("mobile.settings.title"),
            unstable_headerRightItems:
              Platform.OS === "ios"
                ? () => [
                    withNativeGlassHeaderItem({
                      accessibilityLabel: translator.message("mobile.settings.close"),
                      icon: { name: "xmark", type: "sfSymbol" } as const,
                      identifier: "settings-close",
                      label: "",
                      onPress: () => navigation.goBack(),
                      type: "button",
                    }),
                  ]
                : undefined,
          }}
        />
      ) : null}
      <AndroidScreenScaffold title={translator.message("mobile.settings.title")}>
        {hasCloudPublicConfig() ? <ConfiguredSettingsRouteScreen /> : <LocalSettingsRouteScreen />}
      </AndroidScreenScaffold>
    </>
  );
}

function LocalSettingsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const environmentCount = Object.keys(savedConnectionsById).length;

  return (
    <ScreenScaffoldScrollView>
      <SettingsSection title={translator.message("mobile.settings.section.configuration")}>
        <SettingsRow
          icon="desktopcomputer"
          label={translator.message("mobile.settings.environments")}
          value={`${environmentCount}`}
          target="SettingsEnvironments"
        />
        <SettingsRow
          icon="sparkles"
          label={translator.message("mobile.settings.agentsServers")}
          target="SettingsAgents"
        />
      </SettingsSection>

      <GeneralSettingsSection />

      <SettingsSection title={translator.message("settings.betterT3.title")}>
        <SettingsRow
          icon="point.3.connected.trianglepath.dotted"
          label={translator.message("settings.betterT3.title")}
          target="SettingsBetterT3"
        />
      </SettingsSection>

      <SettingsSection title={translator.message("mobile.settings.section.appearance")}>
        <SettingsRow
          icon="paintbrush"
          label={translator.message("mobile.settings.section.appearance")}
          target="SettingsAppearance"
        />
      </SettingsSection>

      <ArchivedThreadsSettingsSection />

      <AppSettingsSection />
    </ScreenScaffoldScrollView>
  );
}

function ConfiguredSettingsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const agentAwarenessPushAvailable = supportsAgentAwarenessPush();
  const agentAwarenessPlatform = resolveAgentAwarenessPlatformPresentation(Platform.OS);
  const navigation = useNavigation();
  const { getToken, isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>("checking");
  const [liveActivityStatus, setLiveActivityStatus] = useState<LiveActivityStatus>("checking");
  const deviceRegistered = useDeviceRegistered();
  const liveActivitiesPreferenceEnabled = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.liveActivitiesEnabled !== false
    : true;

  const connections = useMemo(() => Object.values(savedConnectionsById), [savedConnectionsById]);
  const environmentCount = connections.length;
  const accountLabel = useMemo(() => {
    if (!isLoaded) return translator.message("mobile.settings.checking");
    if (!isSignedIn) return translator.message("mobile.settings.signIn");
    return (
      user?.primaryEmailAddress?.emailAddress ?? translator.message("mobile.settings.signedIn")
    );
  }, [isLoaded, isSignedIn, translator, user?.primaryEmailAddress?.emailAddress]);

  const refreshNotifications = useCallback(async () => {
    if (process.env.EXPO_OS !== "ios") {
      setNotificationStatus("unsupported");
      return;
    }
    const result = await settlePromise(() => Notifications.getPermissionsAsync());
    if (result._tag === "Failure") {
      reportAtomCommandResult(result, { label: "notification permission refresh" });
      setNotificationStatus("disabled");
      return;
    }
    setNotificationStatus(result.value.granted ? "enabled" : "disabled");
  }, []);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!isLoaded) {
      setLiveActivityStatus("checking");
      return;
    }
    if (!isSignedIn) {
      setLiveActivityStatus("signed-out");
      return;
    }
    if (!AsyncResult.isSuccess(preferencesResult)) {
      if (AsyncResult.isFailure(preferencesResult)) {
        reportAtomCommandResult(preferencesResult, { label: "live activity preference load" });
        setLiveActivityStatus("enabled");
      } else {
        setLiveActivityStatus("checking");
      }
      return;
    }
    setLiveActivityStatus(
      preferencesResult.value.liveActivitiesEnabled === false ? "disabled" : "enabled",
    );
  }, [isLoaded, isSignedIn, preferencesResult]);

  const requestNotifications = useCallback(async () => {
    const result = await settleAsyncResult(() =>
      runtime.runPromiseExit(
        requestAgentNotificationPermission.pipe(
          Effect.tap((permission) =>
            permission.type === "granted" ? refreshAgentAwarenessRegistration() : Effect.void,
          ),
        ),
      ),
    );
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Alert.alert(
          translator.message("mobile.settings.notifications.unavailable"),
          error instanceof Error
            ? error.message
            : translator.message("mobile.settings.notifications.permissionFailure"),
        );
      }
      return;
    }
    if (result.value.type === "granted") {
      setNotificationStatus("enabled");
      // Permission alone is not enough: the switch stays off until the relay
      // registration succeeds, so tell the user the truth about which happened.
      if (getAgentAwarenessRegistrationStatus() === "registered") {
        Alert.alert(
          translator.message("mobile.settings.notifications.enabled"),
          translator.message("mobile.settings.notifications.enabledDescription"),
        );
      } else {
        Alert.alert(
          translator.message("mobile.settings.notifications.registrationFailedTitle"),
          translator.message("mobile.settings.notifications.registrationFailedDescription"),
        );
      }
      return;
    }
    if (result.value.type === "unsupported") {
      setNotificationStatus("unsupported");
      Alert.alert(
        translator.message("mobile.settings.notifications.unavailable"),
        translator.message("mobile.settings.notifications.iosOnly"),
      );
      return;
    }
    setNotificationStatus("disabled");
    if (result.value.canAskAgain) {
      Alert.alert(
        translator.message("mobile.settings.notifications.disabled"),
        translator.message("mobile.settings.notifications.disabledDescription"),
      );
      return;
    }
    Alert.alert(
      translator.message("mobile.settings.notifications.disabled"),
      translator.message("mobile.settings.notifications.deniedDescription"),
      [
        { text: translator.message("common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.settings.notifications.openSettings"),
          onPress: () => void Linking.openSettings(),
        },
      ],
    );
  }, [translator]);

  const promptSignIn = useCallback(() => {
    Alert.alert(
      translator.message("mobile.settings.connect.signInTitle"),
      translator.message("mobile.settings.connect.signInDescription"),
      [
        { text: translator.message("common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.settings.connect.continue"),
          onPress: () => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" }),
        },
      ],
    );
  }, [navigation, translator]);

  const linkEnvironments = useCallback(async () => {
    if (!isSignedIn) {
      promptSignIn();
      return;
    }

    setLiveActivityStatus("linking");
    const tokenResult = await settlePromise(() => getToken(resolveRelayClerkTokenOptions()));
    if (tokenResult._tag === "Failure") {
      setLiveActivityStatus("disabled");
      const error = squashAtomCommandFailure(tokenResult);
      Alert.alert(
        translator.message("mobile.settings.liveActivities.unavailable"),
        error instanceof Error
          ? error.message
          : translator.message("mobile.settings.liveActivities.enableFailure"),
      );
      return;
    }
    if (!tokenResult.value) {
      promptSignIn();
      setLiveActivityStatus("signed-out");
      return;
    }

    const updateResult = await settleAsyncResult(() =>
      runtime.runPromiseExit(
        setLiveActivityUpdatesEnabled({
          enabled: true,
          previousEnabled: liveActivitiesPreferenceEnabled,
          clerkToken: tokenResult.value,
          connections,
        }),
      ),
    );
    if (updateResult._tag === "Failure") {
      setLiveActivityStatus("disabled");
      if (!isAtomCommandInterrupted(updateResult)) {
        const error = squashAtomCommandFailure(updateResult);
        Alert.alert(
          translator.message("mobile.settings.liveActivities.unavailable"),
          error instanceof Error
            ? error.message
            : translator.message("mobile.settings.liveActivities.enableFailure"),
        );
      }
      return;
    }

    savePreferences({ liveActivitiesEnabled: true });
    refreshManagedRelayEnvironments();
    setLiveActivityStatus("enabled");
    // The environment link can succeed while this device's own registration
    // (the push-to-start token the relay needs) has not — don't claim Live
    // Activities are live until the device is actually registered.
    if (getAgentAwarenessRegistrationStatus() === "registered") {
      Alert.alert(
        translator.message("mobile.settings.liveActivities.enabled"),
        environmentCount > 0
          ? translator.message("mobile.settings.liveActivities.linkedCount", {
              count: environmentCount,
            })
          : translator.message("mobile.settings.liveActivities.enabledNoEnvironment"),
      );
    } else {
      Alert.alert(
        translator.message("mobile.settings.liveActivities.registrationFailedTitle"),
        translator.message("mobile.settings.liveActivities.registrationFailedDescription"),
      );
    }
  }, [
    connections,
    environmentCount,
    getToken,
    isSignedIn,
    liveActivitiesPreferenceEnabled,
    promptSignIn,
    savePreferences,
    translator,
  ]);

  const handleDeviceNotificationsChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        void requestNotifications();
        return;
      }

      Alert.alert(
        translator.message("mobile.settings.notifications.disableTitle"),
        translator.message("mobile.settings.notifications.disableDescription"),
        [
          { text: translator.message("common.cancel"), style: "cancel" },
          {
            text: translator.message("mobile.settings.notifications.openSettings"),
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
    },
    [requestNotifications, translator],
  );

  const handleLiveActivitiesChange = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        setLiveActivityStatus("disabled");
        void (async () => {
          let token: string | null = null;
          if (isSignedIn) {
            const tokenResult = await settlePromise(() =>
              getToken(resolveRelayClerkTokenOptions()),
            );
            if (tokenResult._tag === "Failure") {
              reportAtomCommandResult(tokenResult, {
                label: "live activity disable token lookup",
              });
              return;
            }
            token = tokenResult.value;
          }

          const updateResult = await settleAsyncResult(() =>
            runtime.runPromiseExit(
              setLiveActivityUpdatesEnabled({
                enabled: false,
                previousEnabled: liveActivitiesPreferenceEnabled,
                clerkToken: token,
                connections,
              }),
            ),
          );
          if (updateResult._tag === "Failure") {
            setLiveActivityStatus("enabled");
            reportAtomCommandResult(updateResult, {
              label: "live activity disable",
            });
            return;
          }
          savePreferences({ liveActivitiesEnabled: false });
          refreshManagedRelayEnvironments();
        })();
        return;
      }

      if (!isSignedIn) {
        promptSignIn();
        return;
      }

      void linkEnvironments();
    },
    [
      connections,
      getToken,
      isSignedIn,
      linkEnvironments,
      liveActivitiesPreferenceEnabled,
      promptSignIn,
      savePreferences,
    ],
  );

  const openAccount = useCallback(() => {
    if (!isLoaded) return;
    navigation.navigate("SettingsSheet", { screen: "SettingsAuth" });
  }, [isLoaded, navigation]);

  return (
    <ScreenScaffoldScrollView>
      <View className="gap-3">
        <SettingsSection title={translator.message("mobile.settings.section.account")}>
          <SettingsRow
            icon="person.crop.circle"
            label={translator.message("mobile.settings.account")}
            value={accountLabel}
            onPress={openAccount}
          />
        </SettingsSection>
        <Text className="px-2 text-sm text-foreground-muted">
          {translator.message("mobile.settings.account.localDescription")}
        </Text>
      </View>

      <SettingsSection title={translator.message("mobile.settings.section.configuration")}>
        <SettingsRow
          icon="desktopcomputer"
          label={translator.message("mobile.settings.environments")}
          value={`${environmentCount}`}
          target="SettingsEnvironments"
        />
        <SettingsRow
          icon="sparkles"
          label={translator.message("mobile.settings.agentsServers")}
          target="SettingsAgents"
        />
        <SettingsSwitchRow
          icon="bell.badge"
          label={translator.message("mobile.settings.deviceNotifications")}
          disabled={
            !agentAwarenessPlatform.supported ||
            !agentAwarenessPushAvailable ||
            notificationStatus === "checking" ||
            notificationStatus === "unsupported"
          }
          subtitle={
            agentAwarenessPlatform.subtitleMessageKey
              ? translator.message(agentAwarenessPlatform.subtitleMessageKey)
              : undefined
          }
          // Only reads as on when this device is actually registered with the
          // relay; otherwise notifications cannot be delivered regardless of
          // the local iOS permission.
          value={
            agentAwarenessPushAvailable && notificationStatus === "enabled" && deviceRegistered
          }
          onValueChange={handleDeviceNotificationsChange}
        />
        <SettingsSwitchRow
          disabled={
            !agentAwarenessPlatform.supported ||
            !agentAwarenessPushAvailable ||
            !isLoaded ||
            liveActivityStatus === "checking" ||
            liveActivityStatus === "linking"
          }
          icon="bolt.circle"
          label={translator.message("mobile.settings.liveActivityUpdates")}
          subtitle={
            agentAwarenessPlatform.subtitleMessageKey
              ? translator.message(agentAwarenessPlatform.subtitleMessageKey)
              : undefined
          }
          // Same gate: a saved preference is meaningless until the device
          // registration the relay needs to push updates has succeeded.
          value={
            agentAwarenessPushAvailable &&
            (liveActivityStatus === "enabled" || liveActivityStatus === "linking") &&
            deviceRegistered
          }
          onValueChange={handleLiveActivitiesChange}
        />
      </SettingsSection>

      <GeneralSettingsSection />

      <SettingsSection title={translator.message("settings.betterT3.title")}>
        <SettingsRow
          icon="point.3.connected.trianglepath.dotted"
          label={translator.message("settings.betterT3.title")}
          target="SettingsBetterT3"
        />
      </SettingsSection>

      <SettingsSection title={translator.message("mobile.settings.section.appearance")}>
        <SettingsRow
          icon="paintbrush"
          label={translator.message("mobile.settings.section.appearance")}
          target="SettingsAppearance"
        />
      </SettingsSection>

      <ArchivedThreadsSettingsSection />

      <AppSettingsSection />
    </ScreenScaffoldScrollView>
  );
}

function GeneralSettingsSection() {
  const translator = useMobileInterfaceTranslator();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const { onMerge: autoSettleOnMerge } = resolveMobileSidebarSettlingPreferences(
    AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : undefined,
  );

  return (
    <SettingsSection title={translator.message("mobile.settings.section.general")}>
      <SettingsRow
        icon="folder"
        label={translator.message("mobile.settings.projects")}
        target="SettingsProjects"
      />
      <SettingsRow
        icon="folder"
        label={translator.message("mobile.settings.projectGrouping")}
        target="SettingsProjectGrouping"
      />
      <SettingsSwitchRow
        icon="arrow.triangle.branch"
        label={translator.message("mobile.settings.autoSettleMergedThreads")}
        value={autoSettleOnMerge}
        onValueChange={(value) =>
          savePreferences({
            sidebarAutoSettleOnMerge: value,
            autoSettleOnMerge: value,
          })
        }
      />
      <SettingsRow
        icon="chart.bar.xaxis"
        label={translator.message("mobile.settings.usage")}
        target="SettingsUsage"
      />
    </SettingsSection>
  );
}

function AppSettingsSection() {
  const translator = useMobileInterfaceTranslator();
  const [updateState, setUpdateState] = useState<AppUpdateCheckState>("idle");
  const updateInFlight = useRef(false);
  const hiddenUpdateTapCount = useRef(0);

  const version = Constants.expoConfig?.version ?? "0.0.0";
  // Fall back to "production" to match resolveAppVariant in app.config.ts, so a
  // missing variant never mislabels a production build as development.
  const variant = (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? "production";
  const variantLabel = variant === "production" ? "" : capitalize(variant);
  const versionLabel = variantLabel ? `${version} · ${variantLabel}` : version;
  const updateCheckAvailable = isAppUpdateCheckAvailable();
  const busy =
    updateState === "checking" || updateState === "downloading" || updateState === "restarting";

  // "Up to date" is a transient acknowledgement, not a state worth persisting —
  // return the version row to its normal, deliberately quiet state.
  useEffect(() => {
    if (updateState !== "current") return;
    const timer = setTimeout(() => setUpdateState("idle"), 3000);
    return () => clearTimeout(timer);
  }, [updateState]);

  const checkForUpdate = useCallback(async () => {
    // `disabled={busy}` only takes effect on the next render, so two taps in the
    // same frame would both get through. The ref closes that window.
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    try {
      // The user asked for this restart by tapping the version row, so it may
      // apply immediately instead of prompting.
      await runAppUpdateCheck({
        applyMode: "immediate",
        onFailure: (message) =>
          Alert.alert(translator.message("mobile.settings.update.failed", { message })),
        onStateChange: setUpdateState,
      });
    } finally {
      updateInFlight.current = false;
    }
  }, [translator]);

  const handleVersionPress = useCallback(() => {
    if (!updateCheckAvailable || updateInFlight.current) return;
    const tap = registerHiddenUpdateTap(hiddenUpdateTapCount.current);
    hiddenUpdateTapCount.current = tap.nextCount;
    if (tap.shouldCheck) {
      void checkForUpdate();
    }
  }, [checkForUpdate, updateCheckAvailable]);

  const statusLabel =
    updateState === "checking"
      ? translator.message("mobile.settings.update.checking")
      : updateState === "downloading"
        ? translator.message("mobile.settings.update.downloading")
        : // "ready" appears only when this check joined an in-flight background-mode
          // check; that download installs at the next backgrounding.
          updateState === "ready"
          ? translator.message("mobile.settings.update.ready")
          : updateState === "restarting"
            ? translator.message("mobile.settings.update.restarting")
            : updateState === "current"
              ? translator.message("mobile.settings.update.current")
              : null;

  const versionRow = (
    <View className="flex-row items-center gap-4 p-4">
      <SymbolView
        name="info.circle"
        size={22}
        tintColorClassName={"accent-icon"}
        type="monochrome"
        weight="regular"
      />
      <Text className="flex-1 text-lg text-foreground">
        {translator.message("mobile.settings.versionLabel")}
      </Text>
      <View className="items-end">
        <Text className="text-lg text-foreground-muted">{versionLabel}</Text>
        {statusLabel ? (
          <Text className="text-xs text-foreground-muted/70">{statusLabel}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SettingsSection title={translator.message("mobile.settings.section.app")}>
      <SettingsRow
        icon="internaldrive"
        label={translator.message("mobile.settings.clientStorage")}
        target="SettingsClientStorage"
      />
      <SettingsRow
        icon="doc.text"
        label={translator.message("mobile.settings.legal")}
        fullScreenTarget="SettingsLegal"
      />
      {updateCheckAvailable ? (
        <Pressable
          accessibilityLabel={translator.message("mobile.settings.version", {
            version: versionLabel,
          })}
          accessibilityRole="text"
          disabled={busy}
          onPress={handleVersionPress}
        >
          {versionRow}
        </Pressable>
      ) : (
        versionRow
      )}
    </SettingsSection>
  );
}

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function ArchivedThreadsSettingsSection() {
  const translator = useMobileInterfaceTranslator();
  return (
    <SettingsSection title={translator.message("mobile.settings.section.threads")}>
      <SettingsRow
        icon="archivebox"
        label={translator.message("mobile.settings.archivedThreads")}
        target="SettingsArchive"
      />
    </SettingsSection>
  );
}
