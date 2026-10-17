import { useState } from "react";
import {
  ArrowLeft,
  Binary,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderGit2,
  Pencil,
  RefreshCw,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { buildChangeSelection, retainValidSelectionIds } from "./GitWorkbench.logic";
import {
  defaultGitReviewChange,
  gitReviewFiles,
  type GitReviewFile,
} from "./GitChangesPanel.model";
import { GitConflictPanel } from "./GitConflictPanel";
import { GitCurrentFilePanel } from "./GitCurrentFilePanel";
import type { GitCurrentFileDraftInput } from "./gitCurrentFileDraft";
import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type {
  GitChangeSelectionInput,
  GitCurrentFileState,
  GitSelectionAction,
  GitWorkbenchChange,
} from "./GitWorkbench.types";

interface GitChangesPanelProps {
  readonly changes: readonly GitWorkbenchChange[];
  readonly currentFile: GitCurrentFileState | null;
  readonly editorPath?: string | null | undefined;
  readonly initialDraft?: GitCurrentFileDraftInput | null | undefined;
  readonly indexReadOnly?: boolean | undefined;
  readonly operationActive?: boolean | undefined;
  readonly onApplySelection: (input: GitChangeSelectionInput) => void;
  readonly onCloseCurrentFile?: (() => void) | undefined;
  readonly onCurrentFileDraftChange?: ((draft: GitCurrentFileDraftInput) => void) | undefined;
  readonly onOpenCurrentFile: (path: string) => void;
  readonly onRefreshChange?: ((path: string) => void) | undefined;
  readonly onSaveCurrentFile: (input: {
    readonly content: string;
    readonly expectedRevision: string;
    readonly path: string;
    readonly resolution?: "agent" | "merged" | "mine";
  }) => void;
  readonly onSelectChange: (changeId: string | null) => void;
  readonly onSetFilesStaged?: ((paths: readonly string[], staged: boolean) => void) | undefined;
  readonly readOnly: boolean;
  readonly selectedChangeId: string | null;
  readonly stagingError?: string | null | undefined;
  readonly stagingPending?: boolean | undefined;
  readonly stateToken: string;
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const translate = useInterfaceTranslator().message;
  const files = gitReviewFiles(props.changes);
  const selected = props.changes.find((change) => change.id === props.selectedChangeId) ?? null;
  const selectedFile = files.find((file) => file.path === selected?.path) ?? null;
  const editorPath = props.editorPath ?? null;
  const detailVisible = selected !== null || editorPath !== null;
  const stagePaths = files
    .filter((file) => !file.conflict && file.worktree !== null)
    .map((file) => file.path);
  const unstagePaths = files
    .filter((file) => !file.conflict && file.index !== null)
    .map((file) => file.path);
  const stagingDisabled =
    props.readOnly ||
    props.indexReadOnly ||
    props.operationActive ||
    props.stagingPending ||
    !props.onSetFilesStaged;

  return (
    <div
      aria-busy={Boolean(props.stagingPending)}
      className="@container/git-changes grid h-fit max-h-full w-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
      data-git-changes-layout="content"
    >
      <div>
        {props.stagingError ? (
          <p
            className="border-b bg-destructive/8 px-3 py-2 text-destructive-foreground text-xs"
            role="alert"
          >
            {props.stagingError}
          </p>
        ) : null}
      </div>
      <div className="grid w-full min-h-0 grid-rows-[minmax(0,1fr)] @3xl/git-changes:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.7fr)]">
        <aside
          aria-label={translate("git.workbench.changedFilesAria")}
          className={cn(
            "min-h-0 overflow-auto border-r",
            detailVisible ? "hidden @3xl/git-changes:block" : "block",
          )}
          data-git-changes-scroll-region="files"
        >
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
            <h3 className="flex-1 font-medium text-xs uppercase tracking-wide">
              {translate("git.common.files")}
            </h3>
            <Badge size="sm" variant="secondary">
              {files.length}
            </Badge>
            <Button
              aria-label={translate("git.changes.stageAll")}
              disabled={stagingDisabled || stagePaths.length === 0}
              onClick={() => props.onSetFilesStaged?.(stagePaths, true)}
              size="xs"
              variant="ghost"
            >
              {translate("common.all")}
            </Button>
            <Button
              aria-label={translate("git.changes.unstageAll")}
              disabled={stagingDisabled || unstagePaths.length === 0}
              onClick={() => props.onSetFilesStaged?.(unstagePaths, false)}
              size="xs"
              variant="ghost"
            >
              {translate("git.common.none")}
            </Button>
          </div>
          {files.length ? (
            <ul>
              {files.map((file) => {
                const change = defaultGitReviewChange(file);
                if (!change) return null;
                const isSelected = selected?.path === file.path;
                return (
                  <li
                    className={cn("flex items-start border-b", isSelected && "bg-accent")}
                    data-git-review-path={file.path}
                    key={file.path}
                  >
                    <span className="flex shrink-0 items-center py-3 pl-3">
                      <Checkbox
                        aria-label={translate(
                          file.staging === "full"
                            ? "git.changes.unstagePath"
                            : "git.changes.stagePath",
                          { path: file.path },
                        )}
                        checked={file.staging === "full"}
                        disabled={stagingDisabled || file.conflict !== null}
                        indeterminate={file.staging === "partial"}
                        onCheckedChange={(staged) => props.onSetFilesStaged?.([file.path], staged)}
                      />
                    </span>
                    <button
                      aria-current={isSelected ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => props.onSelectChange(change.id)}
                      type="button"
                    >
                      {change.binary ? (
                        <Binary aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <FileCode2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{file.path}</span>
                        {change.previousPath ? (
                          <span className="block truncate text-muted-foreground text-xs">
                            {translate("git.changes.from", { path: change.previousPath })}
                          </span>
                        ) : null}
                        <span className="block text-muted-foreground text-xs">
                          {file.conflict
                            ? translate("git.common.conflicts")
                            : file.staging === "partial"
                              ? translate("git.changes.partialStaged")
                              : file.staging === "full"
                                ? translate("git.common.staged")
                                : change.untracked
                                  ? translate("git.common.untracked")
                                  : translate("git.common.unstaged")}
                        </span>
                      </span>
                      <ChangeStats
                        change={{
                          ...change,
                          additions:
                            (file.index?.additions ?? 0) +
                            (file.worktree?.additions ?? 0) +
                            (file.conflict?.additions ?? 0),
                          deletions:
                            (file.index?.deletions ?? 0) +
                            (file.worktree?.deletions ?? 0) +
                            (file.conflict?.deletions ?? 0),
                        }}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="grid min-h-48 place-content-center gap-2 p-6 text-center text-muted-foreground">
              <FolderGit2 aria-hidden="true" className="mx-auto size-7" />
              <p className="text-sm">{translate("git.workbench.clean")}</p>
            </div>
          )}
        </aside>

        <main
          className={cn(
            "min-h-0 overflow-auto",
            detailVisible ? "block" : "hidden @3xl/git-changes:block",
          )}
          data-git-changes-scroll-region="details"
        >
          {editorPath ? (
            <div className="flex h-fit max-h-full w-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center border-b px-3 py-2">
                <Button onClick={props.onCloseCurrentFile} size="xs" variant="ghost">
                  <ArrowLeft />
                  {translate(
                    selected ? "git.changes.backToDiff" : "git.workbench.backChangedFiles",
                  )}
                </Button>
              </div>
              {props.currentFile?.path === editorPath ? (
                <GitCurrentFilePanel
                  file={props.currentFile}
                  initialDraft={props.initialDraft}
                  key={editorPath}
                  onDraftChange={props.onCurrentFileDraftChange}
                  onSave={props.onSaveCurrentFile}
                  readOnly={props.readOnly}
                />
              ) : (
                <p className="p-6 text-muted-foreground text-sm" role="status">
                  {translate("git.changes.loadingCurrent")}
                </p>
              )}
            </div>
          ) : selected && selectedFile ? (
            <GitChangeDetail {...props} change={selected} file={selectedFile} key={selected.id} />
          ) : (
            <div className="grid min-h-48 w-full place-content-center text-muted-foreground text-sm">
              {translate("git.changes.selectFile")}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function GitChangeDetail({
  change,
  file,
  indexReadOnly,
  operationActive,
  onApplySelection,
  onOpenCurrentFile,
  onRefreshChange,
  onSelectChange,
  readOnly,
  stagingPending,
  stateToken,
}: GitChangesPanelProps & { readonly change: GitWorkbenchChange; readonly file: GitReviewFile }) {
  const translate = useInterfaceTranslator().message;
  const [selectedHunks, setSelectedHunks] = useState<ReadonlySet<string>>(new Set());
  const [selectedLines, setSelectedLines] = useState<ReadonlySet<string>>(new Set());
  const [selectionDiff, setSelectionDiff] = useState(change.diff);
  const [showDiff, setShowDiff] = useState(true);
  const [diffLayout, setDiffLayout] = useState<"split" | "unified">("unified");
  const selectionCount = selectedHunks.size + selectedLines.size;
  const actions = availableSelectionActions(change);
  const disabled =
    readOnly ||
    Boolean(indexReadOnly) ||
    Boolean(stagingPending) ||
    !change.diff ||
    Boolean(change.diff.stale);

  if (selectionDiff !== change.diff) {
    setSelectionDiff(change.diff);
    const diff = change.diff;
    setSelectedHunks((current) =>
      diff && !diff.stale
        ? retainValidSelectionIds(
            current,
            diff.hunks.map((hunk) => hunk.id),
          )
        : new Set(),
    );
    setSelectedLines((current) =>
      diff && !diff.stale
        ? retainValidSelectionIds(
            current,
            diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.id)),
          )
        : new Set(),
    );
  }

  const apply = (action: GitSelectionAction) => {
    if (disabled || (operationActive && action === "discard")) return;
    onApplySelection(
      buildChangeSelection({
        action,
        changeId: change.id,
        ...(change.diff ? { expectedPatchId: change.diff.patchId } : {}),
        expectedStateToken: stateToken,
        hunkIds: [...selectedHunks],
        lineIds: [...selectedLines],
        path: change.path,
        source: change.diff?.source ?? (change.staged && !change.unstaged ? "index" : "worktree"),
      }),
    );
  };

  return (
    <div className="flex h-fit max-h-full w-full min-h-0 flex-col" data-git-change-detail="content">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button
          aria-label={translate("git.workbench.backChangedFiles")}
          className="@3xl/git-changes:hidden"
          onClick={() => onSelectChange(null)}
          size="icon-xs"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{change.path}</span>
        {change.binary ? <Badge variant="outline">{translate("git.common.binary")}</Badge> : null}
        {change.submodule ? (
          <Badge variant="outline">{translate("git.common.submodule")}</Badge>
        ) : null}
        {change.modeChanged ? (
          <Badge variant="outline">{translate("git.common.modeChanged")}</Badge>
        ) : null}
        {!change.binary && !change.submodule && change.kind !== "deleted" ? (
          <Button
            aria-label={translate("git.file.editAria", { path: change.path })}
            onClick={() => onOpenCurrentFile(change.path)}
            size="xs"
            variant="outline"
          >
            <Pencil /> {translate("git.common.edit")}
          </Button>
        ) : null}
        {actions.map((action) => {
          const label =
            change.conflict && action.action === "stage"
              ? translate("git.changes.markResolved")
              : selectionActionLabel(action.action, selectionCount > 0, translate);
          if (action.action === "discard") {
            return (
              <GitWorkbenchConfirmation
                confirmLabel={translate("git.changes.discardSelection")}
                description={translate("git.changes.discardDescription")}
                disabled={disabled || Boolean(operationActive)}
                key={action.action}
                onConfirm={() => apply(action.action)}
                phrase={change.untracked ? "DISCARD" : undefined}
                title={translate("git.changes.discardTitle", { path: change.path })}
                triggerLabel={
                  selectionCount > 0
                    ? translate("git.changes.discardSelectionMenu")
                    : translate("git.changes.discardFileMenu")
                }
              />
            );
          }
          return (
            <Button
              disabled={disabled}
              key={action.action}
              onClick={() => apply(action.action)}
              size="xs"
              variant="outline"
            >
              {label}
            </Button>
          );
        })}
      </div>

      {change.conflict ? <GitConflictPanel change={change} /> : null}
      {change.diff?.stale ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b bg-warning/8 px-3 py-2 text-warning-foreground text-xs"
          role="status"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          <span className="flex-1">{translate("git.changes.staleDiff")}</span>
          <Button onClick={() => onRefreshChange?.(change.path)} size="xs" variant="outline">
            {translate("git.changes.refreshDiff")}
          </Button>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <button
          aria-expanded={showDiff}
          className="flex items-center gap-1 text-left font-medium text-xs hover:text-foreground"
          onClick={() => setShowDiff((visible) => !visible)}
          type="button"
        >
          {showDiff ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )}
          {translate("git.changes.diff")}{" "}
          {change.diff?.truncated ? `(${translate("git.changes.truncated")})` : ""}
        </button>
        <div
          aria-label={translate("git.diff.scopeAria", { scope: change.path })}
          className="flex gap-1"
          role="group"
        >
          {[file.index, file.worktree]
            .filter((source) => source !== null)
            .map((source) => (
              <button
                aria-pressed={source.id === change.id}
                className={cn(
                  "rounded px-2 py-0.5 text-xs",
                  source.id === change.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
                key={source.id}
                onClick={() => onSelectChange(source.id)}
                type="button"
              >
                {translate(source.staged ? "git.common.staged" : "git.diff.workingTree")}
              </button>
            ))}
        </div>
        <div
          aria-label={translate("git.diff.view.layout")}
          className="ml-auto flex rounded-md border p-0.5"
          role="group"
        >
          {(["unified", "split"] as const).map((layout) => (
            <button
              aria-pressed={diffLayout === layout}
              className={cn(
                "rounded px-2 py-0.5 text-xs",
                diffLayout === layout ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
              key={layout}
              onClick={() => setDiffLayout(layout)}
              type="button"
            >
              {translate(layout === "unified" ? "git.changes.unified" : "git.changes.split")}
            </button>
          ))}
        </div>
      </div>
      {showDiff ? (
        <div className="min-h-0 overflow-auto bg-muted/20 font-mono text-xs">
          <GitSelectableDiff
            change={change}
            disabled={disabled}
            layout={diffLayout}
            onSelectedHunksChange={setSelectedHunks}
            onSelectedLinesChange={setSelectedLines}
            selectedHunks={selectedHunks}
            selectedLines={selectedLines}
          />
        </div>
      ) : null}
    </div>
  );
}

function GitSelectableDiff({
  change,
  disabled,
  layout,
  onSelectedHunksChange,
  onSelectedLinesChange,
  selectedHunks,
  selectedLines,
}: {
  change: GitWorkbenchChange;
  disabled: boolean;
  layout: "split" | "unified";
  onSelectedHunksChange: (value: ReadonlySet<string>) => void;
  onSelectedLinesChange: (value: ReadonlySet<string>) => void;
  selectedHunks: ReadonlySet<string>;
  selectedLines: ReadonlySet<string>;
}) {
  const translate = useInterfaceTranslator().message;
  if (change.binary)
    return <p className="p-3 text-muted-foreground">{translate("git.changes.binaryWhole")}</p>;
  const diff = change.diff;
  if (!diff) return <p className="p-3 text-muted-foreground">{translate("git.diff.loading")}</p>;
  if (!diff.hunks.length)
    return <p className="p-3 text-muted-foreground">{translate("git.diff.noTextPatch")}</p>;

  return diff.hunks.map((hunk) => {
    const selectable = hunk.lines.filter((line) => line.selectable);
    const hunkSelected = selectedHunks.has(hunk.id);
    return (
      <section aria-label={hunk.header} key={hunk.id}>
        <div className="sticky top-0 flex items-center gap-2 bg-info/8 px-2 py-1 text-info-foreground">
          <Checkbox
            aria-label={`Select hunk ${hunk.header}`}
            checked={hunkSelected}
            disabled={disabled}
            onCheckedChange={(next) => {
              const hunks = new Set(selectedHunks);
              const lines = new Set(selectedLines);
              if (next) {
                if (lines.size > 0) {
                  for (const line of selectable) lines.add(line.id);
                } else {
                  hunks.add(hunk.id);
                }
              } else {
                hunks.delete(hunk.id);
                for (const line of selectable) lines.delete(line.id);
              }
              onSelectedHunksChange(hunks);
              onSelectedLinesChange(lines);
            }}
          />
          <span>{hunk.header}</span>
        </div>
        {hunk.lines.map((line) => {
          const selectionControl = line.selectable ? (
            <Checkbox
              aria-label={`Select ${line.kind} line ${line.newLine ?? line.oldLine ?? "metadata"}`}
              checked={hunkSelected || selectedLines.has(line.id)}
              disabled={disabled}
              onCheckedChange={(next) => {
                const lines = new Set(selectedLines);
                const hunks = new Set(selectedHunks);
                if (hunks.size > 0) {
                  for (const selectedHunk of diff.hunks) {
                    if (!hunks.has(selectedHunk.id)) continue;
                    for (const selectedLine of selectedHunk.lines) {
                      if (selectedLine.selectable) lines.add(selectedLine.id);
                    }
                  }
                  hunks.clear();
                }
                if (next) lines.add(line.id);
                else lines.delete(line.id);
                onSelectedHunksChange(hunks);
                onSelectedLinesChange(lines);
              }}
            />
          ) : (
            <span />
          );
          if (layout === "split") {
            const content = (
              <span className="min-w-0 whitespace-pre-wrap break-all px-2">
                {line.content || " "}
              </span>
            );
            return (
              <label
                className={cn(
                  "grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)] items-start px-2 leading-5",
                  line.kind === "addition" && "bg-success/8",
                  line.kind === "deletion" && "bg-destructive/8",
                )}
                key={line.id}
              >
                {selectionControl}
                {line.kind === "addition" ? <span /> : content}
                {line.kind === "deletion" ? <span /> : content}
              </label>
            );
          }
          return (
            <label
              className={cn(
                "grid grid-cols-[1.25rem_3rem_3rem_minmax(0,1fr)] items-start px-2 leading-5",
                line.kind === "addition" && "bg-success/8",
                line.kind === "deletion" && "bg-destructive/8",
              )}
              key={line.id}
            >
              {selectionControl}
              <span className="select-none text-right text-muted-foreground">
                {line.oldLine ?? ""}
              </span>
              <span className="select-none text-right text-muted-foreground">
                {line.newLine ?? ""}
              </span>
              <span className="whitespace-pre-wrap break-all pl-2">{line.content || " "}</span>
            </label>
          );
        })}
      </section>
    );
  });
}

function ChangeStats({ change }: { readonly change: GitWorkbenchChange }) {
  return (
    <span className="shrink-0 font-mono text-xs">
      {change.additions ? (
        <span className="text-success-foreground">+{change.additions}</span>
      ) : null}{" "}
      {change.deletions ? (
        <span className="text-destructive-foreground">-{change.deletions}</span>
      ) : null}
    </span>
  );
}

function availableSelectionActions(
  change: GitWorkbenchChange,
): readonly { readonly action: GitSelectionAction }[] {
  if (change.conflict) return [{ action: "stage" }];
  if (change.diff?.source === "index") return [{ action: "unstage" }];
  const actions: { action: GitSelectionAction }[] = [{ action: "stage" }];
  if (!change.submodule) actions.push({ action: "discard" });
  return actions;
}

function selectionActionLabel(
  action: GitSelectionAction,
  hasSelection: boolean,
  translate: InterfaceTranslator["message"],
): string {
  if (action === "stage") {
    return hasSelection
      ? translate("git.changes.stageSelection")
      : translate("git.changes.stageFile");
  }
  if (action === "unstage") {
    return hasSelection
      ? translate("git.changes.unstageSelection")
      : translate("git.changes.unstageFile");
  }
  return hasSelection
    ? translate("git.changes.discardSelection")
    : translate("git.changes.discardFile");
}
