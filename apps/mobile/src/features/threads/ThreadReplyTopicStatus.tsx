import {
  AuthOrchestrationOperateScope,
  CommandId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { deriveReplyTopics, type ReplyTopicSummary } from "../../lib/replyTopicStatus";
import { mobileReplyTopicActionsEnabled } from "../../lib/message-replies";
import { useEnvironmentScope } from "../../state/session";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { uuidv4 } from "../../lib/uuid";
import * as Dialog from "../../components/ui/Dialog";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

export function useTimelineReplyTopics(environmentId: EnvironmentId, threadId: ThreadId) {
  const shells = useAtomValue(environmentThreadShells.replyTopicsAtom({ environmentId, threadId }));
  return useMemo(() => deriveReplyTopics(shells, threadId), [shells, threadId]);
}

export function MessageReplyTopicStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly topic: ReplyTopicSummary;
}) {
  const openLinkedThread = useOpenLinkedThread();
  const translator = useMobileInterfaceTranslator();
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const canRetry = useAtomValue(threadEnvironment.retryTurn.permissionAtom(props.environmentId));
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const retry = useAtomCommand(threadEnvironment.retryTurn, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const topic = props.topic;
  const available =
    canOperate &&
    !pending &&
    mobileReplyTopicActionsEnabled(
      runtime?.serverConfig?.environment.capabilities,
      runtime?.connectionState === "connected",
    );
  const active =
    topic.status === "running" || topic.status === "waiting" || topic.status === "pending";
  const run = async (action: "stop" | "retry") => {
    if (!available || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    await (async () => {
      const result =
        action === "stop"
          ? await interrupt({
              environmentId: props.environmentId,
              input: {
                threadId: topic.threadId,
                ...(topic.runId ? { runId: topic.runId } : {}),
                commandId: CommandId.make(uuidv4()),
              },
            })
          : topic.retry && canRetry
            ? await retry({
                environmentId: props.environmentId,
                input: {
                  type: "message.retry",
                  threadId: topic.threadId,
                  ...topic.retry,
                  commandId: CommandId.make(uuidv4()),
                },
              })
            : null;
      if (result?._tag === "Failure" && !isAtomCommandInterrupted(result))
        throw squashAtomCommandFailure(result);
    })()
      .catch((cause) => {
        Dialog.alert(
          translator.message("mobile.timeline.failed"),
          cause instanceof Error ? cause.message : String(cause),
        );
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  };
  return (
    <View className="mt-1 flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityHint={topic.error ?? undefined}
        className="min-h-11 min-w-0 flex-1 justify-center"
        onPress={() =>
          openLinkedThread({ environmentId: props.environmentId, threadId: topic.threadId })
        }
      >
        <Text className="text-xs text-foreground-secondary" numberOfLines={1}>
          {translator.message("chat.reply.topic")}
          {topic.status ? ` · ${translator.message(`mobile.timeline.${topic.status}`)}` : ""} ·{" "}
          {topic.title}
        </Text>
        {topic.error ? (
          <Text className="text-xs text-adaptive-rose-600-400" numberOfLines={2}>
            {topic.error}
          </Text>
        ) : null}
      </Pressable>
      {active || topic.retry ? (
        <Pressable
          accessibilityRole="button"
          disabled={!available || (!active && !canRetry)}
          accessibilityState={{ disabled: !available || (!active && !canRetry) }}
          className="min-h-11 justify-center px-2 disabled:opacity-40"
          onPress={() => void run(active ? "stop" : "retry")}
        >
          <Text className="text-xs font-t3-medium text-foreground">
            {translator.message(active ? "mobile.timeline.stop" : "mobile.timeline.retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ThreadReplyTopicStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const openLinkedThread = useOpenLinkedThread();
  const translator = useMobileInterfaceTranslator();
  const topics = useAtomValue(environmentThreadShells.replyTopicsAtom(props));
  if (topics.length === 0) return null;
  return (
    <View className="gap-1 px-3 py-1">
      {topics.map((topic) => (
        <Pressable
          key={topic.id}
          accessibilityRole="button"
          className="min-h-11 justify-center"
          onPress={() =>
            openLinkedThread({ environmentId: props.environmentId, threadId: topic.id })
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
