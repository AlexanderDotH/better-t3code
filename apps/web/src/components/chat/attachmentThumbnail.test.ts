// @vitest-environment jsdom
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readAttachmentThumbnail, readWordThumbnail } from "./attachmentThumbnail";

async function wordDocument(content: string) {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

afterEach(() => vi.unstubAllGlobals());

describe("attachment thumbnails", () => {
  it("extracts real Word paragraphs without exposing XML or following document links", async () => {
    const bytes = await wordDocument(
      "<w:p><w:r><w:t>Kick </w:t></w:r><w:r><w:t>off &amp; notes</w:t></w:r></w:p><w:p><w:r><w:t>Next steps</w:t></w:r></w:p>",
    );
    const text = await readWordThumbnail(bytes, new AbortController().signal);
    expect(text).toBe("Kick off & notes\nNext steps");
  });

  it("rejects oversized expanded Word content and malformed archives", async () => {
    const bytes = await wordDocument(`<w:p><w:r><w:t>${"a".repeat(1024 * 1024)}</w:t></w:r></w:p>`);
    await expect(readWordThumbnail(bytes, new AbortController().signal)).rejects.toThrow(
      "too large",
    );
    await expect(
      readWordThumbnail(new Uint8Array([1, 2]), new AbortController().signal),
    ).rejects.toThrow();
  });

  it("does not continue an abandoned document preview", async () => {
    const bytes = await wordDocument("<w:p><w:r><w:t>Abandoned</w:t></w:r></w:p>");
    const controller = new AbortController();
    controller.abort();
    await expect(readWordThumbnail(bytes, controller.signal)).rejects.toThrow();
  });

  it("requests only a small text prefix and bounds the displayed excerpt", async () => {
    const fetch = vi.fn(async () => new Response("Snippet\n" + "x".repeat(20_000)));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const text = await readAttachmentThumbnail(
      "https://environment.test/notes.txt",
      "text",
      signal,
    );
    expect(text).toHaveLength(1600);
    expect(text.startsWith("Snippet\n")).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://environment.test/notes.txt", {
      signal,
      headers: { Range: "bytes=0-16384" },
    });
  });

  it("rejects binary text so it can fall back to a file row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([65, 0, 66]))),
    );
    await expect(
      readAttachmentThumbnail(
        "https://environment.test/file.txt",
        "text",
        new AbortController().signal,
      ),
    ).rejects.toThrow("binary");
  });
});
