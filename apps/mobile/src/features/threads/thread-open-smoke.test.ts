import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationSubagentDetail,
  type OrchestrationSubagentSummary,
  type OrchestrationThread,
} from "@t3tools/contracts";

import { buildThreadFeed, deriveThreadFeedPresentation } from "../../lib/threadActivity";
import {
  deriveMobileSubagentGroups,
  deriveMobileSubagentTranscript,
} from "./subagent-presentation";
import { projectThreadContentPresentation } from "./threadContentPresentation";

const STARTED_AT = "2026-08-15T10:00:00.000Z";
const TURN_ID = TurnId.make("turn-mobile-smoke");

function subagent(
  input: Partial<OrchestrationSubagentSummary> &
    Pick<OrchestrationSubagentSummary, "id" | "status" | "updatedAt">,
): OrchestrationSubagentSummary {
  return {
    origin: "provider-native",
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerDriver: ProviderDriverKind.make("codex"),
    providerThreadId: `provider-${input.id}`,
    parentId: null,
    path: null,
    name: String(input.id),
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 0,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: STARTED_AT,
    completedAt: null,
    ...input,
  };
}

function populatedThread(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
): OrchestrationThread {
  return {
    id: ThreadId.make("thread-mobile-smoke"),
    projectId: ProjectId.make("project-mobile-smoke"),
    title: "Mobile smoke thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/workspace/mobile-smoke",
    latestTurn: {
      turnId: TURN_ID,
      state: "running",
      requestedAt: STARTED_AT,
      startedAt: STARTED_AT,
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: STARTED_AT,
    updatedAt: "2026-08-15T10:00:04.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("message-user"),
        role: "user",
        text: "Open this populated thread",
        turnId: TURN_ID,
        streaming: false,
        createdAt: "2026-08-15T10:00:01.000Z",
        updatedAt: "2026-08-15T10:00:01.000Z",
      },
      {
        id: MessageId.make("message-assistant"),
        role: "assistant",
        text: "Working on it",
        turnId: TURN_ID,
        streaming: true,
        createdAt: "2026-08-15T10:00:04.000Z",
        updatedAt: "2026-08-15T10:00:04.000Z",
      },
    ],
    proposedPlans: [
      {
        id: "plan-mobile-smoke",
        turnId: TURN_ID,
        planMarkdown: "# Mobile smoke plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-08-15T10:00:02.000Z",
        updatedAt: "2026-08-15T10:00:02.000Z",
      },
    ],
    activities: [
      {
        id: EventId.make("activity-mobile-smoke"),
        tone: "tool",
        kind: "tool.completed",
        summary: "Read thread state",
        payload: {
          title: "Read thread state",
          itemType: "command_execution",
          detail: "inspect thread",
        },
        turnId: TURN_ID,
        createdAt: "2026-08-15T10:00:03.000Z",
      },
    ],
    subagents,
    checkpoints: [],
    session: null,
  };
}

function withoutHermesUnsupportedArrayMethods<T>(run: () => T): T {
  const methods = ["toReversed", "toSorted", "toSpliced"] as const;
  const descriptors = methods.map(
    (method) => [method, Object.getOwnPropertyDescriptor(Array.prototype, method)] as const,
  );
  for (const method of methods) {
    Reflect.deleteProperty(Array.prototype, method);
  }

  try {
    return run();
  } finally {
    for (const [method, descriptor] of descriptors) {
      if (descriptor !== undefined) {
        Reflect.defineProperty(Array.prototype, method, descriptor);
      }
    }
  }
}

describe("mobile populated-thread smoke", () => {
  it("opens and projects a busy thread when Hermes lacks change-by-copy array methods", () => {
    const running = subagent({
      id: SubagentId.make("subagent-running"),
      nickname: "Running agent",
      status: "running",
      updatedAt: "2026-08-15T10:00:04.000Z",
    });
    const completed = subagent({
      id: SubagentId.make("subagent-completed"),
      nickname: "Completed agent",
      status: "completed",
      updatedAt: "2026-08-15T10:00:05.000Z",
      completedAt: "2026-08-15T10:00:05.000Z",
    });
    const detail: OrchestrationSubagentDetail = {
      ...running,
      messages: [
        {
          id: MessageId.make("subagent-message"),
          role: "assistant",
          text: "Subagent output",
          turnId: TURN_ID,
          streaming: false,
          createdAt: "2026-08-15T10:00:01.000Z",
          updatedAt: "2026-08-15T10:00:01.000Z",
        },
      ],
      proposedPlans: [
        {
          id: "subagent-plan",
          turnId: TURN_ID,
          planMarkdown: "# Subagent plan",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-08-15T10:00:02.000Z",
          updatedAt: "2026-08-15T10:00:02.000Z",
        },
      ],
      activities: [
        {
          id: EventId.make("subagent-activity"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Subagent completed work",
          payload: {},
          turnId: TURN_ID,
          createdAt: "2026-08-15T10:00:03.000Z",
        },
      ],
    };
    const thread = populatedThread([completed, running]);

    const projected = withoutHermesUnsupportedArrayMethods(() => {
      const feed = buildThreadFeed(thread);
      return {
        content: projectThreadContentPresentation({
          hasDetail: true,
          detailError: null,
          detailDeleted: false,
          connectionState: "reconnecting",
        }),
        feed,
        presentedFeed: deriveThreadFeedPresentation(
          feed,
          thread.latestTurn,
          new Set([TURN_ID]),
          "current",
          new Set(),
          STARTED_AT,
        ),
        groups: deriveMobileSubagentGroups(
          thread.subagents,
          Date.parse("2026-08-15T10:00:10.000Z"),
        ),
        transcript: deriveMobileSubagentTranscript(detail),
      };
    });

    expect(projected.content).toEqual({ kind: "ready" });
    expect(projected.feed.map(({ type }) => type)).toEqual([
      "message",
      "proposed-plan",
      "activity-group",
      "message",
    ]);
    expect(projected.presentedFeed[projected.presentedFeed.length - 1]).toMatchObject({
      type: "working",
    });
    expect(projected.presentedFeed.map(({ type }) => type)).toEqual([
      "message",
      "proposed-plan",
      "work-summary",
      "message",
      "working",
    ]);
    expect(projected.groups.active.map(({ id }) => id)).toEqual([running.id]);
    expect(projected.groups.recent.map(({ id }) => id)).toEqual([completed.id]);
    expect(projected.transcript.map(({ type }) => type)).toEqual([
      "message",
      "proposed-plan",
      "activity",
    ]);
    expect(thread.subagents.map(({ id }) => id)).toEqual([completed.id, running.id]);
  });
});
