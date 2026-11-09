import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  type OrchestrationV2MessageReply,
  type ServerConfig,
} from "@t3tools/contracts";
import type { ComposerDraft } from "./use-composer-drafts";

const fixture = vi.hoisted(() => ({
  draft: { text: "", attachments: [] } as ComposerDraft,
  dispatch: vi.fn<(...args: unknown[]) => Promise<{ _tag: "Success" | "Failure" }>>(),
  startTurn: vi.fn<(...args: unknown[]) => Promise<{ _tag: "Success" | "Failure" }>>(),
  shells: [] as ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly messageReply?: OrchestrationV2MessageReply;
  }>,
  alert: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("react-native", () => ({ Alert: { alert: fixture.alert } }));
vi.mock("../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../lib/attachmentUpload", () => ({ prepareTurnAttachments: fixture.prepare }));
vi.mock("../lib/uuid", () => ({ uuidv4: () => "new-topic" }));
vi.mock("../lib/commandMetadata", () => ({
  makeQueuedMessageMetadata: () => ({
    messageId: "sent",
    commandId: "command",
    createdAt: "2026-10-13T10:00:00.000Z",
  }),
}));
vi.mock("../lib/composerContext", () => ({
  serializeComposerMessageForServer: (text: string) => ({ text }),
  uploadedComposerContext: () => undefined,
}));
vi.mock("@t3tools/client-runtime/state/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@t3tools/client-runtime/state/runtime")>();
  return {
    ...actual,
    squashAtomCommandFailure: (result: Parameters<typeof actual.squashAtomCommandFailure>[0]) =>
      result.cause === undefined
        ? new Error("Connection lost")
        : actual.squashAtomCommandFailure(result),
  };
});
vi.mock("./threads", () => ({
  threadEnvironment: { startReply: "startReply", startTurn: "startTurn" },
  environmentThreadShells: { threadShellsAtom: "threadShells" },
}));
vi.mock("./atom-registry", () => ({ appAtomRegistry: { get: () => fixture.shells } }));
vi.mock("./use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "startTurn" ? fixture.startTurn : fixture.dispatch,
}));
vi.mock("./use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => fixture.draft,
  setComposerDraftMessageReply: (_key: string, messageReply: ComposerDraft["messageReply"]) => {
    fixture.draft = { ...fixture.draft, messageReply };
  },
  setComposerDraftAttachmentUpload: vi.fn(),
  clearComposerDraftContent: () => {
    fixture.draft = { text: "", attachments: [] };
  },
}));

import { useThreadMessageReplies } from "./use-thread-message-replies";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const config = {
  environment: { capabilities: { messageReplies: true, inlineMessageContext: true } },
} as unknown as ServerConfig;

async function replies(
  thread: { readonly id?: ThreadId; readonly messageReply?: OrchestrationV2MessageReply } = {},
) {
  let result: ReturnType<typeof useThreadMessageReplies> | undefined;
  function Probe() {
    const actions = useThreadMessageReplies({
      thread: {
        environmentId,
        id: threadId,
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        ...thread,
      },
      connected: true,
      serverConfig: config,
    });
    useLayoutEffect(() => {
      result = actions;
    }, [actions]);
    return null;
  }
  const renderer = createRoot(document.createElement("div"));
  await act(() => {
    renderer.render(<Probe />);
  });
  onTestFinished(async () => {
    await act(() => renderer.unmount());
  });
  return result!;
}

beforeEach(() => {
  fixture.draft = {
    text: "Explain this",
    attachments: [],
    messageReply: {
      replyTo: { messageId: MessageId.make("source"), role: "assistant", text: "Earlier answer" },
      replyTopicId: SubagentId.make("topic"),
    },
  };
  fixture.dispatch.mockReset();
  fixture.dispatch.mockResolvedValue({ _tag: "Success" });
  fixture.startTurn.mockReset();
  fixture.startTurn.mockResolvedValue({ _tag: "Success" });
  fixture.shells = [];
  fixture.prepare.mockReset();
  fixture.prepare.mockResolvedValue({
    status: "ready",
    attachments: [],
    draftAttachments: [],
    pendingAttachmentIds: [],
  });
  fixture.alert.mockReset();
});

