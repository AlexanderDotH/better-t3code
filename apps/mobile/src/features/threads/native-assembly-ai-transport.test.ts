import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createNativeAssemblyAiSession } from "./native-assembly-ai-transport";

const tokenConfig: AssemblyAiStreamingTokenResult = {
  token: "temporary token",
  websocketUrl: "wss://streaming.assemblyai.com/v3/ws",
  expiresInSeconds: 60,
  sampleRate: 16_000,
  encoding: "pcm_s16le",
  speechModel: "universal-3-5-pro",
  context: {
    source: "basic",
    prompt: "Software-development dictation for T3 Code.",
    keyterms: [],
  },
};

function makeSocket() {
  return {
    readyState: 0,
    binaryType: "",
    onopen: null as ((event: unknown) => void) | null,
    onmessage: null as ((event: { readonly data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onclose: null as ((event: { readonly code?: number; readonly reason?: string }) => void) | null,
    send: vi.fn<(data: string | ArrayBuffer) => void>(),
    close: vi.fn(),
  };
}

describe("createNativeAssemblyAiSession", () => {
  it("streams native PCM, accumulates transcripts, and stops idempotently", async () => {
    const socket = makeSocket();
    const onTranscript = vi.fn();
    const onAudioLevel = vi.fn();
    const onError = vi.fn();
    const session = createNativeAssemblyAiSession({
      config: tokenConfig,
      onTranscript,
      onAudioLevel,
      onError,
      createSocket: () => socket,
    });

    const connecting = session.connect();
    socket.readyState = 1;
    socket.onopen?.({});
    await connecting;

    const pcm = new Int16Array(800).fill(0x2000);
    session.pushAudio({ data: pcm.buffer, sampleRate: 16_000, channels: 1, timestamp: 0 });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "Turn",
        transcript: "Hello from mobile",
        end_of_turn: true,
        turn_order: 1,
      }),
    });

    expect(socket.binaryType).toBe("arraybuffer");
    expect(socket.send).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(onAudioLevel).toHaveBeenCalledWith(expect.any(Number));
    expect(onTranscript).toHaveBeenCalledWith("Hello from mobile");

    const firstStop = session.stop();
    const secondStop = session.stop();
    expect(secondStop).toBe(firstStop);
    socket.onmessage?.({ data: JSON.stringify({ type: "Termination" }) });
    await firstStop;

    expect(socket.send).toHaveBeenCalledWith('{"type":"Terminate"}');
    expect(socket.close).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects immediately when the socket fails during connection", async () => {
    const socket = makeSocket();
    const onError = vi.fn();
    const session = createNativeAssemblyAiSession({
      config: tokenConfig,
      onTranscript: vi.fn(),
      onAudioLevel: vi.fn(),
      onError,
      createSocket: () => socket,
    });

    const connecting = session.connect();
    socket.onerror?.({});

    await expect(connecting).rejects.toThrow("streaming connection failed");
    expect(onError).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
