import { describe, expect, it, vi } from "vite-plus/test";

import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";

import {
  AssemblyAiTranscriptAccumulator,
  Pcm16ChunkEncoder,
  buildAssemblyAiStreamingUrl,
  describeAssemblyAiMicrophoneError,
  startAssemblyAiStreamingTranscription,
  type AssemblyAiBrowserDependencies,
  type AssemblyAiMediaStream,
  type AssemblyAiWebSocket,
} from "./assemblyAiStreamingTranscription";

const tokenConfig: AssemblyAiStreamingTokenResult = {
  token: "temporary token",
  websocketUrl: "wss://streaming.assemblyai.com/v3/ws",
  expiresInSeconds: 60,
  sampleRate: 16_000,
  encoding: "pcm_s16le",
  speechModel: "universal-3-5-pro",
  context: {
    source: "indexed",
    prompt: "Software-development dictation for T3 Code.",
    keyterms: ["T3 Code", "AssemblyAI"],
  },
};

describe("buildAssemblyAiStreamingUrl", () => {
  it("constructs the Universal Streaming URL without changing the configured edge host", () => {
    const url = new URL(buildAssemblyAiStreamingUrl(tokenConfig));

    expect(url.origin).toBe("wss://streaming.assemblyai.com");
    expect(url.searchParams.get("token")).toBe("temporary token");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.get("speech_model")).toBe("universal-3-5-pro");
    expect(url.searchParams.get("format_turns")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("Software-development dictation for T3 Code.");
    expect(JSON.parse(url.searchParams.get("keyterms_prompt") ?? "null")).toEqual([
      "T3 Code",
      "AssemblyAI",
    ]);
  });
});

