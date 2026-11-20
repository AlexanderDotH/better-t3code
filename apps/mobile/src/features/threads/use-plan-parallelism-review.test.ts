import type { MobileProposedPlan } from "./plan-parallelism-review";
import { describe, expect, it } from "vite-plus/test";
import {
  DeepPlanRunId,
  EnvironmentId,
  PlanId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";

import { resolveMobilePlanParallelismReviewDescriptor } from "./plan-parallelism-review";

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
const plan: MobileProposedPlan = {
  id: PlanId.make("plan-1"),
  turnId: null,
  planMarkdown: "# Plan",
  implementedAt: null,
  implementationThreadId: null,
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};
const threadId = ThreadId.make("thread-1");
const input = {
  enabled: true,
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  plan,
  implementationProvider: provider,
  reviewerSelection: { instanceId: provider.instanceId, model: "gpt-5.6-sol" },
  providers: [provider],
};
describe("mobile plan parallelism review", () => {
  it("uses a ready reviewer", () => {
    expect(resolveMobilePlanParallelismReviewDescriptor(input)).not.toBeNull();
  });

  it("keeps Deep Plan approval independent of the text reviewer", () => {
    expect(
      resolveMobilePlanParallelismReviewDescriptor({
        ...input,
        plan: { ...plan, deepPlan: { runId: DeepPlanRunId.make("deep-run"), planVersion: 2 } },
      }),
    ).toBeNull();
  });

  it("falls back when the reviewer is unavailable", () => {
    expect(
      resolveMobilePlanParallelismReviewDescriptor({
        ...input,
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
