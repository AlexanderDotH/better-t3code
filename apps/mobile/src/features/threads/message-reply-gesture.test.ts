import { describe, expect, it } from "vite-plus/test";
import {
  acceptsMessageReplyGesture,
  classifyMessageReplyMovement,
  messageReplyTranslation,
} from "./message-reply-gesture";

describe.each([
  ["user", -1],
  ["assistant", 1],
] as const)("mobile reply gesture for %s messages", (role, direction) => {
  it("accepts a deliberate swipe only on completed release", () => {
    expect(
      classifyMessageReplyMovement({
        role,
        translationX: direction * 18,
        translationY: 3,
        elapsedMs: 90,
        touchCount: 1,
      }),
    ).toBe("activate");
    expect(acceptsMessageReplyGesture(direction * 15, 3, true, role)).toBe(false);
    expect(acceptsMessageReplyGesture(direction * 16, 3, true, role)).toBe(true);
    expect(acceptsMessageReplyGesture(direction * 90, 3, false, role)).toBe(false);
    expect(messageReplyTranslation(direction * 160, role)).toBe(direction * 72);
    expect(messageReplyTranslation(0, role)).toBe(0);
    expect(messageReplyTranslation(-direction * 160, role)).toBe(0);
    expect(acceptsMessageReplyGesture(-direction * 90, 3, true, role)).toBe(false);
    expect(
      classifyMessageReplyMovement({
        role,
        translationX: -direction * 18,
        translationY: 0,
        elapsedMs: 90,
        touchCount: 1,
      }),
    ).toBe("fail");
  });
  it("allows a halfway swipe to activate and complete without a hold", () => {
    expect(
      classifyMessageReplyMovement({
        role,
        translationX: direction * 16,
        translationY: 3,
        elapsedMs: 50,
        touchCount: 1,
      }),
    ).toBe("activate");
    expect(acceptsMessageReplyGesture(direction * 16, 3, true, role)).toBe(true);
    expect(acceptsMessageReplyGesture(direction * 16, 3, false, role)).toBe(false);
    expect(acceptsMessageReplyGesture(0, 0, true, role)).toBe(false);
  });

  it("tolerates a small initial wobble and vertical drift in a horizontal swipe", () => {
    expect(
      classifyMessageReplyMovement({
        role,
        translationX: direction * 9,
        translationY: 8,
        elapsedMs: 30,
        touchCount: 1,
      }),
    ).toBe("wait");
    expect(
      classifyMessageReplyMovement({
        role,
        translationX: direction * 28,
        translationY: 11,
        elapsedMs: 80,
        touchCount: 1,
      }),
    ).toBe("activate");
  });
  it("defers vertical scrolling, diagonal drags, text selection holds and multiple touches", () => {
    for (const movement of [
      { translationX: 8, translationY: 12, elapsedMs: 50, touchCount: 1 },
      { translationX: 60, translationY: 60, elapsedMs: 60, touchCount: 1 },
      { translationX: 60, translationY: 0, elapsedMs: 300, touchCount: 1 },
      { translationX: 60, translationY: 0, elapsedMs: 100, touchCount: 2 },
    ])
      expect(
        classifyMessageReplyMovement({
          ...movement,
          role,
          translationX: direction * movement.translationX,
        }),
      ).toBe("fail");
    expect(
      classifyMessageReplyMovement({
        role,
        translationX: direction * 5,
        translationY: 2,
        elapsedMs: 50,
        touchCount: 1,
      }),
    ).toBe("wait");
  });
});
