import type { OrchestrationCheckpointSummary } from "@t3tools/contracts";
import { Pressable, View } from "react-native";
import { AppText } from "../../components/AppText";
import { PierreEntryIcon } from "../../components/PierreEntryIcon";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ChatPresentationMotion } from "./ChatPresentationMotion";
import { changedFileMotionId, COLLAPSED_CHANGED_FILE_COUNT } from "./changed-files-summary";

export function ChangedFilesSummary(props: {
  readonly checkpoint: OrchestrationCheckpointSummary;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onOpenReview: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const files = props.expanded
    ? props.checkpoint.files
    : props.checkpoint.files.slice(0, COLLAPSED_CHANGED_FILE_COUNT);
  return (
    <View className="mt-3 gap-2">
      {files.map((file) => (
        <ChatPresentationMotion
          key={file.path}
          motionId={changedFileMotionId(props.checkpoint, file.path)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={file.path}
            accessibilityHint={translator.message("chat.changedFiles.openFullDiff")}
            className="min-h-[44px] min-w-0 flex-row items-center gap-2 active:opacity-70"
            onPress={props.onOpenReview}
          >
            <PierreEntryIcon path={file.path} kind="file" size={18} />
            <AppText
              className="min-w-0 flex-1 font-t3-medium text-sm text-user-bubble-foreground"
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {file.path}
            </AppText>
            <View className="shrink-0 flex-row gap-2">
              <AppText className="text-xs tabular-nums text-adaptive-emerald-600-400">
                +{file.additions}
              </AppText>
              <AppText className="text-xs tabular-nums text-adaptive-rose-600-400">
                −{file.deletions}
              </AppText>
            </View>
          </Pressable>
        </ChatPresentationMotion>
      ))}
      {props.checkpoint.files.length > COLLAPSED_CHANGED_FILE_COUNT ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: props.expanded }}
          className="min-h-[44px] justify-center rounded-xl active:bg-subtle"
          onPress={props.onToggle}
        >
          <AppText className="font-t3-medium text-xs text-user-bubble-foreground-muted">
            {translator.message(
              props.expanded ? "chat.files.showFewer" : "chat.changedFiles.showAll",
              {
                count: props.checkpoint.files.length,
              },
            )}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
