import {
  EventId,
  MessageId,
  ThreadId,
  type OrchestrationMessage,
  type ThreadForkHistory,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBoundedProviderForkTranscriptHandoff,
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
  it("renders completed canonical messages strictly before the boundary with attachment metadata", () => {
    const handoff = buildProviderTranscriptHandoff({
      messages: [
        message("system-1", "system", "system context"),
        message("user-1", "user", "look at this", {
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "diagram.png",
              mimeType: "image/png",
              sizeBytes: 42,
            },
          ],
        }),
        message("assistant-1", "assistant", "completed answer"),
        message("assistant-streaming", "assistant", "unfinished", { streaming: true }),
        message("boundary", "user", "triggering message"),
        message("later", "assistant", "must not appear"),
      ],
      boundaryMessageId: MessageId.make("boundary"),
    });

    expect(handoff).toContain("[system]\nsystem context\n[/system]");
    expect(handoff).toContain("[user]\nlook at this");
    expect(handoff).toContain(
      '- type=image; id=image-1; name="diagram.png"; mimeType=image/png; sizeBytes=42',
    );
    expect(handoff).toContain("[assistant]\ncompleted answer\n[/assistant]");
    expect(handoff).not.toContain("unfinished");
    expect(handoff).not.toContain("triggering message");
    expect(handoff).not.toContain("must not appear");
  });

  it("is deterministic and returns an empty transcript envelope when the boundary is unknown", () => {
    const input = {
      messages: [message("user-1", "user", "hello")],
      boundaryMessageId: MessageId.make("missing"),
    };

    expect(buildProviderTranscriptHandoff(input)).toBe(buildProviderTranscriptHandoff(input));
    expect(buildProviderTranscriptHandoff(input)).not.toContain("hello");
  });
});

describe("fork transcript handoff", () => {
  it("serializes visible frozen history in ordinal order and measures the exact provider budget", () => {
    const sourceThreadId = ThreadId.make("source-thread");
    const origin = (sourceId: string, ordinal: number) => ({
      sourceThreadId,
      sourceId,
      ordinal,
    });
    const history = {
      messages: [
        {
          ...message("source-user", "user", "inspect the diagram", {
            attachments: [
              {
                type: "image",
                id: "image-1",
                name: "diagram.png",
                mimeType: "image/png",
                sizeBytes: 42,
              },
              {
                type: "audio",
                id: "audio-1",
                name: "note.wav",
                mimeType: "audio/wav",
                sizeBytes: 84,
              },
            ],
          }),
          historyOrigin: origin("source-user", 0),
        },
      ],
      proposedPlans: [
        {
          id: "plan-1",
          turnId: null,
          planMarkdown: "1. Keep the useful behavior",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          historyOrigin: origin("plan-1", 2),
        },
      ],
      activities: [
        {
          id: EventId.make("activity-1"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Read src/index.ts",
          payload: {
            visibleDetail: "must not duplicate runtime payloads",
            runtimeSessionId: "private-runtime-id",
          },
          turnId: null,
          createdAt: "2026-01-01T00:00:00.500Z",
          historyOrigin: origin("activity-1", 1),
        },
      ],
      subagents: [],
      turns: [],
      checkpoints: [],
    } satisfies ThreadForkHistory;

    const built = buildProviderForkTranscriptHandoff(history);
    const measured = measureProviderForkHandoff(history);

    expect(built.handoff.indexOf("inspect the diagram")).toBeLessThan(
      built.handoff.indexOf("Read src/index.ts"),
    );
    expect(built.handoff.indexOf("Read src/index.ts")).toBeLessThan(
      built.handoff.indexOf("Keep the useful behavior"),
    );
    expect(built.handoff).toContain("must not duplicate runtime payloads");
    expect(built.handoff).not.toContain("private-runtime-id");
    expect(built.attachments).toHaveLength(1);
    expect(built.attachments[0]?.id).toBe("image-1");
    expect(measured).toEqual({
      historyInputChars: built.handoff.length,
      historyAttachmentCount: 1,
    });
  });

  it("keeps the newest complete entries and attachments inside explicit provider limits", () => {
    const sourceThreadId = ThreadId.make("source-thread");
    const origin = (sourceId: string, ordinal: number) => ({
      sourceThreadId,
      sourceId,
      ordinal,
    });
    const history = {
      messages: [
        {
          ...message("old", "user", "old context that should be omitted", {
            attachments: [
              {
                type: "image",
                id: "old-image",
                name: "old.png",
                mimeType: "image/png",
                sizeBytes: 1,
              },
            ],
          }),
          historyOrigin: origin("old", 0),
        },
        {
          ...message("new", "assistant", "new context that must survive", {
            attachments: [
              {
                type: "image",
                id: "new-image",
                name: "new.png",
                mimeType: "image/png",
                sizeBytes: 1,
              },
            ],
          }),
          historyOrigin: origin("new", 2),
        },
      ],
      proposedPlans: [],
      activities: [
        {
          id: EventId.make("activity-between"),
          tone: "tool",
          kind: "tool.completed",
          summary: "middle context ".repeat(30),
          payload: null,
          turnId: null,
          createdAt: "2026-01-01T00:00:00.500Z",
          historyOrigin: origin("activity-between", 1),
        },
      ],
      subagents: [],
      turns: [],
      checkpoints: [],
    } satisfies ThreadForkHistory;

    const bounded = buildBoundedProviderForkTranscriptHandoff(history, {
      maxInputChars: 560,
      maxAttachments: 1,
    });

    expect(bounded.handoff.length).toBeLessThanOrEqual(560);
    expect(bounded.handoff).toContain("new context that must survive");
    expect(bounded.handoff).not.toContain("old context that should be omitted");
    expect(bounded.handoff).toContain("Earlier fork history was omitted");
    expect(bounded.attachments.map((attachment) => attachment.id)).toEqual(["new-image"]);
    expect(history.messages).toHaveLength(2);
    expect(history.activities).toHaveLength(1);
  });
});
