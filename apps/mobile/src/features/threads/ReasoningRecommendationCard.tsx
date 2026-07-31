import type {
  PendingReasoningOverride,
  ReasoningRecommendation,
} from "@t3tools/client-runtime/reasoning-recommendation";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { buildReasoningRecommendationCardCopy } from "./reasoningRecommendationCard";

export function ReasoningRecommendationCard(props: {
  readonly recommendation: ReasoningRecommendation | null;
  readonly pendingOverride: PendingReasoningOverride | null;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
}) {
  const copy = buildReasoningRecommendationCardCopy(props);
  if (!copy) {
    return null;
  }
  return (
    <View className="gap-2.5 rounded-[20px] border border-sky-200 bg-sky-50/90 p-4 dark:border-sky-400/15 dark:bg-sky-950/75">
      <Text className="font-t3-bold text-base text-neutral-950 dark:text-neutral-50">
        {copy.title}
      </Text>
      <Text className="font-sans text-sm leading-normal text-neutral-600 dark:text-neutral-300">
        {copy.description}
      </Text>
      <View className="flex-row flex-wrap gap-2.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.actionAccessibilityLabel}
          className="items-center justify-center rounded-[14px] bg-sky-600 px-3.5 py-2.5"
          onPress={copy.armed ? props.onUndo : props.onAccept}
        >
          <Text className="font-t3-extrabold text-sm text-white">{copy.actionLabel}</Text>
        </Pressable>
        {copy.dismissAccessibilityLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.dismissAccessibilityLabel}
            className="items-center justify-center rounded-[14px] bg-neutral-200 px-3.5 py-2.5 dark:bg-neutral-800"
            onPress={props.onDismiss}
          >
            <Text className="font-t3-bold text-sm text-neutral-800 dark:text-neutral-100">
              Dismiss
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
