import { it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type DecisionGenerationResult,
  type ModelDecisionSupport,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import {
  DECISION_GENERATION_TIMEOUT_MS,
  boundDecisionState,
  makeDecisionGenerationFromRegistry,
  normalizedModelSelectionKey,
  type DecisionGenerationProviderInstance,
  type DecisionGenerationProviderRegistry,
  type DecisionGenerationRequest,
} from "./DecisionGeneration.ts";
import type { DecisionGenerationProvider } from "./DecisionGenerationProvider.ts";

const makeModel = (
  slug: string,
  decision: ModelDecisionSupport,
  contextWindowTokens = 16_384,
): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  isSelectable: decision !== "native",
  capabilities: {
    selectionSupport: {
      agent: decision === "prompted",
      textGeneration: decision === "prompted",
      decision,
    },
    contextWindow: {
      defaultTokens: contextWindowTokens,
      maxTokens: contextWindowTokens,
    },
  },
});

const makeInstance = (
  instanceId: ProviderInstanceId,
  models: ReadonlyArray<ServerProviderModel>,
  decisionGeneration?: DecisionGenerationProvider,
  textDecisionGeneration?: DecisionGenerationProvider,
): DecisionGenerationProviderInstance => {
  const snapshot = {
    instanceId,
    driver: ProviderDriverKind.make("test"),
    status: "ready",
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    checkedAt: "2026-09-28T00:00:00.000Z",
    version: "1.0.0",
    models: [...models],
    slashCommands: [],
    skills: [],
  } satisfies ServerProvider;
  return {
    snapshot: { getSnapshot: Effect.succeed(snapshot) },
    ...(decisionGeneration ? { decisionGeneration } : {}),
    ...(textDecisionGeneration
      ? { textGeneration: { decisionGeneration: textDecisionGeneration } }
      : {}),
  };
};

const makeRegistry = (
  entries: ReadonlyArray<readonly [ProviderInstanceId, DecisionGenerationProviderInstance]>,
): DecisionGenerationProviderRegistry => {
  const instances = new Map(entries);
  return { getInstance: (instanceId) => Effect.succeed(instances.get(instanceId)) };
};

const makeRequest = (
  instanceId: ProviderInstanceId,
  model: string,
  state = "Project context",
): DecisionGenerationRequest => ({
  cwd: "/workspace",
  modelSelection: createModelSelection(instanceId, model),
  state,
  questions: {
    relevance: {
      instructions: "Decide whether the context is relevant.",
      criteria: { include: "Useful project facts", skip: "No useful facts" },
    },
  },
});

const answerEveryQuestion = (
  request: DecisionGenerationRequest,
  choice = "include",
): DecisionGenerationResult => ({
  model: request.modelSelection.model,
  answers: Object.fromEntries(
    Object.keys(request.questions).map((questionId) => [questionId, { choice }]),
  ),
});

