import { cn } from "~/lib/utils";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import type { GitCompactStatus } from "./GitCompactCard";

export interface GitWorkspaceChangesIndicatorProps {
  readonly blocked: boolean;
  readonly status: GitCompactStatus;
}

function indicatorCopy(
  status: GitCompactStatus,
  translate: InterfaceTranslator["message"],
): {
  readonly accessibleLabel: string;
  readonly visibleLabel: string;
} {
  if (status.kind === "disconnected" || status.kind === "unavailable") {
    return {
      accessibleLabel: translate("git.workbench.repositoryUnavailable"),
      visibleLabel: translate("git.common.unavailable"),
    };
  }

  const countLabel = translate("git.workbench.changeCount", { count: status.changeCount });
  return {
    accessibleLabel:
      status.conflicts > 0 ? `${countLabel}, ${translate("git.common.conflicts")}` : countLabel,
    visibleLabel: countLabel,
  };
}

export function GitWorkspaceChangesIndicator(props: GitWorkspaceChangesIndicatorProps) {
  const translate = useInterfaceTranslator().message;
  if (props.status.kind === "stale") {
    return (
      <span
        className="sr-only"
        data-git-workspace-changes-indicator="true"
        data-repository-state={props.status.kind}
      >
        {translate("git.workbench.statusRefreshing")}
      </span>
    );
  }

  const copy = indicatorCopy(props.status, translate);

  return (
    <span
      className={cn(
        "git-workspace-changes-indicator pointer-events-none relative z-10 hidden min-w-0 shrink-0 items-center gap-0.5 px-1 text-[0.625rem] leading-none text-muted-foreground/70 md:inline-flex",
        props.blocked && "opacity-60",
      )}
      data-git-workspace-changes-indicator="true"
      data-repository-state={props.status.kind}
      aria-label={copy.accessibleLabel}
    >
      <span className="git-workspace-changes-indicator__dot" aria-hidden />
      <span className="whitespace-nowrap" aria-hidden>
        {copy.visibleLabel}
      </span>
    </span>
  );
}
