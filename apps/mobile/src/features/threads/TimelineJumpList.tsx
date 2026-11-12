import { LegendList } from "@legendapp/list/react-native";
import type { MessageId, TimestampFormat } from "@t3tools/contracts";
import { useMemo } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { formatTimelineTimestamp } from "../../lib/timelineTimestamp";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import type { ThreadFeedHistoryControls } from "./threadFeedHistory";

export function TimelineJumpList(props: {
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly timestampFormat: TimestampFormat;
  readonly history?: ThreadFeedHistoryControls;
  readonly onJump: (messageId: MessageId) => void;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => {
    const finalByRun = new Map<string, string>();
    for (const entry of props.feed)
      if (
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        (entry.message.text.trim() || entry.message.attachments.length)
      )
        finalByRun.set(entry.message.runId ?? entry.id, entry.id);
    return props.feed.flatMap((entry) =>
      entry.type === "message" &&
      (entry.message.role === "user" ||
        finalByRun.get(entry.message.runId ?? entry.id) === entry.id)
        ? [entry]
        : [],
    );
  }, [props.feed]);
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View
        className="flex-1 bg-sheet"
        style={{
          paddingTop: Platform.OS === "android" ? insets.top : 0,
          paddingBottom: insets.bottom,
        }}
      >
        <View className="flex-row items-center px-4 py-3">
          <AppText className="flex-1 text-lg font-t3-semibold text-foreground">
            {translator.message("mobile.timeline.jumpList")}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translator.message("mobile.timeline.close")}
            className="size-11 items-center justify-center"
            onPress={props.onClose}
          >
            <SymbolView name="xmark" size={18} />
          </Pressable>
        </View>
        {/* oxlint-disable-next-line t3code/require-registered-list-scroll -- This modal owns its header and scroll view. */}
        <LegendList
          data={rows}
          keyExtractor={(entry) => entry.id}
          estimatedItemSize={76}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              className="min-h-16 gap-1 border-b border-border-subtle py-3 active:opacity-60"
              onPress={() => props.onJump(item.message.id)}
            >
              <View className="flex-row items-center gap-2">
                <SymbolView
                  name={item.message.role === "user" ? "person.crop.circle" : "sparkles"}
                  size={14}
                />
                <AppText className="text-xs text-foreground-secondary">
                  {translator.message(
                    item.message.role === "user" ? "chat.reply.you" : "chat.reply.assistant",
                  )}{" "}
                  · {formatTimelineTimestamp(item.createdAt, props.timestampFormat, true)}
                </AppText>
              </View>
              <AppText numberOfLines={2} className="text-sm text-foreground">
                {item.message.text.replace(/\s+/g, " ").slice(0, 240)}
              </AppText>
            </Pressable>
          )}
          ListHeaderComponent={
            props.history?.hasMoreHistory ? (
              <Pressable
                accessibilityRole="button"
                disabled={props.history.loading}
                className="min-h-11 justify-center"
                onPress={props.history.onLoadEarlier}
              >
                <AppText className="text-center text-sm text-foreground">
                  {translator.message("mobile.timeline.loadHistory")}
                  {props.history.loading ? "…" : ""}
                </AppText>
              </Pressable>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}
