import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

export interface ExperimentalSettingsPanelViewProps {
  readonly parallelPlanImplementationEnabled: boolean;
  readonly onParallelPlanImplementationChange: (enabled: boolean) => void;
  readonly onResetParallelPlanImplementation: () => void;
}

export function ExperimentalSettingsPanelView({
  parallelPlanImplementationEnabled,
  onParallelPlanImplementationChange,
  onResetParallelPlanImplementation,
}: ExperimentalSettingsPanelViewProps) {
  return (
    <SettingsPageContainer>
      <div
        role="note"
        className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-xs text-muted-foreground"
      >
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
        <p>
          Experimental features may change, break, or be removed without notice. Enable them only
          when you are comfortable testing unfinished workflows.
        </p>
      </div>

      <SettingsSection title="Experimental">
        <SettingsRow
          title="Parallel plan implementation"
          description="Suggest a provider-native subagent strategy when implementing a completed plan."
          resetAction={
            parallelPlanImplementationEnabled !==
            DEFAULT_CLIENT_SETTINGS.experimentalParallelPlanImplementation ? (
              <SettingResetButton
                label="parallel plan implementation"
                onClick={onResetParallelPlanImplementation}
              />
            ) : null
          }
          control={
            <Switch
              checked={parallelPlanImplementationEnabled}
              onCheckedChange={(checked) => onParallelPlanImplementationChange(Boolean(checked))}
              aria-label="Use subagents when implementing plans"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ExperimentalSettingsPanel() {
  const parallelPlanImplementationEnabled = useClientSettings(
    (settings) => settings.experimentalParallelPlanImplementation,
  );
  const updateClientSettings = useUpdateClientSettings();

  return (
    <ExperimentalSettingsPanelView
      parallelPlanImplementationEnabled={parallelPlanImplementationEnabled}
      onParallelPlanImplementationChange={(enabled) =>
        updateClientSettings({ experimentalParallelPlanImplementation: enabled })
      }
      onResetParallelPlanImplementation={() =>
        updateClientSettings({
          experimentalParallelPlanImplementation:
            DEFAULT_CLIENT_SETTINGS.experimentalParallelPlanImplementation,
        })
      }
    />
  );
}
