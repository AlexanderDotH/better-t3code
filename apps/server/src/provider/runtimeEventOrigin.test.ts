import {
  EventId,
  ProviderDriverKind,
  RuntimeSessionId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { bindProviderRuntimeEventOrigin } from "./runtimeEventOrigin.ts";

describe("bindProviderRuntimeEventOrigin", () => {
  it("keeps the captured runtime id after a replacement runtime exists", async () => {
    const oldRuntimeSessionId = RuntimeSessionId.make("runtime-old");
    const replacementRuntimeSessionId = RuntimeSessionId.make("runtime-replacement");
    const received: ProviderRuntimeEvent[] = [];
    const publish = async (event: ProviderRuntimeEvent) => {
      received.push(event);
    };
    const emitFromOldRuntime = bindProviderRuntimeEventOrigin(oldRuntimeSessionId, publish);
    bindProviderRuntimeEventOrigin(replacementRuntimeSessionId, publish);

    await emitFromOldRuntime({
      type: "turn.completed",
      eventId: EventId.make("event-old"),
      provider: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-1"),
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { state: "interrupted" },
    });

    expect(received[0]?.runtimeSessionId).toBe(oldRuntimeSessionId);
  });
});
