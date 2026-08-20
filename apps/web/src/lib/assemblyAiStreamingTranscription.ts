import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";
import {
  AssemblyAiTranscriptAccumulator,
  buildAssemblyAiStreamingUrl,
} from "@t3tools/client-runtime/assembly-ai";

export {
  AssemblyAiTranscriptAccumulator,
  Pcm16ChunkEncoder,
  buildAssemblyAiStreamingUrl,
} from "@t3tools/client-runtime/assembly-ai";

import assemblyAiAudioWorkletUrl from "./assemblyAiAudioWorklet.ts?worker&url";

const AUDIO_CHUNK_DURATION_MS = 50;
const SOCKET_OPEN_TIMEOUT_MS = 10_000;
const TERMINATION_TIMEOUT_MS = 2_000;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const WORKLET_PROCESSOR_NAME = "t3-assemblyai-pcm16";

export interface AssemblyAiTranscriptUpdate {
  readonly text: string;
}

export interface AssemblyAiStreamingSession {
  readonly stop: () => Promise<void>;
  readonly cancel: () => void;
}

export interface AssemblyAiMediaStreamTrack {
  readonly stop: () => void;
}

export interface AssemblyAiMediaStream {
  readonly getTracks: () => ReadonlyArray<AssemblyAiMediaStreamTrack>;
}

interface AssemblyAiAudioNode {
  readonly connect: (destination: AssemblyAiAudioNode) => unknown;
  readonly disconnect: () => void;
}

interface AssemblyAiAudioWorkletPort {
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly removeEventListener: (
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ) => void;
  readonly start?: () => void;
  readonly close?: () => void;
}

interface AssemblyAiAudioWorkletNode extends AssemblyAiAudioNode {
  readonly port: AssemblyAiAudioWorkletPort;
}

interface AssemblyAiAudioContext {
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AssemblyAiAudioNode;
  readonly audioWorklet: { readonly addModule: (url: string) => Promise<void> };
  readonly createMediaStreamSource: (stream: AssemblyAiMediaStream) => AssemblyAiAudioNode;
  readonly resume: () => Promise<void>;
  readonly close: () => Promise<void>;
}

interface AssemblyAiSocketMessageEvent {
  readonly data: unknown;
}

interface AssemblyAiSocketCloseEvent {
  readonly code?: number;
  readonly reason?: string;
}

interface AssemblyAiSocketEventMap {
  readonly open: unknown;
  readonly message: AssemblyAiSocketMessageEvent;
  readonly error: unknown;
  readonly close: AssemblyAiSocketCloseEvent;
}

export interface AssemblyAiWebSocket {
  readyState: number;
  binaryType: string;
  addEventListener<Type extends keyof AssemblyAiSocketEventMap>(
    type: Type,
    listener: (event: AssemblyAiSocketEventMap[Type]) => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener<Type extends keyof AssemblyAiSocketEventMap>(
    type: Type,
    listener: (event: AssemblyAiSocketEventMap[Type]) => void,
  ): void;
  readonly send: (data: string | ArrayBuffer) => void;
  readonly close: () => void;
}

function addAssemblyAiSocketListener<Type extends keyof AssemblyAiSocketEventMap>(
  socket: AssemblyAiWebSocket,
  type: Type,
  listener: (event: AssemblyAiSocketEventMap[Type]) => void,
  options?: { readonly once?: boolean },
): () => void {
  socket.addEventListener(type, listener, options);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    socket.removeEventListener(type, listener);
  };
}

export interface AssemblyAiBrowserDependencies {
  readonly isSecureContext: boolean;
  readonly getUserMedia: () => Promise<AssemblyAiMediaStream>;
  readonly createToken: () => Promise<AssemblyAiStreamingTokenResult>;
  readonly createAudioContext: () => AssemblyAiAudioContext;
  readonly createAudioWorkletNode: (
    context: AssemblyAiAudioContext,
    name: string,
    options: {
      readonly processorOptions: { readonly outputSampleRate: number; readonly chunkMs: number };
    },
  ) => AssemblyAiAudioWorkletNode;
  readonly createWebSocket: (url: string) => AssemblyAiWebSocket;
  readonly workletModuleUrl: string;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timeout: unknown) => void;
}

