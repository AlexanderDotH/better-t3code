import { describe, expect, it, vi } from "vite-plus/test";

import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";

import { createAssemblyAiStreamingProxy } from "./AssemblyAiStreamingProxy";

const CONFIG: AssemblyAiStreamingTokenResult = {
  token: "temporary-token",
  websocketUrl: "wss://streaming.example.test/v3/ws",
  expiresInSeconds: 60,
  sampleRate: 16_000,
  encoding: "pcm_s16le",
  speechModel: "universal-3-5-pro",
  context: { prompt: "T3 Code", keyterms: ["TypeScript"] },
};

class FakeSocket {
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null = null;
  readonly send = vi.fn<(data: string | ArrayBuffer | Uint8Array) => void>();
  readonly close = vi.fn(() => {
    this.readyState = 3;
  });

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

describe("AssemblyAI server streaming proxy", () => {
  it("forwards client PCM and returns AssemblyAI transcript updates", async () => {
    const socket = new FakeSocket();
    const proxy = createAssemblyAiStreamingProxy({
      createSocket: () => socket,
      createSessionId: () => "speech-session-1",
    });

    const started = proxy.start(CONFIG);
    socket.open();
    await expect(started).resolves.toEqual({ sessionId: "speech-session-1" });

    socket.message({ type: "Turn", transcript: "hello", end_of_turn: false, turn_order: 1 });
    const audio = new Uint8Array([1, 2, 3, 4]);
    await expect(proxy.push({ sessionId: "speech-session-1", audio })).resolves.toEqual({
      transcript: "hello",
    });
    expect(socket.send).toHaveBeenCalledWith(audio);

    socket.message({ type: "Turn", transcript: "hello world", end_of_turn: true, turn_order: 1 });
    const finished = proxy.finish("speech-session-1");
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "Terminate" }));
    socket.message({ type: "Termination" });
    await expect(finished).resolves.toEqual({ transcript: "hello world" });
  });

  it("rejects oversized chunks and closes every session on connection disposal", async () => {
    const socket = new FakeSocket();
    const proxy = createAssemblyAiStreamingProxy({
      createSocket: () => socket,
      createSessionId: () => "speech-session-1",
    });
    const started = proxy.start(CONFIG);
    socket.open();
    await started;

    await expect(
      proxy.push({ sessionId: "speech-session-1", audio: new Uint8Array(64 * 1024 + 1) }),
    ).rejects.toThrow("Audio chunk exceeds");
    proxy.dispose();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
