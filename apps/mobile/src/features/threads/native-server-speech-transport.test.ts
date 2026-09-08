import { describe, expect, it, vi } from "vite-plus/test";
import { SpeechStreamingSessionId } from "@t3tools/contracts";

import { createNativeServerSpeechSession } from "./native-server-speech-transport";

describe("native server speech transport", () => {
  it("streams PCM through Better T3 Code and applies returned transcript updates", async () => {
    const onTranscript = vi.fn();
    const pushAudio = vi.fn(async () => ({ transcript: "hello from server" }));
    const session = createNativeServerSpeechSession({
      startSession: async () => ({ sessionId: SpeechStreamingSessionId.make("session-1") }),
      pushAudio,
      finishSession: async () => ({ transcript: "hello from server" }),
      cancelSession: async () => undefined,
      onTranscript,
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    });

    await session.connect();
    session.pushAudio({
      data: new Uint8Array(1_600).buffer,
      sampleRate: 16_000,
      channels: 1,
      timestamp: 0,
    });
    await session.stop();

    expect(pushAudio).toHaveBeenCalledWith({
      sessionId: "session-1",
      audio: expect.any(Uint8Array),
    });
    expect(onTranscript).toHaveBeenCalledWith("hello from server");
  });

  it("cancels the server session without finishing it", async () => {
    const cancelSession = vi.fn(async () => undefined);
    const finishSession = vi.fn(async () => ({ transcript: "" }));
    const session = createNativeServerSpeechSession({
      startSession: async () => ({ sessionId: SpeechStreamingSessionId.make("session-1") }),
      pushAudio: async () => ({ transcript: "" }),
      finishSession,
      cancelSession,
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError: vi.fn(),
    });

    await session.connect();
    session.cancel();
    await Promise.resolve();

    expect(cancelSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(finishSession).not.toHaveBeenCalled();
  });
});
