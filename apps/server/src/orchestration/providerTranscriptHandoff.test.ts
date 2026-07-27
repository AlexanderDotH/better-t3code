import { MessageId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildProviderTranscriptHandoff } from "./providerTranscriptHandoff.ts";

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
