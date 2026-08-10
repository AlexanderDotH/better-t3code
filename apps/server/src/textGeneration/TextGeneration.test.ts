import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as TextGeneration from "./TextGeneration.ts";

const makeStubTextGeneration = (
  overrides: Partial<TextGeneration.TextGeneration["Service"]>,
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () =>
      Effect.die("generateCommitMessage stub not configured for this test"),
    generatePrContent: () => Effect.die("generatePrContent stub not configured for this test"),
    generateBranchName: () => Effect.die("generateBranchName stub not configured for this test"),
    generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured for this test"),
    translateTranscriptToEnglish: () =>
      Effect.die("translateTranscriptToEnglish stub not configured for this test"),
    improvePrompt: () => Effect.die("improvePrompt stub not configured for this test"),
    reviewPlanParallelism: () =>
      Effect.die("reviewPlanParallelism stub not configured for this test"),
    planFetchExploration: () =>
      Effect.die("planFetchExploration stub not configured for this test"),
    ...overrides,
  });

const makeStubInstance = (
  instanceId: ProviderInstanceId,
  textGeneration: TextGeneration.TextGeneration["Service"],
): ProviderInstance =>
  ({
    instanceId,
    driverKind: instanceId as unknown as ProviderInstance["driverKind"],
    continuationIdentity: {
      driverKind: instanceId as unknown as ProviderInstance["driverKind"],
      continuationKey: `${instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {} as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    // Tests never drive changes through this stub; acquire a throwaway
    // subscription on an unused PubSub so the shape is satisfied.
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

describe("makeTextGenerationFromRegistry", () => {
  it.effect("delegates to the matching instance's textGeneration closure", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("codex_personal");
      const personalCalls: string[] = [];
      const personal = makeStubInstance(
        personalId,
        makeStubTextGeneration({
          generateBranchName: (input) => {
            personalCalls.push(input.message);
            return Effect.succeed({ branch: "personal-branch" });
          },
        }),
      );

      const workId = ProviderInstanceId.make("codex_work");
      const work = makeStubInstance(
        workId,
        makeStubTextGeneration({
          generateBranchName: () => Effect.succeed({ branch: "work-branch" }),
        }),
      );

      const tg = TextGeneration.makeTextGenerationFromRegistry(makeStubRegistry([personal, work]));

      const result = yield* tg.generateBranchName({
        cwd: process.cwd(),
        message: "Refactor the routing layer",
        modelSelection: createModelSelection(ProviderInstanceId.make("codex_personal"), "gpt-5"),
      });

      expect(result.branch).toBe("personal-branch");
      expect(personalCalls).toEqual(["Refactor the routing layer"]);
    }),
  );

  it.effect("routes transcript translation and prompt improvement to the selected instance", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("claude_personal");
      const calls: string[] = [];
      const personal = makeStubInstance(
        personalId,
        makeStubTextGeneration({
          translateTranscriptToEnglish: (input) => {
            calls.push(`translate:${input.text}`);
            return Effect.succeed({ text: "Update useThreadOutbox." });
          },
          improvePrompt: (input) => {
            calls.push(`improve:${input.text}`);
            return Effect.succeed({ text: "Clarify the reconnect requirements." });
          },
        }),
      );
      const work = makeStubInstance(
        ProviderInstanceId.make("claude_work"),
        makeStubTextGeneration({
          translateTranscriptToEnglish: () => Effect.succeed({ text: "wrong instance" }),
          improvePrompt: () => Effect.succeed({ text: "wrong instance" }),
        }),
      );
      const textGeneration = TextGeneration.makeTextGenerationFromRegistry(
        makeStubRegistry([personal, work]),
      );
      const modelSelection = createModelSelection(personalId, "claude-sonnet-4-6");

      const translated = yield* textGeneration.translateTranscriptToEnglish({
        cwd: process.cwd(),
        text: "Actualiza useThreadOutbox.",
        modelSelection,
      });
      const improved = yield* textGeneration.improvePrompt({
        cwd: process.cwd(),
        text: "Clarify reconnect.",
        modelSelection,
      });

      expect(translated).toEqual({ text: "Update useThreadOutbox." });
      expect(improved).toEqual({ text: "Clarify the reconnect requirements." });
      expect(calls).toEqual(["translate:Actualiza useThreadOutbox.", "improve:Clarify reconnect."]);
    }),
  );

  it.effect("routes plan parallelism review to the selected provider instance", () =>
    Effect.gen(function* () {
      const reviewerId = ProviderInstanceId.make("codex_reviewer");
      const calls: Array<{ readonly planMarkdown: string; readonly maxSubagents: number }> = [];
      const reviewer = makeStubInstance(
        reviewerId,
        makeStubTextGeneration({
          reviewPlanParallelism: (input) => {
            calls.push({
              planMarkdown: input.planMarkdown,
              maxSubagents: input.maxSubagents,
            });
            return Effect.succeed({ recommendedSubagents: 7 });
          },
        }),
      );
      const textGeneration = TextGeneration.makeTextGenerationFromRegistry(
        makeStubRegistry([reviewer]),
      );

      const generated = yield* textGeneration.reviewPlanParallelism({
        cwd: "/repo/worktree",
        planMarkdown: "## Server\nImplement the RPC.",
        userRequest: "Implement this plan.",
        maxSubagents: 8,
        modelSelection: createModelSelection(reviewerId, "gpt-5.6-luna"),
      });

      expect(generated).toEqual({ recommendedSubagents: 7 });
      expect(calls).toEqual([{ planMarkdown: "## Server\nImplement the RPC.", maxSubagents: 8 }]);
    }),
  );

  it.effect("routes Fetch planning with the exact model selection and provider budget", () =>
    Effect.gen(function* () {
      const plannerId = ProviderInstanceId.make("claude_fetch");
      const calls: TextGeneration.FetchExplorationGenerationInput[] = [];
      const planner = makeStubInstance(
        plannerId,
        makeStubTextGeneration({
          planFetchExploration: (input) => {
            calls.push(input);
            return Effect.succeed({
              decision: "run",
              workers: [{ scope: "Server routing", questions: ["Where is routing decided?"] }],
            });
          },
        }),
      );
      const textGeneration = TextGeneration.makeTextGenerationFromRegistry(
        makeStubRegistry([planner]),
      );
      const modelSelection = createModelSelection(plannerId, "claude-opus-4-6", [
        { id: "effort", value: "high" },
      ]);

      const generated = yield* textGeneration.planFetchExploration({
        cwd: "/repo/worktree",
        userRequest: "Trace the routing path.",
        repositoryOrientation: "Top-level areas: apps/server",
        maxRecommendedWorkers: 10,
        modelSelection,
      });

      expect(generated).toEqual({
        decision: "run",
        workers: [{ scope: "Server routing", questions: ["Where is routing decided?"] }],
      });
      expect(calls).toEqual([
        {
          cwd: "/repo/worktree",
          userRequest: "Trace the routing path.",
          repositoryOrientation: "Top-level areas: apps/server",
          maxRecommendedWorkers: 10,
          modelSelection,
        },
      ]);
    }),
  );

  it.effect("fails with TextGenerationError when the instance is unknown", () =>
    Effect.gen(function* () {
      const tg = TextGeneration.makeTextGenerationFromRegistry(makeStubRegistry([]));

      const result = yield* tg
        .generateBranchName({
          cwd: process.cwd(),
          message: "anything",
          modelSelection: createModelSelection(
            ProviderInstanceId.make("missing_instance"),
            "gpt-5",
          ),
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("TextGenerationError");
        expect(result.failure.operation).toBe("generateBranchName");
        expect(result.failure.detail).toContain("missing_instance");
      }
    }),
  );
});
