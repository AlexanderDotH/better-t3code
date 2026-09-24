import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  type AssemblyAiStreamingTokenResult,
} from "@t3tools/contracts";

import {
  AssemblyAiTranscriptAccumulator,
  Pcm16ChunkEncoder,
  buildAssemblyAiStreamingUrl,
  parseAssemblyAiStreamingMessage,
} from "./assemblyAiStreaming.ts";

describe("streaming dictation", () => {
  it("replaces partial turns and deduplicates finalized transcripts", () => {
    const transcript = new AssemblyAiTranscriptAccumulator();
    transcript.update({ transcript: "Hello", endOfTurn: false, turnOrder: 0 });
    transcript.update({ transcript: "Hello world", endOfTurn: true, turnOrder: 0 });
    transcript.update({ transcript: "Hello world", endOfTurn: true, turnOrder: 0 });
    expect(transcript.text).toBe("Hello world");
    expect(parseAssemblyAiStreamingMessage({ type: "Turn", transcript: 42 })).toEqual({
      _tag: "ignore",
    });
  });

  it("retains samples between chunks and clips PCM output", () => {
    const encoder = new Pcm16ChunkEncoder(1_000, 1_000, 4);
    expect(encoder.push(new Float32Array([-2, 0]))).toEqual([]);
    const chunks = encoder.push(new Float32Array([2, 0.5]));
    expect(chunks).toHaveLength(1);
    const pcm = new DataView(chunks[0]!);
    expect([0, 2, 4, 6].map((offset) => pcm.getInt16(offset, true))).toEqual([
      -32768, 0, 32767, 16384,
    ]);
  });
});

describe("AssemblyAI streaming configuration", () => {
  const config: AssemblyAiStreamingTokenResult = {
    token: "temporary",
    websocketUrl: "wss://streaming.assemblyai.com/v3/ws",
    expiresInSeconds: 60,
    sampleRate: 16_000,
    encoding: "pcm_s16le",
    speechModel: "universal-3-5-pro",
    context: { source: "indexed", prompt: "Code dictation", keyterms: ["TypeScript"] },
    options: {
      ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
      languageCodes: ["de", "en"],
      streamingMode: "max_accuracy",
      minTurnSilence: 700,
      maxTurnSilence: 2_000,
      vadThreshold: 0.3,
      interruptionDelay: 500,
      voiceFocus: "far-field",
    },
  };

  it("encodes supported Universal 3.5 Pro options and omits legacy formatting", () => {
    const params = new URL(buildAssemblyAiStreamingUrl(config)).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      speech_model: "universal-3-5-pro",
      language_codes: '["de","en"]',
      mode: "max_accuracy",
      min_turn_silence: "700",
      max_turn_silence: "2000",
      vad_threshold: "0.3",
      include_partial_turns: "true",
      interruption_delay: "500",
      continuous_partials: "true",
      voice_focus: "far-field",
      prompt: "Code dictation",
      keyterms_prompt: '["TypeScript"]',
    });
    expect(params.has("format_turns")).toBe(false);
  });

  for (const speechModel of ["universal-streaming-english", "universal-streaming-multilingual"]) {
    it(`does not send unsupported Pro options for ${speechModel}`, () => {
      const params = new URL(buildAssemblyAiStreamingUrl({ ...config, speechModel })).searchParams;
      expect(params.get("format_turns")).toBe("true");
      expect(params.get("min_turn_silence")).toBe("700");
      expect(params.get("include_partial_turns")).toBe("true");
      for (const key of [
        "prompt",
        "language_codes",
        "mode",
        "interruption_delay",
        "continuous_partials",
      ]) {
        expect(params.has(key)).toBe(false);
      }
    });
  }

  it("supports tokens returned by older servers without options", () => {
    const { options: _options, ...legacyConfig } = config;
    const params = new URL(buildAssemblyAiStreamingUrl(legacyConfig)).searchParams;
    expect(params.get("token")).toBe("temporary");
    expect(params.get("prompt")).toBe("Code dictation");
    expect(params.has("mode")).toBe(false);
  });
});
