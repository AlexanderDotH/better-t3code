import {
  CommandId,
  DeepPlanRunId,
  EnvironmentId,
  MessageId,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanRun,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildQueuedDeepPlanStartCommand } from "./deep-planning-delivery";
import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  resolveThreadOutboxDeliveryAction,
  type QueuedThreadMessage,
} from "./thread-outbox-model";

const environmentId = EnvironmentId.make("mobile-owner");
const projectId = ProjectId.make("project-owner");
const threadId = ThreadId.make("new-deep-owner");
const createdAt = "2026-10-16T10:00:00.000Z";
const modelSelection = { instanceId: ProviderInstanceId.make("provider"), model: "model" };
const capabilities: ExecutionEnvironmentCapabilities = {
  repositoryIdentity: false,
  midChatProviderSwitching: false,
  deepPlanning: { version: 2 },
};
const provider: ServerProvider = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("custom-provider"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: createdAt,
  models: [],
  slashCommands: [],
  skills: [],
  deepPlanning: { version: 1, structuredPlans: true, durableExecution: true },
};
const remoteChat = {
  environmentId: EnvironmentId.make("mobile-source"),
  projectId: ProjectId.make("project-source"),
  threadId: ThreadId.make("remote-chat"),
};
const legacyReference = {
  threadId,
  planId: PlanId.make("deep-plan-3"),
  deepPlan: { runId: DeepPlanRunId.make("approved-run"), planVersion: 3 },
};

function queuedMessage(overrides?: Partial<QueuedThreadMessage>): QueuedThreadMessage {
  return {
    environmentId,
    threadId,
    messageId: MessageId.make("queued-deep-analysis"),
    commandId: CommandId.make("queued-deep-command"),
    text: "Explore the project",
    attachments: [],
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "plan",
    composerMode: "deep-plan",
    deepPlanSourceRefs: [remoteChat],
    creation: { projectId, workspaceMode: "local", branch: null, worktreePath: null },
    createdAt,
    ...overrides,
  };
}

function persistedMessage(message: QueuedThreadMessage): QueuedThreadMessage {
  return decodeQueuedThreadMessage(JSON.parse(JSON.stringify(encodeQueuedThreadMessage(message))));
}

describe("mobile Deep Planning outbox", () => {
  it.each([undefined, false, true])(
    "builds the same start command after an outbox restart with project chats set to %s",
    (includeProjectChats) => {
      const message = persistedMessage(
        queuedMessage({ deepPlanIncludeProjectChats: includeProjectChats }),
      );
      const input = { message, capabilities, provider };
      const start = buildQueuedDeepPlanStartCommand(input);
      expect(start).toEqual({
        type: "thread.deep-plan.start",
        commandId: `${message.commandId}:deep-plan-start`,
        threadId,
        createdAt,
        chats: [remoteChat],
        includeProjectChats: includeProjectChats === true,
      });
      expect(start).toEqual(
        buildQueuedDeepPlanStartCommand({ ...input, message: persistedMessage(message) }),
      );
    },
  );

  it("uses the existing run for a planning follow-up", () => {
    const currentRun: DeepPlanRun = {
      schemaVersion: 2,
      id: DeepPlanRunId.make("live-run"),
      threadId,
      phase: "awaitingApproval",
      revision: 2,
      plan: null,
      approval: null,
      approvalKey: null,
      chats: [remoteChat],
      includeProjectChats: false,
      steps: [],
      finalReview: {
        status: "pending",
        submission: null,
        reviews: [],
        roundLimit: 3,
        unsubmittedTurns: 0,
      },
      activeTurns: [],
      pause: null,
      operations: [],
      createdAt,
      updatedAt: createdAt,
    };
    expect(
      buildQueuedDeepPlanStartCommand({
        message: queuedMessage({ creation: undefined }),
        capabilities,
        provider,
        currentRun,
      }),
    ).toBeUndefined();
  });

  it("leaves ordinary messages on their normal path", () => {
    expect(
      buildQueuedDeepPlanStartCommand({
        message: queuedMessage({ composerMode: "plan" }),
        capabilities: { repositoryIdentity: false, midChatProviderSwitching: false },
        provider: undefined,
      }),
    ).toBeUndefined();
  });

  it("rejects an unsupported provider before building a start command", () => {
    expect(() =>
      buildQueuedDeepPlanStartCommand({
        message: queuedMessage(),
        capabilities,
        provider: { ...provider, deepPlanning: undefined },
      }),
    ).toThrow("Deep Planning is unavailable for this provider");
  });

  it.each([
    {
      name: "an empty Deep owner",
      deepPlanning: true,
      threadHasTurn: false,
      connected: true,
      shellStatus: "live" as const,
      expected: "send",
    },
    {
      name: "a delivered ordinary creation",
      deepPlanning: false,
      threadHasTurn: false,
      connected: true,
      shellStatus: "live" as const,
      expected: "remove",
    },
    {
      name: "a Deep owner whose turn already started",
      deepPlanning: true,
      threadHasTurn: true,
      connected: true,
      shellStatus: "live" as const,
      expected: "remove",
    },
    {
      name: "an offline empty Deep owner",
      deepPlanning: true,
      threadHasTurn: false,
      connected: false,
      shellStatus: "live" as const,
      expected: "wait",
    },
    {
      name: "an empty Deep owner before shell synchronization",
      deepPlanning: true,
      threadHasTurn: false,
      connected: true,
      shellStatus: "synchronizing" as const,
      expected: "wait",
    },
  ])("handles $name", ({ deepPlanning, threadHasTurn, connected, shellStatus, expected }) => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: true,
        deepPlanning,
        threadHasTurn,
        shellStatus,
        environmentConnected: connected,
      }),
    ).toBe(expected);
  });

  it("decodes a queued legacy implementation without starting it as an ordinary turn", () => {
    const implementation = queuedMessage({
      composerMode: "default",
      interactionMode: "default",
      creation: undefined,
      sourceProposedPlan: legacyReference,
    });
    const message = persistedMessage(implementation);
    expect(message).toEqual(implementation);
    expect(() => buildQueuedDeepPlanStartCommand({ message, capabilities, provider })).toThrow(
      "started in an earlier version",
    );
  });
});
