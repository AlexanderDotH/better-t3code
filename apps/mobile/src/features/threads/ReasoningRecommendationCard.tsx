import type {
  PendingReasoningOverride,
  ReasoningRecommendation,
} from "@t3tools/client-runtime/reasoning-recommendation";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  REASONING_RECOMMENDATION_CARD_CLASSES,
  buildReasoningRecommendationCardCopy,
} from "./reasoningRecommendationCard";

export function ReasoningRecommendationCard(props: {
  readonly recommendation: ReasoningRecommendation | null;
  readonly pendingOverride: PendingReasoningOverride | null;
  readonly autoReasoningActive?: boolean;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const copy = buildReasoningRecommendationCardCopy(props);
  if (!copy) {
    return null;
  }
  return (
    <View className={REASONING_RECOMMENDATION_CARD_CLASSES.root}>
      <Text className={REASONING_RECOMMENDATION_CARD_CLASSES.title}>{copy.title}</Text>
      <Text className={REASONING_RECOMMENDATION_CARD_CLASSES.description}>{copy.description}</Text>
      <View className="flex-row flex-wrap gap-2.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.actionAccessibilityLabel}
          className={REASONING_RECOMMENDATION_CARD_CLASSES.primaryAction}
          onPress={copy.armed ? props.onUndo : props.onAccept}
        >
          <Text className={REASONING_RECOMMENDATION_CARD_CLASSES.primaryActionLabel}>
            {copy.actionLabel}
          </Text>
        </Pressable>
        {copy.dismissAccessibilityLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.dismissAccessibilityLabel}
            className={REASONING_RECOMMENDATION_CARD_CLASSES.secondaryAction}
            onPress={props.onDismiss}
          >
            <Text className={REASONING_RECOMMENDATION_CARD_CLASSES.secondaryActionLabel}>
              {translator.message("mobile.thread.dismiss")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
