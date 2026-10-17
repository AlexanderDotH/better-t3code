import { describe, expect, it } from "vite-plus/test";
import { parseDeepPlanComposerCommand } from "./deepPlanning.ts";

describe("DeepPlan composer command", () => {
  it.each([
    ["/deep-plan", ""],
    ["/deep-plan Build the feature", "Build the feature"],
    [" /DEEP-PLAN\nInspect every source", "Inspect every source"],
  ])("strips an initial command and preserves the prompt: %s", (text, prompt) => {
    expect(parseDeepPlanComposerCommand(text)).toEqual({ prompt });
  });

  it.each(["/deep-planner Build", "Explain /deep-plan", "Ordinary prompt"])(
    "leaves ordinary input unchanged: %s",
    (text) => {
      expect(parseDeepPlanComposerCommand(text)).toBeNull();
    },
  );
});
