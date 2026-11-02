import { readThreadShell, readThreadShells } from "../../state/entities";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useRightPanelStore } from "../../rightPanelStore";
import { createMessageReplyReference } from "@t3tools/client-runtime/messageReplies";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SubagentId, type ScopedThreadRef, type RuntimeMode } from "@t3tools/contracts";
import { appendVoiceFileContext } from "@t3tools/shared/voiceFileContext";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useComposerDraftStore, type ComposerThreadDraftState } from "../../composerDraftStore";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { buildMessageContext } from "../../lib/composerContextRecords";
import { newMessageId, newThreadId, randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ChatMessage } from "../../types";
import { readFileAsDataUrl } from "../ChatView.logic";
import type { ChatComposerHandle } from "./ChatComposer";
import { fileAttachmentCapabilityBlockReason } from "./composerAttachmentFiles";

type ReplyComposer = Pick<
  ChatComposerHandle,
  | "focusAtEnd"
  | "resetCursorState"
  | "validateProviderInput"
  | "hasPendingAttachments"
  | "getSendContext"
>;

function replyDraftMatchesSentContent(
  current: ComposerThreadDraftState | null,
  sent: ComposerThreadDraftState,
): boolean {
  return (
    current !== null &&
    current.replyTarget === sent.replyTarget &&
    current.prompt === sent.prompt &&
    current.images.length === sent.images.length &&
    current.images.every((image, index) => image.id === sent.images[index]?.id) &&
    current.files.length === sent.files.length &&
    current.files.every((file, index) => file.id === sent.files[index]?.id) &&
    current.terminalContexts === sent.terminalContexts &&
    current.previewAnnotations === sent.previewAnnotations &&
    current.reviewComments === sent.reviewComments &&
    current.threadContexts === sent.threadContexts &&
    current.environmentContexts === sent.environmentContexts &&
    current.voiceFileReferences === sent.voiceFileReferences
  );
}

