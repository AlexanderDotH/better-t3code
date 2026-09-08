interface AssemblyAiProcessorOptions {
  readonly processorOptions: {
    readonly outputSampleRate: number;
    readonly chunkMs: number;
  };
}

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processor: new (options: AssemblyAiProcessorOptions) => AudioWorkletProcessor,
): void;

class T3AssemblyAiPcm16Processor extends AudioWorkletProcessor {
  readonly #ratio: number;
  readonly #chunkSamples: number;
  #source: number[] = [];
  #position = 0;
  #pending: number[] = [];

  constructor(options: AssemblyAiProcessorOptions) {
    super();
    const outputRate = options.processorOptions.outputSampleRate;
    this.#ratio = sampleRate / outputRate;
    this.#chunkSamples = Math.max(
      1,
      Math.round((outputRate * options.processorOptions.chunkMs) / 1_000),
    );
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;
    for (const sample of channel) this.#source.push(sample);

    while (this.#position < this.#source.length) {
      const index = Math.floor(this.#position);
      const fraction = this.#position - index;
      if (fraction > 0 && index + 1 >= this.#source.length) break;
      const left = this.#source[index] ?? 0;
      const right = this.#source[index + 1] ?? left;
      this.#pending.push(left + (right - left) * fraction);
      this.#position += this.#ratio;
    }

    const consumed = Math.min(Math.floor(this.#position), this.#source.length);
    if (consumed > 0) {
      this.#source.splice(0, consumed);
      this.#position -= consumed;
    }

    while (this.#pending.length >= this.#chunkSamples) {
      const buffer = new ArrayBuffer(this.#chunkSamples * 2);
      const view = new DataView(buffer);
      let sumSquares = 0;
      for (let index = 0; index < this.#chunkSamples; index += 1) {
        const sample = Math.max(-1, Math.min(1, this.#pending[index] ?? 0));
        sumSquares += sample * sample;
        view.setInt16(index * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
      }
      this.#pending.splice(0, this.#chunkSamples);
      const rms = Math.sqrt(sumSquares / this.#chunkSamples);
      const visualLevel = Math.min(1, Math.sqrt(rms) * 1.8);
      this.port.postMessage({ type: "audio-level", level: visualLevel }, []);
      this.port.postMessage(buffer, [buffer]);
    }

    return true;
  }
}

registerProcessor("t3-assemblyai-pcm16", T3AssemblyAiPcm16Processor);
