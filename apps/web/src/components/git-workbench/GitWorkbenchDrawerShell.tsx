import type { ReactNode, RefObject } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

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
  readonly onOpenChange: (open: boolean) => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
}

export function GitWorkbenchDrawerShell(props: GitWorkbenchDrawerShellProps) {
  const translate = useInterfaceTranslator().message;
  const workbenchTabs: readonly WorkspaceCardDrawerTab<GitWorkbenchDrawerTabId>[] = [
    { id: "overview", label: translate("git.workbench.tab.overview") },
    { id: "changes", label: translate("git.workbench.tab.changes") },
    { id: "history", label: translate("git.workbench.tab.history") },
    { id: "branches", label: translate("git.workbench.tab.branches") },
    { id: "operations", label: translate("git.workbench.tab.operations") },
  ];
  const tabs =
    props.showOperationsTab === false && props.activeTab !== "operations"
      ? workbenchTabs.slice(0, -1)
      : workbenchTabs;
  return (
    <WorkspaceCardDrawerShell
      activeTab={props.activeTab}
      ariaLabel={translate("git.workbench.title")}
      collapseLabel={translate("git.workbench.collapse")}
      sizingMode="content"
      tabs={tabs}
      title={translate("git.workbench.title")}
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
      dataAttributes={{
        "data-git-workbench-drawer": "true",
        "data-workspace-card-expanded-surface": "true",
      }}
      {...(props.headerActions === undefined ? {} : { headerActions: props.headerActions })}
      {...(props.repositoryLabel === undefined ? {} : { subtitle: props.repositoryLabel })}
      {...(props.returnFocusRef === undefined ? {} : { returnFocusRef: props.returnFocusRef })}
      {...(props.showTabs === undefined ? {} : { showTabs: props.showTabs })}
      onActiveTabChange={props.onActiveTabChange}
      {...(props.onEscapeBeforeCollapse === undefined
        ? {}
        : { onEscapeBeforeCollapse: props.onEscapeBeforeCollapse })}
      onOpenChange={props.onOpenChange}
      {...(props.onVisibilityChange === undefined
        ? {}
        : { onVisibilityChange: props.onVisibilityChange })}
    >
      {props.children}
    </WorkspaceCardDrawerShell>
  );
}
