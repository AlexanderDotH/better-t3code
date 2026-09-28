import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import { DecisionGenerationError, ProviderInstanceId } from "@t3tools/contracts";
import { selectManualReasoningEffort, stripAutoReasoning } from "@t3tools/shared/model";
import { expect } from "vite-plus/test";

import {
  AUTO_REASONING_DECISION_QUESTION_ID,
  AUTO_REASONING_MAX_ESTIMATED_TOKENS,
  type AutoReasoningDecide,
  applyAutoReasoningDecisionResult,
  buildAutoReasoningActivityPayload,
  buildAutoReasoningDecisionRequest,
  buildAutoReasoningPrompt,
  resolveAutoReasoningDecision,
  resolveAutoReasoningDecisionModelSelection,
  reuseAutoReasoningForRetry,
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

const promptedDecisionSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-luna",
  options: [
    { id: "reasoningEffort", value: "low" },
    { id: "t3AutoReasoning", value: true },
  ],
} as const;

const nativeDecisionSelection = {
  instanceId: ProviderInstanceId.make("openrouter"),
  model: "typesafe/jev-1.13",
} as const;

const autoReasoningContext = {
  userPrompt: "Implement the requested cross-layer change and verify it.",
  interactionMode: "plan" as const,
  attachments: [],
  allowedEfforts: ["low", "medium", "high", "xhigh"],
  conversation: [
    { role: "user" as const, text: "Wire the contract first." },
    { role: "assistant" as const, text: "The contract is complete." },
  ],
};

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

