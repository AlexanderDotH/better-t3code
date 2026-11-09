import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  MessageId,
  SubagentId,
  ThreadId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ComposerMode,
  type OrchestrationV2MessageReply,
} from "@t3tools/contracts";
import { useLayoutEffect, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useMessageReplies } from "./useMessageReplies";

async function mountHook(element: ReactElement) {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
  });
  const mounted = renderer!;
  return {
    alerts: () => mounted.root.findAllByProps({ role: "alert" }),
    text: () =>
      mounted.root
        .findAllByProps({ role: "alert" })
        .map((node) => node.children.join(""))
        .join(""),
    async [Symbol.asyncDispose]() {
      await act(async () => mounted.unmount());
    },
  };
}

const runtime = vi.hoisted(() => ({
  startReply: vi.fn(),
  startTurn: vi.fn(),
  startReplyCommand: { kind: "startReply" },
  startTurnCommand: { kind: "startTurn" },
  readShell: vi.fn(),
  readShells: vi.fn(),
  capabilities: {
    messageReplies: true,
    attachmentUploads: true,
    fileAttachments: { maxUploadBytes: 1024 },
  },
  upload: vi.fn(),
  awaitUploads: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => {
    if (command === runtime.startReplyCommand) return runtime.startReply;
    if (command === runtime.startTurnCommand) return runtime.startTurn;
    throw new Error("Unexpected reply command");
  },
}));
vi.mock("../../state/threads", () => ({
  threadEnvironment: { startReply: runtime.startReplyCommand, startTurn: runtime.startTurnCommand },
}));
vi.mock("../../state/entities", () => ({
  readThreadShell: runtime.readShell,
  readThreadShells: runtime.readShells,
}));
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
  getUploadedAttachments: ({
    images,
  }: {
    images: { id: string; name: string; mimeType: string; sizeBytes: number }[];
  }) =>
    images.map(({ id, name, mimeType, sizeBytes }) => ({
      type: "file",
      id: `uploaded-${id}`,
      name,
      mimeType,
      sizeBytes,
    })),
  releaseDraftAttachments: runtime.release,
}));
vi.mock("../ChatView.logic", () => ({ readFileAsDataUrl: vi.fn() }));

const thread = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));
const reply = {
  replyTo: { messageId: MessageId.make("source"), role: "assistant" as const, text: "Full source" },
  replyTopicId: SubagentId.make("topic"),
};
function setup({
  currentThread = thread,
  messageReply,
  enabled = true,
  composerMode = "default",
}: {
  currentThread?: typeof thread;
  messageReply?: OrchestrationV2MessageReply;
  enabled?: boolean;
  composerMode?: ComposerMode;
} = {}) {
  let modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test-model" };
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
          const draft = useComposerDraftStore.getState().getComposerDraft(currentThread)!;
          return {
            prompt: draft.prompt,
            images: draft.images,
            files: draft.files,
            terminalContexts: draft.terminalContexts,
            previewAnnotations: draft.previewAnnotations,
            reviewComments: draft.reviewComments,
            answeringPendingUserInput: false,
            threadContexts: draft.threadContexts,
            environmentContexts: draft.environmentContexts,
            selectedPromptEffort: null,
            selectedModelSelection: modelSelection,
            multipleModelSelections: null,
            providerAvailable: true,
            selectedProvider: ProviderDriverKind.make("codex"),
            selectedModel: modelSelection.model,
            selectedProviderModels: [],
            composerMode,
            deepPlanSourceRefs: [],
            interactionMode: "default" as const,
            interactionModeEnabled: true,
            shownPendingApprovalIds: [],
          };
        },
      },
    };
    const nextController = useMessageReplies({
      threadRef: currentThread,
      ...(messageReply ? { messageReply } : {}),
      composerRef,
      enabled,
      runtimeMode: "full-access",
      blocked: false,
      onSent,
    });
    useLayoutEffect(() => {
      controller = nextController;
    });
    return nextController.error ? <p role="alert">{nextController.error}</p> : null;
  }

  vi.clearAllMocks();
  runtime.capabilities.messageReplies = true;
  runtime.startReply.mockResolvedValue({ _tag: "Success", value: undefined });
  runtime.startTurn.mockResolvedValue({ _tag: "Success", value: undefined });
  runtime.readShell.mockReturnValue(undefined);
  runtime.readShells.mockReturnValue([]);
  runtime.awaitUploads.mockResolvedValue(undefined);
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  const store = useComposerDraftStore.getState();
  store.setPrompt(currentThread, "My existing prompt");
  store.setReplyTarget(currentThread, reply);
  return {
    element: <Harness />,
    current: () => controller,
    resetCursorState,
    focusAtEnd,
    onSent,
    selectModel: (model: string) => {
      modelSelection = { ...modelSelection, model };
    },
  };
}

