import { describe, expect, it, vi } from "vite-plus/test";

import { copyThreadTranscript } from "./copyThreadTranscript";

describe("copyThreadTranscript", () => {
  it("exports the requested thread before writing the complete Markdown to the clipboard", async () => {
    const exportThreadTranscript = vi.fn(async () => ({
      formatVersion: 1 as const,
      fileName: "thread.md",
      mediaType: "text/markdown" as const,
      generatedAt: "2026-07-12T10:00:00.000Z",
      content: "# Complete transcript",
    }));
    const writeText = vi.fn(async () => undefined);

    const result = await copyThreadTranscript({
      threadId: "thread-1" as never,
      exportThreadTranscript,
      writeText,
    });

    expect(exportThreadTranscript).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(writeText).toHaveBeenCalledWith("# Complete transcript");
    expect(result.fileName).toBe("thread.md");
  });

  it("does not touch the clipboard when exporting fails", async () => {
    const exportThreadTranscript = vi.fn(async () => {
      throw new Error("Thread no longer exists");
    });
    const writeText = vi.fn(async () => undefined);

    await expect(
      copyThreadTranscript({
        threadId: "missing-thread" as never,
        exportThreadTranscript,
        writeText,
      }),
    ).rejects.toThrow("Thread no longer exists");

    expect(writeText).not.toHaveBeenCalled();
  });

  it("surfaces clipboard failures after a successful export", async () => {
    const exportThreadTranscript = vi.fn(async () => ({
      formatVersion: 1 as const,
      fileName: "thread.md",
      mediaType: "text/markdown" as const,
      generatedAt: "2026-07-12T10:00:00.000Z",
      content: "# Complete transcript",
    }));
    const writeText = vi.fn(async () => {
      throw new Error("Clipboard permission denied");
    });

    await expect(
      copyThreadTranscript({
        threadId: "thread-1" as never,
        exportThreadTranscript,
        writeText,
      }),
    ).rejects.toThrow("Clipboard permission denied");

    expect(exportThreadTranscript).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledOnce();
  });
});
