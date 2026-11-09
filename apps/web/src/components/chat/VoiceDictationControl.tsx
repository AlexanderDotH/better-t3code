import { HourglassIcon, MicIcon, SquareIcon, Undo2Icon, XIcon } from "lucide-react";
import { memo } from "react";

import type { AssemblyAiDictationState } from "../../hooks/useAssemblyAiDictation";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, type ComposerControlSize } from "./ComposerControl";

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
  onCancel,
  onRestoreOriginal,
  size = "sm",
  shortcutLabel,
}: {
  readonly state: AssemblyAiDictationState;
  readonly audioWaveform: ReadonlyArray<number>;
  readonly disabled: boolean;
  readonly onStart: () => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly onCancel: () => void;
  readonly onRestoreOriginal?: (() => void) | undefined;
  readonly size?: ComposerControlSize;
  readonly shortcutLabel?: string | null | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  if (state === "idle") {
    return (
      <div className="flex shrink-0 items-center gap-0.5" data-voice-dictation-state={state}>
        {onRestoreOriginal ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ComposerControl
                  size={size}
                  disabled={disabled}
                  onClick={onRestoreOriginal}
                  aria-label={translate("chat.composer.voiceRestoreOriginal")}
                />
              }
            >
              <Undo2Icon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>{translate("chat.composer.voiceRestoreOriginal")}</TooltipPopup>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <ComposerControl
                size={size}
                disabled={disabled}
                onClick={() => void onStart()}
                data-composer-shortcut="composer.voiceInput"
                aria-label={translate("chat.composer.voiceStart")}
              />
            }
          >
            <MicIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {translate("chat.composer.voiceStart")}
            {shortcutLabel ? ` (${shortcutLabel})` : null}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  const canSpeak = state === "recording";
  const buttonLabel =
    state === "starting"
      ? translate("chat.composer.voiceCancelConnection")
      : state === "stopping"
        ? translate("chat.composer.voiceProcessing")
        : translate("chat.composer.voiceStop");
  const buttonTooltip =
    state === "starting"
      ? translate("chat.composer.voiceConnectingTooltip")
      : state === "stopping"
        ? translate("chat.composer.voiceProcessing")
        : translate("chat.composer.voiceStopTooltip");
  const peakLevel = audioWaveform.reduce(
    (peak, level) => (Number.isFinite(level) ? Math.max(peak, level) : peak),
    0,
  );
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      data-voice-dictation-active="true"
      data-voice-dictation-state={state}
      data-voice-dictation-tone={canSpeak ? "ready" : "waiting"}
    >
      <span className="sr-only" role="status">
        {state === "starting"
          ? translate("chat.composer.voiceConnectingTooltip")
          : state === "stopping"
            ? translate("chat.composer.voiceProcessing")
            : null}
      </span>
      <div
        role="meter"
        aria-label={translate("chat.composer.voiceWaveform")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.max(0, Math.min(1, peakLevel)) * 100)}
        className={cn(
          "flex items-center justify-center gap-px overflow-hidden rounded-(--control-radius) px-1",
          size === "xs" ? "h-6 w-14" : "h-7 w-16",
          canSpeak ? "bg-voice-recording/8" : "bg-muted",
        )}
      >
        {WAVEFORM_BAR_KEYS.map((key, index) => (
          <span
            key={key}
            data-voice-wave-bar="true"
            className={cn(
              "w-0.5 shrink-0 rounded-full motion-safe:transition-[height] motion-safe:duration-75 motion-safe:ease-out",
              canSpeak ? "bg-voice-recording" : "bg-muted-foreground/35",
            )}
            style={{ height: waveformBarHeight(audioWaveform[index] ?? 0) }}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              size={size}
              className={cn(
                canSpeak &&
                  "bg-voice-recording text-white shadow-voice-recording hover:bg-voice-recording-hover hover:text-white dark:text-white",
              )}
              disabled={state === "stopping"}
              data-composer-shortcut="composer.voiceInput"
              onClick={() => (state === "starting" ? onCancel() : void onStop())}
              aria-busy={state === "stopping" || undefined}
              aria-label={buttonLabel}
            />
          }
        >
          {state === "starting" ? (
            <XIcon className="size-3.5" />
          ) : state === "stopping" ? (
            <HourglassIcon className="size-3.5" />
          ) : (
            <SquareIcon className="size-2.5 fill-current text-current" />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {buttonTooltip}
          {shortcutLabel && state !== "stopping" ? ` (${shortcutLabel})` : null}
        </TooltipPopup>
      </Tooltip>
      {state !== "starting" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <ComposerControl
                size={size}
                onClick={onCancel}
                aria-label={translate("chat.composer.voiceCancel")}
              />
            }
          >
            <XIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{translate("chat.composer.voiceCancel")}</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});
