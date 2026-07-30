import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";

export function makeUnsupportedTextGeneration(
  providerName: string,
): TextGeneration.TextGeneration["Service"] {
  const fail = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${providerName} does not support server-side git text generation yet.`,
      }),
    );

  return TextGeneration.TextGeneration.of({
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
  });
}
