import type { FirstTurnForkBudget } from "../../lib/threadFork";

export function ForkHandoffBudgetNotice({
  budget,
}: {
  readonly budget: FirstTurnForkBudget | null;
}) {
  if (!budget) return null;

  return (
    <p className="px-3 pb-2 text-xs text-muted-foreground sm:px-4" data-fork-handoff-budget="true">
      Inherited context adapts to your first message. Normal limits apply:{" "}
      {budget.remainingInputChars.toLocaleString("en-US")} characters and{" "}
      {budget.remainingAttachmentCount.toLocaleString("en-US")} attachments.
    </p>
  );
}
