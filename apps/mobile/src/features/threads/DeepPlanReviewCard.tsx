import {
  formatDeepPlanForDisplay,
  selectDeepPlanSourceAnalysis,
} from "@t3tools/client-runtime/deep-planning";
import { PlanId, type DeepPlanRun, type EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
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
    <View className="gap-3">
      <Text accessibilityRole="header" className="text-sm font-t3-medium text-foreground">
        {translator.message("chat.deepPlan.sources")}
      </Text>
      {selectDeepPlanSourceAnalysis(props.run, translator).map(({ source, label }) => (
        <View key={source.sourceId} className="gap-1">
          <Text className="text-sm text-foreground">
            {source.projectTitle} / {source.threadTitle}
          </Text>
          <Text className="text-xs text-foreground-muted">{label}</Text>
        </View>
      ))}
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
    </View>
  );
});