describe("DecisionGeneration", () => {
  it.effect("dispatches prompted and native decision-capable models", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("decision-provider");
      const dispatchedModels: string[] = [];
      const provider: DecisionGenerationProvider = {
        decide: (request) =>
          Effect.sync(() => {
            dispatchedModels.push(request.modelSelection.model);
            return answerEveryQuestion(request);
          }),
      };
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [
            instanceId,
            makeInstance(
              instanceId,
              [makeModel("generative", "prompted"), makeModel("system-one", "native")],
              provider,
            ),
          ],
        ]),
      );

      const prompted = yield* generation.decide(makeRequest(instanceId, "generative"));
      const native = yield* generation.decide(makeRequest(instanceId, "system-one"));

      expect(prompted.answers.relevance?.choice).toBe("include");
      expect(native.answers.relevance?.choice).toBe("include");
      expect(dispatchedModels).toEqual(["generative", "system-one"]);
    }),
  );

  it.effect("routes native and prompted models through their matching provider facets", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("dual-decision-provider");
      const dispatches: string[] = [];
      const nativeProvider: DecisionGenerationProvider = {
        decide: (request) =>
          Effect.sync(() => {
            dispatches.push(`native:${request.modelSelection.model}`);
            return answerEveryQuestion(request);
          }),
      };
      const promptedProvider: DecisionGenerationProvider = {
        decide: (request) =>
          Effect.sync(() => {
            dispatches.push(`prompted:${request.modelSelection.model}`);
            return answerEveryQuestion(request);
          }),
      };
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [
            instanceId,
            makeInstance(
              instanceId,
              [makeModel("generative", "prompted"), makeModel("system-one", "native")],
              nativeProvider,
              promptedProvider,
            ),
          ],
        ]),
      );

      yield* generation.decide(makeRequest(instanceId, "generative"));
      yield* generation.decide(makeRequest(instanceId, "system-one"));

      expect(dispatches).toEqual(["prompted:generative", "native:system-one"]);
    }),
  );

  it.effect("rejects non-decision models before provider dispatch", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("no-decisions");
      let dispatches = 0;
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [
            instanceId,
            makeInstance(instanceId, [makeModel("image-only", "none")], {
              decide: (request) =>
                Effect.sync(() => {
                  dispatches += 1;
                  return answerEveryQuestion(request);
                }),
            }),
          ],
        ]),
      );

      const result = yield* generation
        .decide(makeRequest(instanceId, "image-only"))
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toBe("unsupported-model");
      expect(dispatches).toBe(0);
    }),
  );

  it.effect("bounds long state while preserving its beginning and end", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("bounded");
      const request = makeRequest(instanceId, "small-context", `BEGIN-${"x".repeat(20_000)}-END`);

      const bounded = yield* boundDecisionState(request, 1_500);

      expect(bounded.state.length).toBeLessThan(request.state.length);
      expect(bounded.state.startsWith("BEGIN-")).toBe(true);
      expect(bounded.state.endsWith("-END")).toBe(true);
      expect(bounded.state).toContain("decision state truncated");
    }),
  );

  it.effect("rejects missing, unknown, and unsupported answers", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("invalid-answers");
      const responses: Array<DecisionGenerationResult> = [
        { model: "model", answers: { extra: { choice: "include" } } },
        { model: "model", answers: { relevance: { choice: "invented" } } },
        {
          model: "model",
          answers: {
            relevance: { choice: "include", probabilities: { invented: 0.5 } },
          },
        },
      ];
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [
            instanceId,
            makeInstance(instanceId, [makeModel("model", "native")], {
              decide: () => Effect.succeed(responses.shift()!),
            }),
          ],
        ]),
      );

      for (let index = 0; index < 3; index += 1) {
        const result = yield* generation
          .decide(makeRequest(instanceId, "model"))
          .pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure.reason).toBe("invalid-response");
      }
    }),
  );

  it.effect("batches colliding question ids with distinct states and restores input order", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("batch-provider");
      const calls: DecisionGenerationRequest[] = [];
      const provider: DecisionGenerationProvider = {
        decide: (request) =>
          Effect.sync(() => {
            calls.push(request);
            const questionIds = Object.keys(request.questions);
            return {
              model: "resolved-model",
              answers: {
                [questionIds[0]!]: { choice: "include" },
                [questionIds[1]!]: { choice: "skip" },
              },
              usage: { totalTokens: 42 },
            };
          }),
      };
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [instanceId, makeInstance(instanceId, [makeModel("model", "prompted")], provider)],
        ]),
      );
      const first = makeRequest(instanceId, "model", "FIRST STATE");
      const second = makeRequest(instanceId, "model", "SECOND STATE");

      const results = yield* generation.decideMany([first, second]);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.state).toContain("FIRST STATE");
      expect(calls[0]?.state).toContain("SECOND STATE");
      expect(Object.keys(calls[0]?.questions ?? {})).toEqual([
        "request_0_question_0",
        "request_1_question_0",
      ]);
      expect(results.map((result) => result.answers.relevance?.choice)).toEqual([
        "include",
        "skip",
      ]);
      expect(results.every((result) => result.model === "resolved-model")).toBe(true);
    }),
  );

  it.effect("runs different normalized model selections concurrently", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("parallel-provider");
      const started = yield* Ref.make(0);
      const bothStarted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const provider: DecisionGenerationProvider = {
        decide: (request) =>
          Effect.gen(function* () {
            const active = yield* Ref.updateAndGet(started, (count) => count + 1);
            if (active === 2) yield* Deferred.succeed(bothStarted, undefined);
            yield* Deferred.await(release);
            return answerEveryQuestion(request);
          }),
      };
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [
            instanceId,
            makeInstance(
              instanceId,
              [makeModel("first-model", "prompted"), makeModel("second-model", "prompted")],
              provider,
            ),
          ],
        ]),
      );
      const fiber = yield* generation
        .decideMany([
          makeRequest(instanceId, "first-model"),
          makeRequest(instanceId, "second-model"),
        ])
        .pipe(Effect.forkChild({ startImmediately: true }));

      yield* Deferred.await(bothStarted);
      expect(yield* Ref.get(started)).toBe(2);
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(fiber)).map((result) => result.model)).toEqual([
        "first-model",
        "second-model",
      ]);
    }),
  );

  it.effect("maps the common provider deadline to a timeout error", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("timeout-provider");
      const generation = makeDecisionGenerationFromRegistry(
        makeRegistry([
          [
            instanceId,
            makeInstance(instanceId, [makeModel("model", "native")], {
              decide: () => Effect.never,
            }),
          ],
        ]),
      );
      const fiber = yield* generation
        .decide(makeRequest(instanceId, "model"))
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));

      yield* Effect.yieldNow;
      yield* TestClock.adjust(DECISION_GENERATION_TIMEOUT_MS);
      const result = yield* Fiber.join(fiber);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.reason).toBe("timeout");
    }),
  );

  it("normalizes model option order for batching keys", () => {
    const instanceId = ProviderInstanceId.make("normalized");
    const left = createModelSelection(instanceId, "model", [
      { id: "tier", value: "priority" },
      { id: "effort", value: "low" },
    ]);
    const right = createModelSelection(instanceId, "model", [
      { id: "effort", value: "low" },
      { id: "tier", value: "priority" },
    ]);

    expect(normalizedModelSelectionKey(left)).toBe(normalizedModelSelectionKey(right));
    expect(normalizedModelSelectionKey(createModelSelection(instanceId, "model"))).toBe(
      normalizedModelSelectionKey({
        instanceId,
        model: "model",
        options: [],
      }),
    );
  });
});