export interface StartAssemblyAiStreamingTranscriptionInput {
  readonly onTranscript: (update: AssemblyAiTranscriptUpdate) => void;
  readonly onError: (error: Error) => void;
  readonly onAudioLevel?: (level: number) => void;
  readonly signal?: AbortSignal;
  readonly createToken?: () => Promise<AssemblyAiStreamingTokenResult>;
}

interface TranscriptTurnUpdate {
  readonly transcript: string;
  readonly endOfTurn: boolean;
  readonly turnOrder: number | null;
}

function errorName(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("name" in value)) return null;
  return typeof value.name === "string" ? value.name : null;
}

export function describeAssemblyAiMicrophoneError(value: unknown): Error {
  switch (errorName(value)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new Error("Microphone permission was denied.");
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new Error("No microphone is available.");
    case "NotReadableError":
    case "TrackStartError":
      return new Error("The microphone is unavailable or already in use.");
    default:
      return value instanceof Error ? value : new Error("Could not access the microphone.");
  }
}

function cancelledError(): Error {
  return new Error("Voice input was cancelled.");
}

function stopTracks(stream: AssemblyAiMediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onLateResolution?: (value: T) => void,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.then(onLateResolution, () => undefined);
    return Promise.reject(cancelledError());
  }
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(cancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted) {
          onLateResolution?.(value);
          return;
        }
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

async function readSocketMessage(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return null;
}

function socketCloseError(event: AssemblyAiSocketCloseEvent): Error {
  const reason = event.reason?.trim() ?? "";
  if (
    event.code === 4008 ||
    event.code === 4009 ||
    /session.{0,20}(limit|duration|maximum|max)/iu.test(reason)
  ) {
    return new Error(
      "AssemblyAI ended dictation because the maximum session duration was reached.",
    );
  }
  return new Error(reason || "AssemblyAI streaming connection closed unexpectedly.");
}

function serviceMessageError(message: Record<string, unknown>): Error {
  const detail =
    typeof message.error === "string"
      ? message.error
      : typeof message.message === "string"
        ? message.message
        : "AssemblyAI reported a streaming service error.";
  return new Error(detail);
}

function audioLevelFromWorkletMessage(value: unknown): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== "audio-level" || typeof message.level !== "number") return null;
  if (!Number.isFinite(message.level)) return null;
  return Math.max(0, Math.min(1, message.level));
}

function defaultBrowserDependencies(): AssemblyAiBrowserDependencies {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new Error("Voice input is only available in a browser window.");
  }
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor || typeof AudioWorkletNode === "undefined") {
    throw new Error("AudioWorklet voice processing is not available in this browser.");
  }
  return {
    isSecureContext: window.isSecureContext,
    getUserMedia: async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not available in this browser.");
      }
      return navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    },
    createToken: () =>
      Promise.reject(new Error("Project context is required to start voice input.")),
    createAudioContext: () => new AudioContextConstructor() as unknown as AssemblyAiAudioContext,
    createAudioWorkletNode: (context, name, options) =>
      new AudioWorkletNode(
        context as unknown as BaseAudioContext,
        name,
        options,
      ) as unknown as AssemblyAiAudioWorkletNode,
    createWebSocket: (url) => new WebSocket(url) as unknown as AssemblyAiWebSocket,
    workletModuleUrl: assemblyAiAudioWorkletUrl,
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timeout) => window.clearTimeout(timeout as number),
  };
}

