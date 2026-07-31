import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import {
  OrchestrationProposedPlanId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  PlanParallelismReviewError,
  ProjectId,
  ProviderInstanceId,
  type ServerProvider,
  TextGenerationError,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  TextGeneration,
  type PlanParallelismReviewGenerationInput,
} from "../textGeneration/TextGeneration.ts";
import {
  PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS,
  PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS,
} from "../textGeneration/TextGenerationPrompts.ts";
import {
  layer as PlanParallelismReviewLayer,
  PlanParallelismReview,
} from "./PlanParallelismReview.ts";

const threadId = ThreadId.make("thread-review");
const projectId = ProjectId.make("project-review");
const planId = OrchestrationProposedPlanId.make("plan-review");
const planTurnId = TurnId.make("turn-plan");
const planUpdatedAt = "2026-07-31T12:00:00.000Z";
const reviewerId = ProviderInstanceId.make("claude_reviewer");
const implementationProviderId = ProviderInstanceId.make("codex_implementation");

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: threadId,
    projectId,
    title: "Review this plan",
    modelSelection: { instanceId: implementationProviderId, model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: "/repo/worktree",
    latestTurn: null,
    createdAt: planUpdatedAt,
    updatedAt: planUpdatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: planUpdatedAt,
    deletedAt: null,
    messages: [
      {
        id: "message-other" as never,
        role: "user",
        text: "Ignore this earlier request.",
        turnId: TurnId.make("turn-other"),
        streaming: false,
        createdAt: planUpdatedAt,
        updatedAt: planUpdatedAt,
      },
      {
        id: "message-plan" as never,
        role: "user",
        text: `${"r".repeat(PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS)}REQUEST_TAIL`,
        turnId: planTurnId,
        streaming: false,
        createdAt: planUpdatedAt,
        updatedAt: planUpdatedAt,
      },
    ],
    proposedPlans: [
      {
        id: planId,
        turnId: planTurnId,
        planMarkdown: `${"p".repeat(PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS)}PLAN_TAIL`,
        implementedAt: null,
        implementationThreadId: null,
        createdAt: planUpdatedAt,
        updatedAt: planUpdatedAt,
      },
    ],
    activities: [],
    subagents: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } as OrchestrationThread;
}

function makeProject(): OrchestrationProjectShell {
  return {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    defaultModelSelection: null,
    scripts: [],
    createdAt: planUpdatedAt,
    updatedAt: planUpdatedAt,
  };
}

function makeProviderInstance(input: {
  readonly instanceId: typeof reviewerId;
  readonly driverKind: string;
  readonly maxSubagents?: number | undefined;
}): ProviderInstance {
  const snapshot = {
    instanceId: input.instanceId,
    driver: input.driverKind,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: planUpdatedAt,
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.maxSubagents === undefined
      ? {}
      : {
          nativeSubagents: {
            toolName: "spawn_agent",
            maxRecommendedSubagents: input.maxSubagents,
          },
        }),
  } as unknown as ServerProvider;
  return {
    instanceId: input.instanceId,
    driverKind: input.driverKind as never,
    continuationIdentity: {
      driverKind: input.driverKind as never,
      continuationKey: `${input.driverKind}:${input.instanceId}`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {
      maintenanceCapabilities: {},
      getSnapshot: Effect.succeed(snapshot),
      refresh: Effect.succeed(snapshot),
      streamChanges: Effect.die("unused") as never,
    },
    adapter: {} as never,
    textGeneration: {} as never,
  };
}

