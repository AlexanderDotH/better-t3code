import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildPlanParallelismReviewCacheKey,
  __resetPlanParallelismReviewCacheForTests,
  createPlanParallelismReviewRequest,
  requestPlanParallelismReview,
  resolvePlanParallelismReviewDescriptor,
  resolvePlanParallelismReviewSetup,
  validatePlanParallelismReviewResult,
} from "./usePlanParallelismReview";

const environmentId = EnvironmentId.make("environment-a");
const threadId = ThreadId.make("thread-a");
const implementationProviderInstanceId = ProviderInstanceId.make("codex");
const reviewerSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex-reviewer"),
  model: "gpt-5.6-luna",
  options: [
    { id: "service_tier", value: "priority" },
    { id: "reasoning_effort", value: "low" },
  ],
};

const descriptor = {
  environmentId,
  threadId,
  planId: "plan-a",
  planUpdatedAt: "2026-07-31T12:00:00.000Z",
  implementationProviderInstanceId,
  maxRecommendedSubagents: 12,
  reviewerSelection,
} as const;

function implementationProvider(withNativeSubagents = true): ServerProvider {
  return {
    instanceId: implementationProviderInstanceId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-31T12:00:00.000Z",
    ...(withNativeSubagents
      ? { nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 12 } }
      : {}),
    models: [],
    slashCommands: [],
    skills: [],
  };
}

function reviewerProvider(enabled = true): ServerProvider {
  return {
    ...implementationProvider(),
    instanceId: reviewerSelection.instanceId,
    enabled,
    nativeSubagents: undefined,
  };
}

beforeEach(() => {
  __resetPlanParallelismReviewCacheForTests();
});

describe("resolvePlanParallelismReviewDescriptor", () => {
  it("starts only for a settled enabled plan with native subagent support", () => {
    expect(
      resolvePlanParallelismReviewDescriptor({
        enabled: true,
        environmentId,
        threadId,
        plan: { id: "plan-a", updatedAt: "2026-07-31T12:00:00.000Z" },
        implementationProvider: implementationProvider(),
        reviewerProvider: reviewerProvider(),
        reviewerSelection,
      }),
    ).toEqual(descriptor);

    expect(
      resolvePlanParallelismReviewDescriptor({
        enabled: false,
        environmentId,
        threadId,
        plan: { id: "plan-a", updatedAt: "2026-07-31T12:00:00.000Z" },
        implementationProvider: implementationProvider(),
        reviewerProvider: reviewerProvider(),
        reviewerSelection,
      }),
    ).toBeNull();
    expect(
      resolvePlanParallelismReviewDescriptor({
        enabled: true,
        environmentId,
        threadId,
        plan: { id: "plan-a", updatedAt: "2026-07-31T12:00:00.000Z" },
        implementationProvider: implementationProvider(false),
        reviewerProvider: reviewerProvider(),
        reviewerSelection,
      }),
    ).toBeNull();
    expect(
      resolvePlanParallelismReviewDescriptor({
        enabled: true,
        environmentId,
        threadId,
        plan: { id: "plan-a", updatedAt: "2026-07-31T12:00:00.000Z" },
        implementationProvider: implementationProvider(),
        reviewerProvider: reviewerProvider(false),
        reviewerSelection,
      }),
    ).toBeNull();
    expect(
      resolvePlanParallelismReviewSetup({
        enabled: true,
        environmentId,
        threadId,
        plan: { id: "plan-a", updatedAt: "2026-07-31T12:00:00.000Z" },
        implementationProvider: implementationProvider(),
        reviewerProvider: reviewerProvider(false),
        reviewerSelection,
      }),
    ).toEqual({ descriptor: null, inactiveStatus: "fallback" });
    expect(
      resolvePlanParallelismReviewSetup({
        enabled: false,
        environmentId,
        threadId,
        plan: { id: "plan-a", updatedAt: "2026-07-31T12:00:00.000Z" },
        implementationProvider: implementationProvider(),
        reviewerProvider: reviewerProvider(),
        reviewerSelection,
      }),
    ).toEqual({ descriptor: null, inactiveStatus: "idle" });
  });
});

describe("createPlanParallelismReviewRequest", () => {
  it("sends only canonical plan and implementation-provider identifiers", () => {
    expect(createPlanParallelismReviewRequest(descriptor)).toEqual({
      threadId,
      planId: "plan-a",
      expectedPlanUpdatedAt: "2026-07-31T12:00:00.000Z",
      implementationProviderInstanceId,
    });
  });
});

