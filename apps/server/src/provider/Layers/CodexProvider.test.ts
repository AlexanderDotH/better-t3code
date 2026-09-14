import { assert, it } from "@effect/vitest";
import { createCodexContextWindowDescriptor } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as CodexSchema from "effect-codex-app-server/schema";

import {
  applyPreferredCodexDefaultModel,
  mapCodexModelCapabilities,
  readCodexRateLimits,
} from "./CodexProvider.ts";

it.effect("accepts a slow usage response and bounds an unanswered request", () =>
  Effect.gen(function* () {
    const response = { rateLimits: { primary: { usedPercent: 4, windowDurationMins: 10_080 } } };
    const pending = yield* Deferred.make<CodexSchema.V2GetAccountRateLimitsResponse>();
    const started = yield* Deferred.make<void>();
    const result = yield* readCodexRateLimits(
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(pending))),
    ).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust("4 seconds");
    yield* Deferred.succeed(pending, response);
    assert.deepStrictEqual(yield* Fiber.join(result), {
      snapshot: response.rateLimits,
      rateLimitsByLimitId: undefined,
      resetCredits: undefined,
    });
    const hung = yield* readCodexRateLimits(Effect.never).pipe(Effect.forkChild);
    yield* TestClock.adjust("9 seconds");
    assert.deepStrictEqual(yield* Fiber.join(hung), {
      failure: "Codex usage request timed out. Refresh Usage → Limits to try again.",
    });
  }),
);

const TEST_CONTEXT_WINDOW = {
  defaultTokens: 272_000,
  maxTokens: 872_000,
  effectivePercent: 95,
} as const;
const TEST_CONTEXT_WINDOW_DESCRIPTOR = createCodexContextWindowDescriptor(TEST_CONTEXT_WINDOW);

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities(
    {
      additionalSpeedTiers: [],
      defaultReasoningEffort: "super-high",
      description: "Test model",
      displayName: "GPT Test",
      hidden: false,
      id: "gpt-test",
      isDefault: true,
      model: "gpt-test",
      defaultServiceTier: "flex",
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          name: "Flex",
          description: "Lower-cost asynchronous routing.",
        },
      ],
      supportedReasoningEfforts: [
        {
          description: "Maximum reasoning",
          reasoningEffort: "super-high",
        },
      ],
    },
    TEST_CONTEXT_WINDOW,
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
    TEST_CONTEXT_WINDOW_DESCRIPTOR,
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities(
    {
      additionalSpeedTiers: ["fast"],
      defaultReasoningEffort: "medium",
      defaultServiceTier: null,
      description: "Test model",
      displayName: "GPT Test",
      hidden: false,
      id: "gpt-test",
      isDefault: true,
      model: "gpt-test",
      serviceTiers: [
        {
          id: "priority",
          name: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
      supportedReasoningEfforts: [],
    },
    TEST_CONTEXT_WINDOW,
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
      ],
      currentValue: "default",
    },
    TEST_CONTEXT_WINDOW_DESCRIPTOR,
  ]);
});

it("canonicalizes the legacy fast catalog tier to priority", () => {
  const capabilities = mapCodexModelCapabilities(
    {
      additionalSpeedTiers: ["fast"],
      defaultReasoningEffort: "medium",
      defaultServiceTier: "fast",
      description: "Legacy catalog model",
      displayName: "GPT Legacy",
      hidden: false,
      id: "gpt-legacy",
      isDefault: false,
      model: "gpt-legacy",
      serviceTiers: [],
      supportedReasoningEfforts: [],
    },
    TEST_CONTEXT_WINDOW,
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        { id: "priority", label: "Fast", isDefault: true },
      ],
      currentValue: "priority",
    },
    TEST_CONTEXT_WINDOW_DESCRIPTOR,
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
