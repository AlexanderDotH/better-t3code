import {
  BETTER_T3_SETTINGS_SUBGROUPS,
  type BetterT3SettingsSubgroupId,
} from "@t3tools/client-runtime/better-t3-settings-layout";
import type { ReactNode } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { SettingsGroup } from "./SettingsGroup";

/** A titled card of related settings, the one layout every Better T3 page is built from. */
export function BetterT3SettingsSubgroup({
  groupId,
  title,
  hideTitle = false,
  children,
}: {
  readonly groupId: BetterT3SettingsSubgroupId;
  readonly title?: string;
  readonly hideTitle?: boolean;
  readonly children: ReactNode;
}) {
  const translator = useInterfaceTranslator();
  const group = BETTER_T3_SETTINGS_SUBGROUPS.find((candidate) => candidate.id === groupId);
  const label = title ?? (group ? translator.message(group.titleMessageId) : groupId);
  return (
    <div data-better-t3-subgroup={groupId} className="space-y-2">
      {hideTitle ? null : (
        <h3 className="px-1 text-xs font-medium text-muted-foreground">{label}</h3>
      )}
      <SettingsGroup>{children}</SettingsGroup>
    </div>
  );
}
