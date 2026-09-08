import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";

export interface AssemblyAiTranscriptTurn {
  readonly transcript: string;
  readonly endOfTurn: boolean;
  readonly turnOrder: number | null;
}

export type AssemblyAiStreamingMessage =
  | { readonly _tag: "turn"; readonly turn: AssemblyAiTranscriptTurn }
  | { readonly _tag: "termination"; readonly reason: string }
  | { readonly _tag: "error"; readonly message: string }
  | { readonly _tag: "ignore" };

function normalizedTranscript(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export class AssemblyAiTranscriptAccumulator {
  readonly #orderedFinalized = new Map<number, string>();
  #unorderedFinalized: string[] = [];
  #partial = "";
  #partialOrder: number | null = null;

  update(update: AssemblyAiTranscriptTurn): string {
    const transcript = normalizedTranscript(update.transcript);
    if (update.endOfTurn) {
      if (transcript.length > 0) {
        if (update.turnOrder !== null) {
          this.#orderedFinalized.set(update.turnOrder, transcript);
        } else if (this.#unorderedFinalized.at(-1) !== transcript) {
          this.#unorderedFinalized.push(transcript);
        }
      }
      if (update.turnOrder === null || update.turnOrder === this.#partialOrder) {
        this.#partial = "";
        this.#partialOrder = null;
      }
    } else {
      this.#partial = transcript;
      this.#partialOrder = update.turnOrder;
    }
    return this.text;
  }

  get text(): string {
    const finalized = [
      ...[...this.#orderedFinalized.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text),
      ...this.#unorderedFinalized,
    ];
    return [...finalized, this.#partial].filter((part) => part.length > 0).join(" ");
  }
}

function pcm16Sample(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

function pcm16Buffer(samples: ReadonlyArray<number>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, pcm16Sample(sample), true));
  return buffer;
}

export class Pcm16ChunkEncoder {
  readonly #ratio: number;
  readonly #chunkSamples: number;
  #source: number[] = [];
  #sourcePosition = 0;
  #pending: number[] = [];

  constructor(inputSampleRate: number, outputSampleRate: number, chunkMs: number) {
    if (inputSampleRate <= 0 || outputSampleRate <= 0 || chunkMs <= 0) {
      throw new Error("Audio sample rates and chunk duration must be positive.");
    }
    this.#ratio = inputSampleRate / outputSampleRate;
    this.#chunkSamples = Math.max(1, Math.round((outputSampleRate * chunkMs) / 1_000));
  }

  push(input: Float32Array): ArrayBuffer[] {
    for (const sample of input) this.#source.push(sample);

    while (this.#sourcePosition < this.#source.length) {
      const index = Math.floor(this.#sourcePosition);
      const fraction = this.#sourcePosition - index;
      if (fraction > 0 && index + 1 >= this.#source.length) break;
      const left = this.#source[index] ?? 0;
      const right = this.#source[index + 1] ?? left;
      this.#pending.push(left + (right - left) * fraction);
      this.#sourcePosition += this.#ratio;
    }

    const consumed = Math.min(Math.floor(this.#sourcePosition), this.#source.length);
    if (consumed > 0) {
      this.#source.splice(0, consumed);
      this.#sourcePosition -= consumed;
    }

    const chunks: ArrayBuffer[] = [];
    while (this.#pending.length >= this.#chunkSamples) {
      chunks.push(pcm16Buffer(this.#pending.splice(0, this.#chunkSamples)));
    }
    return chunks;
  }
}

export function buildAssemblyAiStreamingUrl(config: AssemblyAiStreamingTokenResult): string {
  const url = new URL(config.websocketUrl);
  url.searchParams.set("sample_rate", String(config.sampleRate));
  url.searchParams.set("encoding", config.encoding);
  url.searchParams.set("speech_model", config.speechModel);
  url.searchParams.set("format_turns", "true");
  url.searchParams.set("prompt", config.context.prompt);
  if (config.context.keyterms.length > 0) {
    url.searchParams.set("keyterms_prompt", JSON.stringify(config.context.keyterms));
  }
  url.searchParams.set("token", config.token);
  return url.toString();
}

export function parseAssemblyAiStreamingMessage(value: unknown): AssemblyAiStreamingMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { _tag: "ignore" };
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "Turn" && typeof record.transcript === "string") {
    return {
      _tag: "turn",
      turn: {
        transcript: record.transcript,
        endOfTurn: record.end_of_turn === true,
        turnOrder: typeof record.turn_order === "number" ? record.turn_order : null,
      },
    };
  }
  if (type === "Termination") {
    return {
      _tag: "termination",
      reason: typeof record.reason === "string" ? record.reason : "",
    };
  }
  if (type === "Error" || type === "error") {
    return {
      _tag: "error",
      message:
        typeof record.error === "string"
          ? record.error
          : typeof record.message === "string"
            ? record.message
            : "AssemblyAI reported a streaming service error.",
    };
  }
  return { _tag: "ignore" };
}

export function renderAssemblyAiDictationDraft(original: string, transcript: string): string {
  if (transcript.length === 0) return original;
  const separator = original.length === 0 || /\s$/u.test(original) ? "" : " ";
  return `${original}${separator}${transcript}`;
}

export function pcm16AudioLevel(data: ArrayBuffer): number {
  const view = new DataView(data);
  const sampleCount = Math.floor(view.byteLength / 2);
  if (sampleCount === 0) return 0;
  const stride = Math.max(1, Math.floor(sampleCount / 256));
  let sum = 0;
  let count = 0;
  for (let index = 0; index < sampleCount; index += stride) {
    const sample = view.getInt16(index * 2, true) / 0x8000;
    sum += sample * sample;
    count += 1;
  }
  return Math.max(0, Math.min(1, Math.sqrt(sum / Math.max(1, count)) * 3));
}
