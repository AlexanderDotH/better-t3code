import {
  effortBarHeights,
  getDescriptorStringValue,
  isReasoningSelect,
  resolveEffortGlyph,
} from "@t3tools/client-runtime/model-traits";
import { isAutoReasoningEnabled } from "@t3tools/shared/model";
import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";

export function ComposerEffortSuffix(props: {
  readonly summary: string;
  readonly bars: boolean;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly selection: ModelSelection | null;
  readonly reportedSelection?: ModelSelection | null;
  readonly promptControlled: boolean;
  readonly large?: boolean;
}) {
  const descriptor = props.descriptors.find(isReasoningSelect);
  const glyph = descriptor
    ? resolveEffortGlyph(
        descriptor,
        getDescriptorStringValue(descriptor, props.selection, props.reportedSelection),
      )
    : null;
  const useBars =
    props.bars &&
    glyph &&
    !glyph.special &&
    !props.promptControlled &&
    !isAutoReasoningEnabled(props.selection);
  const summary = useBars
    ? props.summary
        .replace(glyph.label, "")
        .replace(/^\s*·\s*/, "")
        .trim()
    : props.summary;
  return (
    <View className="flex-row items-center gap-1">
      {useBars ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="h-4 flex-row items-end gap-[2px]"
        >
          {effortBarHeights(glyph.count, 12).map((height, index) => (
            <View
              key={height}
              className="w-[2px] bg-foreground-muted"
              style={{ height, opacity: index < glyph.filled ? 1 : 0.35 }}
            />
          ))}
        </View>
      ) : null}
      {summary ? (
        <Text
          className={
            props.large ? "text-sm text-foreground-muted" : "text-xs text-foreground-muted"
          }
          numberOfLines={1}
        >
          {summary}
        </Text>
      ) : null}
    </View>
  );
}
