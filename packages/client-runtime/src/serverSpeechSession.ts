// @effect-diagnostics globalTimers:off - PCM batching runs in browser and native callbacks outside Effect.
import type {
  SpeechStreamingAudioInput,
  SpeechStreamingSessionId,
  SpeechStreamingSessionInput,
  SpeechStreamingSessionStartResult,
  SpeechStreamingTranscriptResult,
} from "@t3tools/contracts";

const AUDIO_BATCH_DELAY_MS = 150;
const MAX_AUDIO_BATCH_BYTES = 64 * 1024;
const MAX_QUEUED_AUDIO_BYTES = 256 * 1024;

export interface ServerSpeechTransport {
  readonly startSession: () => Promise<SpeechStreamingSessionStartResult>;
  readonly pushAudio: (
    input: SpeechStreamingAudioInput,
  ) => Promise<SpeechStreamingTranscriptResult>;
  readonly finishSession: (
    input: SpeechStreamingSessionInput,
  ) => Promise<SpeechStreamingTranscriptResult>;
  readonly cancelSession: (input: SpeechStreamingSessionInput) => Promise<void>;
}

export function createServerSpeechSession(
  input: ServerSpeechTransport & {
    readonly onTranscript: (text: string) => void;
    readonly onError: (error: Error) => void;
    readonly onProcessing?: (advancedMode: boolean) => void;
  },
) {
  let sessionId: SpeechStreamingSessionId | null = null;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let queuedBytes = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let sendChain = Promise.resolve();
  let stopped = false;
  let cancelled = false;
  let advancedMode = false;
  let stopPromise: Promise<SpeechStreamingTranscriptResult | void> | null = null;
  let removeAbortListener: () => void = () => undefined;

  const clearPending = () => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    pending = [];
    pendingBytes = 0;
  };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    stopped = true;
    clearPending();
    removeAbortListener();
    if (sessionId !== null) {
      void input.cancelSession({ sessionId }).catch(() => undefined);
      sessionId = null;
    }
  };
  const fail = (cause: unknown) => {
    if (cancelled) return;
    cancel();
    input.onError(cause instanceof Error ? cause : new Error("Voice streaming failed."));
  };
  const flush = (): Promise<void> => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    if (cancelled || sessionId === null || pendingBytes === 0) return sendChain;
    const audio = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const chunk of pending) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const activeSessionId = sessionId;
    clearPending();
    queuedBytes += audio.byteLength;
    sendChain = sendChain
      .then(async () => {
        try {
          if (cancelled) return;
          const result = await input.pushAudio({ sessionId: activeSessionId, audio });
          if (!cancelled) input.onTranscript(result.transcript);
        } finally {
          queuedBytes -= audio.byteLength;
        }
      })
      .catch(fail);
    return sendChain;
  };

  const pushAudio = (audio: Uint8Array) => {
    if (stopped || cancelled || sessionId === null || audio.byteLength === 0) return;
    if (queuedBytes + pendingBytes + audio.byteLength > MAX_QUEUED_AUDIO_BYTES) {
      fail(new Error("The connection is too slow for voice input. Try a shorter recording."));
      return;
    }
    for (let offset = 0; offset < audio.byteLength; offset += MAX_AUDIO_BATCH_BYTES) {
      const chunk = audio.slice(offset, offset + MAX_AUDIO_BATCH_BYTES);
      if (pendingBytes + chunk.byteLength > MAX_AUDIO_BATCH_BYTES) void flush();
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
    }
    if (flushTimer === null) flushTimer = setTimeout(() => void flush(), AUDIO_BATCH_DELAY_MS);
  };

  const connect = async (signal?: AbortSignal) => {
    if (cancelled || signal?.aborted) throw new Error("Voice input was cancelled.");
    const started = await input.startSession();
    if (cancelled || signal?.aborted) {
      await input.cancelSession(started);
      throw new Error("Voice input was cancelled.");
    }
    sessionId = started.sessionId;
    advancedMode = started.advancedMode === true;
    signal?.addEventListener("abort", cancel, { once: true });
    removeAbortListener = () => signal?.removeEventListener("abort", cancel);
  };

  const stop = (): Promise<SpeechStreamingTranscriptResult | void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = (async () => {
      if (cancelled || sessionId === null) return;
      try {
        await flush();
        if (cancelled || sessionId === null) return;
        input.onProcessing?.(advancedMode);
        const result = await input.finishSession({ sessionId });
        if (cancelled) return;
        input.onTranscript(result.transcript);
        return result;
      } catch (error) {
        cancel();
        throw error;
      } finally {
        sessionId = null;
        clearPending();
        removeAbortListener();
      }
    })();
    return stopPromise;
  };
  return { connect, pushAudio, stop, cancel };
}
