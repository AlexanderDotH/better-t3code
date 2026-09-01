import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  planFetchExploration,
  requestFetchExplorationPlan,
  validateFetchExplorationPlan,
} from "./FetchExplorationPlanner.ts";

const modelSelection = createModelSelection(
  ProviderInstanceId.make("claude_fetch"),
  "claude-opus-4-6",
  [{ id: "effort", value: "high" }],
);

const makeTextGeneration = (
  plan: TextGeneration.TextGeneration["Service"]["planFetchExploration"],
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () => Effect.die("unused"),
    generatePrContent: () => Effect.die("unused"),
    generateBranchName: () => Effect.die("unused"),
    generateThreadTitle: () => Effect.die("unused"),
    translateTranscriptToEnglish: () => Effect.die("unused"),
    improvePrompt: () => Effect.die("unused"),
    reviewPlanParallelism: () => Effect.die("unused"),
    planFetchExploration: plan,
  });

describe("validateFetchExplorationPlan", () => {
  it("accepts skip, one-worker, and full-budget plans", () => {
    expect(validateFetchExplorationPlan({ decision: "skip", workers: [] }, 8)).toEqual({
      decision: "skip",
      workers: [],
    });
    expect(
      validateFetchExplorationPlan(
        {
          decision: "run",
          workers: [{ scope: "Contracts", questions: ["Which schemas cross the wire?"] }],
        },
        8,
      ),
    ).toEqual({
      decision: "run",
      workers: [{ scope: "Contracts", questions: ["Which schemas cross the wire?"] }],
    });
    expect(
      validateFetchExplorationPlan(
        {
          decision: "run",
          workers: Array.from({ length: 8 }, (_, index) => ({
            scope: `Area ${index + 1}`,
            questions: [`What owns area ${index + 1}?`],
          })),
        },
        8,
      )?.workers,
    ).toHaveLength(8);
  });

  it("rejects empty, duplicate, malformed, and over-budget plans", () => {
    expect(validateFetchExplorationPlan({ decision: "run", workers: [] }, 8)).toBeNull();
    expect(
      validateFetchExplorationPlan(
        {
          decision: "run",
          workers: [
            { scope: "Server routing", questions: ["Where is it decided?"] },
            { scope: " server   routing ", questions: ["Which adapter owns it?"] },
          ],
        },
        8,
      ),
    ).toBeNull();
    expect(
      validateFetchExplorationPlan(
        { decision: "run", workers: [{ scope: "Server", questions: ["  "] }] },
        8,
      ),
    ).toBeNull();
    expect(
      validateFetchExplorationPlan(
        {
          decision: "run",
          workers: Array.from({ length: 9 }, (_, index) => ({
            scope: `Area ${index + 1}`,
            questions: ["What is here?"],
          })),
        },
        8,
      ),
    ).toBeNull();
    expect(validateFetchExplorationPlan({ decision: "skip", workers: [{}] }, 8)).toBeNull();
  });
});

it.effect("passes bounded orientation, exact model traits, and the advertised budget", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fetch-planner-" });
    yield* fileSystem.makeDirectory(`${cwd}/apps/server`, { recursive: true });
    yield* fileSystem.makeDirectory(`${cwd}/packages/contracts`, { recursive: true });
    yield* fileSystem.writeFileString(`${cwd}/package.json`, '{"name":"fixture"}');
    yield* fileSystem.writeFileString(
      `${cwd}/apps/server/fetchRouting.ts`,
      "export const fetchRouting = 'fetch routing';",
    );
    yield* fileSystem.writeFileString(
      `${cwd}/packages/contracts/fetchRouting.test.ts`,
      "test('fetch routing', () => {});",
    );
    const calls: TextGeneration.FetchExplorationGenerationInput[] = [];
    const textGeneration = makeTextGeneration((input) => {
      calls.push(input);
      return Effect.succeed({
        decision: "run",
        workers: [{ scope: "Fetch routing", questions: ["Where is Fetch routed?"] }],
      });
    });

    const outcome = yield* planFetchExploration({
      cwd,
      userRequest: `${"Trace fetch routing. ".repeat(1_000)}TAIL`,
      maxRecommendedWorkers: 10,
      modelSelection,
    }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));

    expect(outcome.fallbackReason).toBeNull();
    expect(outcome.plan.workers).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxRecommendedWorkers).toBe(10);
    expect(calls[0]?.modelSelection).toEqual(modelSelection);
    expect(calls[0]?.userRequest).toHaveLength(16_000);
    expect(calls[0]?.userRequest).toContain("[truncated]");
    expect(calls[0]?.repositoryOrientation).toContain("Top-level areas:");
    expect(calls[0]?.repositoryOrientation).toContain("apps");
    expect(calls[0]?.repositoryOrientation).toContain("package.json");
    expect(calls[0]?.repositoryOrientation).toContain("fetchRouting.test.ts");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("lets the main agent continue without workers after invalid output", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fetch-planner-invalid-" });
    const textGeneration = makeTextGeneration(() =>
      Effect.succeed({
        decision: "run",
        workers: [
          { scope: "duplicate", questions: ["First?"] },
          { scope: " Duplicate ", questions: ["Second?"] },
        ],
      }),
    );

    const outcome = yield* planFetchExploration({
      cwd,
      userRequest: "Inspect the repository.",
      maxRecommendedWorkers: 8,
      modelSelection,
    }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));

    expect(outcome.fallbackReason).toBe("invalid-plan");
    expect(outcome.plan).toEqual({ decision: "skip", workers: [] });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("lets the main agent continue without workers after planner failure", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fetch-planner-failed-" });
    const textGeneration = makeTextGeneration(() =>
      Effect.fail(new TextGenerationError({ operation: "planFetchExploration", detail: "failed" })),
    );

    const outcome = yield* planFetchExploration({
      cwd,
      userRequest: "Inspect the repository.",
      maxRecommendedWorkers: 8,
      modelSelection,
    }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));

    expect(outcome.fallbackReason).toBe("planner-failed");
    expect(outcome.plan).toEqual({ decision: "skip", workers: [] });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("lets the main agent continue without workers when planning reaches 20 seconds", () =>
  Effect.gen(function* () {
    const textGeneration = makeTextGeneration(() => Effect.never);
    const fiber = yield* requestFetchExplorationPlan({
      cwd: "/repo",
      userRequest: "Inspect the repository.",
      repositoryOrientation: "Repository orientation",
      maxRecommendedWorkers: 8,
      modelSelection,
    }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration), Effect.forkChild);

    yield* TestClock.adjust("20 seconds");
    const outcome = yield* Fiber.join(fiber);

    expect(outcome.fallbackReason).toBe("planner-failed");
    expect(outcome.plan).toEqual({ decision: "skip", workers: [] });
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect.each(["model-unavailable", "rate-limited"] as const)(
  "surfaces typed $0 failures so Auto Spark can retry Luna",
  (reason) =>
    Effect.gen(function* () {
      const unavailable = new TextGenerationError({
        operation: "planFetchExploration",
        detail: "not available",
        reason,
      });
      const textGeneration = makeTextGeneration(() => Effect.fail(unavailable));

      const outcome = yield* requestFetchExplorationPlan({
        cwd: "/repo",
        userRequest: "Inspect the repository.",
        repositoryOrientation: "Repository orientation",
        maxRecommendedWorkers: 8,
        modelSelection,
      }).pipe(Effect.provideService(TextGeneration.TextGeneration, textGeneration));

      expect(outcome.fallbackReason).toBe(reason);
    }),
);
