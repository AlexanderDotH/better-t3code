import { useState } from "react";
import { GitBranchPlus, GitFork, RefreshCw, RotateCcw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type { GitBranch, GitWorkbenchOperationInput } from "./GitWorkbench.types";

interface GitBranchesPanelProps {
  readonly branches: readonly GitBranch[];
  readonly headOid: string | null;
  readonly onCreateBranch: (name: string) => void;
  readonly onPrepareInteractiveRebase: (upstreamRef: string) => void;
  readonly onRunOperation: (input: GitWorkbenchOperationInput) => void;
  readonly onSwitchBranch: (name: string) => void;
  readonly readOnly: boolean;
}

export function GitBranchesPanel({
  branches,
  headOid,
  onCreateBranch,
  onPrepareInteractiveRebase,
  onRunOperation,
  onSwitchBranch,
  readOnly,
}: GitBranchesPanelProps) {
  const translate = useInterfaceTranslator().message;
  const [branchName, setBranchName] = useState("");
  const [resetOid, setResetOid] = useState(headOid ?? "");
  const [resetMode, setResetMode] = useState<"hard" | "mixed" | "soft">("soft");
  const reset = () => onRunOperation({ kind: "reset", mode: resetMode, oid: resetOid });
  return (
    <div className="grid gap-4 p-4 @3xl/git-panel:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
      <section aria-labelledby="branches-heading" className="min-w-0 rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div>
            <h2 className="font-semibold text-sm" id="branches-heading">
              {translate("git.branches.title")}
            </h2>
            <p className="text-muted-foreground text-xs">
              {translate("git.branches.switchingDescription")}
            </p>
          </div>
        </div>
        <ul>
          {branches.map((branch) => (
            <li
              className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-0"
              key={`${branch.remote}:${branch.name}`}
            >
              <GitFork aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{branch.name}</span>
                  {branch.current ? (
                    <Badge variant="success">{translate("git.common.current")}</Badge>
                  ) : null}
                  {branch.remote ? (
                    <Badge variant="outline">{translate("git.branches.remote")}</Badge>
                  ) : null}
                </div>
                <p className="truncate font-mono text-muted-foreground text-xs">
                  {branch.oid
                    ? branch.oid.slice(0, 10)
                    : translate("git.branches.revisionAfterCheckout")}
                  {branch.upstream ? ` · ${branch.upstream}` : ""}
                </p>
              </div>
              {!branch.current ? (
                <>
                  {!branch.remote ? (
                    <Button
                      disabled={readOnly}
                      onClick={() => onSwitchBranch(branch.name)}
                      size="xs"
                      variant="outline"
                    >
                      {translate("git.branches.switch")}
                    </Button>
                  ) : null}
                  <Button
                    disabled={readOnly}
                    onClick={() => onRunOperation({ branch: branch.name, kind: "guided-rebase" })}
                    size="xs"
                    variant="outline"
                  >
                    {translate("git.branches.rebaseOnto")}
                  </Button>
                  <Button
                    disabled={readOnly}
                    onClick={() => onPrepareInteractiveRebase(branch.name)}
                    size="xs"
                    variant="outline"
                  >
                    {translate("git.branches.interactive")}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-4">
        {readOnly ? (
          <div className="rounded-xl border border-info/24 bg-info/5 p-3 text-info-foreground text-sm">
            {translate("git.branches.readOnly")}
          </div>
        ) : null}
        <section aria-labelledby="create-branch-heading" className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <GitBranchPlus aria-hidden="true" className="size-4" />
            <h2 className="font-semibold text-sm" id="create-branch-heading">
              {translate("git.branches.create")}
            </h2>
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              aria-label={translate("git.branches.newName")}
              disabled={readOnly}
              onChange={(event) => setBranchName(event.currentTarget.value)}
              placeholder="feature/my-change"
              value={branchName}
            />
            <Button
              disabled={readOnly || branchName.trim().length === 0}
              onClick={() => {
                onCreateBranch(branchName.trim());
                setBranchName("");
              }}
            >
              {translate("git.branches.createAction")}
            </Button>
          </div>
        </section>

        <section aria-labelledby="reset-heading" className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <RotateCcw aria-hidden="true" className="size-4" />
            <h2 className="font-semibold text-sm" id="reset-heading">
              {translate("git.branches.resetCurrent")}
            </h2>
          </div>
          <label className="mt-3 block text-xs">
            {translate("git.operation.targetCommit")}
            <Input
              className="mt-1 font-mono"
              disabled={readOnly}
              onChange={(event) => setResetOid(event.currentTarget.value)}
              value={resetOid}
            />
          </label>
          <label className="mt-2 block text-xs">
            {translate("git.operation.resetMode")}
            <select
              className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
              disabled={readOnly}
              onChange={(event) => setResetMode(event.currentTarget.value as typeof resetMode)}
              value={resetMode}
            >
              <option value="soft">{translate("git.branches.resetSoft")}</option>
              <option value="mixed">{translate("git.branches.resetMixed")}</option>
              <option value="hard">{translate("git.branches.resetHard")}</option>
            </select>
          </label>
          <div className="mt-3 flex justify-end">
            {resetMode === "soft" ? (
              <Button
                disabled={readOnly || resetOid.length === 0}
                onClick={reset}
                size="sm"
                variant="outline"
              >
                <RefreshCw aria-hidden="true" /> {translate("git.branches.resetSoftAction")}
              </Button>
            ) : (
              <GitWorkbenchConfirmation
                confirmLabel={translate("git.branches.resetAction", { mode: resetMode })}
                description={translate("git.branches.resetDescription")}
                disabled={readOnly || resetOid.length === 0}
                onConfirm={reset}
                phrase={resetMode === "hard" ? "RESET" : undefined}
                title={translate("git.branches.resetTitle", {
                  mode: resetMode,
                  target: resetOid.slice(0, 12),
                })}
                triggerLabel={`${translate("git.branches.resetAction", { mode: resetMode })}…`}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