describe("Pcm16ChunkEncoder", () => {
  it("resamples statefully and emits approximately 50 ms little-endian PCM16 chunks", () => {
    const encoder = new Pcm16ChunkEncoder(48_000, 16_000, 50);
    const positive = new Float32Array(1_200).fill(1);
    const negative = new Float32Array(1_201).fill(-1);

    expect(encoder.push(positive)).toEqual([]);
    const chunks = encoder.push(negative);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.byteLength).toBe(1_600);
    const samples = new DataView(chunks[0]!);
    expect(samples.getInt16(0, true)).toBe(0x7fff);
    expect(samples.getInt16(samples.byteLength - 2, true)).toBe(-0x8000);
  });

  it("clamps out-of-range samples", () => {
    const encoder = new Pcm16ChunkEncoder(16_000, 16_000, 1);
    const chunks = encoder.push(
      new Float32Array([2, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    const view = new DataView(chunks[0]!);

    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
  });
});

describe("AssemblyAiTranscriptAccumulator", () => {
  it("replaces partial turns and never duplicates a finalized turn", () => {
    const accumulator = new AssemblyAiTranscriptAccumulator();

    expect(accumulator.update({ transcript: "Hello", endOfTurn: false, turnOrder: 1 })).toBe(
      "Hello",
    );
    expect(accumulator.update({ transcript: "Hello world", endOfTurn: false, turnOrder: 1 })).toBe(
      "Hello world",
    );
    expect(accumulator.update({ transcript: "Hello world", endOfTurn: true, turnOrder: 1 })).toBe(
      "Hello world",
    );
    expect(accumulator.update({ transcript: "Hello world!", endOfTurn: true, turnOrder: 1 })).toBe(
      "Hello world!",
    );
    expect(accumulator.update({ transcript: "Again", endOfTurn: false, turnOrder: 2 })).toBe(
      "Hello world! Again",
    );
  });
});

describe("describeAssemblyAiMicrophoneError", () => {
  it("distinguishes permission, missing-device, and busy-device failures", () => {
    expect(describeAssemblyAiMicrophoneError({ name: "NotAllowedError" }).message).toMatch(
      /permission was denied/i,
    );
    expect(describeAssemblyAiMicrophoneError({ name: "NotFoundError" }).message).toMatch(
      /no microphone/i,
    );
    expect(describeAssemblyAiMicrophoneError({ name: "NotReadableError" }).message).toMatch(
      /already in use/i,
    );
  });
});

describe("startAssemblyAiStreamingTranscription", () => {
  it("loads the packaged same-origin AudioWorklet module", async () => {
    const resources = makeBrowserDependencies();
    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError: vi.fn() },
      resources.dependencies,
    );
    await waitFor(() => resources.hasSocketListener("open"));
    resources.socket.readyState = 1;
    resources.emitSocket("open", {});
    const session = await starting;

    expect(resources.addWorkletModule).toHaveBeenCalledWith("/assets/assembly-ai-audio-worklet.js");
    session.cancel();
  });

  it("forwards live audio levels without sending them as microphone audio", async () => {
    const resources = makeBrowserDependencies();
    const onAudioLevel = vi.fn();
    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError: vi.fn(), onAudioLevel },
      resources.dependencies,
    );
    await waitFor(() => resources.hasSocketListener("open"));
    resources.socket.readyState = 1;
    resources.emitSocket("open", {});
    const session = await starting;

    resources.emitWorkletMessage({ type: "audio-level", level: 0.42 });

    expect(onAudioLevel).toHaveBeenCalledWith(0.42);
    expect(resources.socket.send).not.toHaveBeenCalled();
    session.cancel();
  });

  it("requests microphone permission before minting the short-lived token", async () => {
    const order: string[] = [];
    const { dependencies, socket, hasSocketListener, emitSocket } = makeBrowserDependencies({
      getUserMedia: async () => {
        order.push("microphone");
        return makeMediaStream();
      },
      createToken: async () => {
        order.push("token");
        return tokenConfig;
      },
    });

    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError: vi.fn() },
      dependencies,
    );
    await waitFor(() => hasSocketListener("open"));
    socket.readyState = 1;
    emitSocket("open", {});
    const session = await starting;

    expect(order).toEqual(["microphone", "token"]);
    session.cancel();
  });

  it("cannot resurrect a startup attempt cancelled during a slow permission prompt", async () => {
    let resolvePermission!: (stream: AssemblyAiMediaStream) => void;
    const permission = new Promise<AssemblyAiMediaStream>((resolve) => {
      resolvePermission = resolve;
    });
    const track = { stop: vi.fn() };
    const createToken = vi.fn(async () => tokenConfig);
    const { dependencies } = makeBrowserDependencies({
      getUserMedia: () => permission,
      createToken,
    });
    const controller = new AbortController();

    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError: vi.fn(), signal: controller.signal },
      dependencies,
    );
    controller.abort();
    resolvePermission({ getTracks: () => [track] });

    await expect(starting).rejects.toThrow(/cancelled/i);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(createToken).not.toHaveBeenCalled();
  });

  it("makes Stop and Cancel idempotent and releases every browser resource", async () => {
    const resources = makeBrowserDependencies();
    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError: vi.fn() },
      resources.dependencies,
    );
    await waitFor(() => resources.hasSocketListener("open"));
    resources.socket.readyState = 1;
    resources.emitSocket("open", {});
    const session = await starting;

    const firstStop = session.stop();
    const secondStop = session.stop();
    expect(secondStop).toBe(firstStop);
    resources.emitSocket("message", { data: '{"type":"Termination"}' });
    await firstStop;
    session.cancel();
    session.cancel();

    expect(resources.socket.send).toHaveBeenCalledTimes(1);
    expect(resources.socket.send).toHaveBeenCalledWith('{"type":"Terminate"}');
    expect(resources.track.stop).toHaveBeenCalledOnce();
    expect(resources.source.disconnect).toHaveBeenCalledOnce();
    expect(resources.worklet.disconnect).toHaveBeenCalledOnce();
    expect(resources.worklet.port.start).toHaveBeenCalledOnce();
    expect(resources.worklet.port.removeEventListener).toHaveBeenCalledOnce();
    expect(resources.worklet.port.close).toHaveBeenCalledOnce();
    expect(resources.closeAudioContext).toHaveBeenCalledOnce();
    expect(resources.socket.close).toHaveBeenCalledOnce();
  });

  it("reports socket failures and cleans up immediately", async () => {
    const resources = makeBrowserDependencies();
    const onError = vi.fn();
    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError },
      resources.dependencies,
    );
    await waitFor(() => resources.hasSocketListener("open"));
    resources.socket.readyState = 1;
    resources.emitSocket("open", {});
    await starting;

    resources.emitSocket("error", {});

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "AssemblyAI streaming connection failed." }),
    );
    expect(resources.track.stop).toHaveBeenCalledOnce();
    expect(resources.socket.close).toHaveBeenCalledOnce();
  });

  it("times out a stalled socket connection and releases the microphone", async () => {
    const resources = makeBrowserDependencies();
    const timer = { callback: null as (() => void) | null };
    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError: vi.fn() },
      {
        ...resources.dependencies,
        setTimeout: (callback) => {
          timer.callback = callback;
          return "connection-timeout";
        },
        clearTimeout: vi.fn(),
      },
    );
    await waitFor(() => timer.callback !== null && resources.hasSocketListener("open"));

    timer.callback?.();

    await expect(starting).rejects.toThrow(/connection timed out/i);
    expect(resources.track.stop).toHaveBeenCalledOnce();
    expect(resources.socket.close).toHaveBeenCalledOnce();
  });

  it("distinguishes session-limit socket closure", async () => {
    const resources = makeBrowserDependencies();
    const onError = vi.fn();
    const starting = startAssemblyAiStreamingTranscription(
      { onTranscript: vi.fn(), onError },
      resources.dependencies,
    );
    await waitFor(() => resources.hasSocketListener("open"));
    resources.socket.readyState = 1;
    resources.emitSocket("open", {});
    await starting;

    resources.emitSocket("close", { code: 4008, reason: "session duration limit" });

    expect(onError.mock.calls[0]?.[0].message).toMatch(/maximum session duration/i);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}

function makeMediaStream(): AssemblyAiMediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] };
}

