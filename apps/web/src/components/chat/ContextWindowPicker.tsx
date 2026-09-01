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
import { GaugeIcon } from "lucide-react";
import { memo, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { getProviderModelCapabilities } from "../../providerModels";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl, ComposerControlChevron } from "./ComposerControl";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

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

export function buildContextWindowSliderState(
  descriptor: SelectDescriptor,
  modelDefaultLabel = "Model default",
): {
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
  const currentLabel = descriptor.options[currentIndex]?.label ?? modelDefaultLabel;
  return {
    currentIndex,
    currentLabel,
    maxIndex,
    progressPercent: maxIndex === 0 ? 0 : (currentIndex / maxIndex) * 100,
    triggerLabel: currentLabel,
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

const CONTEXT_WINDOW_SLIDER_ADJUSTMENT_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

export function shouldStopContextWindowSliderKeyPropagation(key: string): boolean {
  return CONTEXT_WINDOW_SLIDER_ADJUSTMENT_KEYS.has(key);
}

type ContextWindowSelection = {
  readonly descriptor: SelectDescriptor;
  readonly visibleDescriptor: SelectDescriptor;
  readonly slider: ReturnType<typeof buildContextWindowSliderState>;
  readonly selectIndex: (index: number, notifyThread: boolean) => void;
};

function useContextWindowSelection(props: ContextWindowPickerProps): ContextWindowSelection | null {
  const translate = useInterfaceTranslator().message;
  const selected = contextWindowDescriptor(props);
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const externalValue = selected ? getProviderOptionCurrentValue(selected.descriptor) : undefined;
  const [optimisticValue, setOptimisticValue] = useState<string | null>(null);
  const lastNotifiedValueRef = useRef<string | null>(null);
  useEffect(() => setOptimisticValue(null), [externalValue, props.model, props.provider]);
  useEffect(() => {
    lastNotifiedValueRef.current = null;
  }, [props.draftId, props.model, props.provider, props.threadRef]);
  const visibleDescriptor = useMemo(
    () =>
      selected && optimisticValue
        ? { ...selected.descriptor, currentValue: optimisticValue }
        : selected?.descriptor,
    [optimisticValue, selected],
  );
  const slider = useMemo(
    () =>
      visibleDescriptor
        ? buildContextWindowSliderState(
            visibleDescriptor,
            translate("chat.contextWindow.modelDefault"),
          )
        : null,
    [translate, visibleDescriptor],
  );
  const selectIndex = useCallback(
    (index: number, notifyThread: boolean) => {
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

      setOptimisticValue(option.id);
      setProviderModelOptions(threadTarget, props.provider, nextOptions, {
        instanceId,
        model,
        persistSticky: false,
      });
      if (notifyThread && props.threadRef && lastNotifiedValueRef.current !== option.id) {
        lastNotifiedValueRef.current = option.id;
        props.onThreadModelSelectionChange?.(
          props.threadRef,
          createModelSelection(instanceId, model, nextOptions),
        );
      }
    },
    [props, selected, setProviderModelOptions],
  );

  if (!selected || !visibleDescriptor || !slider) {
    return null;
  }

  return {
    descriptor: selected.descriptor,
    visibleDescriptor,
    slider,
    selectIndex,
  };
}

function ContextWindowRangeSlider({
  selection,
  sliderId,
  isolateFromMenu,
}: {
  readonly selection: ContextWindowSelection;
  readonly sliderId: string;
  readonly isolateFromMenu: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const { slider } = selection;
  const ratio = slider.progressPercent / 100;
  const sliderStyle = {
    "--settings-slider-progress": `${slider.progressPercent}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;

  return (
    <input
      aria-label={translate("chat.contextWindow.size")}
      aria-valuetext={slider.currentLabel}
      className="settings-slider w-full"
      data-chat-context-window-slider={isolateFromMenu ? "menu" : "picker"}
      id={sliderId}
      max={slider.maxIndex}
      min={0}
      onBlur={(event) => selection.selectIndex(Number(event.currentTarget.value), true)}
      onChange={(event) => {
        if (isolateFromMenu) {
          event.stopPropagation();
        }
        selection.selectIndex(Number(event.currentTarget.value), false);
      }}
      onClick={(event) => {
        if (isolateFromMenu) {
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (isolateFromMenu && shouldStopContextWindowSliderKeyPropagation(event.key)) {
          event.stopPropagation();
        }
      }}
      onKeyUp={(event) => {
        if (!shouldStopContextWindowSliderKeyPropagation(event.key)) {
          return;
        }
        if (isolateFromMenu) {
          event.stopPropagation();
        }
        selection.selectIndex(Number(event.currentTarget.value), true);
      }}
      onPointerDown={(event) => {
        if (isolateFromMenu) {
          event.stopPropagation();
        }
      }}
      onPointerUp={(event) => {
        if (isolateFromMenu) {
          event.stopPropagation();
        }
        selection.selectIndex(Number(event.currentTarget.value), true);
      }}
      step={1}
      style={sliderStyle}
      type="range"
      value={slider.currentIndex}
    />
  );
}

function ContextWindowRangeEndpoints({ descriptor }: { readonly descriptor: SelectDescriptor }) {
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
      <span>{descriptor.options[0]?.label}</span>
      <span>{descriptor.options.at(-1)?.label}</span>
    </div>
  );
}

export const ContextWindowMenuContent = memo(function ContextWindowMenuContent(
  props: ContextWindowPickerProps,
) {
  const translate = useInterfaceTranslator().message;
  const selection = useContextWindowSelection(props);
  if (!selection) {
    return null;
  }

  return (
    <div className="w-full px-2 py-1.5" data-chat-context-window-menu-content="true">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="font-medium text-muted-foreground text-xs">
          {translate("chat.contextWindow.title")}
        </div>
        <output
          className="font-medium tabular-nums text-foreground text-xs"
          htmlFor="chat-context-window-menu-slider"
        >
          {selection.slider.currentLabel}
        </output>
      </div>
      <ContextWindowRangeSlider
        isolateFromMenu
        selection={selection}
        sliderId="chat-context-window-menu-slider"
      />
      <ContextWindowRangeEndpoints descriptor={selection.descriptor} />
    </div>
  );
});

export const ContextWindowPicker = memo(function ContextWindowPicker(
  props: ContextWindowPickerProps,
) {
  const translate = useInterfaceTranslator().message;
  const selection = useContextWindowSelection(props);
  if (!selection) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <ComposerControl
            aria-label={translate("chat.contextWindow.pickerLabel", {
              label: selection.slider.currentLabel,
            })}
            className="min-w-16 shrink-0 justify-between whitespace-nowrap px-2.5"
            data-chat-context-window-picker="true"
            variant="ghost"
          />
        }
      >
        <span className="tabular-nums">{selection.slider.triggerLabel}</span>
        <ComposerControlChevron />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        side="top"
        collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
        collisionPadding={12}
        positionMethod="fixed"
        className="w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl"
        viewportClassName="p-0"
      >
        <div className="flex flex-col gap-3.5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/55 text-foreground">
              <GaugeIcon aria-hidden="true" className="size-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm text-foreground">
                {translate("chat.contextWindow.title")}
              </div>
              <div className="mt-0.5 text-pretty text-muted-foreground text-xs leading-relaxed">
                {translate("chat.contextWindow.savedDescription")}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border/65 bg-muted/30 px-3.5 pb-3 pt-3">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <output
                className="font-semibold text-2xl tabular-nums tracking-tight text-foreground"
                htmlFor="chat-context-window-slider"
              >
                {selection.slider.currentLabel}
              </output>
              <span className="rounded-md border border-border/60 bg-background/55 px-2 py-1 font-medium text-[10px] uppercase tracking-wide text-muted-foreground">
                {selection.visibleDescriptor.options[selection.slider.currentIndex]?.isDefault
                  ? translate("chat.contextWindow.modelDefault")
                  : translate("chat.contextWindow.custom")}
              </span>
            </div>
            <ContextWindowRangeSlider
              isolateFromMenu={false}
              selection={selection}
              sliderId="chat-context-window-slider"
            />
            <ContextWindowRangeEndpoints descriptor={selection.descriptor} />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
