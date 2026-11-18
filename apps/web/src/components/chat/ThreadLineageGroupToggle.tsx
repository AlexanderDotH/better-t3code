import { BotIcon, ChevronDownIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadLineageGroupToggle({
  label,
  count,
  expanded,
  onToggle,
  controls,
  icon: Icon = BotIcon,
  status,
}: {
  readonly label: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly controls?: string;
  readonly icon?: LucideIcon;
  readonly status?: ReactNode;
}) {
  return (
    <ThreadDetailsControl aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
      <Icon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      <span className={cn(THREAD_DETAILS_PANEL_LABEL_CLASS, "min-w-0 flex-1 truncate")}>
        {label}
      </span>
      {status}
      {expanded ? null : (
        <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          THREAD_DETAILS_PANEL_CHEVRON_CLASS,
          "motion-safe:transition-transform",
          !expanded && "-rotate-90",
        )}
      />
    </ThreadDetailsControl>
  );
}