function makeBrowserDependencies(
  overrides: {
    readonly getUserMedia?: AssemblyAiBrowserDependencies["getUserMedia"];
    readonly createToken?: AssemblyAiBrowserDependencies["createToken"];
  } = {},
) {
  const track = { stop: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  let workletMessageListener: ((event: { readonly data: unknown }) => void) | null = null;
  const addWorkletMessageListener = vi.fn(
    (_type: "message", listener: (event: { readonly data: unknown }) => void) => {
      workletMessageListener = listener;
    },
  );
  const removeWorkletMessageListener = vi.fn(
    (_type: "message", listener: (event: { readonly data: unknown }) => void) => {
      if (workletMessageListener === listener) workletMessageListener = null;
    },
  );
  const worklet = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    port: {
      addEventListener: addWorkletMessageListener,
      removeEventListener: removeWorkletMessageListener,
      start: vi.fn(),
      close: vi.fn(),
    },
  };
  const destination = { connect: vi.fn(), disconnect: vi.fn() };
  const closeAudioContext = vi.fn(async () => undefined);
  const addWorkletModule = vi.fn(async () => undefined);
  const socketListeners = new Map<string, Set<(event: unknown) => void>>();
  const socket = {
    readyState: 0,
    binaryType: "arraybuffer",
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      const listeners = socketListeners.get(type) ?? new Set();
      listeners.add(listener);
      socketListeners.set(type, listeners);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      socketListeners.get(type)?.delete(listener);
    }),
    send: vi.fn(),
    close: vi.fn(function close(this: { readyState: number }) {
      this.readyState = 3;
    }),
  };
  return {
    track,
    source,
    worklet,
    closeAudioContext,
    addWorkletModule,
    socket,
    emitWorkletMessage: (data: unknown) => workletMessageListener?.({ data }),
    hasSocketListener: (type: string) => (socketListeners.get(type)?.size ?? 0) > 0,
    emitSocket: (type: string, event: unknown) => {
      for (const listener of socketListeners.get(type) ?? []) listener(event);
    },
    dependencies: {
      isSecureContext: true,
      getUserMedia: overrides.getUserMedia ?? (async () => ({ getTracks: () => [track] })),
      createToken: overrides.createToken ?? (async () => tokenConfig),
      createAudioContext: () => ({
        sampleRate: 48_000,
        state: "running",
        destination,
        audioWorklet: { addModule: addWorkletModule },
        createMediaStreamSource: () => source,
        resume: async () => undefined,
        close: closeAudioContext,
      }),
      createAudioWorkletNode: () => worklet,
      createWebSocket: () => socket as AssemblyAiWebSocket,
      workletModuleUrl: "/assets/assembly-ai-audio-worklet.js",
      setTimeout: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
      clearTimeout: (timeout: unknown) =>
        globalThis.clearTimeout(timeout as ReturnType<typeof setTimeout>),
    },
  };
}
