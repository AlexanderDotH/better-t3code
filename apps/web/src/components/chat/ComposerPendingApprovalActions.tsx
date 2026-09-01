import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
} from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";
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
      {presentedOptions.map((option) => (
        <Button
          key={option.decision}
          size="micro"
          variant="ghost-muted"
          className={`${APPROVAL_ACTION_CLASS_NAME}${
            option.decision === "decline"
              ? " text-destructive-foreground [:hover,[data-pressed]]:text-destructive-foreground"
              : option.decision === "accept"
                ? " text-foreground"
                : ""
          }`}
          disabled={isResponding}
          onClick={() => void onRespondToApproval(requestId, option.decision)}
        >
          <span className="max-w-40 truncate">{option.label}</span>
        </Button>
      ))}
    </>
  );
});
