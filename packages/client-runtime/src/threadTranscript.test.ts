import { ThreadId, type OrchestrationThreadTranscriptExport } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { copyThreadTranscript } from "./threadTranscript.ts";

const threadId = ThreadId.make("thread-transcript-copy");
const transcript: OrchestrationThreadTranscriptExport = {
  formatVersion: 1,
  fileName: "complete-thread.md",
  mediaType: "text/markdown",
  generatedAt: "2026-07-12T10:00:00.000Z",
  content:
    "# Complete transcript\n\n## User\nÜbersicht **bitte**\n\n## Assistant\n```ts\nconst count = 2;\n```\n",
};

describe("copyThreadTranscript", () => {
  it("copies the complete server Markdown as plain text without escaping or truncation", async () => {
    const exportThreadTranscript = vi.fn(async () => transcript);
    const writeText = vi.fn(async () => undefined);

    const result = await copyThreadTranscript({ threadId, exportThreadTranscript, writeText });

    expect(exportThreadTranscript).toHaveBeenCalledExactlyOnceWith({ threadId });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(transcript.content);
    expect(result).toBe(transcript);
  });

  it("waits for the requested server export before writing to the clipboard", async () => {
    const pending = Promise.withResolvers<OrchestrationThreadTranscriptExport>();
    const writeText = vi.fn(async () => undefined);
    const copy = copyThreadTranscript({
      threadId,
      exportThreadTranscript: () => pending.promise,
      writeText,
    });

    expect(writeText).not.toHaveBeenCalled();
    pending.resolve(transcript);
    await expect(copy).resolves.toBe(transcript);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(transcript.content);
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
