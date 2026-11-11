import {
  describeThreadTokenUsage,
  formatTokenTotal,
  type ThreadTokenUsage,
  type TokenUsageSection,
  type TokenUsageSegment,
} from "@t3tools/client-runtime/thread-token-usage";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadDetailSheet } from "./ThreadDetailSheet";

const SEGMENT_TONES = ["bg-foreground", "bg-foreground/50", "bg-foreground/20"] as const;

function TokenSplit(props: { readonly segments: ReadonlyArray<TokenUsageSegment> }) {
  const translator = useMobileInterfaceTranslator();
  const segments = props.segments.map((segment, index) => ({
    ...segment,
    tone: SEGMENT_TONES[index] ?? SEGMENT_TONES[2],
  }));
  return (
    <View className="gap-1.5">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="h-1.5 flex-row gap-px overflow-hidden rounded-full"
      >
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <View
              key={segment.label}
              className={segment.tone}
              style={{ flexGrow: segment.value, flexBasis: 0, minWidth: 2 }}
            />
          ))}
      </View>
      {segments.map((segment) => (
        <View
          key={segment.label}
          accessible
          accessibilityLabel={`${segment.label}: ${translator.number(segment.value)}, ${segment.share}`}
          className="flex-row items-center gap-2"
        >
          <View className={`size-2 rounded-sm ${segment.tone}`} />
          <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
            {segment.label}
          </Text>
          <Text className="text-sm tabular-nums text-foreground-muted">
            {translator.number(segment.value)}
          </Text>
          <Text className="w-10 text-right text-xs tabular-nums text-foreground-muted">
            {segment.share}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TokenSectionDetails({ section }: { readonly section: TokenUsageSection }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-2.5 pb-5">
      <View className="flex-row items-baseline justify-between gap-4">
        <Text accessibilityRole="header" className="text-base font-t3-medium text-foreground">
          {section.title}
        </Text>
        <Text className="text-lg font-t3-semibold tabular-nums text-foreground">
          {translator.number(section.total)}
          {section.partial ? "+" : ""}
        </Text>
      </View>
      {section.splits.map((segments) => (
        <TokenSplit key={segments[0]?.label} segments={segments} />
      ))}
    </View>
  );
}

export function ThreadTokenUsageSheet(props: {
  readonly usage: ThreadTokenUsage;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const { sections, notes } = describeThreadTokenUsage(props.usage, translator);
  return (
    <ThreadDetailSheet
      title={translator.message("chat.tokens.title", {
        direction: translator.message("chat.timeline.totalTokens"),
      })}
      onClose={props.onClose}
    >
      <View className="pt-2">
        {sections.map((section) => (
          <TokenSectionDetails key={section.id} section={section} />
        ))}
        {notes.map((note) => (
          <Text key={note} className="pb-1 text-xs text-foreground-muted">
            {note}
          </Text>
        ))}
      </View>
    </ThreadDetailSheet>
  );
}

/** The running totals; tapping them opens the breakdown. */
export function ThreadTokenTotals(props: {
  readonly usage: ThreadTokenUsage;
  readonly onPress: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const { usage } = props;
  const partial = (flag: boolean, value: number) => (flag && value > 0 ? "+" : "");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${translator.message("chat.timeline.inputTokens")}: ${translator.number(usage.inputTokens)}${partial(usage.inputIsPartial, usage.inputTokens)}, ${translator.message("chat.timeline.outputTokens")}: ${translator.number(usage.outputTokens)}${partial(usage.outputIsPartial, usage.outputTokens)}`}
      className="h-11 shrink justify-center active:opacity-70"
      onPress={props.onPress}
    >
      <Text className="font-t3-medium text-xs tabular-nums text-foreground-muted" numberOfLines={1}>
        {formatTokenTotal(usage.inputTokens, usage.inputIsPartial)}{" "}
        {translator.message("chat.tokens.inShort")} ·{" "}
        {formatTokenTotal(usage.outputTokens, usage.outputIsPartial)}{" "}
        {translator.message("chat.tokens.outShort")}
      </Text>
    </Pressable>
  );
}
