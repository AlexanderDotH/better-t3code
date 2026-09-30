import { memo } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { type PendingApproval } from "../../session-logic";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const translate = useInterfaceTranslator().message;
  const Detail = approval.requestKind === "mcp-elicitation" ? "span" : "code";
  const fallbackLabel =
    approval.requestKind === "mcp-elicitation"
      ? translate("chat.composer.approval.label.mcpElicitation")
      : approval.requestKind === "command"
        ? translate("chat.composer.approval.label.command")
        : approval.requestKind === "file-read"
          ? translate("chat.composer.approval.label.fileRead")
          : approval.requestKind === "permission"
            ? "App permission approval"
            : translate("chat.composer.approval.label.fileChange");
  const detailAriaLabel =
    approval.requestKind === "mcp-elicitation"
      ? translate("chat.composer.approval.detail.mcpElicitation")
      : approval.requestKind === "command"
        ? translate("chat.composer.approval.detail.command")
        : approval.requestKind === "file-read"
          ? translate("chat.composer.approval.detail.fileRead")
          : approval.requestKind === "permission"
            ? "Permission request"
            : translate("chat.composer.approval.detail.fileChange");

  return (
    <span
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 flex-col items-start gap-1", className)}
      role="group"
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-2xs text-muted-foreground">
        <span className="shrink-0 font-medium text-warning">{fallbackLabel}</span>
        {approval.appName ? <span className="min-w-0 truncate">{approval.appName}</span> : null}
        {pendingCount > 1 ? (
          <span className="ml-auto shrink-0 tabular-nums">1/{pendingCount}</span>
        ) : null}
      </span>
      <Detail
        aria-label={detailAriaLabel}
        className={cn(
          "block max-h-20 w-full min-w-0 overflow-auto text-xs text-foreground [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5",
          approval.requestKind === "mcp-elicitation"
            ? "whitespace-pre-wrap font-sans wrap-break-word"
            : "whitespace-pre font-mono",
        )}
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.detail || fallbackLabel}
      </Detail>
    </span>
  );
});
