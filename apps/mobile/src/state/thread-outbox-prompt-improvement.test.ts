import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { QueuedThreadMessage } from "./thread-outbox-model";
import { prepareQueuedPromptForDelivery } from "./thread-outbox-prompt-improvement";

const projectId = ProjectId.make("project-1");

function queuedMessage(overrides: Partial<QueuedThreadMessage> = {}): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make("message-1"),
    commandId: CommandId.make("command-1"),
    text: "rough prompt",
    attachments: [],
    createdAt: "2026-08-14T12:00:00.000Z",
    ...overrides,
  };
}

describe("prepareQueuedPromptForDelivery", () => {
  it("persists improved text once and clears the deferred marker", async () => {
    const message = queuedMessage({ improvePromptBeforeSend: true });
    const improve = vi.fn(async () => "  Improved prompt  ");
    const persist = vi.fn(async () => true);

    const result = await prepareQueuedPromptForDelivery({
      message,
      projectId,
      improve,
      persist,
    });

    expect(improve).toHaveBeenCalledWith("rough prompt", projectId);
    expect(persist).toHaveBeenCalledWith({
      ...message,
      text: "Improved prompt",
      improvePromptBeforeSend: undefined,
    });
    expect(result).toEqual({
      _tag: "ready",
      message: expect.objectContaining({ text: "Improved prompt" }),
    });
    expect(result._tag === "ready" && result.message.improvePromptBeforeSend).toBeUndefined();
  });

  it("retries without mutating the queued payload when improvement fails", async () => {
    const message = queuedMessage({ improvePromptBeforeSend: true });
    const persist = vi.fn(async () => true);

    await expect(
      prepareQueuedPromptForDelivery({
        message,
        projectId,
        improve: async () => Promise.reject(new Error("model unavailable")),
        persist,
      }),
    ).resolves.toEqual({ _tag: "retry" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("treats a concurrently removed message as completed work", async () => {
    const result = await prepareQueuedPromptForDelivery({
      message: queuedMessage({ improvePromptBeforeSend: true }),
      projectId,
      improve: async () => "Improved",
      persist: async () => false,
    });

    expect(result).toEqual({ _tag: "removed" });
  });
});
