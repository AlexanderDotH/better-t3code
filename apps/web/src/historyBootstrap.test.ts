import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";

import { buildBootstrapInput } from "./historyBootstrap";

describe("history bootstrap attachments", () => {
  it("describes imported audio when a fresh provider needs transcript handoff", () => {
    const result = buildBootstrapInput(
      [
        {
          id: MessageId.make("message-with-audio"),
          role: "user",
          text: "Earlier request",
          attachments: [
            {
              type: "audio",
              id: "audio-attachment",
              name: "voice-note.ogg",
              mimeType: "audio/ogg",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: "2026-08-23T00:00:00.000Z",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
      ],
      "Continue",
      10_000,
    );

    expect(result.text).toContain("[Attached audio: voice-note.ogg]");
  });
});
