import {
  AssemblyAiTranscriptAccumulator,
  Pcm16ChunkEncoder,
  buildAssemblyAiStreamingUrl,
  parseAssemblyAiStreamingMessage,
  pcm16AudioLevel,
} from "@t3tools/client-runtime/assembly-ai";
import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";
import type { AudioStreamBuffer } from "expo-audio";

/* oxlint-disable unicorn/prefer-add-event-listener -- React Native WebSocket handler properties make teardown explicit and keep the injected socket contract minimal. */

const AUDIO_CHUNK_DURATION_MS = 50;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_OPEN_TIMEOUT_MS = 10_000;
const TERMINATION_TIMEOUT_MS = 2_000;

interface NativeAssemblyAiSocket {
  readyState: number;
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

export interface NativeAssemblyAiSession {
  readonly connect: (signal?: AbortSignal) => Promise<void>;
  readonly pushAudio: (buffer: AudioStreamBuffer) => void;
  readonly stop: () => Promise<void>;
  readonly cancel: () => void;
}

function socketCloseError(input: { readonly code?: number; readonly reason?: string }): Error {
  const reason = input.reason?.trim() ?? "";
  if (
    input.code === 4008 ||
    input.code === 4009 ||
    /session.{0,20}(limit|duration|maximum|max)/iu.test(reason)
  ) {
    return new Error(
      "AssemblyAI ended dictation because the maximum session duration was reached.",
    );
  }
  return new Error(reason || "AssemblyAI streaming connection closed unexpectedly.");
}

function monoFloatSamples(buffer: AudioStreamBuffer): Float32Array {
  const view = new DataView(buffer.data);
  const sampleCount = Math.floor(view.byteLength / 2);
  const channels = Math.max(1, buffer.channels);
  const frameCount = Math.floor(sampleCount / channels);
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let total = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      total += view.getInt16((frame * channels + channel) * 2, true) / 0x8000;
    }
    mono[frame] = total / channels;
  }
  return mono;
}

export function createNativeAssemblyAiSession(input: {
  readonly config: AssemblyAiStreamingTokenResult;
  readonly onTranscript: (text: string) => void;
  readonly onAudioLevel: (level: number) => void;
  readonly onError: (error: Error) => void;
  readonly createSocket?: (url: string) => NativeAssemblyAiSocket;
}): NativeAssemblyAiSession {
  const socket = (input.createSocket ?? ((url) => new WebSocket(url) as NativeAssemblyAiSocket))(
    buildAssemblyAiStreamingUrl(input.config),
  );
  socket.binaryType = "arraybuffer";
  const accumulator = new AssemblyAiTranscriptAccumulator();
  let encoder: Pcm16ChunkEncoder | null = null;
  let encoderInputRate = 0;
  let stopping = false;
  let closed = false;
  let stopPromise: Promise<void> | null = null;
  let resolveTermination: (() => void) | null = null;
  let rejectConnect: ((error: Error) => void) | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN)
      socket.close();
    resolveTermination?.();
    resolveTermination = null;
  };

  const fail = (error: Error) => {
    if (stopping || closed) return;
    rejectConnect?.(error);
    cleanup();
    input.onError(error);
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(event.data);
    } catch {
      fail(new Error("AssemblyAI returned an unreadable streaming message."));
      return;
    }
    const message = parseAssemblyAiStreamingMessage(decoded);
    switch (message._tag) {
      case "turn": {
        const text = accumulator.update(message.turn);
        input.onTranscript(text);
        return;
      }
      case "error":
        fail(new Error(message.message));
        return;
      case "termination":
        resolveTermination?.();
        if (!stopping) fail(socketCloseError({ reason: message.reason }));
        return;
      case "ignore":
        return;
    }
  };
  socket.onerror = () => fail(new Error("AssemblyAI streaming connection failed."));
  socket.onclose = (event) => {
    resolveTermination?.();
    if (!stopping) fail(socketCloseError(event));
  };

  const connect = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        cleanup();
        reject(new Error("Voice input was cancelled."));
        return;
      }
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        rejectConnect = null;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () =>
        settle(() => {
          cleanup();
          reject(new Error("Voice input was cancelled."));
        });
      const timeout = setTimeout(
        () =>
          settle(() => {
            cleanup();
            reject(new Error("AssemblyAI streaming connection timed out."));
          }),
        SOCKET_OPEN_TIMEOUT_MS,
      );
      rejectConnect = (error) => settle(() => reject(error));
      socket.onopen = () => settle(resolve);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  const pushAudio = (buffer: AudioStreamBuffer) => {
    if (closed || stopping || socket.readyState !== SOCKET_OPEN) return;
    input.onAudioLevel(pcm16AudioLevel(buffer.data));
    if (encoder === null || encoderInputRate !== buffer.sampleRate) {
      encoderInputRate = buffer.sampleRate;
      encoder = new Pcm16ChunkEncoder(
        buffer.sampleRate,
        input.config.sampleRate,
        AUDIO_CHUNK_DURATION_MS,
      );
    }
    for (const chunk of encoder.push(monoFloatSamples(buffer))) socket.send(chunk);
  };

  const cancel = () => {
    if (closed) return;
    stopping = true;
    if (socket.readyState === SOCKET_OPEN) {
      try {
        socket.send(JSON.stringify({ type: "Terminate" }));
      } catch {
        // Closing below remains the important cancellation guarantee.
      }
    }
    cleanup();
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (closed) return;
      stopping = true;
      if (socket.readyState === SOCKET_OPEN) {
        const termination = new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, TERMINATION_TIMEOUT_MS);
          resolveTermination = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
        socket.send(JSON.stringify({ type: "Terminate" }));
        await termination;
      }
      cleanup();
    })();
    return stopPromise;
  };

  return { connect, pushAudio, stop, cancel };
}
