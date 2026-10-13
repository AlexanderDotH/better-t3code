import { createMessageReplyReference } from "@t3tools/client-runtime/messageReplies";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SubagentId, type ScopedThreadRef } from "@t3tools/contracts";
import { appendVoiceFileContext } from "@t3tools/shared/voiceFileContext";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useComposerDraftStore, type ComposerThreadDraftState } from "../../composerDraftStore";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { buildMessageContext } from "../../lib/composerContextRecords";
import { newMessageId, randomUUID } from "../../lib/utils";
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
  "focusAtEnd" | "resetCursorState" | "validateProviderInput" | "hasPendingAttachments"
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
    current.reviewComments === sent.reviewComments
  );
}

export function useMessageReplies({
  threadRef,
  composerRef,
  enabled,
  blocked,
  onSent,
}: {
  threadRef: ScopedThreadRef;
  composerRef: RefObject<ReplyComposer | null>;
  enabled: boolean;
  blocked: boolean;
  onSent: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const startReply = useAtomCommand(threadEnvironment.startReply, { reportFailure: false });
  const inFlightRef = useRef(new Set<string>());
  const [sendingKeys, setSendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{ threadKey: string; message: string } | null>(null);
  const threadKey = scopedThreadKey(threadRef);
  const currentThreadKeyRef = useRef(threadKey);
  useLayoutEffect(() => {
    currentThreadKeyRef.current = threadKey;
  }, [threadKey]);
  const onReply = useCallback(
    (message: ChatMessage) => {
      if (!enabled) return;
      const replyTo = createMessageReplyReference(message);
      if (!replyTo) return;
      useComposerDraftStore.getState().setReplyTarget(threadRef, {
        replyTo,
        replyTopicId: message.replyTopicId ?? SubagentId.make(randomUUID()),
      });
      setError(null);
      composerRef.current?.focusAtEnd();
    },
    [composerRef, enabled, threadRef],
  );

  const sendReply = async () => {
    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    const replyTarget = draft?.replyTarget;
    if (!draft || !replyTarget || blocked || inFlightRef.current.has(threadKey)) return;
    if (!composerRef.current || composerRef.current.hasPendingAttachments()) return;
    const send = draft;
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
      send.previewAnnotations.length === 0
    )
      return;
    const text = appendVoiceFileContext(send.prompt.trim(), draft.voiceFileReferences);
    if (composerRef.current?.validateProviderInput(text) === false) return;
    inFlightRef.current.add(threadKey);
    setSendingKeys(new Set(inFlightRef.current));
    setError(null);
    try {
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
        attachments: attachments.map((attachment, index) => ({
          attachment,
          attachmentId: outgoingAttachments[index]?.id ?? attachment.id,
        })),
      });
      const result = await startReply({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          ...replyTarget,
          message: {
            messageId: newMessageId(),
            role: "user",
            text,
            attachments: outgoingAttachments,
            ...(context ? { context } : {}),
          },
          createdAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const store = useComposerDraftStore.getState();
      if (replyDraftMatchesSentContent(store.getComposerDraft(threadRef), draft)) {
        store.clearComposerContent(threadRef);
        if (currentThreadKeyRef.current === threadKey) composerRef.current?.resetCursorState();
        releaseDraftAttachments(attachments);
      }
      if (currentThreadKeyRef.current === threadKey) onSent();
    } catch (cause) {
      setError({
        threadKey,
        message: cause instanceof Error ? cause.message : translate("chat.reply.sendFailed"),
      });
    } finally {
      inFlightRef.current.delete(threadKey);
      setSendingKeys(new Set(inFlightRef.current));
    }
  };

  return {
    onReply,
    sendReply,
    isSending: sendingKeys.has(threadKey),
    error: error?.threadKey === threadKey ? error.message : null,
  };
}
