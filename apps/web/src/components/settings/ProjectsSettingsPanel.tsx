import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { Button } from "../ui/button";
import { HarnessChatSyncSettings } from "./HarnessChatSyncSettings";
import { useSettingsProjectGroups } from "./ProjectSettingsPanel";
import { resolveProjectCheckpointSetting } from "./projectCheckpointSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { TranscriptPortabilitySettings } from "./TranscriptPortabilitySettings";

export interface ProjectCheckpointSettingsGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{ readonly checkpointsEnabled: boolean }>;
}

function checkpointStatus(
  group: ProjectCheckpointSettingsGroup,
  translate: ReturnType<typeof useInterfaceTranslator>["message"],
): string {
  const { state } = resolveProjectCheckpointSetting(group.memberProjects);
  return translate(
    state === "enabled"
      ? "settings.common.enabled"
      : state === "disabled"
        ? "settings.common.disabled"
        : "settings.projects.checkpoints.mixed",
  );
}

export function ProjectsSettingsPanelView({
  groups,
  syncSettings,
  transcriptSettings,
}: {
  readonly groups: ReadonlyArray<ProjectCheckpointSettingsGroup>;
  readonly syncSettings?: ReactNode;
  readonly transcriptSettings?: ReactNode;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <SettingsPageContainer>
      {syncSettings}
      {transcriptSettings}
      <SettingsSection {...searchableSetting("checkpoints")}>
        {groups.length === 0 ? (
          <SettingsRow
            title={translate("settings.projects.empty.title")}
            description={translate("settings.projects.empty.description")}
          />
        ) : (
          groups.map((group) => (
            <SettingsRow
              key={group.projectKey}
              title={group.displayName}
              description={`${translate("settings.projects.checkoutCount", {
                count: group.memberProjects.length,
              })} · ${translate("settings.projects.checkpoints.status", {
                status: checkpointStatus(group, translate).toLocaleLowerCase(),
              })}`}
              control={
                <Button
                  render={
                    <Link to="/projects/$projectKey" params={{ projectKey: group.projectKey }} />
                  }
                  size="sm"
                  variant="outline"
                  aria-label={translate("settings.projects.checkpoints.configureAria", {
                    name: group.displayName,
                  })}
                >
                  {translate("settings.projects.checkpoints.configure")}
                  <ChevronRightIcon />
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ProjectsSettingsPanel() {
  const groups = useSettingsProjectGroups();
  return (
    <ProjectsSettingsPanelView
      groups={groups}
      syncSettings={<HarnessChatSyncSettings />}
      transcriptSettings={<TranscriptPortabilitySettings />}
    />
  );
}
