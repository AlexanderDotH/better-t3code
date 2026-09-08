import { describe, expect, it } from "vite-plus/test";

import {
  AssemblyAiTranscriptAccumulator,
  Pcm16ChunkEncoder,
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
