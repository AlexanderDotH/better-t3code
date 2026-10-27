import { describe, expect, it } from "vite-plus/test";

import { createChatReasoningScope, resolveChatPresentation } from "./chatPresentation.ts";

describe("chat presentation", () => {
  it("keeps reasoning with its user request while isolating side replies and later requests", () => {
    const scope = createChatReasoningScope();
    const leading = scope({ id: "orphan-1", role: "reasoning" });
    expect(scope({ id: "orphan-2", role: "reasoning" })).toBe(leading);
    const request = scope({ id: "request", role: "user" });
    expect(request).not.toBe(leading);
    expect(scope({ id: "reasoning", role: "reasoning" })).toBe(request);
    expect(scope()).toBe(request);
    expect(scope({ id: "progress", role: "assistant" })).toBe(request);
    const reply = scope({ id: "reply-request", role: "user", replyTopicId: "reply" });
    expect(reply).not.toBe(request);
    expect(scope({ id: "reply-thought", role: "reasoning", replyTopicId: "reply" })).toBe(reply);
    expect(scope({ id: "continued-thought", role: "reasoning" })).toBe(request);
    expect(scope({ id: "next-request", role: "user" })).not.toBe(request);
    expect(scope({ id: "reply-continuation", role: "reasoning", replyTopicId: "reply" })).toBe(
      reply,
    );
  });

  it.each(["current", "classic", "better-t3"] as const)(
    "preserves %s transcript grouping",
    (mode) => {
      const presentation = resolveChatPresentation({
        mode,
        presentationMotion: true,
        characterStreamingMotion: true,
        reducedMotion: false,
      });
      expect(presentation.grouping).toBe(mode);
      expect(presentation.variant).toBe(mode);
      expect(presentation.presentationMotion).toBe(mode === "better-t3");
      expect(presentation.characterStreamingMotion).toBe(true);
    },
  );

  it("honors reduced motion independently of saved preferences", () => {
    expect(
      resolveChatPresentation({
        mode: "better-t3",
        presentationMotion: true,
        characterStreamingMotion: true,
        reducedMotion: true,
      }),
    ).toMatchObject({ presentationMotion: false, characterStreamingMotion: false });
  });

  it("keeps presentation and character motion independently selectable", () => {
    expect(
      resolveChatPresentation({
        mode: "better-t3",
        presentationMotion: false,
        characterStreamingMotion: true,
        reducedMotion: false,
      }),
    ).toMatchObject({ presentationMotion: false, characterStreamingMotion: true });
    expect(
      resolveChatPresentation({
        mode: "better-t3",
        presentationMotion: true,
        characterStreamingMotion: false,
        reducedMotion: false,
      }),
    ).toMatchObject({ presentationMotion: true, characterStreamingMotion: false });
  });
});
