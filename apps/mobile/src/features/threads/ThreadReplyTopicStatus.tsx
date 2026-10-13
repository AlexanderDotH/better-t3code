import { isMessageReplyTopicActive } from "@t3tools/client-runtime/messageReplies";
import type { EnvironmentId, OrchestrationSubagentSummary, ThreadId } from "@t3tools/contracts";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectedThreadRequests } from "../../state/use-selected-thread-requests";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { PendingUserInputCard } from "./PendingUserInputCard";
import { messageReplyStatusKey } from "../../lib/message-replies";

type TopicProps = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly topic: OrchestrationSubagentSummary;
  readonly enabled: boolean;
};

const ReplyTopic = memo(function ReplyTopic(props: TopicProps) {
  const translator = useMobileInterfaceTranslator();
  const interrupt = useAtomCommand(threadEnvironment.interruptReply, "stop message reply");
  const retry = useAtomCommand(threadEnvironment.retryReply, "retry message reply");
  const requests = useSelectedThreadRequests(props.topic.id);
  const [pending, setPending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const active = isMessageReplyTopicActive(props.topic);
  const retryable =
    props.topic.status === "interrupted" ||
    props.topic.status === "error" ||
    props.topic.status === "unavailable";
  const runAction = async () => {
    if (pending || !props.enabled) return;
    setPending(true);
    try {
      await (active ? interrupt : retry)({
        environmentId: props.environmentId,
        input: { threadId: props.threadId, replyTopicId: props.topic.id },
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <View className="mb-4 gap-2 border-l-2 border-border pl-3">
      <View className="flex-row flex-wrap items-center gap-3">
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-secondary">
          {translator.message("chat.reply.topic")} ·{" "}
          {translator.message(messageReplyStatusKey(props.topic))}
        </Text>
        {active || retryable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || !props.enabled, busy: pending }}
            disabled={pending || !props.enabled}
            className="min-h-9 justify-center px-2 active:opacity-60 disabled:opacity-40"
            onPress={() => void runAction()}
          >
            <Text className="font-t3-medium text-xs text-foreground">
              {translator.message(active ? "chat.reply.stop" : "chat.reply.retry")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {requests.activePendingApproval ? (
        <PendingApprovalCard
          approval={requests.activePendingApproval}
          respondingApprovalId={
            props.enabled ? requests.respondingApprovalId : requests.activePendingApproval.requestId
          }
          onRespond={requests.onRespondToApproval}
        />
      ) : null}
      {requests.activePendingUserInput ? (
        <PendingUserInputCard
          inline
          replyTopicId={props.topic.id}
          pendingUserInput={requests.activePendingUserInput}
          maxHeight={380}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          drafts={requests.activePendingUserInputDrafts}
          answers={requests.activePendingUserInputAnswers}
          respondingUserInputId={
            props.enabled
              ? requests.respondingUserInputId
              : requests.activePendingUserInput.requestId
          }
          onSelectOption={requests.onSelectUserInputOption}
          onChangeCustomAnswer={requests.onChangeUserInputCustomAnswer}
          onSubmit={requests.onSubmitUserInput}
          onDismiss={requests.onDismissUserInput}
        />
      ) : null}
    </View>
  );
});

export function ThreadReplyTopicStatus(
  props: Omit<TopicProps, "topic"> & { readonly topic: OrchestrationSubagentSummary | undefined },
) {
  return props.topic ? <ReplyTopic {...props} topic={props.topic} /> : null;
}
