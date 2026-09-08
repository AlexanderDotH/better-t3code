import { expect, it } from "@effect/vitest";

import {
  PROJECT_AGENT_COORDINATION_INSTRUCTIONS,
  applyProjectAgentInstructionsToProviderInput,
} from "./ProjectAgentInstructions.ts";

it("prepends the bounded coordination contract without changing the user request", () => {
  const result = applyProjectAgentInstructionsToProviderInput({
    providerInput: "Implement the approved plan",
    maxInputChars: PROJECT_AGENT_COORDINATION_INSTRUCTIONS.length + 40,
  });

  expect(result.outcome).toBe("included");
  expect(result.providerInput).toBe(
    `${PROJECT_AGENT_COORDINATION_INSTRUCTIONS}\n\nImplement the approved plan`,
  );
});

it("preserves the complete original input when the coordination block does not fit", () => {
  const providerInput = "x".repeat(100);
  expect(
    applyProjectAgentInstructionsToProviderInput({ providerInput, maxInputChars: 100 }),
  ).toEqual({ providerInput, outcome: "omitted" });
});

it("tells coordinated agents that direct messages can wake an offline peer chat", () => {
  expect(PROJECT_AGENT_COORDINATION_INSTRUCTIONS).toContain(
    "A direct message to an offline peer wakes its existing chat",
  );
});
