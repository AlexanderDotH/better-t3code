// @vitest-environment jsdom
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, SubagentId, ThreadId } from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useMessageReplies } from "./useMessageReplies";

const runtime = vi.hoisted(() => ({
  startReply: vi.fn(),
  capabilities: {
    messageReplies: true,
    attachmentUploads: true,
    fileAttachments: { maxUploadBytes: 1024 },
  },
  upload: vi.fn(),
  awaitUploads: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => runtime.startReply }));
vi.mock("../../state/threads", () => ({ threadEnvironment: { startReply: {} } }));
vi.mock("../../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => new Map([["local", { environment: { capabilities: runtime.capabilities } }]]),
  },
}));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  startAttachmentUpload: runtime.upload,
  awaitAttachmentUploads: runtime.awaitUploads,
  getUploadedAttachments: ({ images }: { images: { id: string }[] }) =>
    images.map(({ id }) => ({ type: "file", id: `uploaded-${id}` })),
  releaseDraftAttachments: runtime.release,
}));
vi.mock("../ChatView.logic", () => ({ readFileAsDataUrl: vi.fn() }));

const thread = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));
const reply = {
  replyTo: { messageId: MessageId.make("source"), role: "assistant" as const, text: "Full source" },
  replyTopicId: SubagentId.make("topic"),
};
let container: HTMLDivElement;
let root: Root;
let controller: ReturnType<typeof useMessageReplies>;
const resetCursorState = vi.fn();
const focusAtEnd = vi.fn();
const onSent = vi.fn();

function Harness() {
  const composerRef = {
    current: {
      focusAtEnd,
      resetCursorState,
      validateProviderInput: () => true,
      hasPendingAttachments: () => false,
      getSendContext: () => {
        const draft = useComposerDraftStore.getState().getComposerDraft(thread)!;
        return {
          prompt: draft.prompt,
          images: draft.images,
          files: draft.files,
          terminalContexts: draft.terminalContexts,
          previewAnnotations: draft.previewAnnotations,
          reviewComments: draft.reviewComments,
        };
      },
    },
  };
  const nextController = useMessageReplies({
    threadRef: thread,
    composerRef,
    enabled: true,
    blocked: false,
    onSent,
  });
  useLayoutEffect(() => {
    controller = nextController;
  });
  return nextController.error ? <p role="alert">{nextController.error}</p> : null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  runtime.capabilities.messageReplies = true;
  runtime.startReply.mockResolvedValue({ _tag: "Success", value: undefined });
  runtime.awaitUploads.mockResolvedValue(undefined);
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  const store = useComposerDraftStore.getState();
  store.setPrompt(thread, "My existing prompt");
  store.setReplyTarget(thread, reply);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("message reply dispatch", () => {
  it("selects a source without changing the draft and continues its existing topic", () => {
    act(() =>
      controller.onReply({
        id: MessageId.make("topic-answer"),
        replyTopicId: reply.replyTopicId,
        role: "assistant",
        text: "The earlier topic answer",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        turnId: null,
        streaming: false,
      }),
    );
    const draft = useComposerDraftStore.getState().getComposerDraft(thread);
    expect(draft?.prompt).toBe("My existing prompt");
    expect(draft?.replyTarget?.replyTopicId).toBe(reply.replyTopicId);
    expect(draft?.replyTarget?.replyTo.replyTopicId).toBe(reply.replyTopicId);
    expect(focusAtEnd).toHaveBeenCalled();
  });

  it("dispatches the immutable snapshot and clears only after success", async () => {
    await act(async () => controller.sendReply());
    expect(runtime.startReply).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: thread.environmentId,
        input: expect.objectContaining({
          threadId: thread.threadId,
          ...reply,
          message: expect.objectContaining({ text: "My existing prompt" }),
        }),
      }),
    );
    expect(useComposerDraftStore.getState().getComposerDraft(thread)).toBeNull();
    expect(resetCursorState).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("preserves the prompt and source on dispatch failure", async () => {
    runtime.startReply.mockRejectedValueOnce(new Error("Server disconnected"));
    await act(async () => controller.sendReply());
    const draft = useComposerDraftStore.getState().getComposerDraft(thread);
    expect(draft?.prompt).toBe("My existing prompt");
    expect(draft?.replyTarget).toEqual(reply);
    expect(container.textContent).toBe("Server disconnected");
    expect(resetCursorState).not.toHaveBeenCalled();
  });

  it("preserves a newer prompt written while dispatch is pending", async () => {
    runtime.startReply.mockImplementationOnce(async () => {
      useComposerDraftStore.getState().setPrompt(thread, "A newer prompt");
      return { _tag: "Success", value: undefined };
    });
    await act(async () => controller.sendReply());
    expect(useComposerDraftStore.getState().getComposerDraft(thread)?.prompt).toBe(
      "A newer prompt",
    );
    expect(resetCursorState).not.toHaveBeenCalled();
  });

  it("clears a successfully sent file draft after its upload updates storage", async () => {
    const store = useComposerDraftStore.getState();
    store.addFiles(thread, [
      {
        type: "file",
        id: "local-file",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        file: new File(["x"], "notes.txt"),
      },
    ]);
    runtime.awaitUploads.mockImplementationOnce(async () => {
      store.setFileUpload(thread, "local-file", thread.environmentId, "uploaded-local-file");
    });
    await act(async () => controller.sendReply());
    expect(runtime.startReply).toHaveBeenCalled();
    expect(store.getComposerDraft(thread)).toBeNull();
    expect(runtime.release).toHaveBeenCalledTimes(1);
  });

  it("does not send a stale reply draft to a server without reply support", async () => {
    runtime.capabilities.messageReplies = false;
    await act(async () => controller.sendReply());
    expect(runtime.startReply).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(thread)?.replyTarget).toEqual(reply);
    expect(container.querySelector("[role=alert]")).not.toBeNull();
  });
});
