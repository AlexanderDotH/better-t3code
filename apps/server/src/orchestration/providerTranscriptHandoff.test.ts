import {
  CheckpointRef,
  EventId,
  MessageId,
  SubagentId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type ThreadForkHistory,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderForkTranscriptHandoff,
  buildProviderTranscriptHandoff,
  measureProviderForkHandoff,
} from "./providerTranscriptHandoff.ts";

const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  input?: Partial<OrchestrationMessage>,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text,
  turnId: null,
  streaming: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...input,
});

describe("buildProviderTranscriptHandoff", () => {
  it("keeps the goal, current state, latest exchange, and latest changed-file checkpoint", () => {
    const built = buildProviderTranscriptHandoff({
      messages: [
        message("system-1", "system", "SYSTEM_CONTEXT_MUST_NOT_LEAK"),
        message("goal", "user", "Implement compact handoffs", {
          attachments: [
            {
              type: "image",
              id: "goal-image",
              name: "goal.png",
              mimeType: "image/png",
              sizeBytes: 42,
            },
          ],
        }),
        message("old-assistant", "assistant", "OLD_ASSISTANT_TRANSCRIPT_MUST_NOT_LEAK"),
        message("latest-user", "user", "Keep exact checkpoint metadata"),
        message("latest-assistant", "assistant", "The parser is implemented but tests are open"),
        message("streaming", "assistant", "STREAMING_CONTENT_MUST_NOT_LEAK", {
          streaming: true,
        }),
        message("boundary", "user", "Continue"),
        message("later", "assistant", "LATER_CONTENT_MUST_NOT_LEAK"),
      ],
      boundaryMessageId: MessageId.make("boundary"),
      latestTurnState: "interrupted",
      checkpoints: [
        {
          turnId: TurnId.make("turn-checkpoint"),
          checkpointTurnCount: 3,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread/3"),
          status: "ready",
          files: [
            { path: "src/z.ts", kind: "modified", additions: 4, deletions: 1 },
            { path: "src/a.ts", kind: "added", additions: 8, deletions: 0 },
          ],
          assistantMessageId: MessageId.make("latest-assistant"),
          completedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(built.handoff).toContain("<t3code_context_handoff>");
    expect(built.handoff).toContain("[original-goal]\n[user]\nImplement compact handoffs");
    expect(built.handoff).toContain("latestTurn=interrupted; open=true");
    expect(built.handoff).toContain("[user]\nKeep exact checkpoint metadata\n[/user]");
    expect(built.handoff).toContain(
      "[assistant]\nThe parser is implemented but tests are open\n[/assistant]",
    );
    expect(built.handoff).toContain("status=ready; turn=3; ref=refs/t3/checkpoints/thread/3");
    expect(built.handoff.indexOf("src/a.ts")).toBeLessThan(built.handoff.indexOf("src/z.ts"));
    expect(built.attachments.map((attachment) => attachment.id)).toEqual(["goal-image"]);
    expect(built.handoff).not.toContain("SYSTEM_CONTEXT_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("OLD_ASSISTANT_TRANSCRIPT_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("STREAMING_CONTENT_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("LATER_CONTENT_MUST_NOT_LEAK");
  });

  it("bounds selected message text and is deterministic when the boundary is unknown", () => {
    const input = {
      messages: [message("user-1", "user", `goal ${"x".repeat(50_000)}`)],
      boundaryMessageId: MessageId.make("missing"),
    };

    const first = buildProviderTranscriptHandoff(input);
    const second = buildProviderTranscriptHandoff(input);

    expect(first).toEqual(second);
    expect(first.handoff).not.toContain("goal ");
    expect(first.handoff.length).toBeLessThan(2_000);
    expect(first.handoff).toContain("latestTurn=unknown; open=false");
    expect(first.handoff).toContain("[checkpoint]\nnone\n[/checkpoint]");
  });
});

describe("fork transcript handoff", () => {
  it("uses compact canonical context and never serializes tool activity or nested agent state", () => {
    const sourceThreadId = ThreadId.make("source-thread");
    const origin = (sourceId: string, ordinal: number) => ({
      sourceThreadId,
      sourceId,
      ordinal,
    });
    const history = {
      messages: [
        {
          ...message("goal", "user", "Inspect the renderer", {
            attachments: [
              {
                type: "image",
                id: "goal-image",
                name: "goal.png",
                mimeType: "image/png",
                sizeBytes: 42,
              },
            ],
          }),
          historyOrigin: origin("goal", 0),
        },
        {
          ...message("old-assistant", "assistant", "OLD_FORK_TRANSCRIPT_MUST_NOT_LEAK"),
          historyOrigin: origin("old-assistant", 1),
        },
        {
          ...message("latest-user", "user", "Keep the latest exchange exact"),
          historyOrigin: origin("latest-user", 5),
        },
        {
          ...message("latest-assistant", "assistant", "The latest exact answer", {
            attachments: [
              {
                type: "file",
                id: "latest-file",
                name: "result.txt",
                mimeType: "text/plain",
                sizeBytes: 12,
              },
            ],
          }),
          historyOrigin: origin("latest-assistant", 6),
        },
      ],
      proposedPlans: [
        {
          id: "plan-1",
          turnId: null,
          planMarkdown: "RAW_PLAN_MUST_NOT_LEAK",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          historyOrigin: origin("plan-1", 3),
        },
      ],
      activities: [
        {
          id: EventId.make("activity-1"),
          tone: "tool",
          kind: "tool.completed",
          summary: "RAW_TOOL_LOG_MUST_NOT_LEAK",
          payload: { nestedTranscript: "RAW_ACTIVITY_PAYLOAD_MUST_NOT_LEAK" },
          turnId: null,
          createdAt: "2026-01-01T00:00:00.500Z",
          historyOrigin: origin("activity-1", 2),
        },
      ],
      subagents: [
        {
          id: SubagentId.make("agent-1"),
          origin: "provider-native",
          providerInstanceId: null,
          providerDriver: null,
          providerThreadId: "provider-agent-1",
          parentId: null,
          path: null,
          name: "agent-1",
          nickname: null,
          role: null,
          task: "NESTED_AGENT_TRANSCRIPT_MUST_NOT_LEAK",
          model: null,
          reasoningEffort: null,
          depth: 1,
          status: "completed",
          statusMessage: null,
          latestProgress: null,
          latestTurn: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          historyOrigin: origin("agent-1", 4),
        },
      ],
      turns: [],
      checkpoints: [
        {
          turnId: TurnId.make("turn-1"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/source/1"),
          status: "ready",
          files: [{ path: "src/index.ts", kind: "modified", additions: 2, deletions: 1 }],
          assistantMessageId: MessageId.make("latest-assistant"),
          completedAt: "2026-01-01T00:00:02.000Z",
          historyOrigin: origin("checkpoint-1", 7),
        },
      ],
    } satisfies ThreadForkHistory;

    const built = buildProviderForkTranscriptHandoff(history);
    const measured = measureProviderForkHandoff(history);

    expect(built.handoff).toContain("Inspect the renderer");
    expect(built.handoff).toContain("Keep the latest exchange exact");
    expect(built.handoff).toContain("The latest exact answer");
    expect(built.handoff).toContain("src/index.ts");
    expect(built.handoff).not.toContain("OLD_FORK_TRANSCRIPT_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("RAW_PLAN_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("RAW_TOOL_LOG_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("RAW_ACTIVITY_PAYLOAD_MUST_NOT_LEAK");
    expect(built.handoff).not.toContain("NESTED_AGENT_TRANSCRIPT_MUST_NOT_LEAK");
    expect(built.attachments.map((attachment) => attachment.id)).toEqual([
      "goal-image",
      "latest-file",
    ]);
    expect(measured).toEqual({
      historyInputChars: built.handoff.length,
      historyAttachmentCount: 2,
    });
  });

  it("stays compact when omitted fork history is much larger than the provider turn limit", () => {
    const sourceThreadId = ThreadId.make("source-thread");
    const origin = (sourceId: string, ordinal: number) => ({ sourceThreadId, sourceId, ordinal });
    const history = {
      messages: [
        {
          ...message("goal", "user", "Retain the goal"),
          historyOrigin: origin("goal", 0),
        },
        {
          ...message("old", "assistant", `RAW_OLD_HISTORY ${"x".repeat(150_000)}`),
          historyOrigin: origin("old", 1),
        },
        {
          ...message("latest-user", "user", "Latest question"),
          historyOrigin: origin("latest-user", 2),
        },
        {
          ...message("latest-assistant", "assistant", "Latest answer"),
          historyOrigin: origin("latest-assistant", 3),
        },
      ],
      proposedPlans: [],
      activities: [],
      subagents: [],
      turns: [],
      checkpoints: [],
    } satisfies ThreadForkHistory;

    const built = buildProviderForkTranscriptHandoff(history);
    const legacyTranscriptChars = history.messages.reduce(
      (total, entry) => total + entry.text.length,
      0,
    );

    expect(built.handoff.length).toBeLessThan(25_000);
    expect(built.handoff.length).toBeLessThanOrEqual(legacyTranscriptChars * 0.05);
    expect(built.handoff).not.toContain("RAW_OLD_HISTORY");
    expect(built.handoff).toContain("Retain the goal");
    expect(built.handoff).toContain("Latest answer");
  });
});
