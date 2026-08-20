import {
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  type ProjectThreadPreviewCount,
} from "@t3tools/contracts";

import { ProjectThreadPreviewCountControl } from "../ProjectThreadPreviewCountControl";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ProjectThreadPreviewCountSetting({
  count,
  onChange,
  status,
}: {
  readonly count: ProjectThreadPreviewCount;
  readonly onChange: (count: ProjectThreadPreviewCount) => void;
  readonly status: string | null;
}) {
  return (
    <SettingsRow
      {...searchableSetting("chats-per-project")}
      description="Choose how many chats each project shows before Show more in the Classic sidebar. This syncs through compatible connected T3 servers."
      status={status}
      resetAction={
        count !== DEFAULT_PROJECT_THREAD_PREVIEW_COUNT ? (
          <SettingResetButton
            label="chats per project"
            onClick={() => onChange(DEFAULT_PROJECT_THREAD_PREVIEW_COUNT)}
          />
        ) : null
      }
      control={
        <ProjectThreadPreviewCountControl
          ariaLabel="Chats per project"
          count={count}
          onChange={onChange}
        />
      }
    />
  );
}
