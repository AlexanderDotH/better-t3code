import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { makeUnsupportedTextGeneration } from "./UnsupportedTextGeneration.ts";

describe("makeUnsupportedTextGeneration", () => {
  it("fails every operation with the provider name and operation", async () => {
    const textGeneration = makeUnsupportedTextGeneration("Hyperagent");
    const modelSelection = { instanceId: "hyperagent" as never, model: "sonnet-latest" };

    const errors = await Promise.all([
      Effect.runPromise(
        Effect.flip(
          textGeneration.generateCommitMessage({
            cwd: "/repo",
            branch: "main",
            stagedSummary: "",
            stagedPatch: "",
            modelSelection,
          }),
        ),
      ),
      Effect.runPromise(
        Effect.flip(
          textGeneration.translateTranscriptToEnglish({
            cwd: "/repo",
            text: "Hallo",
            modelSelection,
          }),
        ),
      ),
      Effect.runPromise(
        Effect.flip(
          textGeneration.improvePrompt({
            cwd: "/repo",
            text: "Fix it",
            modelSelection,
          }),
        ),
      ),
    ]);

    expect(errors.map((error) => error.operation)).toEqual([
      "generateCommitMessage",
      "translateTranscriptToEnglish",
      "improvePrompt",
    ]);
    expect(errors.every((error) => error.detail.includes("Hyperagent"))).toBe(true);
  });
});
