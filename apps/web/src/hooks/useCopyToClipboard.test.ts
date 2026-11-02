import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { COMPOSER_CONTEXT_CLIPBOARD_MIME } from "@t3tools/shared/composerContextClipboard";

import { ClipboardApiUnavailableError, writeTextToClipboard } from "./useCopyToClipboard";

function fallbackClipboard(allowCopy: boolean) {
  const textarea = {
    value: "",
    style: {},
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
  const previousFocus = { focus: vi.fn() };
  const execCommand = vi.fn(() => allowCopy);
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { clipboard: undefined });
  vi.stubGlobal("document", {
    execCommand,
    activeElement: previousFocus,
    createElement: () => textarea,
    body: { appendChild: vi.fn() },
  });
  return { textarea, previousFocus, execCommand };
}

describe("writeTextToClipboard", () => {
  it("reserves plain text even when an extra flavor attempts to replace it", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly data: Record<string, Blob>) {}
      },
    );
    await expect(
      writeTextToClipboard("original", "message", {
        "text/plain": "replacement",
        "text/html": "<b>original</b>",
      }),
    ).resolves.toBe(true);
    const items = write.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>;
    expect(await items[0]!.data["text/plain"]!.text()).toBe("original");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies through execCommand when the async clipboard is unavailable and restores focus", async () => {
    const clipboard = fallbackClipboard(true);
    const text = "| Name |\n| --- |\n| Ada |";
    await expect(writeTextToClipboard(text, "table")).resolves.toBe(true);
    expect(clipboard.execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    expect(clipboard.textarea.value).toBe(text);
    expect(clipboard.textarea.setSelectionRange).toHaveBeenCalledExactlyOnceWith(0, text.length);
    expect(clipboard.textarea.remove).toHaveBeenCalledOnce();
    expect(clipboard.previousFocus.focus).toHaveBeenCalledOnce();
  });

  it("reports a rejected fallback instead of claiming the text was copied", async () => {
    const clipboard = fallbackClipboard(false);
    await expect(writeTextToClipboard("message")).rejects.toBeInstanceOf(
      ClipboardApiUnavailableError,
    );
    expect(clipboard.textarea.remove).toHaveBeenCalledOnce();
    expect(clipboard.previousFocus.focus).toHaveBeenCalledOnce();
  });

  it("keeps a denied async write observable and allows the same text to be retried", async () => {
    const clipboard = fallbackClipboard(true);
    const denied = new DOMException("Clipboard access denied", "NotAllowedError");
    const writeText = vi.fn().mockRejectedValueOnce(denied).mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(writeTextToClipboard("same text")).rejects.toMatchObject({
      _tag: "ClipboardWriteError",
      target: "text",
      cause: denied,
    });
    await expect(writeTextToClipboard("same text")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith("same text");
    expect(clipboard.execCommand).not.toHaveBeenCalled();
  });

  it("keeps caller-built rich HTML when attaching a context fragment", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText: vi.fn() } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly data: Record<string, Blob>) {}
      },
    );
    const fragment = JSON.stringify({ version: 1, source: {}, records: [] });
    const rich = "<p><strong>Message</strong></p>";

    await expect(
      writeTextToClipboard("Message", "message", {
        [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment,
        "text/html": rich,
      }),
    ).resolves.toBe(true);

    const items = write.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>;
    const html = await items[0]!.data["text/html"]!.text();
    expect(html).toContain(rich);
    expect(html).toContain("data-t3-context-fragment=");
  });
});
