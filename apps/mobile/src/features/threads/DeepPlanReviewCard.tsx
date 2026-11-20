import { formatDeepPlanForDisplay } from "@t3tools/client-runtime/deep-planning";
import { PlanId, type DeepPlanRun, type EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { memo } from "react";

export const DeepPlanReviewCard = memo(function DeepPlanReviewCard(props: {
  readonly run: DeepPlanRun;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | null;
  readonly onActionComplete?: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const { nativeTextStyle } = useMarkdownPreviewStyles();
  if (!props.run.plan) return null;
  return (
    <ProposedPlanCard
      environmentId={props.environmentId}
      workspaceRoot={props.workspaceRoot}
      deepPlan={props.run}
      onActionComplete={props.onActionComplete}
      plan={{
        threadId: props.run.threadId,
        planId: PlanId.make(`deep-plan:${props.run.id}:${props.run.plan.version}`),
        updatedAt: DateTime.makeUnsafe(props.run.updatedAt),
        deepPlan: { runId: props.run.id, planVersion: props.run.plan.version },
      }}
      markdown={formatDeepPlanForDisplay(props.run, translator, { includeImplementation: false })}
      renderMarkdown={(markdown) => (
        <SelectableMarkdownText markdown={markdown} textStyle={nativeTextStyle} />
      )}
    />
  );
});
