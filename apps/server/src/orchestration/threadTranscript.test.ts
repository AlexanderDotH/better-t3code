import { describe, expect, it } from "@effect/vitest";
import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProject,
  type OrchestrationThread,
} from "@t3tools/contracts";

import { renderThreadTranscriptMarkdown } from "./threadTranscript.ts";

const createdAt = "2026-07-12T10:00:00.000Z";
const updatedAt = "2026-07-12T10:05:00.000Z";
const threadId = ThreadId.make("thread-export-1");
const projectId = ProjectId.make("project-export-1");
const turnId = TurnId.make("turn-export-1");

function makeProject(): OrchestrationProject {
  return {
    id: projectId,
    title: "T3 Code",
    workspaceRoot: "/workspace/t3code",
    defaultModelSelection: null,
    scripts: [],
    createdAt,
    updatedAt,
    deletedAt: null,
  };
}

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: threadId,
    projectId,
    title: "Export everything / safely?",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/transcript",
    worktreePath: "/workspace/t3code",
    latestTurn: null,
    createdAt,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

describe("renderThreadTranscriptMarkdown", () => {
  it("renders readable messages, reasoning, complete MCP payloads, plans, and checkpoints", () => {
    const thread = makeThread({
      messages: [
        {
          id: MessageId.make("message-user"),
          role: "user",
          text: "Inspect the MCP result. Unicode: 你好 👋 and ```` nested fences.",
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "screen.png",
              mimeType: "image/png",
              sizeBytes: 42,
            },
          ],
          turnId,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: MessageId.make("message-assistant"),
          role: "assistant",
          text: "Done.",
          turnId,
          streaming: false,
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      activities: [
        {
          id: EventId.make("activity-reasoning"),
          tone: "info",
          kind: "reasoning.completed",
          summary: "Thinking",
          payload: {
            streamKind: "reasoning_text",
            text: "First inspect the repository, including ``` nested fences.",
          },
          turnId,
          sequence: 1,
          createdAt: "2026-07-12T10:01:00.000Z",
        },
        {
          id: EventId.make("activity-tool"),
          tone: "tool",
          kind: "tool.completed",
          summary: "MCP: read_file",
          payload: {
            itemId: "tool-call-1",
            itemType: "mcp_tool_call",
            canonicalPayload: {
              input: { path: "/workspace/secret.txt" },
              result: { content: "token=unredacted-test-secret" },
            },
          },
          turnId,
          sequence: 2,
          createdAt: "2026-07-12T10:02:00.000Z",
        },
        {
          id: EventId.make("activity-future"),
          tone: "info",
          kind: "future.provider.activity",
          summary: "Future activity",
          payload: { arbitrary: { nested: ["kept", "complete"] } },
          turnId,
          sequence: 3,
          createdAt: "2026-07-12T10:02:30.000Z",
        },
      ],
      proposedPlans: [
        {
          id: "plan-1",
          turnId,
          planMarkdown: "- Keep the full result",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-07-12T10:03:00.000Z",
          updatedAt: "2026-07-12T10:03:00.000Z",
        },
      ],
      checkpoints: [
        {
          turnId,
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("checkpoint-1"),
          status: "ready",
          files: [{ path: "src/app.ts", kind: "modified", additions: 3, deletions: 1 }],
          assistantMessageId: MessageId.make("message-assistant"),
          completedAt: updatedAt,
        },
      ],
    });

    const result = renderThreadTranscriptMarkdown({
      thread,
      project: makeProject(),
      generatedAt: "2026-07-12T11:00:00.000Z",
    });

    expect(result.formatVersion).toBe(1);
    expect(result.mediaType).toBe("text/markdown");
    expect(result.fileName).toMatch(
      /^export-everything-safely-thread-export-1-20260712-110000\.md$/,
    );
    expect(result.content).toContain("This transcript is unredacted");
    expect(result.content).toContain("## Conversation");
    expect(result.content).toContain("Inspect the MCP result. Unicode: 你好 👋");
    expect(result.content).toContain("`````markdown");
    expect(result.content).toContain("First inspect the repository, including ``` nested fences.");
    expect(result.content).toContain('"itemType": "mcp_tool_call"');
    expect(result.content).toContain("token=unredacted-test-secret");
    expect(result.content).toContain("screen.png");
    expect(result.content).toContain("- Keep the full result");
    expect(result.content).toContain("src/app.ts");
    expect(result.content).toContain('"kind": "future.provider.activity"');
    expect(result.content).toContain('"nested": [');
    expect(result.content).toContain('provider_instance_id: "codex"');
    expect(result.content).toContain("## Session metadata");
  });

  it("does not apply the browser retention limits", () => {
    const messages = Array.from({ length: 513 }, (_, index) => ({
      id: MessageId.make(`message-${index}`),
      role: "user" as const,
      text: `message body ${index}`,
      turnId: null,
      streaming: false,
      createdAt: createdAt.replace(".000Z", `.${String(index).padStart(3, "0")}Z`),
      updatedAt: createdAt.replace(".000Z", `.${String(index).padStart(3, "0")}Z`),
    }));
    const activities = Array.from({ length: 129 }, (_, index) => ({
      id: EventId.make(`activity-${index}`),
      tone: "info" as const,
      kind: "runtime.notice",
      summary: `activity summary ${index}`,
      payload: { index },
      turnId: null,
      sequence: index,
      createdAt: updatedAt.replace(".000Z", `.${String(index).padStart(3, "0")}Z`),
    }));

    const result = renderThreadTranscriptMarkdown({
      thread: makeThread({ messages, activities }),
      project: makeProject(),
      generatedAt: updatedAt,
    });

    expect(result.content).toContain("message body 0");
    expect(result.content).toContain("message body 512");
    expect(result.content).toContain("activity summary 0");
    expect(result.content).toContain("activity summary 128");
  });
});
