import type { FirstTurnForkBudget } from "../../lib/threadFork";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export function ForkHandoffBudgetNotice({
  budget,
}: {
  readonly budget: FirstTurnForkBudget | null;
}) {
  const translator = useInterfaceTranslator();
  if (!budget) return null;

  return (
    <p className="px-3 pb-2 text-xs text-muted-foreground sm:px-4" data-fork-handoff-budget="true">
      {translator.message("chat.fork.handoffBudget")}
    </p>
  );
}
