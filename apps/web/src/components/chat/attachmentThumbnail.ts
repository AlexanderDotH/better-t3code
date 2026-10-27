import type JSZip from "jszip";
import {
  readFilePreviewBytes,
  readFilePreviewResponse,
} from "@t3tools/client-runtime/file-preview";
import { FILE_THUMBNAIL_TEXT_MAX_BYTES } from "@t3tools/shared/filePreview";

const WORD_ARCHIVE_MAX_BYTES = 8 * 1024 * 1024;
const WORD_DOCUMENT_MAX_CHARS = 1024 * 1024;
const THUMBNAIL_MAX_CHARS = 1600;

export async function readAttachmentThumbnail(
  url: string,
  kind: "text" | "document",
  signal: AbortSignal,
) {
  const limit = kind === "document" ? WORD_ARCHIVE_MAX_BYTES : FILE_THUMBNAIL_TEXT_MAX_BYTES;
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${limit}` } });
  if (kind === "text") {
    const content = await readFilePreviewResponse(response, signal, limit);
    return content.text.trim().slice(0, THUMBNAIL_MAX_CHARS);
  }
  const bytes = await readFilePreviewBytes(response, signal, limit);
  if (bytes.length > limit) throw new Error("The document is too large for a thumbnail.");
  return readWordThumbnail(bytes, signal);
}

export async function readWordThumbnail(bytes: Uint8Array, signal: AbortSignal) {
  const { default: JSZip } = await import("jszip");
  signal.throwIfAborted();
  const zip = await JSZip.loadAsync(bytes);
  signal.throwIfAborted();
  const file = zip.file("word/document.xml") as
    | (JSZip.JSZipObject & {
        internalStream(type: "string"): JSZip.JSZipStreamHelper<string>;
      })
    | null;
  if (!file) throw new Error("The Word document is missing its content.");
  const xml = await new Promise<string>((resolve, reject) => {
    const stream = file.internalStream("string");
    let content = "";
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(content);
    };
    const abort = () => finish(new Error("Preview cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    stream
      .on("data", (chunk) => {
        if (settled) return;
        if (content.length + chunk.length > WORD_DOCUMENT_MAX_CHARS) {
          finish(new Error("The document is too large for a thumbnail."));
          return;
        }
        content += chunk;
      })
      .on("error", finish)
      .on("end", () => finish())
      .resume();
  });
  signal.throwIfAborted();
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The document could not be read.");
  const namespace = document.documentElement.namespaceURI;
  const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, "p"));
  return paragraphs
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagNameNS(namespace, "t"))
        .map((text) => text.textContent ?? "")
        .join(""),
    )
    .filter((text) => text.trim())
    .join("\n")
    .slice(0, THUMBNAIL_MAX_CHARS);
}
