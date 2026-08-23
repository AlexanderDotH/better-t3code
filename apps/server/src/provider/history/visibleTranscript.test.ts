import { describe, expect, it } from "vite-plus/test";

import {
  makeFallbackNativeItemId,
  normalizeVisibleProviderHistoryTranscript,
  type ProviderHistoryTranscriptCandidate,
} from "./visibleTranscript.ts";

describe("normalizeVisibleProviderHistoryTranscript", () => {
  it("keeps visible user, assistant, and plan items while excluding harness internals", () => {
    const candidates: ReadonlyArray<ProviderHistoryTranscriptCandidate> = [
      {
        kind: "message",
        nativeMessageId: "user-1",
        role: "user",
        text: "Please fix the parser.",
        attachments: [],
      },
      {
        kind: "message",
        nativeMessageId: "reasoning-1",
        role: "reasoning",
        text: "Hidden chain of thought",
        attachments: [],
      },
      {
        kind: "message",
        nativeMessageId: "system-1",
        role: "system",
        text: "System prompt",
        attachments: [],
      },
      {
        kind: "message",
        nativeMessageId: "tool-1",
        role: "tool",
        text: "Tool output",
        attachments: [],
      },
      {
        kind: "message",
        nativeMessageId: "assistant-1",
        role: "assistant",
        text: "Implemented the fix.",
        attachments: [
          {
            type: "image",
            nativeAttachmentId: "image-1",
            name: "result.png",
            mimeType: "image/png",
            content: { type: "data-url", dataUrl: "data:image/png;base64,AA==" },
          },
        ],
      },
      {
        kind: "plan",
        nativePlanId: "plan-1",
        markdown: "# Plan\n\n- Parse the input",
      },
    ];

    expect(normalizeVisibleProviderHistoryTranscript(candidates)).toEqual([
      candidates[0],
      candidates[4],
      candidates[5],
    ]);
  });

  it("keeps an attachment-only message and drops empty text-only items", () => {
    const attachmentOnly: ProviderHistoryTranscriptCandidate = {
      kind: "message",
      nativeMessageId: "attachment-only",
      role: "user",
      text: "  ",
      attachments: [
        {
          type: "audio",
          nativeAttachmentId: "voice-1",
          name: "request.ogg",
          mimeType: "audio/ogg",
          content: { type: "file", path: "/tmp/request.ogg" },
        },
      ],
    };

    expect(
      normalizeVisibleProviderHistoryTranscript([
        attachmentOnly,
        {
          kind: "message",
          nativeMessageId: "empty-assistant",
          role: "assistant",
          text: "\n",
          attachments: [],
        },
        { kind: "plan", nativePlanId: "empty-plan", markdown: "  " },
      ]),
    ).toEqual([attachmentOnly]);
  });

  it("keeps the first native item when a provider repeats it", () => {
    const first: ProviderHistoryTranscriptCandidate = {
      kind: "message",
      nativeMessageId: "assistant-1",
      role: "assistant",
      text: "First completed copy",
      attachments: [],
    };

    expect(
      normalizeVisibleProviderHistoryTranscript([
        first,
        { ...first, text: "Duplicate replay" },
        { kind: "plan", nativePlanId: "assistant-1", markdown: "# Separate plan" },
      ]),
    ).toEqual([first, { kind: "plan", nativePlanId: "assistant-1", markdown: "# Separate plan" }]);
  });
});

describe("makeFallbackNativeItemId", () => {
  it("uses the session, item kind, and stable ordinal", () => {
    expect(makeFallbackNativeItemId("session-42", "message", 3)).toBe("session-42:message:3");
  });
});