describe("message reply dispatch", () => {
  it.each(["parent", "child"] as const)(
    "selects a source and continues its existing topic from the %s view",
    async (surface) => {
      const child = scopeThreadRef(thread.environmentId, ThreadId.make("existing-reply-child"));
      const metadata = {
        sourceThreadId: thread.threadId,
        replyTopicId: reply.replyTopicId,
        messageId: reply.replyTo.messageId,
      };
      const currentThread = surface === "child" ? child : thread;
      const { element, current, focusAtEnd } = setup({
        currentThread,
        ...(surface === "child" ? { messageReply: metadata } : {}),
      });
      if (surface === "parent")
        runtime.readShells.mockReturnValue([
          { id: child.threadId, environmentId: child.environmentId, messageReply: metadata },
        ]);
      await using _screen = await mountHook(element);
      await act(() =>
        current().onReply({
          id: MessageId.make("topic-answer"),
          ...(surface === "parent" ? { replyTopicId: reply.replyTopicId } : {}),
          role: "assistant",
          text: "The earlier topic answer",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          runId: null,
          streaming: false,
        }),
      );
      const draft = useComposerDraftStore.getState().getComposerDraft(currentThread);
      expect(draft?.prompt).toBe("My existing prompt");
      expect(draft?.replyTarget?.replyTopicId).toBe(reply.replyTopicId);
      expect(draft?.replyTarget?.replyTo.replyTopicId).toBe(reply.replyTopicId);
      expect(focusAtEnd).toHaveBeenCalled();
      await act(async () => current().sendReply());
      expect(runtime.startReply).not.toHaveBeenCalled();
      expect(runtime.startTurn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          environmentId: thread.environmentId,
          input: expect.objectContaining({
            threadId: child.threadId,
            replyTopicId: reply.replyTopicId,
            replyTo: expect.objectContaining({
              messageId: "topic-answer",
              text: "The earlier topic answer",
            }),
            message: expect.objectContaining({ text: "My existing prompt" }),
          }),
        }),
      );
    },
  );

  it("dispatches the immutable snapshot and clears only after success", async () => {
    const { element, current, resetCursorState, onSent } = setup();
    await using _screen = await mountHook(element);
    await act(async () => current().sendReply());
    expect(runtime.startReply).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: thread.environmentId,
        input: expect.objectContaining({
          threadId: thread.threadId,
          ...reply,
          text: "My existing prompt",
        }),
      }),
    );
    expect(useComposerDraftStore.getState().getComposerDraft(thread)).toBeNull();
    expect(resetCursorState).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("preserves the prompt and source on dispatch failure", async () => {
    const { element, current, resetCursorState } = setup();
    await using screen = await mountHook(element);
    runtime.startReply.mockRejectedValueOnce(new Error("Server disconnected"));
    await act(async () => current().sendReply());
    const draft = useComposerDraftStore.getState().getComposerDraft(thread);
    expect(draft?.prompt).toBe("My existing prompt");
    expect(draft?.replyTarget).toEqual(reply);
    expect(screen.text()).toBe("Server disconnected");
    expect(resetCursorState).not.toHaveBeenCalled();
  });

  it("preserves a newer prompt written while dispatch is pending", async () => {
    const { element, current, resetCursorState } = setup();
    await using _screen = await mountHook(element);
    runtime.startReply.mockImplementationOnce(async () => {
      useComposerDraftStore.getState().setPrompt(thread, "A newer prompt");
      return { _tag: "Success", value: undefined };
    });
    await act(async () => current().sendReply());
    expect(useComposerDraftStore.getState().getComposerDraft(thread)?.prompt).toBe(
      "A newer prompt",
    );
    expect(resetCursorState).not.toHaveBeenCalled();
  });

  it("keeps the chosen model through an upload and clears the successful file draft", async () => {
    const { element, current, selectModel } = setup();
    await using _screen = await mountHook(element);
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
      selectModel("later-model-choice");
      store.setFileUpload(thread, "local-file", thread.environmentId, "uploaded-local-file");
    });
    await act(async () => current().sendReply());
    expect(runtime.startReply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        input: expect.objectContaining({
          modelSelection: { instanceId: "codex", model: "test-model" },
          attachments: [expect.objectContaining({ id: "uploaded-local-file", name: "notes.txt" })],
        }),
      }),
    );
    expect(runtime.startTurn).not.toHaveBeenCalled();
    expect(store.getComposerDraft(thread)).toBeNull();
    expect(runtime.release).toHaveBeenCalledTimes(1);
  });

  it.each(["unsupported", "disabled", "deep-plan"] as const)(
    "preserves a stale reply draft when replies are %s",
    async (reason) => {
      const { element, current } = setup({
        enabled: reason !== "disabled",
        composerMode: reason === "deep-plan" ? "deep-plan" : "default",
      });
      await using screen = await mountHook(element);
      runtime.capabilities.messageReplies = reason !== "unsupported";
      await act(async () => current().sendReply());
      expect(runtime.startReply).not.toHaveBeenCalled();
      expect(runtime.startTurn).not.toHaveBeenCalled();
      expect(useComposerDraftStore.getState().getComposerDraft(thread)?.replyTarget).toEqual(reply);
      expect(screen.alerts()).toHaveLength(1);
    },
  );
});
