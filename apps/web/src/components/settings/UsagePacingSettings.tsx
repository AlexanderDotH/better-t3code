import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { BetterT3SettingsSubgroup } from "./BetterT3SettingsSubgroup";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function UsagePacingSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  return (
    <SettingsSection {...searchableSetting("usage-pacing")}>
      <BetterT3SettingsSubgroup groupId="usage-display" hideTitle>
        <SettingsRow
          title="Show usage pace"
          description="Show a daily allowance and pace guidance beside subscription limits. Saved on this device."
          control={
            <Switch
              aria-label="Show usage pace"
              checked={settings.usagePacingEnabled}
              onCheckedChange={(usagePacingEnabled) => updateSettings({ usagePacingEnabled })}
            />
          }
        />
      </BetterT3SettingsSubgroup>
      <BetterT3SettingsSubgroup groupId="daily-budget" hideTitle>
        <SettingsRow
          id="usage-hard-budget"
          title="Hard daily budget"
          description="Stop requests when the daily allowance, including catch-up, is used up. Applies to every client connected to this environment, using its calendar day. Blocks requests when weekly usage cannot be verified. Provider reporting can delay the stop."
          control={
            <Switch
              aria-label="Hard daily budget"
              checked={settings.usageHardBudgetEnabled}
              onCheckedChange={(usageHardBudgetEnabled) =>
                updateSettings({ usageHardBudgetEnabled })
              }
            />
          }
        />
      </BetterT3SettingsSubgroup>
      <BetterT3SettingsSubgroup groupId="workday" hideTitle>
        <SettingsRow
          id="usage-workday"
          title="8-hour workday"
          description="Start with the first observed usage each local day. Turn off for a full 24-hour calendar day. Both modes include weekends."
          control={
            <Switch
              aria-label="8-hour workday"
              disabled={!settings.usagePacingEnabled}
              checked={settings.usagePacingWorkdayHours === 8}
              onCheckedChange={(enabled) =>
                updateSettings({ usagePacingWorkdayHours: enabled ? 8 : 24 })
              }
            />
          }
        />
      </BetterT3SettingsSubgroup>
    </SettingsSection>
  );
}
