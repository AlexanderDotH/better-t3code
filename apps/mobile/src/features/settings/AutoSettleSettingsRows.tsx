import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironments } from "../../state/environments";
import {
  DEFAULT_SERVER_SETTINGS,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  filterSharedServerPatch,
  findSharedSettingsMismatches,
  pickSharedServerSettings,
  supportsSharedSettingsSync,
} from "@t3tools/client-runtime/state/shared-settings";

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_SERVER_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

/**
 * Auto-settlement is a user preference that every server has to hold. Mobile
 * has no primary environment, so the first eligible sync target provides the
 * reference value. Edits fan out to every eligible target, and a mismatch row
 * lets the user push the reference out.
 */
export function AutoSettleSettingsRows() {
  const { environments } = useEnvironments();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "server settings update",
    reportFailure: true,
  });

  const syncTargets = environments.filter(supportsSharedSettingsSync);
  const reference = syncTargets[0] ?? null;
  const referenceSettings = reference?.serverConfig?.settings ?? null;

  const [daysDraft, setDaysDraft] = useState<string | null>(null);

  if (reference === null || referenceSettings === null) {
    return null;
  }

  const writeToAll = (patch: ServerSettingsPatch) => {
    for (const environment of syncTargets) {
      void updateSettings({ environmentId: environment.environmentId, input: { patch } });
    }
  };

  const mismatches = findSharedSettingsMismatches({
    primaryEnvironmentId: reference.environmentId,
    primarySettings: referenceSettings,
    primaryCapabilities: reference.serverConfig?.environment.capabilities,
    environments: environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      syncEligible: supportsSharedSettingsSync(environment),
      settings: environment.serverConfig?.settings ?? null,
      capabilities: environment.serverConfig?.environment.capabilities,
    })),
  });

  const afterDays = referenceSettings.sidebarAutoSettleAfterDays;
  const commitDays = () => {
    const draft = (daysDraft ?? "").trim();
    setDaysDraft(null);
    // Whole-string check so "3.5" and "3days" are rejected instead of
    // silently becoming 3 on every eligible sync target.
    const parsed = /^\d+$/.test(draft) ? Number(draft) : Number.NaN;
    if (
      Number.isInteger(parsed) &&
      parsed >= MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
      parsed <= MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
      parsed !== afterDays
    ) {
      writeToAll({ sidebarAutoSettleAfterDays: parsed });
    }
  };

  return (
    <>
      <SettingsSwitchRow
        icon="arrow.triangle.branch"
        label="Auto-settle merged threads"
        value={referenceSettings.sidebarAutoSettleOnMerge}
        onValueChange={(value) => writeToAll({ sidebarAutoSettleOnMerge: value })}
      />
      <SettingsSwitchRow
        icon="clock"
        label="Auto-settle inactive threads"
        subtitle={afterDays === null ? undefined : `After ${afterDays} days without activity`}
        value={afterDays !== null}
        onValueChange={(value) =>
          writeToAll({ sidebarAutoSettleAfterDays: value ? AUTO_SETTLE_DEFAULT_DAYS : null })
        }
      />
      {afterDays !== null ? (
        <View className="flex-row items-center gap-4 border-t border-border-subtle p-4">
          <Text className="flex-1 text-lg text-foreground">Days before auto-settle</Text>
          <TextInput
            className="min-h-10 w-20 rounded-xl px-3 py-2 text-center text-base"
            keyboardType="number-pad"
            returnKeyType="done"
            value={daysDraft ?? String(afterDays)}
            onChangeText={setDaysDraft}
            onBlur={commitDays}
            onSubmitEditing={commitDays}
            accessibilityLabel="Days before auto-settle"
          />
        </View>
      ) : null}
      {mismatches.length > 0 ? (
        <View className="flex-row items-center gap-4 border-t border-border-subtle p-4">
          <View className="min-w-0 flex-1">
            <Text className="text-lg text-foreground">Settings differ</Text>
            <Text className="text-sm text-foreground-muted">
              {mismatches.map((mismatch) => mismatch.label).join(", ")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const patch = pickSharedServerSettings(
                referenceSettings,
                reference.serverConfig?.environment.capabilities,
              );
              for (const mismatch of mismatches) {
                const target = environments.find(
                  (candidate) => candidate.environmentId === mismatch.environmentId,
                );
                void updateSettings({
                  environmentId: mismatch.environmentId,
                  input: {
                    patch: filterSharedServerPatch(
                      patch,
                      target?.serverConfig?.environment.capabilities,
                      target?.serverConfig?.settings,
                      referenceSettings,
                    ),
                  },
                });
              }
            }}
            className="rounded-full bg-subtle px-4 py-2 active:opacity-70"
          >
            <Text className="text-base font-t3-medium text-foreground">Apply to all</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
