import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadStatus } from "./threadPresentation";

const now = "2026-08-14T20:42:25.000Z";

function makeStartingThread(
  backgroundLiveness: EnvironmentThreadShell["backgroundLiveness"],
): EnvironmentThreadShell {
  const threadId = ThreadId.make("thread-fetch-parent");
  return {
    environmentId: EnvironmentId.make("environment-local"),
    id: threadId,
    projectId: ProjectId.make("project-better-t3code"),
    title: "Port Fork Features to Mobile",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId,
      status: "starting",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeSessionId: null,
      runtimeMode: "full-access",
      activeTurnId: null,
      abortState: null,
      lastError: null,
      updatedAt: now,
    },
    latestUserMessageAt: now,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    backgroundLiveness,
  };
}

describe("resolveThreadStatus", () => {
  it("shows working while background agents run before the main provider turn starts", () => {
    expect(resolveThreadStatus(makeStartingThread("working"))).toMatchObject({
      kind: "working",
      label: "Working",
      pulse: true,
    });
  });

  it("keeps connecting for a starting session with no active background work", () => {
    expect(resolveThreadStatus(makeStartingThread(null))).toMatchObject({
      kind: "connecting",
      label: "Connecting",
      pulse: true,
    });
  });
});
