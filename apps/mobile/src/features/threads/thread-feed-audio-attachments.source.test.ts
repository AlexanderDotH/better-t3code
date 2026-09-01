import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const threadFeedSource = NodeFS.readFileSync(new URL("./ThreadFeed.tsx", import.meta.url), "utf8");

describe("mobile synchronized audio attachments", () => {
  it("renders audio separately from image previews and opens the signed asset", () => {
    expect(threadFeedSource).toContain('attachment.type === "audio"');
    expect(threadFeedSource).toContain("function MessageAttachmentAudio");
    expect(threadFeedSource).toContain('tryOpenExternalUrl(uri, "file-preview")');
    expect(threadFeedSource).toContain('name="waveform"');
  });
});
