import {
  estimatePlanExecutionTime,
  formatPlanExecutionDuration,
} from "@t3tools/client-runtime/plan-implementation";
import { getProviderOptionCurrentValue, isAutoReasoningEnabled } from "@t3tools/shared/model";
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import { useMemo } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ComposerPlanBanner(props: {
  readonly markdown: string;
  readonly title: string | null;
  readonly deepPlan?: boolean;
  readonly modelSelection: ModelSelection;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly autoReasoningEffort?: string | null;
}) {
  const translator = useMobileInterfaceTranslator();
  const effort = isAutoReasoningEnabled(props.modelSelection)
    ? props.autoReasoningEffort
    : getProviderOptionCurrentValue(
        props.descriptors.find((descriptor) =>
          ["reasoningEffort", "effort"].includes(descriptor.id),
        ),
      );
  const speed = getProviderOptionCurrentValue(
    props.descriptors.find((descriptor) => ["serviceTier", "fastMode"].includes(descriptor.id)),
  );
  const estimate = useMemo(
    () => estimatePlanExecutionTime({ planMarkdown: props.markdown, effort, speed }),
    [props.markdown, effort, speed],
  );
  return (
    <View className="gap-1 px-3 py-2">
      <Text
        className={
          props.deepPlan
            ? "text-sm font-t3-medium text-warning"
            : "text-sm font-t3-medium text-foreground"
        }
      >
        {translator.message(props.deepPlan ? "chat.deepPlan.ready" : "chat.composer.planReady")}
        {props.title ? ` · ${props.title}` : ""}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {formatPlanExecutionDuration(estimate, translator)} ·{" "}
        {translator.message("chat.planEstimate.scope", { count: estimate.workUnits })}
      </Text>
    </View>
  );
}
