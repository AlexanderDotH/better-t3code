import type { OrchestrationSubagentDetail, ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { memo } from "react";

import { resolveSubagentDisplayName } from "./subagents/subagentPresentation";
import { SubagentTranscriptPanel } from "./SubagentTranscriptPanel";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";

export const SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME =
  "h-[min(82dvh,52rem)] max-w-[min(64rem,calc(100dvw-2rem))] overflow-hidden bg-background p-0 shadow-2xl/20";

export interface SubagentTranscriptDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly subagent: OrchestrationSubagentDetail | null;
  readonly isLoading?: boolean;
  readonly errorMessage?: string | null;
  readonly markdownCwd?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly timestampFormat?: TimestampFormat;
}

type SubagentTranscriptDialogContentProps = Omit<
  SubagentTranscriptDialogProps,
  "open" | "onOpenChange"
>;

export const SubagentTranscriptDialogContent = memo(function SubagentTranscriptDialogContent({
  subagent,
  isLoading = false,
  errorMessage = null,
  markdownCwd,
  threadRef,
  timestampFormat = "locale",
}: SubagentTranscriptDialogContentProps) {
  return (
    <div data-subagent-transcript-dialog="true" className="contents">
      <SubagentTranscriptPanel
        subagent={subagent}
        isLoading={isLoading}
        errorMessage={errorMessage}
        {...(markdownCwd ? { markdownCwd } : {})}
        {...(threadRef ? { threadRef } : {})}
        timestampFormat={timestampFormat}
        className="min-h-0 flex-1"
      />
    </div>
  );
});

export const SubagentTranscriptDialog = memo(function SubagentTranscriptDialog({
  open,
  onOpenChange,
  subagent,
  isLoading = false,
  errorMessage = null,
  markdownCwd,
  threadRef,
  timestampFormat = "locale",
}: SubagentTranscriptDialogProps) {
  const title = subagent
    ? `${resolveSubagentDisplayName(subagent)} transcript`
    : "Agent transcript";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        data-subagent-transcript-dialog="true"
        bottomStickOnMobile={false}
        className={SUBAGENT_TRANSCRIPT_DIALOG_CLASS_NAME}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <SubagentTranscriptDialogContent
          subagent={subagent}
          isLoading={isLoading}
          errorMessage={errorMessage}
          {...(markdownCwd ? { markdownCwd } : {})}
          {...(threadRef ? { threadRef } : {})}
          timestampFormat={timestampFormat}
        />
      </DialogPopup>
    </Dialog>
  );
});
