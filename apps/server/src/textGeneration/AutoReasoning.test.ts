import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@t3tools/contracts";
import { selectManualReasoningEffort, stripAutoReasoning } from "@t3tools/shared/model";
import { expect } from "vite-plus/test";

import {
  AUTO_REASONING_MAX_ESTIMATED_TOKENS,
  buildAutoReasoningPrompt,
  validateAutoReasoningDecision,
} from "./AutoReasoning.ts";

const selection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  options: [
    { id: "reasoningEffort", value: "low" },
    { id: "t3AutoReasoning", value: true },
    { id: "serviceTier", value: "priority" },
  ],
} as const;

it("builds a bounded preflight prompt from prior outcomes and current work items", () => {
  const built = buildAutoReasoningPrompt({
    userPrompt: `${"current ".repeat(8_000)}CURRENT_PROMPT_TAIL`,
    interactionMode: "plan",
    attachments: [
      {
        type: "image",
        id: "attachment-secret-id",
        name: "architecture.png",
        mimeType: "image/png",
        sizeBytes: 42,
      },
    ],
    allowedEfforts: ["low", "medium", "high", "xhigh"],
    conversation: [
      { role: "user", text: "Original work items:\n- add the contract\n- wire the server" },
      { role: "assistant", text: "Completed the contract and server wiring with tests." },
      ...Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `Intermediate exchange ${index}: ${"detail ".repeat(500)}`,
      })),
      { role: "user", text: "Next, support web and mobile." },
      { role: "assistant", text: "Web is complete. Mobile remains open." },
    ],
  });

  expect(built.estimatedTokens).toBeLessThanOrEqual(AUTO_REASONING_MAX_ESTIMATED_TOKENS);
  expect(built.prompt).toContain("<t3code_auto_reasoning_call>");
  expect(built.prompt).toContain("lowest adequate supported effort");
  expect(built.prompt).toContain("low, medium, high, xhigh");
  expect(built.prompt).toContain("Interaction mode: plan");
  expect(built.prompt).toContain("image | architecture.png | image/png | 42 bytes");
  expect(built.prompt).not.toContain("attachment-secret-id");
  expect(built.prompt).toContain("Original work items:");
  expect(built.prompt).toContain("Completed the contract and server wiring with tests.");
  expect(built.prompt).toContain("Mobile remains open.");
  expect(built.prompt).toContain("intermediate conversation messages omitted");
  expect(built.prompt).toContain("individual requests, bullets, and work items");
  expect(built.prompt).toContain("Count only remaining or newly requested work");
  expect(built.prompt).toContain("cross-layer or cross-client wiring");
  expect(built.prompt).toContain("Current user prompt:");
  expect(built.prompt).toContain("CURRENT_PROMPT_TAIL");
});

it.effect("accepts only an exact live effort", () =>
  Effect.gen(function* () {
    expect(yield* validateAutoReasoningDecision(["low", "high"], { effort: "high" })).toEqual({
      effort: "high",
    });

    const error = yield* Effect.flip(
      validateAutoReasoningDecision(["low", "high"], { effort: "medium" }),
    );
    expect(error).toMatchObject({
      _tag: "TextGenerationError",
      operation: "decideAutoReasoning",
    });
  }),
);

it("keeps the concrete fallback while stripping Auto from effective selections", () => {
  expect(stripAutoReasoning(selection)).toEqual({
    ...selection,
    options: [
      { id: "reasoningEffort", value: "low" },
      { id: "serviceTier", value: "priority" },
    ],
  });
  expect(selectManualReasoningEffort(stripAutoReasoning(selection), "xhigh")).toEqual({
    ...selection,
    options: [
      { id: "reasoningEffort", value: "xhigh" },
      { id: "serviceTier", value: "priority" },
    ],
  });
});
