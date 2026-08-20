import {
  defaultInstanceIdForDriver,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  CODEX_CONTEXT_WINDOW_OPTION_ID,
  createModelSelection,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { memo, type CSSProperties, useCallback, useMemo } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl, ComposerControlChevron } from "./ComposerControl";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export interface ContextWindowPickerProps {
  readonly provider: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly model: string | null | undefined;
  readonly modelOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly threadRef?: ScopedThreadRef;
  readonly draftId?: DraftId;
  readonly onThreadModelSelectionChange?: (
    threadRef: ScopedThreadRef,
    modelSelection: ModelSelection,
  ) => void;
}

function contextWindowDescriptor(input: {
  readonly provider: ProviderDriverKind;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly model: string | null | undefined;
  readonly modelOptions?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): {
  readonly descriptor: SelectDescriptor;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
} | null {
  if (input.provider !== "codex") {
    return null;
  }
  const descriptors = getProviderOptionDescriptors({
    caps: getProviderModelCapabilities(input.models, input.model, input.provider),
    selections: input.modelOptions,
  });
  const descriptor = descriptors.find(
    (candidate): candidate is SelectDescriptor =>
      candidate.id === CODEX_CONTEXT_WINDOW_OPTION_ID && candidate.type === "select",
  );
  return descriptor && descriptor.options.length > 0 ? { descriptor, descriptors } : null;
}

export function buildContextWindowSliderState(descriptor: SelectDescriptor): {
  readonly currentIndex: number;
  readonly currentLabel: string;
  readonly maxIndex: number;
  readonly progressPercent: number;
  readonly triggerLabel: string;
} {
  const currentValue = getProviderOptionCurrentValue(descriptor);
  const selectedIndex = descriptor.options.findIndex((option) => option.id === currentValue);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const maxIndex = Math.max(0, descriptor.options.length - 1);
  const currentLabel = descriptor.options[currentIndex]?.label ?? "Model default";
  const compactLabel = currentLabel === "Model default" ? "Default" : currentLabel;
  return {
    currentIndex,
    currentLabel,
    maxIndex,
    progressPercent: maxIndex === 0 ? 0 : (currentIndex / maxIndex) * 100,
    triggerLabel: `Context ${compactLabel}`,
  };
}

function withContextWindowValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  value: string,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id === CODEX_CONTEXT_WINDOW_OPTION_ID && descriptor.type === "select"
      ? { ...descriptor, currentValue: value }
      : descriptor,
  );
}

export function shouldRenderContextWindowControl(input: ContextWindowPickerProps): boolean {
  return contextWindowDescriptor(input) !== null;
}

export const ContextWindowPicker = memo(function ContextWindowPicker(
  props: ContextWindowPickerProps,
) {
  const selected = contextWindowDescriptor(props);
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const slider = useMemo(
    () => (selected ? buildContextWindowSliderState(selected.descriptor) : null),
    [selected],
  );
  const selectIndex = useCallback(
    (index: number) => {
      if (!selected) {
        return;
      }
      const option = selected.descriptor.options[index];
      const threadTarget = props.threadRef ?? props.draftId;
      if (!option || !threadTarget) {
        return;
      }
      const nextDescriptors = withContextWindowValue(selected.descriptors, option.id);
      const nextOptions = buildProviderOptionSelectionsFromDescriptors(nextDescriptors);
      const instanceId = props.instanceId ?? defaultInstanceIdForDriver(props.provider);
      const model = props.model?.trim();
      if (!model) {
        return;
      }

      setProviderModelOptions(threadTarget, props.provider, nextOptions, {
        instanceId,
        model,
        persistSticky: false,
      });
      if (props.threadRef) {
        props.onThreadModelSelectionChange?.(
          props.threadRef,
          createModelSelection(instanceId, model, nextOptions),
        );
      }
    },
    [props, selected, setProviderModelOptions],
  );

  if (!selected || !slider) {
    return null;
  }

  const ratio = slider.progressPercent / 100;
  const sliderStyle = {
    "--settings-slider-progress": `${slider.progressPercent}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <ComposerControl
            aria-label={`Context window: ${slider.currentLabel}`}
            className="shrink-0 whitespace-nowrap"
            data-chat-context-window-picker="true"
            variant="ghost"
          />
        }
      >
        <span className="tabular-nums">{slider.triggerLabel}</span>
        <ComposerControlChevron />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="top"
        className="w-72 max-w-[calc(100vw-2rem)]"
        viewportClassName="p-0"
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium text-sm text-foreground">Context window</div>
              <div className="mt-0.5 text-pretty text-muted-foreground text-xs">
                Applied only to this chat and synced with the thread.
              </div>
            </div>
            <output
              className="shrink-0 rounded-md bg-muted px-2 py-1 font-mono font-medium text-xs tabular-nums text-foreground"
              htmlFor="chat-context-window-slider"
            >
              {slider.currentLabel}
            </output>
          </div>
          <input
            aria-label="Context window size"
            aria-valuetext={slider.currentLabel}
            className="settings-slider w-full"
            id="chat-context-window-slider"
            max={slider.maxIndex}
            min={0}
            onChange={(event) => selectIndex(Number(event.currentTarget.value))}
            step={1}
            style={sliderStyle}
            type="range"
            value={slider.currentIndex}
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{selected.descriptor.options[0]?.label}</span>
            <span>{selected.descriptor.options.at(-1)?.label}</span>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
