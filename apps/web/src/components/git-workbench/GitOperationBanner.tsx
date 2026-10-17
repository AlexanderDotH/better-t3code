import { MergeIcon as GitMerge } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/select";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type {
  GitOperationState,
  GitWorkbenchChange,
  GitWorkbenchOperationInput,
} from "./GitWorkbench.types";

interface GitOperationBannerProps {
  readonly changes: readonly GitWorkbenchChange[];
  readonly disabled: boolean;
  readonly onRunOperation: (input: GitWorkbenchOperationInput) => void;
  readonly onSelectConflict: (path: string) => void;
  readonly operation: GitOperationState | null;
  readonly selectedPath: string | null;
  readonly snapshotConflicts: number;
}

export function GitOperationBanner({
  changes,
  disabled,
  onRunOperation,
  onSelectConflict,
  operation,
  selectedPath,
  snapshotConflicts,
}: GitOperationBannerProps) {
  const translate = useInterfaceTranslator().message;
  const conflictPaths = [
    ...new Set([
      ...(operation?.conflicts ?? []),
      ...changes
        .filter(
          (change) => change.conflict || change.kind === "conflicted" || change.kind === "unmerged",
        )
        .map((change) => change.path),
    ]),
  ];
  const conflictCount = Math.max(snapshotConflicts, conflictPaths.length);
  const availablePaths = new Set(changes.map((change) => change.path));
  if (!operation && conflictCount === 0) return null;
  const canContinue = !disabled && Boolean(operation?.canContinue) && conflictCount === 0;
  const canSkip = !disabled && Boolean(operation?.canSkip);
  const canAbort = !disabled && Boolean(operation?.canAbort);

  return (
    <section
      aria-label={translate("git.operation.active")}
      className="shrink-0 border-b bg-warning/5 px-3 py-2"
      data-git-operation-banner=""
    >
      <div className="flex flex-wrap items-center gap-2">
        <GitMerge aria-hidden="true" className="size-4 shrink-0 text-warning-foreground" />
        <h2 className="font-medium text-sm">
          {operation
            ? translate("git.operation.inProgress", {
                operation: operation.kind.replaceAll("-", " "),
              })
            : translate("git.common.conflicts")}
        </h2>
        <Badge variant={conflictCount > 0 ? "error" : "warning"}>
          {conflictCount > 0
            ? translate("git.workbench.conflictsCount", { count: conflictCount })
            : translate("git.operation.paused")}
        </Badge>
        {conflictPaths.length > 0 ? (
          <NativeSelect
            aria-label={translate("git.common.conflicts")}
            className="max-w-full flex-1 sm:max-w-80"
            size="compact"
            onChange={(event) => onSelectConflict(event.currentTarget.value)}
            value={selectedPath && conflictPaths.includes(selectedPath) ? selectedPath : ""}
          >
            <option disabled value="">
              {translate("git.changes.selectFile")}
            </option>
            {conflictPaths.map((path) => (
              <option disabled={!availablePaths.has(path)} key={path} value={path}>
                {path}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        {operation ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              disabled={!canContinue}
              onClick={() => {
                if (canContinue) onRunOperation({ kind: "continue" });
              }}
              size="xs"
            >
              {translate("git.common.continue")}
            </Button>
            <Button
              disabled={!canSkip}
              onClick={() => {
                if (canSkip) onRunOperation({ kind: "skip" });
              }}
              size="xs"
              variant="outline"
            >
              {translate("git.operation.skip")}
            </Button>
            <GitWorkbenchConfirmation
              confirmLabel={translate("git.operation.abortAction")}
              description={translate("git.operation.abortDescription")}
              disabled={!canAbort}
              onConfirm={() => {
                if (canAbort) onRunOperation({ kind: "abort" });
              }}
              title={translate("git.operation.abortTitle", { operation: operation.kind })}
              triggerLabel={translate("git.operation.abort")}
            />
          </div>
        ) : null}
      </div>
      {operation?.detail ? (
        <p className="mt-1 break-words text-muted-foreground text-xs">{operation.detail}</p>
      ) : null}
    </section>
  );
}
