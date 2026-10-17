import { CircleOff, LoaderCircle } from "lucide-react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { GitBranchesPanel } from "./GitBranchesPanel";
import { GitChangesPanel } from "./GitChangesPanel";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { GitOperationsPanel } from "./GitOperationsPanel";
import { GitOperationBanner } from "./GitOperationBanner";
import { GitOverviewPanel } from "./GitOverviewPanel";
import { GitWorkbenchTabs } from "./GitWorkbenchTabs";
import type { GitWorkbenchPanelProps } from "./GitWorkbench.types";

export function GitWorkbenchPanel(props: GitWorkbenchPanelProps) {
  const translate = useInterfaceTranslator().message;
  const operationAttention = (props.operation ? 1 : 0) + (props.queue ? 1 : 0);
  const showTabs = props.showTabs !== false;
  const documentSized =
    props.activeTab === "overview" ||
    props.activeTab === "branches" ||
    props.activeTab === "operations";
  const refreshing = props.loading && props.snapshot !== null;
  return (
    <section
      aria-label={translate("git.workbench.title")}
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
          aria-label={
            showTabs ? undefined : translate("git.workbench.viewAria", { view: props.activeTab })
          }
          aria-labelledby={showTabs ? `git-workbench-tab-${props.activeTab}` : undefined}
          className={cn(
            "min-h-0",
            documentSized ? "flex-[0_1_auto]" : "flex flex-1 flex-col",
            documentSized ? "overflow-auto" : "overflow-hidden",
          )}
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
            {translate("git.workbench.refreshing")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ActivePanel(
  props: GitWorkbenchPanelProps & { snapshot: NonNullable<GitWorkbenchPanelProps["snapshot"]> },
) {
  const mutationsDisabled =
    props.readOnly ||
    props.snapshot.stale ||
    props.loading ||
    props.operationProgress?.status === "running";
  const operationBanner = (
    <GitOperationBanner
      changes={props.changes}
      disabled={mutationsDisabled}
      onRunOperation={props.onRunOperation}
      onSelectConflict={(path) => {
        const change =
          props.changes.find(
            (candidate) =>
              candidate.path === path &&
              (candidate.conflict ||
                candidate.kind === "conflicted" ||
                candidate.kind === "unmerged"),
          ) ?? props.changes.find((candidate) => candidate.path === path);
        if (!change) return;
        props.onSelectChange(change.id);
      }}
      operation={props.operation}
      selectedPath={
        props.editorPath
          ? null
          : (props.changes.find((change) => change.id === props.selectedChangeId)?.path ?? null)
      }
      snapshotConflicts={props.snapshot.conflicts}
    />
  );
  if (props.activeTab === "overview") {
    return (
      <GitOverviewPanel
        blocked={mutationsDisabled}
        insights={props.insights}
        onCancelQueue={props.onCancelQueue}
        onNavigate={props.onChangeTab}
        onRestoreUndo={props.onRestoreUndo}
        onRunOperation={props.onRunOperation}
        operation={props.operation}
        operationRunning={props.operationProgress?.status === "running"}
        pushAvailable={props.pushAvailable}
        pullAvailable={props.pullAvailable}
        queue={props.queue}
        readOnly={props.readOnly}
        snapshot={props.snapshot}
        undoSnapshots={props.undoSnapshots}
      />
    );
  }
  if (props.activeTab === "changes") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {operationBanner}
        <GitChangesPanel
          changes={props.changes}
          currentFile={props.currentFile}
          initialDraft={props.currentFileDraft}
          editorPath={props.editorPath}
          indexReadOnly={props.indexReadOnly || mutationsDisabled}
          operationActive={props.operation !== null}
          onCloseCurrentFile={props.onCloseCurrentFile}
          onCurrentFileDraftChange={props.onCurrentFileDraftChange}
          onSetFilesStaged={props.onSetFilesStaged}
          stagingPending={props.stagingPending}
          stagingError={props.stagingError}
          onApplySelection={props.onApplySelection}
          onOpenCurrentFile={props.onOpenCurrentFile}
          onRefreshChange={props.onRefreshChange}
          onSaveCurrentFile={props.onSaveCurrentFile}
          onSelectChange={props.onSelectChange}
          readOnly={mutationsDisabled}
          selectedChangeId={props.selectedChangeId}
          stateToken={props.snapshot.stateToken}
        />
        {props.commitComposer}
      </div>
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
        readOnly={mutationsDisabled}
        selectedCommit={props.selectedCommit}
      />
    );
  }
  if (props.activeTab === "branches") {
    return (
      <GitBranchesPanel
        blocked={mutationsDisabled}
        branches={props.branches}
        onCreateBranch={props.onCreateBranch}
        onSwitchBranch={props.onSwitchBranch}
        readOnly={props.readOnly}
      />
    );
  }
  return (
    <>
      {operationBanner}
      <GitOperationsPanel
        blocked={mutationsDisabled}
        branches={props.branches}
        headOid={props.snapshot.headOid}
        onPrepareInteractiveRebase={props.onPrepareInteractiveRebase}
        rebasePreparedTarget={props.rebasePreparedTarget}
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
    </>
  );
}

function LoadingWorkbench() {
  const translate = useInterfaceTranslator().message;
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
      <p className="text-sm">{translate("git.workbench.loadingState")}</p>
    </div>
  );
}

function UnavailableWorkbench({ upgradeRequired }: { readonly upgradeRequired: boolean }) {
  const translate = useInterfaceTranslator().message;
  return (
    <div
      className="grid min-h-48 w-full place-content-center gap-2 p-6 text-center text-muted-foreground"
      data-git-workbench-state="unavailable"
    >
      <CircleOff aria-hidden="true" className="mx-auto size-7" />
      <p className="font-medium text-foreground text-sm">
        {upgradeRequired
          ? translate("git.workbench.upgradeRequired")
          : translate("git.workbench.unavailable")}
      </p>
      <p className="max-w-sm text-xs">
        {upgradeRequired
          ? translate("git.workbench.upgradeDescription")
          : translate("git.workbench.unavailableDescription")}
      </p>
    </div>
  );
}
