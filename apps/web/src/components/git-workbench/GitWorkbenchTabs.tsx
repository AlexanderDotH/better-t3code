import {
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  History,
  LayoutDashboard,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import type { GitWorkbenchTabId } from "./GitWorkbench.types";

const tabs: readonly {
  readonly icon: typeof GitBranch;
  readonly id: GitWorkbenchTabId;
}[] = [
  { icon: LayoutDashboard, id: "overview" },
  { icon: GitCompareArrows, id: "changes" },
  { icon: History, id: "history" },
  { icon: GitBranch, id: "branches" },
  { icon: GitCommitHorizontal, id: "operations" },
];

interface GitWorkbenchTabsProps {
  readonly activeTab: GitWorkbenchTabId;
  readonly attentionCount?: number;
  readonly onChange: (tab: GitWorkbenchTabId) => void;
}

export function GitWorkbenchTabs({
  activeTab,
  attentionCount = 0,
  onChange,
}: GitWorkbenchTabsProps) {
  const translate = useInterfaceTranslator().message;
  const labels = {
    overview: translate("git.workbench.tab.overview"),
    changes: translate("git.workbench.tab.changes"),
    history: translate("git.workbench.tab.history"),
    branches: translate("git.workbench.tab.branches"),
    operations: translate("git.workbench.tab.operations"),
  } satisfies Record<GitWorkbenchTabId, string>;
  return (
    <div
      aria-label={translate("git.workbench.sections")}
      className="flex min-w-0 gap-1 overflow-x-auto border-b px-2 py-1.5"
      role="tablist"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = tab.id === activeTab;
        const count = tab.id === "operations" ? attentionCount : 0;
        return (
          <button
            aria-controls={`git-workbench-panel-${tab.id}`}
            aria-selected={selected}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            id={`git-workbench-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            <Icon aria-hidden="true" className="size-4" />
            {labels[tab.id]}
            {count > 0 ? (
              <span className="min-w-4 rounded-full bg-warning/16 px-1 text-center text-warning-foreground text-xs">
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
