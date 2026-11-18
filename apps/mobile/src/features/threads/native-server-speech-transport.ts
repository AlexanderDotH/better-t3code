import { Pcm16ChunkEncoder, pcm16AudioLevel } from "@t3tools/client-runtime/assembly-ai";
import {
  createServerSpeechSession,
  type ServerSpeechTransport,
} from "@t3tools/client-runtime/server-speech-session";
import type { SpeechStreamingTranscriptResult } from "@t3tools/contracts";
import type { AudioStreamBuffer } from "expo-audio";

const AUDIO_CHUNK_DURATION_MS = 50;

export interface NativeServerSpeechSession {
  readonly connect: (signal?: AbortSignal) => Promise<void>;
  readonly pushAudio: (buffer: AudioStreamBuffer) => void;
  readonly stop: () => Promise<SpeechStreamingTranscriptResult | void>;
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

export function createNativeServerSpeechSession(
  input: ServerSpeechTransport & {
    readonly onTranscript: (text: string) => void;
    readonly onAudioLevel: (level: number) => void;
    readonly onError: (error: Error) => void;
    readonly onProcessing?: (advancedMode: boolean) => void;
  },
): NativeServerSpeechSession {
  const session = createServerSpeechSession(input);
  let encoder: Pcm16ChunkEncoder | null = null;
  let encoderInputRate = 0;

  const pushAudio = (buffer: AudioStreamBuffer) => {
    input.onAudioLevel(pcm16AudioLevel(buffer.data));
    if (encoder === null || encoderInputRate !== buffer.sampleRate) {
      encoderInputRate = buffer.sampleRate;
      encoder = new Pcm16ChunkEncoder(buffer.sampleRate, 16_000, AUDIO_CHUNK_DURATION_MS);
    }
    for (const chunk of encoder.push(monoFloatSamples(buffer)))
      session.pushAudio(new Uint8Array(chunk));
  };

  return { ...session, pushAudio };
}
