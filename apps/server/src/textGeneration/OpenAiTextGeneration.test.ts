import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { OpenAiHttpError } from "../provider/openai/OpenAiTransport.ts";
import { makeOpenAiTextGeneration, type OpenAiTextCompletion } from "./OpenAiTextGeneration.ts";

const selection = {
  instanceId: ProviderInstanceId.make("openai"),
  model: "gpt-5.6-sol",
  options: [{ id: "reasoningEffort", value: "high" }],
} as const;

describe("OpenAiTextGeneration", () => {
  it.effect("uses the selected live model for strict structured generation", () =>
    Effect.gen(function* () {
      const requests: Array<Parameters<OpenAiTextCompletion>[0]> = [];
      const complete: OpenAiTextCompletion = (request) =>
        Effect.sync(() => {
          requests.push(request);
          return { text: '{"title":"  Direct Responses  "}' };
        });
      const textGeneration = makeOpenAiTextGeneration({ enabled: true }, complete, {
        isModelAvailable: () => Effect.succeed(true),
      });

      const result = yield* textGeneration.generateThreadTitle({
        cwd: "/workspace",
        message: "Implement OpenAI Responses",
        attachments: [],
        modelSelection: selection,
      });

      expect(result).toEqual({ title: "Direct Responses" });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        responseFormat: { name: "thread_title", schema: expect.any(Object) },
      });
      expect(requests[0]?.instructions).toContain("exactly one JSON object");
    }),
  );

  it.effect("generates title and branch in one structured metadata request", () =>
    Effect.gen(function* () {
      const requests: Array<Parameters<OpenAiTextCompletion>[0]> = [];
      const complete: OpenAiTextCompletion = (request) =>
        Effect.sync(() => {
          requests.push(request);
          return { text: '{"title":"  Usage diagnostics  ","branch":" Feat/Usage Diagnostics "}' };
        });
      const textGeneration = makeOpenAiTextGeneration({ enabled: true }, complete);

      const result = yield* textGeneration.generateThreadMetadata({
        cwd: "/workspace",
        message: "Add usage diagnostics",
        attachments: [],
        modelSelection: selection,
      });

      expect(result).toEqual({ title: "Usage diagnostics", branch: "feat/usage-diagnostics" });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        model: selection.model,
        reasoningEffort: "high",
        responseFormat: { name: "thread_metadata", schema: expect.any(Object) },
      });
      expect(requests[0]?.prompt).toContain("<t3code_metadata_call>");
      expect(requests[0]?.prompt).toContain('exactly two keys: "title" and "branch"');
    }),
  );

  it.effect("uses strict OpenAI schemas for plan review and Fetch planning", () =>
    Effect.gen(function* () {
      const requests: Array<Parameters<OpenAiTextCompletion>[0]> = [];
      const complete: OpenAiTextCompletion = (request) =>
        Effect.sync(() => {
          requests.push(request);
          if (request.responseFormat.name === "plan_parallelism_review") {
            return { text: '{"recommendedSubagents":4}' };
          }
          return {
            // Keep the external model fixture independent of the decoder under test.
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            text: JSON.stringify({
              decision: "run",
              workers: [
                { scope: "Provider runtime", questions: ["Where is OpenAI Responses started?"] },
              ],
            }),
          };
        });
      const textGeneration = makeOpenAiTextGeneration({ enabled: true }, complete, {
        isModelAvailable: () => Effect.succeed(true),
      });

      const review = yield* textGeneration.reviewPlanParallelism({
        cwd: "/workspace",
        planMarkdown: "## Provider\nComplete OpenAI conformance.",
        userRequest: "Finish the provider implementation.",
        maxSubagents: 8,
        modelSelection: selection,
      });
      const fetch = yield* textGeneration.planFetchExploration({
        cwd: "/workspace",
        userRequest: "Trace the OpenAI provider runtime.",
        repositoryOrientation: "Top-level areas: apps/server/src/provider",
        maxRecommendedWorkers: 6,
        modelSelection: selection,
      });

      expect(review).toEqual({ recommendedSubagents: 4 });
      expect(fetch).toEqual({
        decision: "run",
        workers: [{ scope: "Provider runtime", questions: ["Where is OpenAI Responses started?"] }],
      });
      expect(requests.map((request) => request.responseFormat.name)).toEqual([
        "plan_parallelism_review",
        "fetch_exploration_plan",
      ]);
      expect(requests[0]?.prompt).toContain("between 2 and 8");
      expect(requests[1]?.prompt).toContain("between 1 and 6 workers");
      expect(requests.every((request) => request.reasoningEffort === "high")).toBe(true);
    }),
  );

  it.effect("blocks disabled and no-longer-live model selections before inference", () =>
    Effect.gen(function* () {
      let calls = 0;
      const complete: OpenAiTextCompletion = () =>
        Effect.sync(() => {
          calls += 1;
          return { text: "{}" };
        });
      const input = {
        cwd: "/workspace",
        message: "Blocked",
        attachments: [],
        modelSelection: selection,
      } as const;
      const disabled = makeOpenAiTextGeneration({ enabled: false }, complete);
      const disabledError = yield* Effect.flip(disabled.generateThreadTitle(input));
      expect(disabledError).toMatchObject({
        _tag: "TextGenerationError",
        detail: "OpenAI Responses is disabled in this provider instance.",
      });

      const unavailable = makeOpenAiTextGeneration({ enabled: true }, complete, {
        isModelAvailable: () => Effect.succeed(false),
      });
      const unavailableError = yield* Effect.flip(unavailable.generateThreadTitle(input));
      expect(unavailableError).toMatchObject({
        reason: "model-unavailable",
        detail: "The selected OpenAI model is no longer available.",
      });
      expect(calls).toBe(0);
    }),
  );

  it.effect("normalizes Retry-After into typed absolute rate-limit metadata", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const complete: OpenAiTextCompletion = () =>
        Effect.fail(
          new OpenAiHttpError({
            operation: "responses",
            category: "rate-limit",
            status: 429,
            retryAfterSeconds: 17,
            message: "OpenAI rate limit was reached",
          }),
        );
      const textGeneration = makeOpenAiTextGeneration({ enabled: true }, complete);

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Rate limited",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error).toBeInstanceOf(TextGenerationError);
      expect(error).toMatchObject({
        reason: "rate-limited",
        retryAt: now + 17_000,
        detail: "OpenAI text generation was rate limited.",
      });
    }),
  );

  it.effect("preserves rate-limit metadata from live model validation before inference", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      let calls = 0;
      const textGeneration = makeOpenAiTextGeneration(
        { enabled: true },
        () =>
          Effect.sync(() => {
            calls += 1;
            return { text: "{}" };
          }),
        {
          isModelAvailable: () =>
            Effect.fail(
              new OpenAiHttpError({
                operation: "models",
                category: "rate-limit",
                status: 429,
                retryAfterSeconds: 9,
                message: "OpenAI rate limit was reached",
              }),
            ),
        },
      );

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Catalog rate limited",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error).toMatchObject({
        reason: "rate-limited",
        retryAt: now + 9_000,
      });
      expect(calls).toBe(0);
    }),
  );

  it.effect("classifies unavailable models and account entitlements without leaking payloads", () =>
    Effect.gen(function* () {
      for (const [category, reason] of [
        ["not-found", "model-unavailable"],
        ["forbidden", "entitlement"],
      ] as const) {
        const textGeneration = makeOpenAiTextGeneration({ enabled: true }, () =>
          Effect.fail(
            new OpenAiHttpError({
              operation: "responses",
              category,
              status: category === "not-found" ? 404 : 403,
              message: "secret upstream detail",
            }),
          ),
        );

        const error = yield* Effect.flip(
          textGeneration.generateThreadTitle({
            cwd: "/workspace",
            message: "Check model availability",
            attachments: [],
            modelSelection: selection,
          }),
        );

        expect(error).toMatchObject({
          operation: "generateThreadTitle",
          reason,
          detail: "OpenAI text generation request failed.",
        });
        // A schema encoder could hide leaked properties by stripping unknown fields.
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        expect(JSON.stringify(error)).not.toContain("secret upstream detail");
      }
    }),
  );

  it.effect("rejects invalid structured output", () =>
    Effect.gen(function* () {
      const textGeneration = makeOpenAiTextGeneration({ enabled: true }, () =>
        Effect.succeed({ text: '{"title":42}' }),
      );

      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Check structured output",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error).toMatchObject({
        operation: "generateThreadTitle",
        detail: "OpenAI returned invalid structured output.",
      });
    }),
  );

  it.effect("redacts transport payloads and rejects invalid structured output", () =>
    Effect.gen(function* () {
      const secret = "sk-secret-should-not-escape";
      const textGeneration = makeOpenAiTextGeneration({ enabled: true }, () =>
        Effect.fail({ _tag: "TestError", message: `upstream included ${secret}` }),
      );
      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: "/workspace",
          message: "Failure",
          attachments: [],
          modelSelection: selection,
        }),
      );

      expect(error.detail).toBe("OpenAI text generation request failed.");
      // A schema encoder could hide leaked properties by stripping unknown fields.
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.stringify(error)).not.toContain(secret);
    }),
  );
});