export async function startAssemblyAiStreamingTranscription(
  input: StartAssemblyAiStreamingTranscriptionInput,
  dependencies: AssemblyAiBrowserDependencies = defaultBrowserDependencies(),
): Promise<AssemblyAiStreamingSession> {
  if (!dependencies.isSecureContext) {
    throw new Error("Voice input requires a secure browser context (HTTPS or localhost).");
  }

  let mediaStream: AssemblyAiMediaStream | null = null;
  let audioContext: AssemblyAiAudioContext | null = null;
  let source: AssemblyAiAudioNode | null = null;
  let worklet: AssemblyAiAudioWorkletNode | null = null;
  let socket: AssemblyAiWebSocket | null = null;
  let connectionTimeout: unknown = null;
  let terminationTimeout: unknown = null;
  let audioCleaned = false;
  let socketCleaned = false;
  let stopping = false;
  let cancelled = false;
  let stopPromise: Promise<void> | null = null;
  let resolveTermination: (() => void) | null = null;
  let audioMessageListener: ((event: { readonly data: unknown }) => void) | null = null;
  let runtimeSocketListenerCleanups: ReadonlyArray<() => void> = [];
  const accumulator = new AssemblyAiTranscriptAccumulator();
  let lastEmittedTranscript = "";

  const cleanupAudio = () => {
    if (audioCleaned) return;
    audioCleaned = true;
    if (worklet) {
      if (audioMessageListener) {
        worklet.port.removeEventListener("message", audioMessageListener);
        audioMessageListener = null;
      }
      worklet.port.close?.();
      worklet.disconnect();
    }
    source?.disconnect();
    stopTracks(mediaStream);
    mediaStream = null;
    if (audioContext) {
      void audioContext.close().catch(() => undefined);
      audioContext = null;
    }
  };

  const cleanupSocket = (sendTerminate: boolean) => {
    if (socketCleaned) return;
    socketCleaned = true;
    if (connectionTimeout !== null) dependencies.clearTimeout(connectionTimeout);
    if (terminationTimeout !== null) dependencies.clearTimeout(terminationTimeout);
    connectionTimeout = null;
    terminationTimeout = null;
    for (const removeListener of runtimeSocketListenerCleanups) removeListener();
    runtimeSocketListenerCleanups = [];
    if (socket) {
      if (sendTerminate && socket.readyState === SOCKET_OPEN) {
        try {
          socket.send(JSON.stringify({ type: "Terminate" }));
        } catch {
          // The transport is already failing; closing remains the important cleanup step.
        }
      }
      if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) {
        socket.close();
      }
      socket = null;
    }
    resolveTermination?.();
    resolveTermination = null;
  };

  const cancelSession = () => {
    if (cancelled || socketCleaned) return;
    cancelled = true;
    stopping = true;
    cleanupAudio();
    cleanupSocket(true);
  };

  const abortListener = () => cancelSession();

  try {
    const permissionRequest = dependencies.getUserMedia();
    mediaStream = await withAbort(permissionRequest, input.signal, stopTracks).catch((error) => {
      if (input.signal?.aborted) throw cancelledError();
      throw describeAssemblyAiMicrophoneError(error);
    });
    if (input.signal?.aborted) throw cancelledError();

    const config = await withAbort((input.createToken ?? dependencies.createToken)(), input.signal);
    if (input.signal?.aborted) throw cancelledError();

    audioContext = dependencies.createAudioContext();
    if (audioContext.state === "suspended") {
      await withAbort(audioContext.resume(), input.signal);
    }
    await withAbort(
      audioContext.audioWorklet.addModule(dependencies.workletModuleUrl),
      input.signal,
    );
    if (input.signal?.aborted) throw cancelledError();

    source = audioContext.createMediaStreamSource(mediaStream);
    worklet = dependencies.createAudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
      processorOptions: {
        outputSampleRate: config.sampleRate,
        chunkMs: AUDIO_CHUNK_DURATION_MS,
      },
    });
    socket = dependencies.createWebSocket(buildAssemblyAiStreamingUrl(config));
    socket.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
      if (!socket) {
        reject(new Error("AssemblyAI streaming connection could not be created."));
        return;
      }
      const openingSocket = socket;
      const openSocketListenerCleanups: Array<() => void> = [];
      let settled = false;
      const cleanupOpenListeners = () => {
        for (const removeListener of openSocketListenerCleanups) removeListener();
        input.signal?.removeEventListener("abort", rejectOpenOnAbort);
      };
      const resolveOpen = () => {
        if (settled) return;
        settled = true;
        cleanupOpenListeners();
        resolve();
      };
      const rejectOpen = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupOpenListeners();
        reject(error);
      };
      const rejectOpenOnAbort = () => rejectOpen(cancelledError());
      connectionTimeout = dependencies.setTimeout(
        () => rejectOpen(new Error("AssemblyAI streaming connection timed out.")),
        SOCKET_OPEN_TIMEOUT_MS,
      );
      openSocketListenerCleanups.push(
        addAssemblyAiSocketListener(openingSocket, "open", () => {
          if (connectionTimeout !== null) dependencies.clearTimeout(connectionTimeout);
          connectionTimeout = null;
          resolveOpen();
        }),
        addAssemblyAiSocketListener(openingSocket, "error", () =>
          rejectOpen(new Error("AssemblyAI streaming connection failed.")),
        ),
        addAssemblyAiSocketListener(openingSocket, "close", (event) =>
          rejectOpen(socketCloseError(event)),
        ),
      );
      input.signal?.addEventListener("abort", rejectOpenOnAbort, { once: true });
    });
    if (input.signal?.aborted) throw cancelledError();

    const failRuntime = (error: Error) => {
      if (stopping || cancelled || socketCleaned) return;
      stopping = true;
      cleanupAudio();
      cleanupSocket(true);
      input.onError(error);
    };

    const emitTranscript = (update: TranscriptTurnUpdate) => {
      const text = accumulator.update(update);
      if (text !== lastEmittedTranscript) {
        lastEmittedTranscript = text;
        input.onTranscript({ text });
      }
    };

    const runtimeSocket = socket;
    const onSocketMessage = (event: AssemblyAiSocketMessageEvent) => {
      void readSocketMessage(event.data)
        .then((messageText) => {
          if (!messageText || socketCleaned) return;
          let message: unknown;
          try {
            message = JSON.parse(messageText);
          } catch {
            failRuntime(new Error("AssemblyAI returned an unreadable streaming message."));
            return;
          }
          if (message === null || typeof message !== "object" || Array.isArray(message)) return;
          const record = message as Record<string, unknown>;
          const type = typeof record.type === "string" ? record.type : "";
          if (type === "Turn" && typeof record.transcript === "string") {
            emitTranscript({
              transcript: record.transcript,
              endOfTurn: record.end_of_turn === true,
              turnOrder: typeof record.turn_order === "number" ? record.turn_order : null,
            });
            return;
          }
          if (type === "Error" || type === "error") {
            failRuntime(serviceMessageError(record));
            return;
          }
          if (type === "Termination") {
            resolveTermination?.();
            if (!stopping && !cancelled) {
              failRuntime(
                socketCloseError({
                  reason: typeof record.reason === "string" ? record.reason : "",
                }),
              );
            }
          }
        })
        .catch(() => failRuntime(new Error("Failed to read an AssemblyAI transcript message.")));
    };
    const onSocketError = () => failRuntime(new Error("AssemblyAI streaming connection failed."));
    const onSocketClose = (event: AssemblyAiSocketCloseEvent) => {
      resolveTermination?.();
      if (!stopping && !cancelled) failRuntime(socketCloseError(event));
    };
    runtimeSocketListenerCleanups = [
      addAssemblyAiSocketListener(runtimeSocket, "message", onSocketMessage),
      addAssemblyAiSocketListener(runtimeSocket, "error", onSocketError),
      addAssemblyAiSocketListener(runtimeSocket, "close", onSocketClose),
    ];

    audioMessageListener = (event) => {
      const audioLevel = audioLevelFromWorkletMessage(event.data);
      if (audioLevel !== null) {
        input.onAudioLevel?.(audioLevel);
        return;
      }
      if (!(event.data instanceof ArrayBuffer) || socket?.readyState !== SOCKET_OPEN) return;
      socket.send(event.data);
    };
    worklet.port.addEventListener("message", audioMessageListener);
    worklet.port.start?.();
    source.connect(worklet);
    worklet.connect(audioContext.destination);
    input.signal?.addEventListener("abort", abortListener, { once: true });

    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (cancelled || socketCleaned) return;
        stopping = true;
        cleanupAudio();
        if (socket?.readyState === SOCKET_OPEN) {
          const termination = new Promise<void>((resolve) => {
            resolveTermination = resolve;
            terminationTimeout = dependencies.setTimeout(resolve, TERMINATION_TIMEOUT_MS);
          });
          socket.send(JSON.stringify({ type: "Terminate" }));
          await termination;
        }
        cleanupSocket(false);
        input.signal?.removeEventListener("abort", abortListener);
      })();
      return stopPromise;
    };

    return { stop, cancel: cancelSession };
  } catch (error) {
    cleanupAudio();
    cleanupSocket(true);
    input.signal?.removeEventListener("abort", abortListener);
    throw error instanceof Error ? error : new Error("Failed to start AssemblyAI voice input.");
  }
}

declare global {
  interface Window {
    readonly webkitAudioContext?: typeof AudioContext;
  }
}