describe("buildPlanParallelismReviewCacheKey", () => {
  it("changes for environment, plan version, provider capability, and reviewer selection", () => {
    const base = buildPlanParallelismReviewCacheKey(descriptor);

    expect(
      buildPlanParallelismReviewCacheKey({
        ...descriptor,
        environmentId: EnvironmentId.make("environment-b"),
      }),
    ).not.toBe(base);
    expect(
      buildPlanParallelismReviewCacheKey({
        ...descriptor,
        threadId: ThreadId.make("thread-b"),
      }),
    ).not.toBe(base);
    expect(buildPlanParallelismReviewCacheKey({ ...descriptor, planUpdatedAt: "later" })).not.toBe(
      base,
    );
    expect(
      buildPlanParallelismReviewCacheKey({
        ...descriptor,
        implementationProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
      }),
    ).not.toBe(base);
    expect(
      buildPlanParallelismReviewCacheKey({ ...descriptor, maxRecommendedSubagents: 13 }),
    ).not.toBe(base);
    expect(
      buildPlanParallelismReviewCacheKey({
        ...descriptor,
        reviewerSelection: { ...reviewerSelection, model: "another-model" },
      }),
    ).not.toBe(base);
  });

  it("is stable when equivalent reviewer options arrive in a different order", () => {
    expect(
      buildPlanParallelismReviewCacheKey({
        ...descriptor,
        reviewerSelection: {
          ...reviewerSelection,
          options: (reviewerSelection.options ?? []).toReversed(),
        },
      }),
    ).toBe(buildPlanParallelismReviewCacheKey(descriptor));
  });
});

describe("validatePlanParallelismReviewResult", () => {
  it("accepts the matching response within the implementation provider capability", () => {
    expect(
      validatePlanParallelismReviewResult(descriptor, {
        planId: "plan-a",
        planUpdatedAt: "2026-07-31T12:00:00.000Z",
        implementationProviderInstanceId,
        recommendedSubagents: 10,
      }),
    ).toBe(10);
  });

  it("discards stale, mismatched, and out-of-capability responses", () => {
    expect(
      validatePlanParallelismReviewResult(descriptor, {
        planId: "plan-a",
        planUpdatedAt: "stale",
        implementationProviderInstanceId,
        recommendedSubagents: 10,
      }),
    ).toBeNull();
    expect(
      validatePlanParallelismReviewResult(descriptor, {
        planId: "plan-a",
        planUpdatedAt: "2026-07-31T12:00:00.000Z",
        implementationProviderInstanceId: ProviderInstanceId.make("claudeAgent"),
        recommendedSubagents: 10,
      }),
    ).toBeNull();
    expect(
      validatePlanParallelismReviewResult(descriptor, {
        planId: "plan-a",
        planUpdatedAt: "2026-07-31T12:00:00.000Z",
        implementationProviderInstanceId,
        recommendedSubagents: 13,
      }),
    ).toBeNull();
  });
});

describe("requestPlanParallelismReview", () => {
  it("returns and caches a valid successful review", async () => {
    const review = vi.fn(async () => ({
      planId: "plan-a",
      planUpdatedAt: "2026-07-31T12:00:00.000Z",
      implementationProviderInstanceId,
      recommendedSubagents: 10,
    }));

    await expect(requestPlanParallelismReview(descriptor, review)).resolves.toEqual({
      status: "ready",
      reviewedSubagentCount: 10,
    });
    await expect(requestPlanParallelismReview(descriptor, review)).resolves.toEqual({
      status: "ready",
      reviewedSubagentCount: 10,
    });
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent reviews for the same plan version", async () => {
    let resolveReview!: (result: {
      planId: string;
      planUpdatedAt: string;
      implementationProviderInstanceId: ProviderInstanceId;
      recommendedSubagents: number;
    }) => void;
    const review = vi.fn(
      () =>
        new Promise<{
          planId: string;
          planUpdatedAt: string;
          implementationProviderInstanceId: ProviderInstanceId;
          recommendedSubagents: number;
        }>((resolve) => {
          resolveReview = resolve;
        }),
    );

    const first = requestPlanParallelismReview(descriptor, review);
    const second = requestPlanParallelismReview(descriptor, review);
    expect(review).toHaveBeenCalledTimes(1);

    resolveReview({
      planId: "plan-a",
      planUpdatedAt: "2026-07-31T12:00:00.000Z",
      implementationProviderInstanceId,
      recommendedSubagents: 10,
    });
    await expect(first).resolves.toEqual({ status: "ready", reviewedSubagentCount: 10 });
    await expect(second).resolves.toEqual({ status: "ready", reviewedSubagentCount: 10 });
  });

  it("falls back silently after generation failure or a stale response", async () => {
    await expect(
      requestPlanParallelismReview(descriptor, async () => {
        throw new Error("provider failed");
      }),
    ).resolves.toEqual({ status: "fallback", reviewedSubagentCount: null });

    await expect(
      requestPlanParallelismReview(descriptor, async () => ({
        planId: "plan-a",
        planUpdatedAt: "stale",
        implementationProviderInstanceId,
        recommendedSubagents: 10,
      })),
    ).resolves.toEqual({ status: "fallback", reviewedSubagentCount: null });
  });
});
