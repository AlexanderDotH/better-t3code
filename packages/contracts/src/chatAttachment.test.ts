import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { CHAT_ATTACHMENT_MAX_AUDIO_BYTES, ChatAttachment } from "./orchestration.ts";

const decodeAttachment = Schema.decodeUnknownSync(ChatAttachment);

describe("ChatAttachment", () => {
  it("accepts persisted audio imported from a provider harness", () => {
    expect(
      decodeAttachment({
        type: "audio",
        id: "thread-1-00000000-0000-4000-8000-000000000001",
        name: "recording.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 128,
      }),
    ).toEqual({
      type: "audio",
      id: "thread-1-00000000-0000-4000-8000-000000000001",
      name: "recording.ogg",
      mimeType: "audio/ogg",
      sizeBytes: 128,
    });
  });

  it("rejects non-audio mime types and oversized persisted audio", () => {
    expect(() =>
      decodeAttachment({
        type: "audio",
        id: "audio-1",
        name: "not-audio.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 128,
      }),
    ).toThrow();
    expect(() =>
      decodeAttachment({
        type: "audio",
        id: "audio-2",
        name: "too-large.wav",
        mimeType: "audio/wav",
        sizeBytes: CHAT_ATTACHMENT_MAX_AUDIO_BYTES + 1,
      }),
    ).toThrow();
  });
});
