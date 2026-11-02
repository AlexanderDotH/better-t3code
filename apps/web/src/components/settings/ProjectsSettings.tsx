import { EnvironmentId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { LayersIcon } from "lucide-react";

import { HarnessChatSyncSettings } from "./HarnessChatSyncSettings";
import { TranscriptPortabilitySettings } from "./TranscriptPortabilitySettings";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsPageContainer } from "./settingsLayout";
import { ALL_ENVIRONMENTS_VALUE, selectEnvironmentAxis } from "./settingsScopeAxis";

export function ProjectsSettings() {
  const { search: value, scope, selectScope } = useSettingsScope();
  const unavailable =
    scope.kind === "unavailable" ? (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{scope.message}</p>
        {value.machine || value.checkout ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => selectScope(selectEnvironmentAxis(value, ALL_ENVIRONMENTS_VALUE))}
          >
            <LayersIcon />
            Show all environments
          </Button>
        ) : null}
      </div>
    ) : null;
  // Keep the panel mounted so it can follow members when regrouping changes the project key.
  const projectScope =
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    (scope.kind === "unavailable" &&
      (scope.reason === "project-missing" || scope.reason === "checkout-missing"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {value.project && projectScope ? (
        <ProjectSettingsPanel
          projectKey={value.project}
          environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
          checkoutKey={value.checkout ?? null}
          unavailable={
            unavailable ? <SettingsPageContainer>{unavailable}</SettingsPageContainer> : null
          }
        />
      ) : (
        <SettingsPageContainer>
          {unavailable ?? (
            <SettingsScopeNotice inline target="project">
              Choose a project to manage its name, icon, checkouts and actions.
            </SettingsScopeNotice>
          )}
          {!projectScope ? (
            <>
              <TranscriptPortabilitySettings
                environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
              />
              <HarnessChatSyncSettings
                environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
              />
            </>
          ) : null}
        </SettingsPageContainer>
      )}
    </div>
  );
}
