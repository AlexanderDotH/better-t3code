import { RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/select";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import { GitWorkbenchConfirmation } from "./GitWorkbenchConfirmation";
import type { GitWorkbenchOperationInput } from "./GitWorkbench.types";

export function GitResetPanel({
  disabled,
  headOid,
  onRunOperation,
}: {
  readonly disabled: boolean;
  readonly headOid: string | null;
  readonly onRunOperation: (input: GitWorkbenchOperationInput) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const [resetOid, setResetOid] = useState(headOid ?? "");
  const [resetMode, setResetMode] = useState<"hard" | "mixed" | "soft">("soft");
  const targetOid = resetOid.trim();
  const resetDisabled = disabled || targetOid.length === 0;
  const reset = () => {
    if (!resetDisabled) onRunOperation({ kind: "reset", mode: resetMode, oid: targetOid });
  };

  return (
    <section aria-labelledby="reset-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <RotateCcw aria-hidden="true" className="size-4" />
        <h2 className="font-semibold text-sm" id="reset-heading">
          {translate("git.branches.resetCurrent")}
        </h2>
      </div>
      <label className="mt-3 block text-xs">
        {translate("git.operation.targetCommit")}
        <div className="mt-1">
          <Input
            disabled={disabled}
            font="mono"
            onChange={(event) => setResetOid(event.currentTarget.value)}
            value={resetOid}
          />
        </div>
      </label>
      <label className="mt-2 block text-xs">
        {translate("git.operation.resetMode")}
        <NativeSelect
          className="mt-1"
          disabled={disabled}
          onChange={(event) => setResetMode(event.currentTarget.value as typeof resetMode)}
          value={resetMode}
        >
          <option value="soft">{translate("git.branches.resetSoft")}</option>
          <option value="mixed">{translate("git.branches.resetMixed")}</option>
          <option value="hard">{translate("git.branches.resetHard")}</option>
        </NativeSelect>
      </label>
      <div className="mt-3 flex justify-end">
        {resetMode === "soft" ? (
          <Button disabled={resetDisabled} onClick={reset} size="sm" variant="outline">
            <RefreshCw aria-hidden="true" /> {translate("git.branches.resetSoftAction")}
          </Button>
        ) : (
          <GitWorkbenchConfirmation
            confirmLabel={translate("git.branches.resetAction", { mode: resetMode })}
            description={translate("git.branches.resetDescription")}
            disabled={resetDisabled}
            onConfirm={reset}
            phrase={resetMode === "hard" ? "RESET" : undefined}
            title={translate("git.branches.resetTitle", {
              mode: resetMode,
              target: targetOid.slice(0, 12),
            })}
            triggerLabel={`${translate("git.branches.resetAction", { mode: resetMode })}…`}
          />
        )}
      </div>
    </section>
  );
}
