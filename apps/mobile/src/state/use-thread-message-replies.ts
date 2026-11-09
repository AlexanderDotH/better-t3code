import { useRef, useState } from "react";
import { Alert } from "react-native";
import {
  CommandId,
  MessageId,
  SubagentId,
  type EnvironmentId,
  ThreadId,
  type ModelSelection,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ServerConfig,
  type BetterT3SettingsV1,
  type OrchestrationV2MessageReply,
} from "@t3tools/contracts";
import {
  createMessageReplyReference,
  resolveMessageReplyDispatch,
  resolveMessageReplyTarget,
} from "@t3tools/client-runtime/messageReplies";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { appendVoiceFileContext } from "@t3tools/shared/voiceFileContext";
import { prepareTurnAttachments } from "../lib/attachmentUpload";
import { makeQueuedMessageMetadata } from "../lib/commandMetadata";
import { serializeComposerMessageForServer, uploadedComposerContext } from "../lib/composerContext";
import { scopedThreadKey } from "../lib/scopedEntities";
import { uuidv4 } from "../lib/uuid";
import { useMobileInterfaceTranslator } from "../localization/useMobileInterfaceTranslator";
import { mobileMessageRepliesEnabled } from "../lib/message-replies";
import { messageReplyDraftCompletion } from "./message-reply-draft";
import {
  clearComposerDraftContent,
  getComposerDraftSnapshot,
  setComposerDraftAttachmentUpload,
  setComposerDraftMessageReply,
  type ComposerDraft,
} from "./use-composer-drafts";
import { appAtomRegistry } from "./atom-registry";
import { environmentThreadShells, threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";

export function useThreadMessageReplies(input: {
  readonly thread: {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly messageReply?: OrchestrationV2MessageReply;
  } | null;
  readonly serverConfig: ServerConfig | null;
  readonly connected: boolean;
  readonly deviceSettings?: BetterT3SettingsV1;
}) {
  const translator = useMobileInterfaceTranslator();
  const startReply = useAtomCommand(threadEnvironment.startReply, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const inFlight = useRef(new Set<string>());
  const [sendingKeys, setSendingKeys] = useState<ReadonlySet<string>>(new Set());
  const enabled = mobileMessageRepliesEnabled(
    input.serverConfig?.environment.capabilities,
    input.deviceSettings,
  );
  const threadKey = input.thread
    ? scopedThreadKey(input.thread.environmentId, input.thread.id)
    : null;
  const selectReply = (message: Parameters<typeof createMessageReplyReference>[0]) => {
    if (!enabled || !threadKey) return;
    const reference = createMessageReplyReference(
      message,
      translator.message(message.role === "user" ? "chat.reply.you" : "chat.reply.assistant"),
    );
    if (reference)
      setComposerDraftMessageReply(
        threadKey,
        resolveMessageReplyTarget({
          reference,
          currentReply: input.thread?.messageReply,
          createTopicId: () => SubagentId.make(uuidv4()),
        }),
      );
  };
  const cancelReply = () => {
    if (threadKey) setComposerDraftMessageReply(threadKey, undefined);
  };
  const sendReply = async (draft: ComposerDraft): Promise<MessageId | null> => {
    if (
      !input.thread ||
      !threadKey ||
      !draft.messageReply ||
      !enabled ||
      !input.connected ||
      inFlight.current.has(threadKey)
    )
      return null;
    const thread = input.thread;
    const reply = draft.messageReply;
    inFlight.current.add(threadKey);
    setSendingKeys(new Set(inFlight.current));
    const completed = await settlePromise(async () => {
      const prepared = await prepareTurnAttachments({
        environmentId: thread.environmentId,
        attachments: draft.attachments,
        supportsImageUploads:
          input.serverConfig?.environment.capabilities.attachmentUploads === true,
        persistUploadedReferences: async (attachments) => {
          if (getComposerDraftSnapshot(threadKey).messageReply !== reply) return "abandon";
          for (const attachment of attachments)
            setComposerDraftAttachmentUpload(threadKey, attachment);
          return "persisted";
        },
      });
      if (prepared.status !== "ready" || getComposerDraftSnapshot(threadKey).messageReply !== reply)
        return null;
      const dispatch = resolveMessageReplyDispatch({
        threadId: thread.id,
        currentReply: thread.messageReply,
        replyTo: reply.replyTo,
        replyTopicId: reply.replyTopicId,
        threads: appAtomRegistry
          .get(environmentThreadShells.threadShellsAtom)
          .filter((shell) => shell.environmentId === thread.environmentId),
      });
      if (dispatch.kind === "unavailable")
        throw new Error(translator.message("chat.reply.unavailable"));
      const metadata = makeQueuedMessageMetadata();
      const messageId = MessageId.make(metadata.messageId);
      const message = serializeComposerMessageForServer(
        appendVoiceFileContext(draft.text.trim(), draft.voiceFileReferences ?? []),
        uploadedComposerContext(draft.context, draft.attachments, prepared.attachments),
      );
      const settings = {
        modelSelection: draft.modelSelection ?? thread.modelSelection,
        runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
        interactionMode: draft.interactionMode ?? thread.interactionMode,
      };
      const commandId = CommandId.make(metadata.commandId);
      const result =
        dispatch.kind === "continue"
          ? await startTurn({
              environmentId: thread.environmentId,
              input: {
                threadId: dispatch.threadId,
                commandId,
                message: {
                  messageId,
                  role: "user",
                  ...message,
                  attachments: prepared.attachments,
                },
                ...settings,
                replyTo: reply.replyTo,
                replyTopicId: reply.replyTopicId,
              },
            })
          : await startReply({
              environmentId: thread.environmentId,
              input: {
                threadId: dispatch.sourceThreadId,
                replyTopicId: reply.replyTopicId,
                replyTo: reply.replyTo,
                commandId,
                targetThreadId: ThreadId.make(`reply:${reply.replyTopicId}`),
                messageId,
                ...settings,
                ...message,
                attachments: prepared.attachments,
                creationSource: "mobile",
              },
            });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const completion = messageReplyDraftCompletion(getComposerDraftSnapshot(threadKey), draft);
      if (completion === "clear") clearComposerDraftContent(threadKey);
      else if (completion === "cancel-reply") setComposerDraftMessageReply(threadKey, undefined);
      return messageId;
    });
    inFlight.current.delete(threadKey);
    setSendingKeys(new Set(inFlight.current));
    if (AsyncResult.isFailure(completed)) {
      const error = squashAtomCommandFailure(completed);
      Alert.alert(
        translator.message("chat.reply.sendFailed"),
        error instanceof Error ? error.message : translator.message("chat.reply.unavailable"),
      );
      return null;
    }
    return completed.value;
  };
  return {
    enabled,
    sending: threadKey !== null && sendingKeys.has(threadKey),
    selectReply,
    cancelReply,
    sendReply,
  };
}
