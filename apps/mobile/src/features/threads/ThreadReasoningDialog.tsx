import type { RunId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import type { ThreadFeedActivity } from "../../lib/threadActivity";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadReasoningGroup } from "./thread-work-log";

export function ThreadReasoningDialog(props: {
  readonly activities: ReadonlyArray<ThreadFeedActivity> | undefined;
  readonly edgeFadeColor: string;
  readonly liveRunId: RunId | null;
  readonly onClose: () => void;
  readonly renderReasoning: (text: string) => ReactNode;
}) {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  if (!props.activities) return null;
  // A thought's final chunk arrives with streaming off, so follow the run rather than the item.
  const live = props.liveRunId !== null && props.activities.at(-1)?.runId === props.liveRunId;
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View
        className="flex-1 bg-sheet"
        // Android ignores pageSheet and draws the modal edge to edge under the status bar.
        style={{
          paddingTop: Platform.OS === "android" ? insets.top : 0,
          paddingBottom: insets.bottom,
        }}
      >
        <View className="flex-row items-center border-b border-border px-5 py-4">
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">
            {translator.message(live ? "chat.timeline.thinking" : "chat.timeline.thought")}
          </Text>
          <Pressable accessibilityRole="button" className="px-2 py-1" onPress={props.onClose}>
            <Text className="text-base font-t3-medium text-foreground">
              {translator.message("common.done")}
            </Text>
          </Pressable>
        </View>
        <View className="flex-1 px-5 py-4">
          <ThreadReasoningGroup
            activities={props.activities}
            edgeFadeColor={props.edgeFadeColor}
            renderReasoning={props.renderReasoning}
            fullHeight
            followLive={live}
          />
        </View>
      </View>
    </Modal>
  );
}
