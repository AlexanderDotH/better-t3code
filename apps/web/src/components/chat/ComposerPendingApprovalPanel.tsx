import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

const APPROVAL_MESSAGE_IDS = {
  "mcp-elicitation": {
    labelMessageId: "chat.composer.approval.label.mcpElicitation",
    detailMessageId: "chat.composer.approval.detail.mcpElicitation",
  },
  command: {
    labelMessageId: "chat.composer.approval.label.command",
    detailMessageId: "chat.composer.approval.detail.command",
  },
  "file-read": {
    labelMessageId: "chat.composer.approval.label.fileRead",
    detailMessageId: "chat.composer.approval.detail.fileRead",
  },
  "file-change": {
    labelMessageId: "chat.composer.approval.label.fileChange",
    detailMessageId: "chat.composer.approval.detail.fileChange",
  },
} as const satisfies Record<
  PendingApproval["requestKind"],
  Readonly<{
    labelMessageId: InterfaceMessageKey;
    detailMessageId: InterfaceMessageKey;
  }>
>;

export function composerApprovalMessageIds(requestKind: PendingApproval["requestKind"]) {
  return APPROVAL_MESSAGE_IDS[requestKind];
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const translator = useInterfaceTranslator();
  const messageIds = composerApprovalMessageIds(approval.requestKind);
  const fallbackLabel = translator.message(messageIds.labelMessageId);
  const detailAriaLabel = translator.message(messageIds.detailMessageId);

  return (
    <span
      aria-label={fallbackLabel}
      className={cn("flex min-w-0 flex-1 items-center gap-2", className)}
      role="group"
    >
      {approval.appName ? (
        <span className="max-w-32 shrink truncate text-[11px] font-medium text-foreground">
          {approval.appName}
        </span>
      ) : null}
      <code
        aria-label={detailAriaLabel}
        className="block max-h-20 min-w-0 flex-1 overflow-auto whitespace-pre font-mono text-[11px] text-foreground/85 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 [&::-webkit-scrollbar]:h-1.5"
        data-approval-detail="complete"
        tabIndex={0}
      >
        {approval.detail || fallbackLabel}
      </code>
      {pendingCount > 1 ? (
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
          1/{pendingCount}
        </span>
      ) : null}
    </span>
  );
});
