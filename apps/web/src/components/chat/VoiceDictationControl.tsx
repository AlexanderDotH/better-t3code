import { MicIcon, SquareIcon } from "lucide-react";
import { memo } from "react";

import type { AssemblyAiDictationState } from "../../hooks/useAssemblyAiDictation";

const WAVEFORM_BAR_KEYS = [
  "wave-01",
  "wave-02",
  "wave-03",
  "wave-04",
  "wave-05",
  "wave-06",
  "wave-07",
  "wave-08",
  "wave-09",
  "wave-10",
  "wave-11",
  "wave-12",
  "wave-13",
  "wave-14",
] as const;

function waveformBarHeight(level: number): number {
  const normalized = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  return Math.max(2, Math.round(normalized * 18));
}

export const VoiceDictationControl = memo(function VoiceDictationControl({
  state,
  audioWaveform,
  disabled,
  onStart,
  onStop,
}: {
  readonly state: AssemblyAiDictationState;
  readonly audioWaveform: ReadonlyArray<number>;
  readonly disabled: boolean;
  readonly onStart: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
}) {
  if (state === "idle") {
    return (
      <button
        type="button"
        className="flex h-9 w-9 enabled:cursor-pointer items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-all duration-150 hover:scale-105 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 sm:h-8 sm:w-8"
        disabled={disabled}
        onClick={() => void onStart()}
        aria-label="Start voice input"
        title="Start voice input"
      >
        <MicIcon className="size-4" />
      </button>
    );
  }

  const peakLevel = audioWaveform.reduce((peak, level) => Math.max(peak, level), 0);
  return (
    <div className="flex h-9 items-center gap-2 sm:h-8" data-voice-dictation-active="true">
      <div
        role="meter"
        aria-label="Live microphone waveform"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.max(0, Math.min(1, peakLevel)) * 100)}
        className="flex h-7 w-[4.5rem] items-center justify-center gap-px overflow-hidden rounded-full bg-rose-500/8 px-1.5"
      >
        {WAVEFORM_BAR_KEYS.slice(0, audioWaveform.length).map((key, index) => (
          <span
            key={key}
            data-voice-wave-bar="true"
            className="w-0.5 shrink-0 rounded-full bg-rose-500 transition-[height] duration-75 ease-out"
            style={{ height: waveformBarHeight(audioWaveform[index] ?? 0) }}
          />
        ))}
      </div>
      <button
        type="button"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white shadow-[0_0_0_3px_rgb(244_63_94/0.15)] transition-all hover:bg-rose-600 disabled:opacity-60 sm:h-8 sm:w-8"
        disabled={state === "stopping"}
        onClick={() => void onStop()}
        aria-label="Stop voice input"
        title="Stop voice input · Press Escape to cancel and restore the draft"
      >
        <SquareIcon className="size-2.5 fill-current" />
      </button>
    </div>
  );
});
