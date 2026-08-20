import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProposedPlan,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  resolveMobilePlanParallelismReviewDescriptor,
  validateMobilePlanParallelismReview,
} from "./plan-parallelism-review";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  availability: "available",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-13T10:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 4 },
};
const plan: OrchestrationProposedPlan = {
  id: "plan-1",
  turnId: null,
  planMarkdown: "# Plan",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

describe("mobile plan parallelism review", () => {
  it("uses a ready reviewer and rejects stale or oversized responses", () => {
    const descriptor = resolveMobilePlanParallelismReviewDescriptor({
      enabled: true,
      threadId: ThreadId.make("thread-1"),
      plan,
      implementationProvider: provider,
      reviewerSelection: { instanceId: provider.instanceId, model: "gpt-5.6-sol" },
      providers: [provider],
    });
    expect(descriptor).not.toBeNull();
    if (!descriptor) return;
    expect(
      validateMobilePlanParallelismReview(descriptor, {
        planId: plan.id,
        planUpdatedAt: plan.updatedAt,
        implementationProviderInstanceId: provider.instanceId,
        recommendedSubagents: 3,
      }),
    ).toBe(3);
    expect(
      validateMobilePlanParallelismReview(descriptor, {
        planId: plan.id,
        planUpdatedAt: plan.updatedAt,
        implementationProviderInstanceId: provider.instanceId,
        recommendedSubagents: 5,
      }),
    ).toBeNull();
  });

  it("falls back when the reviewer is unavailable", () => {
    expect(
      resolveMobilePlanParallelismReviewDescriptor({
        enabled: true,
        threadId: ThreadId.make("thread-1"),
        plan,
        implementationProvider: provider,
        reviewerSelection: { instanceId: provider.instanceId, model: "gpt-5.6-sol" },
        providers: [
          {
            ...provider,
            enabled: false,
            installed: false,
            status: "disabled",
            availability: "unavailable",
          },
        ],
      }),
    ).toBeNull();
  });
});
