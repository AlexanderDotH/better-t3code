import { SpeechStreamingSessionId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createServerSpeechSession } from "./serverSpeechSession.ts";

const sessionId = SpeechStreamingSessionId.make("test-session");

describe("server speech audio batching", () => {
  it("splits large buffers into ordered bounded RPCs before finishing", async () => {
    const received: Uint8Array[] = [];
    const finishSession = vi.fn(async () => ({ transcript: "Finished" }));
    const session = createServerSpeechSession({
      startSession: async () => ({ sessionId }),
      pushAudio: async ({ audio }) => {
        received.push(audio);
        return { transcript: "Live" };
      },
      finishSession,
      cancelSession: async () => undefined,
      onTranscript: vi.fn(),
      onError: vi.fn(),
    });
    await session.connect();
    const audio = Uint8Array.from({ length: 150_000 }, (_, index) => index % 256);
    session.pushAudio(audio);
    await session.stop();
    expect(received.map((chunk) => chunk.byteLength)).toEqual([65_536, 65_536, 18_928]);
    const combined = new Uint8Array(audio.byteLength);
    let offset = 0;
    for (const chunk of received) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(combined).toEqual(audio);
    expect(finishSession).toHaveBeenCalledOnce();
  });

  it("bounds queued audio and cancels a stalled connection", async () => {
    const onError = vi.fn();
    const cancelSession = vi.fn(async () => undefined);
    const finishSession = vi.fn(async () => ({ transcript: "" }));
    const session = createServerSpeechSession({
      startSession: async () => ({ sessionId }),
      pushAudio: async () => ({ transcript: "" }),
      finishSession,
      cancelSession,
      onTranscript: vi.fn(),
      onError,
    });
    await session.connect();
    session.pushAudio(new Uint8Array(256 * 1024));
    session.pushAudio(new Uint8Array([1, 2]));
    await session.stop();
    expect(onError.mock.calls[0]?.[0].message).toContain("too slow");
    expect(cancelSession).toHaveBeenCalledExactlyOnceWith({ sessionId });
    expect(finishSession).not.toHaveBeenCalled();
  });

  it("cancels a late session created after its composer was abandoned", async () => {
    const started = Promise.withResolvers<{ sessionId: typeof sessionId }>();
    const cancelSession = vi.fn(async () => undefined);
    const session = createServerSpeechSession({
      startSession: () => started.promise,
      pushAudio: async () => ({ transcript: "" }),
      finishSession: async () => ({ transcript: "" }),
      cancelSession,
      onTranscript: vi.fn(),
      onError: vi.fn(),
    });
    const connecting = session.connect();
    session.cancel();
    started.resolve({ sessionId });
    await expect(connecting).rejects.toThrow("cancelled");
    expect(cancelSession).toHaveBeenCalledExactlyOnceWith({ sessionId });
  });
});
