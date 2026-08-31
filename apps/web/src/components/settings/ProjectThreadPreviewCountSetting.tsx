import {
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  type ProjectThreadPreviewCount,
} from "@t3tools/contracts";

import { ProjectThreadPreviewCountControl } from "../ProjectThreadPreviewCountControl";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
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
  const translate = useInterfaceTranslator().message;
  return (
    <SettingsRow
      {...searchableSetting("chats-per-project")}
      description={translate("settings.projects.preview.description")}
      status={status}
      resetAction={
        count !== DEFAULT_PROJECT_THREAD_PREVIEW_COUNT ? (
          <SettingResetButton
            label={translate("settings.projects.preview.resetLabel")}
            onClick={() => onChange(DEFAULT_PROJECT_THREAD_PREVIEW_COUNT)}
          />
        ) : null
      }
      control={
        <ProjectThreadPreviewCountControl
          ariaLabel={translate("settings.projects.preview.aria")}
          count={count}
          onChange={onChange}
        />
      }
    />
  );
}
