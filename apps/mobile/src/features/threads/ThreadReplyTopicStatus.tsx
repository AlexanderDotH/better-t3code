import { StackActions, useNavigation } from "@react-navigation/native";
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
import { useThreadShells } from "../../state/entities";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { deriveReplyTopics, type ReplyTopicSummary } from "../../lib/replyTopicStatus";
import { useEnvironmentScope } from "../../state/session";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { uuidv4 } from "../../lib/uuid";
import * as Dialog from "../../components/ui/Dialog";

export function useTimelineReplyTopics(environmentId: EnvironmentId, threadId: ThreadId) {
  const shells = useThreadShells();
  const key = useMemo(
    () =>
      JSON.stringify([
        ...deriveReplyTopics(
          shells.filter((thread) => thread.environmentId === environmentId),
          threadId,
        ),
      ]),
    [shells, environmentId, threadId],
  );
  return useMemo(
    () => new Map(JSON.parse(key) as Array<[ReplyTopicSummary["messageId"], ReplyTopicSummary]>),
    [key],
  );
}

export function MessageReplyTopicStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly topic: ReplyTopicSummary | undefined;
}) {
  const navigation = useNavigation();
  const translator = useMobileInterfaceTranslator();
  const runtime = useRemoteEnvironmentRuntime(props.environmentId);
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const canRetry = useAtomValue(threadEnvironment.retryTurn.permissionAtom(props.environmentId));
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const retry = useAtomCommand(threadEnvironment.retryTurn, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const topic = props.topic;
  if (!topic) return null;
  const available =
    canOperate &&
    runtime?.connectionState === "connected" &&
    !pending &&
    runtime.serverConfig?.environment.capabilities.messageReplies === true;
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
          navigation.dispatch(
            StackActions.push("Thread", {
              environmentId: String(props.environmentId),
              threadId: String(topic.threadId),
            }),
          )
        }
      >
        <Text className="text-xs text-foreground-secondary" numberOfLines={1}>
          {translator.message("mobile.timeline.replies", { count: topic.count })}
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
          accessibilityState={{ disabled: !available }}
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
