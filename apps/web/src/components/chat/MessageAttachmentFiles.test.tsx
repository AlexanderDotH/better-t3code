// @vitest-environment jsdom
import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MessageAttachmentFiles } from "./MessageAttachmentFiles";
import { readAttachmentThumbnail } from "./attachmentThumbnail";
import type { ChatFileAttachment } from "../../types";

vi.mock("../../assets/assetUrls", () => ({
  useAssetUrlState: (environmentId: string | null, resource: { attachmentId: string } | null) =>
    environmentId && resource
      ? { _tag: "Success", url: `https://environment.test/assets/${resource.attachmentId}` }
      : { _tag: "Loading" },
}));
vi.mock("./attachmentThumbnail", () => ({ readAttachmentThumbnail: vi.fn() }));

const observers = new Map<Element, (visible: boolean) => void>();
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const textFile: ChatFileAttachment = {
  type: "file",
  id: "text",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 80,
};
const pdf: ChatFileAttachment = {
  ...textFile,
  id: "pdf",
  name: "report.pdf",
  mimeType: "application/pdf",
};
const archive: ChatFileAttachment = {
  ...textFile,
  id: "zip",
  name: "backup.zip",
  mimeType: "application/zip",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      nodes: Element[] = [];
      constructor(readonly callback: IntersectionObserverCallback) {}
      observe(node: Element) {
        this.nodes.push(node);
        observers.set(node, (visible) =>
          this.callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      disconnect() {
        for (const node of this.nodes) observers.delete(node);
      }
    },
  );
  vi.mocked(readAttachmentThumbnail).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  observers.clear();
  vi.unstubAllGlobals();
});

function fixture(files: ChatFileAttachment[], actions = { onOpen: vi.fn(), onDownload: vi.fn() }) {
  return (
    <MessageAttachmentFiles
      files={files}
      unknownAttachments={[]}
      environmentId={EnvironmentId.make("remote-environment")}
      theme="dark"
      {...actions}
    />
  );
}

async function reveal(id: string) {
  const node = container.querySelector(`[data-attachment-preview="${id}"]`)!;
  await act(() => observers.get(node)!(true));
}

describe("message attachment previews", () => {
  it("loads visible previews only and keeps other files below them", async () => {
    const actions = { onOpen: vi.fn(), onDownload: vi.fn() };
    vi.mocked(readAttachmentThumbnail).mockResolvedValue("Actual file content");
    await act(() => root.render(fixture([archive, textFile, pdf], actions)));
    expect(readAttachmentThumbnail).not.toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
    const preview = container.querySelector('[data-attachment-preview="text"]')!;
    const otherFile = container.querySelector(".better-chat-attachment-list")!;
    expect(
      preview.compareDocumentPosition(otherFile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await reveal("text");
    expect(container.querySelector("pre")?.textContent).toBe("Actual file content");
    expect(readAttachmentThumbnail).toHaveBeenCalledTimes(1);
    await reveal("pdf");
    expect(container.querySelector("iframe")?.src).toContain("/pdf#page=1");
    await act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Preview notes.txt"]')!.click(),
    );
    expect(actions.onOpen).toHaveBeenCalledWith(textFile);
    await act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Download notes.txt"]')!.click(),
    );
    expect(actions.onDownload).toHaveBeenCalledWith(textFile);
    expect(actions.onOpen).toHaveBeenCalledTimes(1);
  });

  it("falls back to a usable file row when a preview cannot be read", async () => {
    vi.mocked(readAttachmentThumbnail).mockRejectedValue(new Error("Invalid UTF-8"));
    await act(() => root.render(fixture([textFile, pdf])));
    await reveal("text");
    expect(container.querySelector('[data-attachment-preview="text"]')).toBeNull();
    expect(container.querySelector(".better-chat-attachment-list")?.textContent).toContain(
      "notes.txt",
    );
    expect(container.querySelector('[aria-label="Download notes.txt"]')).not.toBeNull();
    expect(container.querySelector('[data-attachment-preview="pdf"]')).not.toBeNull();
  });

  it("aborts a pending read on unmount and keeps optimistic files inert", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(readAttachmentThumbnail).mockImplementation((_url, _kind, nextSignal) => {
      signal = nextSignal;
      return new Promise(() => {});
    });
    const pending = { ...pdf, id: "pending", name: "upload.pdf", downloadable: false };
    await act(() => root.render(fixture([textFile, pending])));
    expect(container.querySelector('[data-attachment-preview="pending"]')).toBeNull();
    expect(container.querySelector('[aria-label="Download upload.pdf"]')).toBeNull();
    await reveal("text");
    expect(signal?.aborted).toBe(false);
    await act(() => root.render(null));
    expect(signal?.aborted).toBe(true);
    expect(observers.size).toBe(0);
  });
});