describe("mobile reply submission", () => {
  it("reuses the source topic and keeps typed text while selecting or cancelling", async () => {
    const actions = await replies();
    actions.selectReply({
      id: MessageId.make("reply-source"),
      role: "assistant",
      text: "Topic answer",
      replyTopicId: SubagentId.make("existing-topic"),
    });
    expect(fixture.draft.messageReply?.replyTopicId).toBe("existing-topic");
    expect(fixture.draft.messageReply?.replyTo.replyTopicId).toBe("existing-topic");
    expect(fixture.draft.text).toBe("Explain this");
    actions.cancelReply();
    expect(fixture.draft.messageReply).toBeUndefined();
    expect(fixture.draft.text).toBe("Explain this");
  });
  it("keeps the draft and source after a rejected send", async () => {
    fixture.dispatch.mockResolvedValueOnce({ _tag: "Failure" });
    const before = fixture.draft;
    const actions = await replies();
    expect(await actions.sendReply(before)).toBeNull();
    expect(fixture.draft).toEqual(before);
    expect(fixture.alert).toHaveBeenCalled();
    expect(await actions.sendReply(before)).toBe(MessageId.make("sent"));
    expect(fixture.dispatch).toHaveBeenCalledTimes(2);
  });
  it("releases an abandoned upload and sends the replacement reply without losing its draft", async () => {
    const before = fixture.draft;
    fixture.prepare.mockImplementationOnce(async () => {
      fixture.draft = {
        ...before,
        text: "Replacement",
        messageReply: {
          ...before.messageReply!,
          replyTopicId: SubagentId.make("replacement-topic"),
        },
      };
      return { status: "ready", attachments: [], draftAttachments: [], pendingAttachmentIds: [] };
    });
    const actions = await replies();
    expect(await actions.sendReply(before)).toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fixture.draft.text).toBe("Replacement");
    expect(fixture.draft.messageReply?.replyTopicId).toBe("replacement-topic");
    expect(await actions.sendReply(fixture.draft)).toBe(MessageId.make("sent"));
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });
  it("preserves upload error details and releases the reply for retry", async () => {
    fixture.prepare.mockRejectedValueOnce(new Error("Upload failed"));
    const actions = await replies();
    const before = fixture.draft;
    expect(await actions.sendReply(before)).toBeNull();
    expect(fixture.alert).toHaveBeenCalledWith("chat.reply.sendFailed", "Upload failed");
    expect(fixture.draft).toEqual(before);
    expect(await actions.sendReply(before)).toBe(MessageId.make("sent"));
  });
  it("dispatches to the selected topic and clears only after acceptance", async () => {
    const before = fixture.draft;
    expect(await (await replies()).sendReply(before)).toBe(MessageId.make("sent"));
    expect(fixture.dispatch).toHaveBeenCalledWith({
      environmentId,
      input: {
        threadId,
        replyTopicId: before.messageReply!.replyTopicId,
        replyTo: before.messageReply!.replyTo,
        commandId: "command",
        targetThreadId: "reply:topic",
        messageId: "sent",
        text: "Explain this",
        attachments: [],
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        creationSource: "mobile",
      },
    });
    expect(fixture.draft).toEqual({ text: "", attachments: [] });
  });
  it("continues a topic inside its reply thread instead of starting a nested one", async () => {
    const topic = SubagentId.make("topic");
    const replyThreadId = ThreadId.make("reply:topic");
    const actions = await replies({
      id: replyThreadId,
      messageReply: {
        replyTopicId: topic,
        sourceThreadId: threadId,
        messageId: MessageId.make("source"),
      },
    });
    actions.selectReply({
      id: MessageId.make("topic-answer"),
      role: "assistant",
      text: "Topic answer",
    });
    const replyTo = {
      messageId: MessageId.make("topic-answer"),
      role: "assistant",
      text: "Topic answer",
      authorLabel: "chat.reply.assistant",
      replyTopicId: topic,
    };
    expect(fixture.draft.messageReply).toEqual({ replyTo, replyTopicId: topic });
    expect(await actions.sendReply(fixture.draft)).toBe(MessageId.make("sent"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fixture.startTurn).toHaveBeenCalledWith({
      environmentId,
      input: {
        threadId: replyThreadId,
        commandId: "command",
        message: { messageId: "sent", role: "user", text: "Explain this", attachments: [] },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        replyTo,
        replyTopicId: topic,
      },
    });
  });
  it("continues a topic another client started and refuses one whose thread is missing", async () => {
    const topic = SubagentId.make("web-topic");
    fixture.draft = {
      ...fixture.draft,
      messageReply: {
        replyTo: {
          messageId: MessageId.make("topic-answer"),
          role: "assistant",
          text: "Topic answer",
          replyTopicId: topic,
        },
        replyTopicId: topic,
      },
    };
    const actions = await replies();
    expect(await actions.sendReply(fixture.draft)).toBeNull();
    expect(fixture.alert).toHaveBeenCalledWith("chat.reply.sendFailed", "chat.reply.unavailable");
    fixture.shells = [
      {
        environmentId,
        id: ThreadId.make("web-child"),
        messageReply: {
          replyTopicId: topic,
          sourceThreadId: threadId,
          messageId: MessageId.make("source"),
        },
      },
    ];
    expect(await actions.sendReply(fixture.draft)).toBe(MessageId.make("sent"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fixture.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ threadId: "web-child", replyTopicId: topic }),
      }),
    );
  });
  it("preserves replacement sources and prevents duplicate sends while acceptance is pending", async () => {
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    fixture.dispatch.mockImplementationOnce(async () => {
      started();
      await pending;
      return { _tag: "Success" };
    });
    const actions = await replies();
    const sending = actions.sendReply(fixture.draft);
    await dispatched;
    expect(await actions.sendReply(fixture.draft)).toBeNull();
    fixture.draft = {
      ...fixture.draft,
      text: "New draft",
      messageReply: {
        ...fixture.draft.messageReply!,
        replyTopicId: SubagentId.make("replacement-topic"),
      },
    };
    release();
    await sending;
    expect(fixture.draft.text).toBe("New draft");
    expect(fixture.draft.messageReply?.replyTopicId).toBe("replacement-topic");
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  });
});
