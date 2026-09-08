import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Binary,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderGit2,
  RefreshCw,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import {
  buildChangeSelection,
  groupGitChanges,
  retainValidSelectionIds,
} from "./GitWorkbench.logic";
import { GitConflictPanel } from "./GitConflictPanel";
import { GitCurrentFilePanel } from "./GitCurrentFilePanel";
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
  readonly onApplySelection: (input: GitChangeSelectionInput) => void;
  readonly onOpenCurrentFile: (path: string) => void;
  readonly onRefreshChange?: ((path: string) => void) | undefined;
  readonly onSaveCurrentFile: (input: {
    readonly content: string;
    readonly expectedRevision: string;
    readonly path: string;
    readonly resolution?: "agent" | "merged" | "mine";
  }) => void;
  readonly onSelectChange: (changeId: string | null) => void;
  readonly readOnly: boolean;
  readonly selectedChangeId: string | null;
  readonly stateToken: string;
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const translate = useInterfaceTranslator().message;
  const groups = groupGitChanges(props.changes);
  const selected = props.changes.find((change) => change.id === props.selectedChangeId) ?? null;
  return (
    <div
      className="grid h-fit max-h-full w-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden @container/git-changes @3xl/git-changes:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.7fr)]"
      data-git-changes-layout="content"
    >
      <aside
        aria-label={translate("git.workbench.changedFilesAria")}
        className={cn(
          "min-h-0 overflow-auto border-r",
          selected ? "hidden @3xl/git-changes:block" : "block",
        )}
        data-git-changes-scroll-region="files"
      >
        {groups.length ? (
          groups.map((group) => (
            <section aria-labelledby={`change-group-${group.id}`} key={group.id}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-3 py-2 backdrop-blur">
                <h3
                  className="font-medium text-xs uppercase tracking-wide"
                  id={`change-group-${group.id}`}
                >
                  {translate(`git.common.${group.id}`)}
                </h3>
                <Badge size="sm" variant={group.id === "conflicts" ? "error" : "secondary"}>
                  {group.changes.length}
                </Badge>
              </div>
              <ul>
                {group.changes.map((change) => (
                  <li key={`${group.id}:${change.id}`}>
                    <button
                      aria-current={change.id === props.selectedChangeId ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        change.id === props.selectedChangeId && "bg-accent",
                      )}
                      onClick={() => {
                        props.onSelectChange(change.id);
                        props.onOpenCurrentFile(change.path);
                      }}
                      type="button"
                    >
                      {change.binary ? (
                        <Binary aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <FileCode2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{change.path}</span>
                        {change.previousPath ? (
                          <span className="block truncate text-muted-foreground text-xs">
                            {translate("git.changes.from", { path: change.previousPath })}
                          </span>
                        ) : null}
                      </span>
                      <ChangeStats change={change} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
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
          selected ? "block" : "hidden @3xl/git-changes:block",
        )}
        data-git-changes-scroll-region="details"
      >
        {selected ? (
          <GitChangeDetail {...props} change={selected} />
        ) : (
          <div className="grid min-h-48 w-full place-content-center text-muted-foreground text-sm">
            {translate("git.changes.selectFile")}
          </div>
        )}
      </main>
    </div>
  );
}

function GitChangeDetail({
  change,
  currentFile,
  onApplySelection,
  onRefreshChange,
  onSaveCurrentFile,
  onSelectChange,
  readOnly,
  stateToken,
}: GitChangesPanelProps & { readonly change: GitWorkbenchChange }) {
  const translate = useInterfaceTranslator().message;
  const [selectedHunks, setSelectedHunks] = useState<ReadonlySet<string>>(new Set());
  const [selectedLines, setSelectedLines] = useState<ReadonlySet<string>>(new Set());
  const [showDiff, setShowDiff] = useState(true);
  const [diffLayout, setDiffLayout] = useState<"split" | "unified">("unified");
  const selectionCount = selectedHunks.size + selectedLines.size;
  const actions = availableSelectionActions(change);

  useEffect(() => {
    if (!change.diff) return;
    setSelectedHunks((current) =>
      retainValidSelectionIds(current, change.diff?.hunks.map((hunk) => hunk.id) ?? []),
    );
    setSelectedLines((current) =>
      retainValidSelectionIds(
        current,
        change.diff?.hunks.flatMap((hunk) => hunk.lines.map((line) => line.id)) ?? [],
      ),
    );
  }, [change.diff]);

  const apply = (action: GitSelectionAction) => {
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
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
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
        {actions.map((action) => {
          const disabled = readOnly || !change.diff || Boolean(change.diff.stale);
          const label = selectionActionLabel(action.action, selectionCount > 0, translate);
          if (action.action === "discard") {
            return (
              <GitWorkbenchConfirmation
                confirmLabel={translate("git.changes.discardSelection")}
                description={translate("git.changes.discardDescription")}
                disabled={disabled}
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
          className="flex items-center gap-2 border-b bg-warning/8 px-3 py-2 text-warning-foreground text-xs"
          role="status"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          <span className="flex-1">{translate("git.changes.staleDiff")}</span>
          <Button onClick={() => onRefreshChange?.(change.path)} size="xs" variant="outline">
            {translate("git.changes.refreshDiff")}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center border-b">
        <button
          aria-expanded={showDiff}
          className="flex min-w-0 flex-1 items-center gap-1 px-3 py-2 text-left font-medium text-xs hover:bg-accent/40"
          onClick={() => setShowDiff((visible) => !visible)}
          type="button"
        >
          {showDiff ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          {translate("git.changes.diff")}{" "}
          {change.diff?.truncated ? `(${translate("git.changes.truncated")})` : ""}
        </button>
        <div
          aria-label={translate("git.diff.view.layout")}
          className="mr-2 flex rounded-md border p-0.5"
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
              {layout === "unified"
                ? translate("git.changes.unified")
                : translate("git.changes.split")}
            </button>
          ))}
        </div>
      </div>
      {showDiff ? (
        <div className="max-h-[45%] min-h-32 overflow-auto border-b bg-muted/20 font-mono text-xs">
          <GitSelectableDiff
            change={change}
            layout={diffLayout}
            onSelectedHunksChange={setSelectedHunks}
            onSelectedLinesChange={setSelectedLines}
            selectedHunks={selectedHunks}
            selectedLines={selectedLines}
          />
        </div>
      ) : null}

      {currentFile?.path === change.path ? (
        <GitCurrentFilePanel file={currentFile} onSave={onSaveCurrentFile} readOnly={readOnly} />
      ) : (
        <div className="grid min-h-32 flex-1 place-content-center text-muted-foreground text-sm">
          {translate("git.changes.loadingCurrent")}
        </div>
      )}
    </div>
  );
}

function GitSelectableDiff({
  change,
  layout,
  onSelectedHunksChange,
  onSelectedLinesChange,
  selectedHunks,
  selectedLines,
}: {
  change: GitWorkbenchChange;
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
