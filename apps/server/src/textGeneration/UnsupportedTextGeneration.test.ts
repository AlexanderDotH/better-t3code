import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { makeUnsupportedTextGeneration } from "./UnsupportedTextGeneration.ts";

describe("makeUnsupportedTextGeneration", () => {
  it.effect("fails every operation with the provider name and operation", () =>
    Effect.gen(function* () {
      const textGeneration = makeUnsupportedTextGeneration("Hyperagent");
      const modelSelection = { instanceId: "hyperagent" as never, model: "sonnet-latest" };

      const errors = yield* Effect.all([
        Effect.flip(
          textGeneration.generateCommitMessage({
            cwd: "/repo",
            branch: "main",
            stagedSummary: "",
            stagedPatch: "",
            modelSelection,
          }),
        ),
        Effect.flip(
          textGeneration.translateTranscriptToEnglish({
            cwd: "/repo",
            text: "Hallo",
            modelSelection,
          }),
        ),
        Effect.flip(
          textGeneration.improvePrompt({
            cwd: "/repo",
            text: "Fix it",
            modelSelection,
          }),
        ),
      ]);

      expect(errors.map((error) => error.operation)).toEqual([
        "generateCommitMessage",
        "translateTranscriptToEnglish",
        "improvePrompt",
      ]);
      expect(errors.every((error) => error.detail.includes("Hyperagent"))).toBe(true);
    }),
  );
});
