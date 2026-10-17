import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DeepPlanRunId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
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
    pullRequests: [],
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

  it("names a ready Deep Plan in the current language and keeps approval priority", () => {
    const baseThread = makeStartingThread(null);
    const thread: EnvironmentThreadShell = {
      ...baseThread,
      interactionMode: "plan",
      session: null,
      hasActionableProposedPlan: true,
      latestTurn: {
        turnId: TurnId.make("plan"),
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        assistantMessageId: null,
      },
      deepPlan: {
        id: DeepPlanRunId.make("deep-plan"),
        threadId: baseThread.id,
        phase: "awaitingApproval",
        revision: 1,
        plan: null,
        approval: null,
        approvalKey: null,
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
        createdAt: now,
        updatedAt: now,
        pauseReason: null,
      },
    };
    expect(resolveThreadStatus(thread)).toMatchObject({
      kind: "plan-ready",
      label: "Deep Plan ready",
      textClassName: "text-adaptive-orange-700-400",
    });
    const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    expect(resolveThreadStatus(thread, german)?.label).toBe("Deep Plan bereit");
    expect(resolveThreadStatus({ ...thread, deepPlan: null }, german)?.label).toBe("Plan bereit");
    expect(resolveThreadStatus({ ...thread, hasPendingApprovals: true })?.kind).toBe(
      "pending-approval",
    );
  });

  it("keeps connecting for a starting session with no active background work", () => {
    expect(resolveThreadStatus(makeStartingThread(null))).toMatchObject({
      kind: "connecting",
      label: "Connecting",
      pulse: true,
    });
  });
});
