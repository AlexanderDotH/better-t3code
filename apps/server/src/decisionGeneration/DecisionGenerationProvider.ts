import type {
  DecisionGenerationError,
  DecisionGenerationInput,
  DecisionGenerationResult,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export interface DecisionGenerationRequest extends DecisionGenerationInput {
  readonly cwd: string;
}

export interface DecisionGenerationProvider {
  readonly decide: (
    input: DecisionGenerationRequest,
  ) => Effect.Effect<DecisionGenerationResult, DecisionGenerationError>;
}
