import type { DeepPlanRun, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { formatDeepPlanForDisplay } from "@t3tools/client-runtime/deep-planning";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProposedPlanCard } from "./ProposedPlanCard";

export function DeepPlanReviewCard({
  run,
  environmentId,
  threadRef,
  workspaceRoot,
}: {
  run: DeepPlanRun;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  workspaceRoot: string | undefined;
}) {
  const translator = useInterfaceTranslator();
  if (!run.plan) return null;
  return (
    <ProposedPlanCard
      planMarkdown={formatDeepPlanForDisplay(run, translator)}
      environmentId={environmentId}
      threadRef={threadRef}
      cwd={workspaceRoot}
      workspaceRoot={workspaceRoot}
      deepPlan={run}
    />
  );
}