export function useMessageReplies({
  threadRef,
  composerRef,
  enabled,
  blocked,
  onSent,
  runtimeMode,
  messageReply,
}: {
  threadRef: ScopedThreadRef;
  composerRef: RefObject<ReplyComposer | null>;
  enabled: boolean;
  blocked: boolean;
  onSent: () => void;
  runtimeMode: RuntimeMode;
  messageReply?: import("@t3tools/contracts").OrchestrationV2MessageReply | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  const startReply = useAtomCommand(threadEnvironment.startReply, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const inFlightRef = useRef(new Set<string>());
  const [sendingKeys, setSendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{ threadKey: string; message: string } | null>(null);
  const threadKey = scopedThreadKey(threadRef);
  const currentThreadKeyRef = useRef(threadKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep async upload completion tied to the currently displayed thread.
  useLayoutEffect(() => {
    currentThreadKeyRef.current = threadKey;
  }, [threadKey]);
  const onReply = useStableCallback((message: ChatMessage) => {
    if (!enabled) return;
    const reference = createMessageReplyReference(message);
    if (!reference) return;
    const existingTopicId =
      message.replyTopicId ??
      messageReply?.replyTopicId ??
      readThreadShell(threadRef)?.messageReply?.replyTopicId;
    const replyTo =
      existingTopicId && reference.replyTopicId === undefined
        ? { ...reference, replyTopicId: existingTopicId }
        : reference;
    useComposerDraftStore.getState().setReplyTarget(threadRef, {
      replyTo,
      replyTopicId: existingTopicId ?? SubagentId.make(randomUUID()),
    });
    setError(null);
    composerRef.current?.focusAtEnd();
  });

  const sendReply = async () => {
    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    const replyTarget = draft?.replyTarget;
    if (!draft || !replyTarget || blocked || inFlightRef.current.has(threadKey)) return;
    if (!composerRef.current || composerRef.current.hasPendingAttachments()) return;
    const send = draft;
    const sendContext = composerRef.current.getSendContext();
    const currentReply = messageReply ?? readThreadShell(threadRef)?.messageReply;
    const continuesTopic = replyTarget.replyTo.replyTopicId === replyTarget.replyTopicId;
    const existingChild = !continuesTopic
      ? null
      : currentReply?.replyTopicId === replyTarget.replyTopicId
        ? { id: threadRef.threadId }
        : (readThreadShells().find(
            (shell) =>
              shell.environmentId === threadRef.environmentId &&
              shell.messageReply?.replyTopicId === replyTarget.replyTopicId &&
              shell.messageReply.sourceThreadId ===
                (currentReply?.sourceThreadId ?? threadRef.threadId),
          ) ?? null);
    const readCapabilities = () =>
      appAtomRegistry.get(environmentServerConfigsAtom).get(threadRef.environmentId)?.environment
        .capabilities;
    if (!enabled || readCapabilities()?.messageReplies !== true) {
      setError({ threadKey, message: translate("chat.reply.unavailable") });
      return;
    }
    const attachments = [...send.images, ...send.files];
    if (
      !send.prompt.trim() &&
      attachments.length === 0 &&
      send.terminalContexts.length === 0 &&
      send.reviewComments.length === 0 &&
      send.previewAnnotations.length === 0 &&
      send.threadContexts.length === 0 &&
      send.environmentContexts.length === 0
    )
      return;
    const text = appendVoiceFileContext(send.prompt.trim(), draft.voiceFileReferences);
    if (composerRef.current?.validateProviderInput(text) === false) return;
    inFlightRef.current.add(threadKey);
    setSendingKeys(new Set(inFlightRef.current));
    setError(null);
    return (async () => {
      const capabilities = readCapabilities();
      const blockReason = fileAttachmentCapabilityBlockReason({
        files: send.files,
        attachmentUploadsCapabilityKnown: capabilities !== undefined,
        supportsAttachmentUploads: capabilities?.attachmentUploads === true,
        maxFileAttachmentBytes: capabilities?.fileAttachments?.maxUploadBytes ?? null,
      });
      if (blockReason) throw new Error(blockReason);
      if (capabilities?.attachmentUploads === true) {
        for (const attachment of attachments)
          startAttachmentUpload({
            environmentId: threadRef.environmentId,
            image: attachment,
            draftTarget: threadRef,
          });
        await awaitAttachmentUploads(attachments.map(({ id }) => id));
      }
      const outgoingAttachments = await Promise.all(
        attachments.map(async (attachment) => {
          if (capabilities?.attachmentUploads === true) {
            const uploaded = getUploadedAttachments({
              environmentId: threadRef.environmentId,
              images: [attachment],
            })?.[0];
            if (!uploaded)
              throw new Error(`Attachment '${attachment.name}' did not finish uploading.`);
            return uploaded;
          }
          if (attachment.type !== "image")
            throw new Error("This server does not support file attachments.");
          return {
            type: "image" as const,
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            dataUrl: await readFileAsDataUrl(attachment.file),
            ...(attachment.source ? { source: attachment.source } : {}),
          };
        }),
      );
      if (readCapabilities()?.messageReplies !== true)
        throw new Error(translate("chat.reply.unavailable"));
      const context = buildMessageContext({
        terminalContexts: send.terminalContexts,
        previewAnnotations: send.previewAnnotations,
        reviewComments: send.reviewComments,
        threadContexts: send.threadContexts,
        environmentContexts: send.environmentContexts,
        attachments: attachments.map((attachment, index) => ({
          attachment,
          attachmentId: outgoingAttachments[index]?.id ?? attachment.id,
        })),
      });
      if (continuesTopic && existingChild === null)
        throw new Error(translate("chat.reply.unavailable"));
      const targetThreadId = existingChild?.id ?? newThreadId();
      const messageId = newMessageId();
      const result = existingChild
        ? await startTurn({
            environmentId: threadRef.environmentId,
            input: {
              threadId: targetThreadId,
              message: {
                messageId,
                role: "user",
                text,
                attachments: outgoingAttachments,
                ...(context ? { context } : {}),
              },
              modelSelection: sendContext.selectedModelSelection,
              runtimeMode,
              interactionMode: sendContext.interactionMode,
              replyTo: replyTarget.replyTo,
              replyTopicId: replyTarget.replyTopicId,
            },
          })
        : await startReply({
            environmentId: threadRef.environmentId,
            input: {
              threadId: currentReply?.sourceThreadId ?? threadRef.threadId,
              ...replyTarget,
              messageId,
              targetThreadId,
              text,
              attachments: outgoingAttachments,
              ...(context ? { context } : {}),
              modelSelection: sendContext.selectedModelSelection,
              runtimeMode,
              interactionMode: sendContext.interactionMode,
            },
          });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const rootThreadRef = {
        environmentId: threadRef.environmentId,
        threadId: currentReply?.sourceThreadId ?? threadRef.threadId,
      };
      useRightPanelStore.getState().openSideChat(rootThreadRef, targetThreadId);
      const store = useComposerDraftStore.getState();
      if (replyDraftMatchesSentContent(store.getComposerDraft(threadRef), draft)) {
        store.clearComposerContent(threadRef);
        if (currentThreadKeyRef.current === threadKey) composerRef.current?.resetCursorState();
        releaseDraftAttachments(attachments);
      }
      if (currentThreadKeyRef.current === threadKey) onSent();
    })()
      .catch((cause) => {
        setError({
          threadKey,
          message: cause instanceof Error ? cause.message : translate("chat.reply.sendFailed"),
        });
      })
      .finally(() => {
        inFlightRef.current.delete(threadKey);
        setSendingKeys(new Set(inFlightRef.current));
      });
  };

  return {
    onReply,
    sendReply,
    isSending: sendingKeys.has(threadKey),
    error: error?.threadKey === threadKey ? error.message : null,
  };
}
