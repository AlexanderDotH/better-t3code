import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useThreadShells } from "../../state/entities";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ThreadReplyTopicStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const navigation = useNavigation();
  const translator = useMobileInterfaceTranslator();
  const topics = useThreadShells().filter(
    (thread) =>
      thread.environmentId === props.environmentId &&
      thread.messageReply?.sourceThreadId === props.threadId,
  );
  if (topics.length === 0) return null;
  return (
    <View className="gap-1 px-3 py-1">
      {topics.map((topic) => (
        <Pressable
          key={topic.id}
          accessibilityRole="button"
          className="min-h-11 justify-center"
          onPress={() =>
            navigation.dispatch(
              StackActions.push("Thread", {
                environmentId: String(props.environmentId),
                threadId: String(topic.id),
              }),
            )
          }
        >
          <Text className="text-sm text-foreground" numberOfLines={1}>
            {translator.message("chat.reply.topic")} · {topic.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
