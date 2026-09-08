import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import { memo } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const APPROVAL_ACTION_CLASS_NAME = "font-normal";
export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  options,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const translate = useInterfaceTranslator().message;
  const presentedOptions =
    options ??
    ([
      { decision: "cancel", label: translate("chat.approval.cancel") },
      { decision: "decline", label: translate("chat.approval.decline") },
      {
        decision: "acceptForSession",
        label: translate("chat.approval.alwaysAllowSession"),
      },
      { decision: "accept", label: translate("chat.approval.approve") },
    ] satisfies ReadonlyArray<ProviderApprovalOption>);
  return (
    <>
      {presentedOptions.map((option) => {
        const button = (
          <Button
            key={option.decision}
            size="micro"
            variant="ghost-muted"
            className={`${APPROVAL_ACTION_CLASS_NAME}${
              option.decision === "decline"
                ? " text-destructive-foreground [:hover,[data-pressed]]:text-destructive-foreground"
                : option.decision === "accept"
                  ? " text-foreground"
                  : option.warning
                    ? " text-warning"
                    : ""
            }`}
            disabled={isResponding}
            aria-description={option.warning}
            onClick={() => void onRespondToApproval(requestId, option.decision)}
          >
            {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
            <span className="max-w-40 truncate">{option.label}</span>
          </Button>
        );
        // A provider caution, such as a prompt injection warning on "allow
        // always", rides along as a tooltip so the row stays one line.
        return option.warning ? (
          <Tooltip key={option.decision}>
            <TooltipTrigger render={button} />
            <TooltipPopup side="top" className="max-w-72 text-xs leading-snug">
              {option.warning}
            </TooltipPopup>
          </Tooltip>
        ) : (
          button
        );
      })}
    </>
  );
});