it("builds a bounded provider-neutral decision request with one choice per live effort", () => {
  const built = buildAutoReasoningDecisionRequest({
    ...autoReasoningContext,
    userPrompt: `${"current ".repeat(8_000)}CURRENT_PROMPT_TAIL`,
    decisionModelSelection: promptedDecisionSelection,
  });

  expect(built.estimatedTokens).toBeLessThanOrEqual(AUTO_REASONING_MAX_ESTIMATED_TOKENS);
  expect(built.request.modelSelection).toEqual({
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-luna",
    options: [{ id: "reasoningEffort", value: "low" }],
  });
  expect(built.request.state).toContain("Interaction mode: plan");
  expect(built.request.state).toContain("The contract is complete.");
  expect(built.request.state).toContain("CURRENT_PROMPT_TAIL");
  expect(built.request.questions[AUTO_REASONING_DECISION_QUESTION_ID]).toMatchObject({
    instructions: expect.stringContaining("lowest adequate supported effort"),
    criteria: {
      low: expect.stringContaining("Rank 1 of 4"),
      medium: expect.stringContaining("Rank 2 of 4"),
      high: expect.stringContaining("Rank 3 of 4"),
      xhigh: expect.stringContaining("Rank 4 of 4"),
    },
  });
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

it("applies a valid native decision and preserves the compatibility activity payload", () => {
  const resolution = applyAutoReasoningDecisionResult({
    agentModelSelection: selection,
    decisionModelSelection: nativeDecisionSelection,
    allowedEfforts: ["low", "medium", "high", "xhigh"],
    result: {
      model: "typesafe/jev-1.13",
      answers: {
        [AUTO_REASONING_DECISION_QUESTION_ID]: {
          choice: "high",
          confidence: 0.91,
          probabilities: { low: 0.01, medium: 0.08, high: 0.91, xhigh: 0 },
        },
      },
      usage: { inputTokens: 120, outputTokens: 4, totalTokens: 124, costUsd: 0.002 },
    },
    durationMs: 37,
  });

  expect(resolution.effectiveSelection).toEqual({
    ...selection,
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ],
  });
  expect(resolution.diagnostic).toEqual({
    routerModel: { instanceId: "openrouter", model: "typesafe/jev-1.13" },
    effort: "high",
    durationMs: 37,
    fallback: false,
    usage: { inputTokens: 120, outputTokens: 4, totalTokens: 124, costUsd: 0.002 },
  });
  expect(buildAutoReasoningActivityPayload(resolution.diagnostic!)).toEqual({
    autoReasoningEffort: "high",
    autoReasoningFallback: false,
    autoReasoningRouterModel: { instanceId: "openrouter", model: "typesafe/jev-1.13" },
    autoReasoningDurationMs: 37,
    autoReasoningUsage: {
      inputTokens: 120,
      outputTokens: 4,
      totalTokens: 124,
      costUsd: 0.002,
    },
  });
});

it("uses the concrete effort when a decision answer is missing or invalid", () => {
  const resolution = applyAutoReasoningDecisionResult({
    agentModelSelection: selection,
    decisionModelSelection: promptedDecisionSelection,
    allowedEfforts: ["low", "high"],
    result: {
      model: "gpt-5.6-luna",
      answers: { [AUTO_REASONING_DECISION_QUESTION_ID]: { choice: "medium" } },
      usage: { totalTokens: 42 },
    },
    durationMs: -1,
  });

  expect(resolution.effectiveSelection).toEqual(stripAutoReasoning(selection));
  expect(resolution.diagnostic).toEqual({
    routerModel: { instanceId: "codex", model: "gpt-5.6-luna" },
    effort: "low",
    durationMs: 0,
    fallback: true,
  });
});

it("keeps the null setting fallback to text generation while honoring an explicit decision model", () => {
  expect(
    resolveAutoReasoningDecisionModelSelection({
      autoReasoningModelSelection: null,
      textGenerationModelSelection: promptedDecisionSelection,
    }),
  ).toEqual(stripAutoReasoning(promptedDecisionSelection));
  expect(
    resolveAutoReasoningDecisionModelSelection({
      autoReasoningModelSelection: nativeDecisionSelection,
      textGenerationModelSelection: promptedDecisionSelection,
    }),
  ).toEqual(nativeDecisionSelection);
});

it("reuses the persisted compatible decision for a retry", () => {
  const reused = reuseAutoReasoningForRetry({
    agentModelSelection: selection,
    retryOfTurnId: "turn-original",
    activities: [
      {
        kind: "auto-reasoning.resolved",
        turnId: "turn-original",
        payload: { autoReasoningEffort: "xhigh", autoReasoningFallback: false },
      },
    ],
  });

  expect(reused).toEqual({
    effectiveSelection: {
      ...selection,
      options: [
        { id: "reasoningEffort", value: "xhigh" },
        { id: "serviceTier", value: "priority" },
      ],
    },
    diagnostic: {
      routerModel: null,
      effort: "xhigh",
      durationMs: 0,
      fallback: false,
    },
  });
});

it.effect("forwards prompted and native selections through the same decision contract", () =>
  Effect.gen(function* () {
    for (const [modelSelection, returnedModel] of [
      [promptedDecisionSelection, "gpt-5.6-luna"],
      [nativeDecisionSelection, "typesafe/jev-1.13"],
    ] as const) {
      let receivedModelSelection: unknown;
      const decide: AutoReasoningDecide = (input) =>
        Effect.sync(() => {
          receivedModelSelection = input.modelSelection;
          return {
            model: returnedModel,
            answers: { [AUTO_REASONING_DECISION_QUESTION_ID]: { choice: "medium" } },
          };
        });
      const resolution = yield* resolveAutoReasoningDecision(
        {
          ...autoReasoningContext,
          cwd: "/tmp/project",
          agentModelSelection: selection,
          decisionModelSelection: modelSelection,
        },
        decide,
      );

      expect(receivedModelSelection).toEqual(stripAutoReasoning(modelSelection));
      expect(resolution?.diagnostic).toMatchObject({
        routerModel: { instanceId: String(modelSelection.instanceId), model: returnedModel },
        effort: "medium",
        fallback: false,
      });
    }
  }),
);

it.effect("falls back to the concrete effort on a decision error", () =>
  Effect.gen(function* () {
    const decide: AutoReasoningDecide = () =>
      Effect.fail(
        new DecisionGenerationError({
          operation: "decide",
          reason: "provider-failed",
          detail: "provider unavailable",
        }),
      );
    const resolution = yield* resolveAutoReasoningDecision(
      {
        ...autoReasoningContext,
        cwd: "/tmp/project",
        agentModelSelection: selection,
        decisionModelSelection: nativeDecisionSelection,
      },
      decide,
    );

    expect(resolution?.diagnostic).toMatchObject({ effort: "low", fallback: true });
    expect(resolution?.effectiveSelection).toEqual(stripAutoReasoning(selection));
  }),
);

it.effect("falls back to the concrete effort when the decision times out", () =>
  Effect.gen(function* () {
    const decide: AutoReasoningDecide = () => Effect.never;
    const fiber = yield* resolveAutoReasoningDecision(
      {
        ...autoReasoningContext,
        cwd: "/tmp/project",
        agentModelSelection: selection,
        decisionModelSelection: nativeDecisionSelection,
      },
      decide,
    ).pipe(Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    yield* TestClock.adjust("16 seconds");
    const resolution = yield* Fiber.join(fiber);
    expect(resolution?.diagnostic).toMatchObject({ effort: "low", fallback: true });
    expect(resolution?.effectiveSelection).toEqual(stripAutoReasoning(selection));
  }),
);
