import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { HarnessChatSyncSettings } from "./HarnessChatSyncSettings";
import { useSettingsProjectGroups } from "./ProjectSettingsPanel";
import { resolveProjectCheckpointSetting } from "./projectCheckpointSettings";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export interface ProjectCheckpointSettingsGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{ readonly checkpointsEnabled: boolean }>;
}

function checkpointStatus(group: ProjectCheckpointSettingsGroup): string {
  const { state } = resolveProjectCheckpointSetting(group.memberProjects);
  return state[0]!.toLocaleUpperCase() + state.slice(1);
}

function checkoutCountLabel(group: ProjectCheckpointSettingsGroup): string {
  const checkoutCount = group.memberProjects.length;
  return checkoutCount === 1 ? "1 checkout" : `${checkoutCount} grouped checkouts`;
}

export function ProjectsSettingsPanelView({
  groups,
  syncSettings,
}: {
  readonly groups: ReadonlyArray<ProjectCheckpointSettingsGroup>;
  readonly syncSettings?: ReactNode;
}) {
  return (
    <SettingsPageContainer>
      {syncSettings}
      <SettingsSection {...searchableSetting("checkpoints")}>
        {groups.length === 0 ? (
          <SettingsRow
            title="No projects"
            description="Add a project from the sidebar to configure checkpoint creation."
          />
        ) : (
          groups.map((group) => (
            <SettingsRow
              key={group.projectKey}
              title={group.displayName}
              description={`${checkoutCountLabel(group)} · Checkpoints ${checkpointStatus(group).toLocaleLowerCase()}`}
              control={
                <Button
                  render={
                    <Link to="/projects/$projectKey" params={{ projectKey: group.projectKey }} />
                  }
                  size="sm"
                  variant="outline"
                  aria-label={`Configure checkpoints for ${group.displayName}`}
                >
                  Configure
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
  return <ProjectsSettingsPanelView groups={groups} syncSettings={<HarnessChatSyncSettings />} />;
}
