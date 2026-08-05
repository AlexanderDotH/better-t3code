import { MicIcon, SquareIcon } from "lucide-react";
import { memo } from "react";

import type { AssemblyAiDictationState } from "../../hooks/useAssemblyAiDictation";
import { cn } from "../../lib/utils";

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

  const canSpeak = state === "recording";
  const buttonLabel =
    state === "starting"
      ? "Cancel voice input connection"
      : state === "stopping"
        ? "Stopping voice input"
        : "Stop voice input";
  const peakLevel = audioWaveform.reduce((peak, level) => Math.max(peak, level), 0);
  return (
    <div
      className="flex h-9 items-center gap-3 sm:h-8"
      data-voice-dictation-active="true"
      data-voice-dictation-tone={canSpeak ? "ready" : "waiting"}
    >
      <div
        role="meter"
        aria-label="Live microphone waveform"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.max(0, Math.min(1, peakLevel)) * 100)}
        className={cn(
          "flex h-8 w-20 items-center justify-center gap-0.5 overflow-hidden rounded-full px-2",
          canSpeak ? "bg-rose-500/8" : "bg-muted",
        )}
      >
        {WAVEFORM_BAR_KEYS.slice(0, audioWaveform.length).map((key, index) => (
          <span
            key={key}
            data-voice-wave-bar="true"
            className={cn(
              "w-0.5 shrink-0 rounded-full transition-[height] duration-75 ease-out",
              canSpeak ? "bg-rose-500" : "bg-muted-foreground/35",
            )}
            style={{ height: waveformBarHeight(audioWaveform[index] ?? 0) }}
          />
        ))}
      </div>
      <button
        type="button"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-60 sm:h-8 sm:w-8",
          canSpeak
            ? "bg-rose-500 text-white shadow-[0_0_0_3px_rgb(244_63_94/0.15)] hover:bg-rose-600"
            : "border border-border/70 bg-muted text-muted-foreground hover:bg-muted/80",
        )}
        disabled={state === "stopping"}
        onClick={() => void onStop()}
        aria-busy={state === "stopping" || undefined}
        aria-label={buttonLabel}
        title={
          state === "starting"
            ? "Connecting to AssemblyAI · Select to cancel"
            : "Stop voice input · Press Escape to cancel and restore the draft"
        }
      >
        <SquareIcon className="size-2.5 fill-current" />
      </button>
    </div>
  );
});
