// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";

import { installRecordingCursor } from "./RecordingCursor.ts";

it("hides the native cursor and respects reduced motion until recording is disposed", () => {
  const recording = installRecordingCursor(document, window);
  const style = document.querySelector("style");
  expect(style?.sheet).not.toBeNull();
  const rules = Array.from(style!.sheet!.cssRules);
  const cursorRule = rules.find((rule) => "selectorText" in rule) as CSSStyleRule;
  const reducedMotionRule = rules.find((rule) => "conditionText" in rule) as CSSMediaRule;

  expect(cursorRule.selectorText).toBe("html, html *");
  expect(cursorRule.style.getPropertyValue("cursor")).toBe("none");
  expect(cursorRule.style.getPropertyPriority("cursor")).toBe("important");
  expect(reducedMotionRule.conditionText).toBe("(prefers-reduced-motion: reduce)");
  const transitionRule = reducedMotionRule.cssRules[0] as CSSStyleRule;
  expect(transitionRule.style.getPropertyValue("transition")).toBe("none");
  expect(transitionRule.style.getPropertyPriority("transition")).toBe("important");

  recording.dispose();
  expect(document.querySelector("style")).toBeNull();
  expect(document.querySelector("[data-t3code-recording-cursor]")).toBeNull();
});
