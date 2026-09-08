import { GitMerge } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import type { GitWorkbenchChange } from "./GitWorkbench.types";

export function GitConflictPanel({ change }: { readonly change: GitWorkbenchChange }) {
  const translate = useInterfaceTranslator().message;
  return (
    <section aria-labelledby="git-conflict-heading" className="border-b bg-warning/5 p-3">
      <div className="flex items-center gap-2">
        <GitMerge aria-hidden="true" className="size-4 text-warning-foreground" />
        <h3 className="font-medium text-sm" id="git-conflict-heading">
          {translate("git.workbench.resolveConflict", { path: change.path })}
        </h3>
        <Badge variant="warning">{change.conflict?.replaceAll("-", " ")}</Badge>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        {translate("git.workbench.resolveConflictInstructions")}
      </p>
      {change.conflictVersions ? (
        <div className="mt-3 grid gap-2 @2xl/git-panel:grid-cols-3">
          <ConflictVersion
            content={change.conflictVersions.base}
            label={translate("git.common.base")}
          />
          <ConflictVersion
            content={change.conflictVersions.ours}
            label={translate("git.common.ours")}
          />
          <ConflictVersion
            content={change.conflictVersions.theirs}
            label={translate("git.common.theirs")}
          />
        </div>
      ) : null}
      <p className="mt-2 font-medium text-xs">{translate("git.workbench.currentResult")}</p>
    </section>
  );
}

function ConflictVersion({ content, label }: { content: string | null; label: string }) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="min-w-0 rounded-md border bg-background">
      <h4 className="border-b px-2 py-1 font-medium text-xs">{label}</h4>
      <pre className="max-h-32 overflow-auto p-2 text-xs">
        <code>{content ?? translate("git.workbench.versionUnavailable")}</code>
      </pre>
    </div>
  );
}
