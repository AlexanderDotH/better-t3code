import { v2Now } from "./state/orchestrationV2TestFixtures.ts";
import { MessageId, TurnItemId } from "@t3tools/contracts";
import { ThreadId, type OrchestrationV2ThreadTranscript } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { copyThreadTranscript } from "./threadTranscript.ts";

const threadId = ThreadId.make("thread-transcript-copy");
const transcript: OrchestrationV2ThreadTranscript = {
  threadId,
  title: "Complete transcript",
  updatedAt: v2Now,
  items: [
    {
      position: 0,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: TurnItemId.make("message"),
      item: {
        id: TurnItemId.make("message"),
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "completed",
        title: null,
        startedAt: v2Now,
        completedAt: v2Now,
        updatedAt: v2Now,
        type: "assistant_message",
        messageId: MessageId.make("assistant"),
        text: "Übersicht **bitte**\n\n```ts\nconst count = 2;\n```",
        streaming: false,
      },
    },
  ],
};

describe("copyThreadTranscript", () => {
  it("copies the complete server Markdown as plain text without escaping or truncation", async () => {
    const exportThreadTranscript = vi.fn(async () => transcript);
    const writeText = vi.fn(async () => undefined);

    const result = await copyThreadTranscript({ threadId, exportThreadTranscript, writeText });

    expect(exportThreadTranscript).toHaveBeenCalledExactlyOnceWith({ threadId });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Übersicht **bitte**"),
    );
    expect(result.fileName).toBe("Complete transcript.md");
  });

  it("waits for the requested server export before writing to the clipboard", async () => {
    const pending = Promise.withResolvers<OrchestrationV2ThreadTranscript>();
    const writeText = vi.fn(async () => undefined);
    const copy = copyThreadTranscript({
      threadId,
      exportThreadTranscript: () => pending.promise,
      writeText,
    });

    expect(writeText).not.toHaveBeenCalled();
    pending.resolve(transcript);
    await expect(copy).resolves.toMatchObject({ fileName: "Complete transcript.md" });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Übersicht **bitte**"),
    );
  });

  it("leaves the clipboard untouched when exporting fails", async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(
      copyThreadTranscript({
        threadId,
        exportThreadTranscript: async () => {
          throw new Error("Thread no longer exists");
        },
        writeText,
      }),
    ).rejects.toThrow("Thread no longer exists");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("surfaces clipboard permission failures after a successful export", async () => {
    const exportThreadTranscript = vi.fn(async () => transcript);
    await expect(
      copyThreadTranscript({
        threadId,
        exportThreadTranscript,
        writeText: async () => {
          throw new Error("Clipboard permission denied");
        },
      }),
    ).rejects.toThrow("Clipboard permission denied");
    expect(exportThreadTranscript).toHaveBeenCalledOnce();
  });
});
