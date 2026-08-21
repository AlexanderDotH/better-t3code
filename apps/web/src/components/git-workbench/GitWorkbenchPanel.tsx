import { CircleOff, LoaderCircle } from "lucide-react";

import { cn } from "~/lib/utils";

import { GitBranchesPanel } from "./GitBranchesPanel";
import { GitChangesPanel } from "./GitChangesPanel";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { GitOperationsPanel } from "./GitOperationsPanel";
import { GitOverviewPanel } from "./GitOverviewPanel";
import { GitWorkbenchTabs } from "./GitWorkbenchTabs";
import type { GitWorkbenchPanelProps } from "./GitWorkbench.types";

export function GitWorkbenchPanel(props: GitWorkbenchPanelProps) {
  const operationAttention = (props.operation ? 1 : 0) + (props.queue ? 1 : 0);
  const showTabs = props.showTabs !== false;
  const documentSized =
    props.activeTab === "overview" ||
    props.activeTab === "branches" ||
    props.activeTab === "operations";
  const refreshing = props.loading && props.snapshot !== null;
  return (
    <section
      aria-label="Git workbench"
      className="@container/git-panel flex h-fit max-h-full w-full min-h-0 flex-col overflow-hidden bg-background"
      data-git-workbench=""
      data-git-workbench-layout="content"
    >
      {showTabs ? (
        <GitWorkbenchTabs
          activeTab={props.activeTab}
          attentionCount={operationAttention}
          onChange={props.onChangeTab}
        />
      ) : null}
      {props.operationProgress ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b bg-muted/35 px-3 py-2 text-xs"
          role="status"
        >
          {props.operationProgress.status === "running" ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : null}
          <span>{props.operationProgress.label}</span>
        </div>
      ) : null}
      <div
        className={cn(
          "relative flex min-h-0 flex-col overflow-hidden",
          documentSized ? "flex-[0_1_auto]" : "flex-1",
        )}
        data-git-workbench-view-frame="true"
      >
        <div
          aria-label={showTabs ? undefined : `${props.activeTab} Git view`}
          aria-labelledby={showTabs ? `git-workbench-tab-${props.activeTab}` : undefined}
          className={cn(
            "min-h-0",
            documentSized ? "flex-[0_1_auto]" : "flex flex-1 flex-col",
            documentSized ? "overflow-auto" : "overflow-hidden",
            refreshing && "mt-10",
          )}
          data-git-workbench-refresh-inset={refreshing ? "true" : undefined}
          data-git-workbench-scroll-region={documentSized ? "document" : "nested"}
          data-git-workbench-view={props.activeTab}
          id={`git-workbench-panel-${props.activeTab}`}
          role={showTabs ? "tabpanel" : undefined}
          tabIndex={showTabs ? 0 : undefined}
        >
          {props.loading && !props.snapshot ? <LoadingWorkbench /> : null}
          {!props.loading && !props.snapshot ? (
            <UnavailableWorkbench upgradeRequired={props.upgradeRequired === true} />
          ) : null}
          {props.snapshot ? <ActivePanel {...props} snapshot={props.snapshot} /> : null}
        </div>
        {refreshing ? (
          <div
            className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md border bg-popover px-2 py-1 text-muted-foreground text-xs shadow-sm"
            data-git-workbench-refresh-overlay="true"
            role="status"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-3 animate-spin motion-reduce:animate-none"
            />
            Refreshing Git
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ActivePanel(
  props: GitWorkbenchPanelProps & { snapshot: NonNullable<GitWorkbenchPanelProps["snapshot"]> },
) {
  if (props.activeTab === "overview") {
    return (
      <GitOverviewPanel
        insights={props.insights}
        onCancelQueue={props.onCancelQueue}
        onNavigate={props.onChangeTab}
        onRestoreUndo={props.onRestoreUndo}
        onRunOperation={props.onRunOperation}
        queue={props.queue}
        readOnly={props.readOnly}
        snapshot={props.snapshot}
        undoSnapshots={props.undoSnapshots}
      />
    );
  }
  if (props.activeTab === "changes") {
    return (
      <GitChangesPanel
        changes={props.changes}
        currentFile={props.currentFile}
        onApplySelection={props.onApplySelection}
        onOpenCurrentFile={props.onOpenCurrentFile}
        onRefreshChange={props.onRefreshChange}
        onSaveCurrentFile={props.onSaveCurrentFile}
        onSelectChange={props.onSelectChange}
        readOnly={props.readOnly}
        selectedChangeId={props.selectedChangeId}
        stateToken={props.snapshot.stateToken}
      />
    );
  }
  if (props.activeTab === "history") {
    return (
      <GitHistoryPanel
        branches={props.branches}
        history={props.history}
        onHistoryPathFilterChange={props.onHistoryPathFilterChange}
        onHistoryRefFilterChange={props.onHistoryRefFilterChange}
        onLoadCommit={props.onLoadCommit}
        onLoadCommitPatch={props.onLoadCommitPatch}
        onLoadMore={props.onLoadMoreHistory}
        onOpenCurrentFile={props.onOpenCurrentFile}
        onRunOperation={props.onRunOperation}
        onSelectCommit={props.onSelectCommit}
        pathFilter={props.historyPathFilter}
        refFilter={props.historyRefFilter}
        readOnly={props.readOnly}
        selectedCommit={props.selectedCommit}
      />
    );
  }
  if (props.activeTab === "branches") {
    return (
      <GitBranchesPanel
        branches={props.branches}
        headOid={props.snapshot.headOid}
        onCreateBranch={props.onCreateBranch}
        onPrepareInteractiveRebase={props.onPrepareInteractiveRebase ?? (() => {})}
        onRunOperation={props.onRunOperation}
        onSwitchBranch={props.onSwitchBranch}
        readOnly={props.readOnly}
      />
    );
  }
  return (
    <GitOperationsPanel
      forcePushTarget={props.forcePushTarget}
      onCancelQueue={props.onCancelQueue}
      onEditQueue={props.onEditQueue}
      onQueueWorkflow={props.onQueueWorkflow}
      onRestoreUndo={props.onRestoreUndo}
      onRetryQueue={props.onRetryQueue}
      onRunOperation={props.onRunOperation}
      onUpdateRebasePlan={props.onUpdateRebasePlan}
      operation={props.operation}
      queue={props.queue}
      readOnly={props.readOnly}
      rebasePlan={props.rebasePlan ?? []}
      rebaseUpstreamRef={props.rebaseUpstreamRef}
      undoSnapshots={props.undoSnapshots}
    />
  );
}

function LoadingWorkbench() {
  return (
    <div
      className="grid min-h-48 w-full place-content-center gap-2 text-center text-muted-foreground"
      data-git-workbench-state="loading"
      role="status"
    >
      <LoaderCircle
        aria-hidden="true"
        className="mx-auto size-6 animate-spin motion-reduce:animate-none"
      />
      <p className="text-sm">Loading repository state…</p>
    </div>
  );
}

function UnavailableWorkbench({ upgradeRequired }: { readonly upgradeRequired: boolean }) {
  return (
    <div
      className="grid min-h-48 w-full place-content-center gap-2 p-6 text-center text-muted-foreground"
      data-git-workbench-state="unavailable"
    >
      <CircleOff aria-hidden="true" className="mx-auto size-7" />
      <p className="font-medium text-foreground text-sm">
        {upgradeRequired ? "Server upgrade required" : "Git workbench unavailable"}
      </p>
      <p className="max-w-sm text-xs">
        {upgradeRequired
          ? "This server does not advertise Git workbench version 1. Existing source-control shortcuts remain available."
          : "This environment may not contain a Git repository. Existing source-control shortcuts remain available."}
      </p>
    </div>
  );
}
