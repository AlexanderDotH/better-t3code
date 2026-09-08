import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarOlderProjectsSection(props: {
  readonly children: ReactNode;
  readonly count: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const translator = useInterfaceTranslator();
  const tooltip = translator.message("sidebar.olderProjects.tooltip");
  if (props.count === 0) {
    return null;
  }

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange} className="mt-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <CollapsibleTrigger
              type="button"
              title={tooltip}
              data-testid="sidebar-older-projects-trigger"
              className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground data-panel-open:[&_svg]:rotate-90"
            />
          }
        >
          <ChevronRightIcon
            aria-hidden
            className="size-3 shrink-0 transition-transform duration-200"
          />
          <span className="min-w-0 flex-1 truncate">
            {translator.message("sidebar.olderProjects.label")}
          </span>
          <span
            className="tabular-nums"
            aria-label={translator.message("sidebar.olderProjects.count", { count: props.count })}
          >
            {props.count}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="right">{tooltip}</TooltipPopup>
      </Tooltip>
      <CollapsiblePanel data-testid="sidebar-older-projects-panel" className="mt-1">
        {props.children}
      </CollapsiblePanel>
    </Collapsible>
  );
}
