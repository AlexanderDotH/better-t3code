import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";

type UnsupportedOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "translateTranscriptToEnglish"
  | "improvePrompt";

export function makeUnsupportedTextGeneration(
  providerName: string,
): TextGeneration.TextGeneration["Service"] {
  const fail = (operation: UnsupportedOperation) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${providerName} does not support server-side text generation yet.`,
      }),
    );

  return TextGeneration.TextGeneration.of({
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
    translateTranscriptToEnglish: () => fail("translateTranscriptToEnglish"),
    improvePrompt: () => fail("improvePrompt"),
  });
}
