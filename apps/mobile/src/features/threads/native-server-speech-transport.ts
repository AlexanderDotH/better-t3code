import { Pcm16ChunkEncoder, pcm16AudioLevel } from "@t3tools/client-runtime/assembly-ai";
import type {
  SpeechStreamingAudioInput,
  SpeechStreamingSessionId,
  SpeechStreamingSessionInput,
  SpeechStreamingSessionStartResult,
  SpeechStreamingTranscriptResult,
} from "@t3tools/contracts";
import type { AudioStreamBuffer } from "expo-audio";

const AUDIO_CHUNK_DURATION_MS = 50;
const AUDIO_BATCH_DELAY_MS = 150;

export interface NativeServerSpeechSession {
  readonly connect: (signal?: AbortSignal) => Promise<void>;
  readonly pushAudio: (buffer: AudioStreamBuffer) => void;
  readonly stop: () => Promise<void>;
  readonly cancel: () => void;
}

function monoFloatSamples(buffer: AudioStreamBuffer): Float32Array {
  const view = new DataView(buffer.data);
  const channels = Math.max(1, buffer.channels);
  const frameCount = Math.floor(view.byteLength / 2 / channels);
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

function concatenateAudio(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const audio = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

export function createNativeServerSpeechSession(input: {
  readonly startSession: () => Promise<SpeechStreamingSessionStartResult>;
  readonly pushAudio: (
    input: SpeechStreamingAudioInput,
  ) => Promise<SpeechStreamingTranscriptResult>;
  readonly finishSession: (
    input: SpeechStreamingSessionInput,
  ) => Promise<SpeechStreamingTranscriptResult>;
  readonly cancelSession: (input: SpeechStreamingSessionInput) => Promise<void>;
  readonly onTranscript: (text: string) => void;
  readonly onAudioLevel: (level: number) => void;
  readonly onError: (error: Error) => void;
}): NativeServerSpeechSession {
  let sessionId: SpeechStreamingSessionId | null = null;
  let encoder: Pcm16ChunkEncoder | null = null;
  let encoderInputRate = 0;
  let pendingChunks: Uint8Array[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let sendChain = Promise.resolve();
  let closed = false;

  const reportTranscript = ({ transcript }: SpeechStreamingTranscriptResult) => {
    input.onTranscript(transcript);
  };
  const fail = (cause: unknown) => {
    if (closed) return;
    closed = true;
    input.onError(cause instanceof Error ? cause : new Error("Voice streaming failed."));
  };
  const flush = (): Promise<void> => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    if (closed || sessionId === null || pendingChunks.length === 0) return sendChain;
    const audio = concatenateAudio(pendingChunks);
    pendingChunks = [];
    const activeSessionId = sessionId;
    sendChain = sendChain
      .then(() => input.pushAudio({ sessionId: activeSessionId, audio }))
      .then(reportTranscript)
      .catch(fail);
    return sendChain;
  };
  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => void flush(), AUDIO_BATCH_DELAY_MS);
  };

  const connect = async (signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error("Voice input was cancelled.");
    const started = await input.startSession();
    if (signal?.aborted) {
      await input.cancelSession({ sessionId: started.sessionId });
      throw new Error("Voice input was cancelled.");
    }
    sessionId = started.sessionId;
  };

  const pushAudio = (buffer: AudioStreamBuffer) => {
    if (closed || sessionId === null) return;
    input.onAudioLevel(pcm16AudioLevel(buffer.data));
    if (encoder === null || encoderInputRate !== buffer.sampleRate) {
      encoderInputRate = buffer.sampleRate;
      encoder = new Pcm16ChunkEncoder(buffer.sampleRate, 16_000, AUDIO_CHUNK_DURATION_MS);
    }
    pendingChunks.push(
      ...encoder.push(monoFloatSamples(buffer)).map((chunk) => new Uint8Array(chunk)),
    );
    if (pendingChunks.length > 0) scheduleFlush();
  };

  const stop = async () => {
    if (closed || sessionId === null) return;
    await flush();
    await sendChain;
    if (closed) return;
    const activeSessionId = sessionId;
    closed = true;
    reportTranscript(await input.finishSession({ sessionId: activeSessionId }));
  };

  const cancel = () => {
    if (closed) return;
    closed = true;
    pendingChunks = [];
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    if (sessionId !== null) void input.cancelSession({ sessionId }).catch(() => undefined);
  };

  return { connect, pushAudio, stop, cancel };
}
