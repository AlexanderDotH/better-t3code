import { useState } from "react";
import { GitBranchPlus, GitFork } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import type { GitBranch } from "./GitWorkbench.types";

interface GitBranchesPanelProps {
  readonly blocked?: boolean | undefined;
  readonly branches: readonly GitBranch[];
  readonly onCreateBranch: (name: string) => void;
  readonly onSwitchBranch: (name: string) => void;
  readonly readOnly: boolean;
}

export function GitBranchesPanel({
  blocked = false,
  branches,
  onCreateBranch,
  onSwitchBranch,
  readOnly,
}: GitBranchesPanelProps) {
  const translate = useInterfaceTranslator().message;
  const [branchName, setBranchName] = useState("");
  const disabled = readOnly || blocked;
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
              {!branch.current && !branch.remote ? (
                <Button
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) onSwitchBranch(branch.name);
                  }}
                  size="xs"
                  variant="outline"
                >
                  {translate("git.branches.switch")}
                </Button>
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
              disabled={disabled}
              onChange={(event) => setBranchName(event.currentTarget.value)}
              placeholder="feature/my-change"
              value={branchName}
            />
            <Button
              disabled={disabled || branchName.trim().length === 0}
              onClick={() => {
                if (disabled || branchName.trim().length === 0) return;
                onCreateBranch(branchName.trim());
                setBranchName("");
              }}
            >
              {translate("git.branches.createAction")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
