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
} from "@t3tools/contracts";
import { createMessageReplyReference } from "@t3tools/client-runtime/messageReplies";
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
import { threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";

export function useThreadMessageReplies(input: {
  readonly thread: {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
  } | null;
  readonly serverConfig: ServerConfig | null;
  readonly connected: boolean;
  readonly deviceSettings?: BetterT3SettingsV1;
}) {
  const translator = useMobileInterfaceTranslator();
  const startReply = useAtomCommand(threadEnvironment.startReply, { reportFailure: false });
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
    const replyTo = createMessageReplyReference(
      message,
      translator.message(message.role === "user" ? "chat.reply.you" : "chat.reply.assistant"),
    );
    if (replyTo)
      setComposerDraftMessageReply(threadKey, {
        replyTo,
        replyTopicId: message.replyTopicId ?? SubagentId.make(uuidv4()),
      });
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
      const metadata = makeQueuedMessageMetadata();
      const messageId = MessageId.make(metadata.messageId);
      const result = await startReply({
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          replyTopicId: reply.replyTopicId,
          replyTo: reply.replyTo,
          commandId: CommandId.make(metadata.commandId),
          targetThreadId: ThreadId.make(`reply:${reply.replyTopicId}`),
          messageId,
          modelSelection: draft.modelSelection ?? thread.modelSelection,
          runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
          interactionMode: draft.interactionMode ?? thread.interactionMode,
          ...serializeComposerMessageForServer(
            appendVoiceFileContext(draft.text.trim(), draft.voiceFileReferences ?? []),
            uploadedComposerContext(draft.context, draft.attachments, prepared.attachments),
          ),
          attachments: prepared.attachments,
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