function makeLayer(input: {
  readonly thread?: OrchestrationThread | undefined;
  readonly reviewerDriverKind?: string | undefined;
  readonly implementationMaxSubagents?: number | undefined;
  readonly generate: (
    input: PlanParallelismReviewGenerationInput,
  ) => Effect.Effect<{ readonly recommendedSubagents: number }, TextGenerationError>;
}) {
  const thread = input.thread ?? makeThread();
  const reviewer = makeProviderInstance({
    instanceId: reviewerId,
    driverKind: input.reviewerDriverKind ?? "claudeAgent",
  });
  const implementation = makeProviderInstance({
    instanceId: implementationProviderId,
    driverKind: "codex",
    maxSubagents: input.implementationMaxSubagents,
  });
  const instances = new Map([
    [reviewer.instanceId, reviewer],
    [implementation.instanceId, implementation],
  ]);

  return PlanParallelismReviewLayer.pipe(
    Layer.provideMerge(
      Layer.mock(ProjectionSnapshotQuery, {
        getThreadDetailById: () => Effect.succeed(Option.some(thread)),
        getProjectShellById: () => Effect.succeed(Option.some(makeProject())),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProviderInstanceRegistry, {
        getInstance: (instanceId) => Effect.succeed(instances.get(instanceId)),
      }),
    ),
    Layer.provideMerge(
      ServerSettingsService.layerTest({
        parallelPlanReviewModelSelection: {
          instanceId: reviewerId,
          model: "claude-fable-5",
          options: [{ id: "effort", value: "low" }],
        },
      }),
    ),
    Layer.provideMerge(
      Layer.mock(TextGeneration, {
        reviewPlanParallelism: input.generate,
      }),
    ),
  );
}

const request = {
  threadId,
  planId,
  expectedPlanUpdatedAt: planUpdatedAt,
  implementationProviderInstanceId: implementationProviderId,
} as const;

describe("PlanParallelismReview", () => {
  it.effect("loads canonical context, truncates it, and uses the selected reviewer", () => {
    let generatedInput: PlanParallelismReviewGenerationInput | undefined;
    const layer = makeLayer({
      implementationMaxSubagents: 12,
      generate: (input) =>
        Effect.sync(() => {
          generatedInput = input;
          return { recommendedSubagents: 7 };
        }),
    });

    return Effect.gen(function* () {
      const review = yield* PlanParallelismReview;
      const result = yield* review.review(request);

      expect(result).toEqual({
        planId,
        planUpdatedAt,
        implementationProviderInstanceId: implementationProviderId,
        recommendedSubagents: 7,
      });
      expect(generatedInput?.cwd).toBe("/repo/worktree");
      expect(generatedInput?.modelSelection).toEqual({
        instanceId: reviewerId,
        model: "claude-fable-5",
        options: [{ id: "effort", value: "low" }],
      });
      expect(generatedInput?.maxSubagents).toBe(12);
      expect(generatedInput?.planMarkdown).toHaveLength(PLAN_PARALLELISM_REVIEW_PLAN_MAX_CHARS);
      expect(generatedInput?.userRequest).toHaveLength(PLAN_PARALLELISM_REVIEW_REQUEST_MAX_CHARS);
      expect(generatedInput?.planMarkdown).not.toContain("PLAN_TAIL");
      expect(generatedInput?.userRequest).not.toContain("REQUEST_TAIL");
      expect(generatedInput?.userRequest).not.toContain("Ignore this earlier request.");
    }).pipe(Effect.provide(layer));
  });

  it.effect("uses the project root and omits request context when the plan has no turn", () => {
    const baseThread = makeThread();
    const plan = baseThread.proposedPlans[0]!;
    let generatedInput: PlanParallelismReviewGenerationInput | undefined;
    const layer = makeLayer({
      thread: makeThread({
        worktreePath: null,
        proposedPlans: [{ ...plan, turnId: null, planMarkdown: "## Plan" }],
      }),
      implementationMaxSubagents: 8,
      generate: (input) =>
        Effect.sync(() => {
          generatedInput = input;
          return { recommendedSubagents: 4 };
        }),
    });

    return Effect.gen(function* () {
      const review = yield* PlanParallelismReview;
      yield* review.review(request);

      expect(generatedInput?.cwd).toBe("/repo");
      expect(generatedInput?.userRequest).toBeUndefined();
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects stale plans before starting generation", () => {
    let generationStarted = false;
    const layer = makeLayer({
      implementationMaxSubagents: 8,
      generate: () =>
        Effect.sync(() => {
          generationStarted = true;
          return { recommendedSubagents: 4 };
        }),
    });

    return Effect.gen(function* () {
      const review = yield* PlanParallelismReview;
      const error = yield* Effect.flip(
        review.review({ ...request, expectedPlanUpdatedAt: "2026-07-31T12:00:01.000Z" }),
      );

      expect(error).toBeInstanceOf(PlanParallelismReviewError);
      expect(error.reason).toBe("plan-stale");
      expect(generationStarted).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.effect("maps missing plans and provider generation failures to stable reasons", () => {
    const missingPlanLayer = makeLayer({
      thread: makeThread({ proposedPlans: [] }),
      implementationMaxSubagents: 8,
      generate: () => Effect.succeed({ recommendedSubagents: 4 }),
    });
    const failedGenerationLayer = makeLayer({
      implementationMaxSubagents: 8,
      generate: () =>
        Effect.fail(
          new TextGenerationError({
            operation: "reviewPlanParallelism",
            detail: "provider failed",
          }),
        ),
    });

    return Effect.gen(function* () {
      const missingPlan = yield* Effect.gen(function* () {
        const review = yield* PlanParallelismReview;
        return yield* Effect.flip(review.review(request));
      }).pipe(Effect.provide(missingPlanLayer));
      const failedGeneration = yield* Effect.gen(function* () {
        const review = yield* PlanParallelismReview;
        return yield* Effect.flip(review.review(request));
      }).pipe(Effect.provide(failedGenerationLayer));

      expect(missingPlan.reason).toBe("plan-not-found");
      expect(failedGeneration.reason).toBe("generation-failed");
    });
  });

  it.effect(
    "rejects disallowed reviewer drivers and implementation providers without a cap",
    () => {
      const disallowedReviewerLayer = makeLayer({
        reviewerDriverKind: "gemini",
        implementationMaxSubagents: 8,
        generate: () => Effect.succeed({ recommendedSubagents: 4 }),
      });
      const unsupportedImplementationLayer = makeLayer({
        generate: () => Effect.succeed({ recommendedSubagents: 4 }),
      });

      return Effect.gen(function* () {
        const disallowedReviewer = yield* Effect.gen(function* () {
          const review = yield* PlanParallelismReview;
          return yield* Effect.flip(review.review(request));
        }).pipe(Effect.provide(disallowedReviewerLayer));
        const unsupportedImplementation = yield* Effect.gen(function* () {
          const review = yield* PlanParallelismReview;
          return yield* Effect.flip(review.review(request));
        }).pipe(Effect.provide(unsupportedImplementationLayer));

        expect(disallowedReviewer.reason).toBe("reviewer-unavailable");
        expect(unsupportedImplementation.reason).toBe("implementation-provider-unsupported");
      });
    },
  );

  it.effect("rejects a generated count above the provider ceiling", () => {
    const layer = makeLayer({
      implementationMaxSubagents: 8,
      generate: () => Effect.succeed({ recommendedSubagents: 9 }),
    });

    return Effect.gen(function* () {
      const review = yield* PlanParallelismReview;
      const error = yield* Effect.flip(review.review(request));

      expect(error.reason).toBe("invalid-output");
    }).pipe(Effect.provide(layer));
  });

  it.effect("interrupts generation at twenty seconds and returns a timeout", () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>();
      const layer = makeLayer({
        implementationMaxSubagents: 8,
        generate: () =>
          Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
          ),
      });
      const fiber = yield* Effect.gen(function* () {
        const review = yield* PlanParallelismReview;
        return yield* review.review(request);
      }).pipe(Effect.provide(layer), Effect.forkChild);

      yield* TestClock.adjust("20 seconds");
      const error = yield* Fiber.join(fiber).pipe(Effect.flip);
      yield* Deferred.await(interrupted);

      expect(error.reason).toBe("timeout");
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
