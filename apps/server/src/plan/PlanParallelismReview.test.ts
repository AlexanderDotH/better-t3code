import { expect, it } from "@effect/vitest";
import {
  DeepPlanRunId,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type PlanParallelismReviewInput,
} from "@t3tools/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PlanReview from "./PlanParallelismReview.ts";

const threadId = ThreadId.make("deep-plan-owner");
const projectId = ProjectId.make("project");
const instanceId = ProviderInstanceId.make("codex");
const updatedAt = "2026-10-16T08:00:00.000Z";

function runFixture(): DeepPlanRun {
  return {
    id: DeepPlanRunId.make("deep-plan-run"),
    threadId,
    phase: "awaitingApproval",
    revision: 4,
    plan: {
      schemaVersion: 1,
      version: 2,
      goal: "Preserve the reviewed plan",
      scope: ["Saved chat"],
      decisions: [],
      affectedAreas: ["Planning"],
      steps: [
        {
          id: "implementation",
          title: "Implement the workflow",
          description: "Preserve frozen inputs",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "check",
              description: "Inputs remain frozen",
              checkMethod: "Run regression tests",
            },
          ],
        },
      ],
      finalValidation: {
        description: "Check the whole workflow",
        checkMethod: "Run integration tests",
      },
    },
    approval: null,
    approvalKey: "approval",
    sources: [],
    sourceCoverage: [],
    stepStates: [],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 0,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt: updatedAt,
    updatedAt,
    pauseReason: null,
  };
}

function request(run: DeepPlanRun) {
  return {
    threadId,
    planId: PlanId.make(`deep-plan:${run.id}:${run.plan!.version}`),
    deepPlan: { runId: run.id, planVersion: run.plan!.version },
    expectedPlanUpdatedAt: run.updatedAt,
    implementationProviderInstanceId: instanceId,
  };
}

function dependencies(
  readRun: () => DeepPlanRun,
  generate: TextGeneration.TextGeneration["Service"]["reviewPlanParallelism"],
) {
  return Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadRecords: () =>
        Effect.succeed({
          thread: { id: threadId, projectId, worktreePath: null, deepPlan: readRun() },
          plans: [],
          messages: [],
          turnItems: [],
        } as never),
      getThreadShell: () =>
        Effect.succeed({ id: threadId, projectId, deepPlan: readRun() } as never),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      getShell: () => Effect.succeedSome({ workspaceRoot: "/workspace/planning" } as never),
    }),
    Layer.mock(ProviderRegistry.ProviderInstanceRegistry)({
      getInstance: () =>
        Effect.succeed({
          enabled: true,
          driverKind: "codex",
          snapshot: {
            getSnapshot: Effect.succeed({
              nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 8 },
            }),
          },
        } as never),
    }),
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
    }),
    Layer.mock(TextGeneration.TextGeneration)({ reviewPlanParallelism: generate }),
  );
}

it.effect(
  "reviews a frozen DeepPlan without an ordinary proposal and rejects stale or foreign references",
  () =>
    Effect.gen(function* () {
      const run = runFixture();
      const generated: Array<
        Parameters<TextGeneration.TextGeneration["Service"]["reviewPlanParallelism"]>[0]
      > = [];
      const service = yield* PlanReview.make.pipe(
        Effect.provide(
          dependencies(
            () => run,
            (input) =>
              Effect.sync(() => {
                generated.push(input);
                return { recommendedSubagents: 3 };
              }),
          ),
        ),
      );
      const input = request(run);
      const result = yield* service.review(input);
      expect(result).toMatchObject({
        planId: input.planId,
        recommendedSubagents: 3,
        planUpdatedAt: updatedAt,
      });
      expect(generated[0]?.planMarkdown).toContain("Preserve frozen inputs");
      expect(generated[0]?.planMarkdown).toContain("Inputs remain frozen");
      for (const stale of [
        { ...input, deepPlan: { ...input.deepPlan, runId: DeepPlanRunId.make("other-run") } },
        { ...input, deepPlan: { ...input.deepPlan, planVersion: 1 } },
        { ...input, expectedPlanUpdatedAt: "2026-10-15T08:00:00.000Z" },
        { ...input, threadId: ThreadId.make("other-owner") },
      ] satisfies PlanParallelismReviewInput[]) {
        const failure = yield* service.review(stale).pipe(Effect.flip);
        expect(["plan-not-found", "plan-stale"]).toContain(failure.reason);
      }
      expect(generated).toHaveLength(1);
    }),
);

it.effect("rejects a DeepPlan revision replaced while its reviewer is responding", () =>
  Effect.gen(function* () {
    let run = runFixture();
    const started = yield* Deferred.make<void>();
    const response = yield* Deferred.make<{ recommendedSubagents: number }>();
    const service = yield* PlanReview.make.pipe(
      Effect.provide(
        dependencies(
          () => run,
          () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Deferred.await(response);
            }),
        ),
      ),
    );
    const review = yield* service.review(request(run)).pipe(Effect.flip, Effect.forkChild);
    yield* Effect.raceFirst(
      Deferred.await(started),
      Fiber.join(review).pipe(Effect.flatMap((failure) => Effect.fail(failure))),
    );
    run = { ...run, plan: { ...run.plan!, version: 3 }, updatedAt: "2026-10-16T08:01:00.000Z" };
    yield* Deferred.succeed(response, { recommendedSubagents: 4 });
    expect((yield* Fiber.join(review)).reason).toBe("plan-stale");
  }),
);
