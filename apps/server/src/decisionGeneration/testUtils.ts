import { DecisionGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DecisionGeneration } from "./DecisionGeneration.ts";

type DecisionGenerationService = DecisionGeneration["Service"];

export function makeDecisionGenerationTestLayer(
  overrides: Partial<DecisionGenerationService> = {},
) {
  const decide: DecisionGenerationService["decide"] =
    overrides.decide ??
    (() =>
      Effect.fail(
        new DecisionGenerationError({
          operation: "decide",
          reason: "provider-failed",
          detail: "Decision generation is disabled in this test harness.",
        }),
      ));
  const decideMany: DecisionGenerationService["decideMany"] =
    overrides.decideMany ?? ((requests) => Effect.forEach(requests, decide));

  return Layer.succeed(DecisionGeneration, DecisionGeneration.of({ decide, decideMany }));
}
