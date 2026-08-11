import type { ReactNode, RefObject } from "react";

import {
  WorkspaceCardDrawerShell,
  type WorkspaceCardDrawerTab,
} from "../workspace-deck/WorkspaceCardDrawerShell";
import "./GitWorkspaceDeck.css";

export type GitWorkbenchDrawerTabId =
  | "overview"
  | "changes"
  | "history"
  | "branches"
  | "operations";

const WORKBENCH_TABS: readonly WorkspaceCardDrawerTab<GitWorkbenchDrawerTabId>[] = [
  { id: "overview", label: "Overview" },
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" },
  { id: "operations", label: "Operations" },
];

export interface GitWorkbenchDrawerShellProps {
  readonly open: boolean;
  readonly activeTab: GitWorkbenchDrawerTabId;
  readonly children: ReactNode;
  readonly availableHeight?: number;
  readonly className?: string;
  readonly headerActions?: ReactNode;
  readonly repositoryLabel?: string | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly showOperationsTab?: boolean;
  readonly showTabs?: boolean;
  readonly onActiveTabChange: (tab: GitWorkbenchDrawerTabId) => void;
  readonly onEscapeBeforeCollapse?: () => boolean;
  readonly onHeightChange?: (height: number) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
}

export function GitWorkbenchDrawerShell(props: GitWorkbenchDrawerShellProps) {
  const tabs =
    props.showOperationsTab === false && props.activeTab !== "operations"
      ? WORKBENCH_TABS.slice(0, -1)
      : WORKBENCH_TABS;
  return (
    <WorkspaceCardDrawerShell
      activeTab={props.activeTab}
      ariaLabel="Git workbench"
      collapseLabel="Collapse Git workbench"
      sizingMode="content"
      tabs={tabs}
      title="Git workbench"
      open={props.open}
      {...(props.availableHeight === undefined ? {} : { availableHeight: props.availableHeight })}
      {...(props.className === undefined ? {} : { className: props.className })}
      classNames={{
        collapse: "git-workbench-drawer__collapse",
        content: "git-workbench-drawer__content",
        header: "git-workbench-drawer__header",
        headerActions: "git-workbench-drawer__header-actions",
        root: "git-workbench-drawer",
        tabs: "git-workbench-drawer__tabs",
      }}
      dataAttributes={{ "data-git-workbench-drawer": "true" }}
      {...(props.headerActions === undefined ? {} : { headerActions: props.headerActions })}
      {...(props.repositoryLabel === undefined ? {} : { subtitle: props.repositoryLabel })}
      {...(props.returnFocusRef === undefined ? {} : { returnFocusRef: props.returnFocusRef })}
      {...(props.showTabs === undefined ? {} : { showTabs: props.showTabs })}
      onActiveTabChange={props.onActiveTabChange}
      {...(props.onEscapeBeforeCollapse === undefined
        ? {}
        : { onEscapeBeforeCollapse: props.onEscapeBeforeCollapse })}
      {...(props.onHeightChange === undefined ? {} : { onHeightChange: props.onHeightChange })}
      onOpenChange={props.onOpenChange}
      {...(props.onVisibilityChange === undefined
        ? {}
        : { onVisibilityChange: props.onVisibilityChange })}
    >
      {props.children}
    </WorkspaceCardDrawerShell>
  );
}
