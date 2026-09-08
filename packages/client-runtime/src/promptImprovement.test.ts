import { describe, expect, it, vi } from "vitest";
import { shouldOfferProjectSpeechPreindex, resolvePromptForSend } from "./promptImprovement";

describe("shouldOfferProjectSpeechPreindex", () => {
  const emptyDraft = {
    voiceInputConfigured: true,
    routeKind: "draft" as const,
    hasProjectSpeechProfile: false,
    hasStartedThread: false,
    prompt: "",
  };

  it("offers setup for a configured empty local draft without a profile", () => {
    expect(shouldOfferProjectSpeechPreindex(emptyDraft)).toBe(true);
  });

  it("does not offer setup when voice is unavailable or the draft is no longer empty", () => {
    expect(shouldOfferProjectSpeechPreindex({ ...emptyDraft, voiceInputConfigured: false })).toBe(
      false,
    );
    expect(shouldOfferProjectSpeechPreindex({ ...emptyDraft, routeKind: "server" })).toBe(false);
    expect(shouldOfferProjectSpeechPreindex({ ...emptyDraft, hasProjectSpeechProfile: true })).toBe(
      false,
    );
    expect(shouldOfferProjectSpeechPreindex({ ...emptyDraft, hasStartedThread: true })).toBe(false);
    expect(shouldOfferProjectSpeechPreindex({ ...emptyDraft, prompt: "Already typing" })).toBe(
      false,
    );
  });
});

describe("resolvePromptForSend", () => {
  it("improves non-empty prompt text when a transform is configured", async () => {
    const improve = vi.fn(async (prompt: string) => `Improved: ${prompt}`);

    await expect(resolvePromptForSend({ prompt: "  fix the bug  ", improve })).resolves.toBe(
      "Improved: fix the bug",
    );
    expect(improve).toHaveBeenCalledWith("fix the bug");
  });

  it("preserves the original prompt when improvement is disabled or text is empty", async () => {
    const improve = vi.fn(async (prompt: string) => prompt);

    await expect(resolvePromptForSend({ prompt: "  keep spacing  " })).resolves.toBe(
      "  keep spacing  ",
    );
    await expect(resolvePromptForSend({ prompt: "   ", improve })).resolves.toBe("   ");
    expect(improve).not.toHaveBeenCalled();
  });

  it("propagates improvement failures without returning replacement text", async () => {
    const error = new Error("model unavailable");

    await expect(
      resolvePromptForSend({ prompt: "fix the bug", improve: async () => Promise.reject(error) }),
    ).rejects.toBe(error);
  });
});
