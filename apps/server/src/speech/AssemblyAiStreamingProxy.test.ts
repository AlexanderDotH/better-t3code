import { describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  type AssemblyAiStreamingTokenResult,
} from "@t3tools/contracts";

import { createAssemblyAiStreamingProxy } from "./AssemblyAiStreamingProxy.ts";

const CONFIG: AssemblyAiStreamingTokenResult = {
  token: "temporary-token",
  websocketUrl: "wss://streaming.example.test/v3/ws",
  expiresInSeconds: 60,
  sampleRate: 16_000,
  encoding: "pcm_s16le",
  speechModel: "universal-3-5-pro",
  context: { source: "basic", prompt: "T3 Code", keyterms: ["TypeScript"] },
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
  it("passes the selected model and supported parameters through the mobile proxy", async () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn<(url: string) => FakeSocket>(() => socket);
    const proxy = createAssemblyAiStreamingProxy({
      createSocket,
      createSessionId: () => "configured",
    });
    const started = proxy.start({
      ...CONFIG,
      speechModel: "universal-streaming-multilingual",
      options: {
        ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
        speechModel: "universal-streaming-multilingual",
        minTurnSilence: 800,
      },
    });
    socket.open();
    await started;
    const params = new URL(createSocket.mock.calls[0]![0]).searchParams;
    expect(params.get("speech_model")).toBe("universal-streaming-multilingual");
    expect(params.get("min_turn_silence")).toBe("800");
    expect(params.get("format_turns")).toBe("true");
    expect(params.has("prompt")).toBe(false);
    expect(params.has("mode")).toBe(false);
    proxy.dispose();
  });
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

  it("retains an independent copy of advanced audio only until finish or cancellation", async () => {
    const socket = new FakeSocket();
    const proxy = createAssemblyAiStreamingProxy({
      createSocket: () => socket,
      createSessionId: () => "retained",
    });
    const started = proxy.start({
      ...CONFIG,
      options: { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, advancedMode: true },
    });
    socket.open();
    await started;
    const audio = new Uint8Array([1, 2, 3, 4]);
    await proxy.push({ sessionId: "retained", audio });
    audio.fill(9);
    const finished = proxy.finish("retained");
    socket.message({ type: "Termination" });
    await expect(finished).resolves.toEqual({
      transcript: "",
      audio: new Uint8Array([1, 2, 3, 4]),
    });
    await expect(proxy.finish("retained")).rejects.toThrow("not active");

    const second = proxy.start({
      ...CONFIG,
      options: { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, advancedMode: true },
    });
    socket.open();
    await second;
    await proxy.push({ sessionId: "retained", audio });
    proxy.cancel("retained");
    await expect(proxy.finish("retained")).rejects.toThrow("not active");
    proxy.dispose();
  });

  it("bounds advanced recordings to five minutes of PCM and removes an over-limit session", async () => {
    const socket = new FakeSocket();
    const proxy = createAssemblyAiStreamingProxy({
      createSocket: () => socket,
      createSessionId: () => "bounded",
    });
    const started = proxy.start({
      ...CONFIG,
      options: { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, advancedMode: true },
    });
    socket.open();
    await started;
    const chunk = new Uint8Array(32_000);
    for (let second = 0; second < 300; second += 1)
      await proxy.push({ sessionId: "bounded", audio: chunk });
    await expect(
      proxy.push({ sessionId: "bounded", audio: new Uint8Array([1, 2]) }),
    ).rejects.toThrow("five minutes");
    await expect(proxy.finish("bounded")).rejects.toThrow("not active");
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
