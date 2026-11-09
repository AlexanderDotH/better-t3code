import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ModelSelectionPurpose,
  type ProviderInstanceId,
  type EnvironmentId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { createContext, memo, type ReactNode, useRef, useState } from "react";
import { MicIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { ModelPickerContent, resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ChatGptSharingControl } from "./ChatGptSharingControl";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ModelEsque, getDisplayModelName, getTriggerDisplayModelName } from "./providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import {
  ComposerControl,
  ComposerControlChevron,
  type ComposerControlSize,
} from "./ComposerControl";
import { takeOpenTarget, useComposerMenuProps } from "./composerEventScope";
import { shortcutLabelForCommand } from "../../keybindings";

/** Holds the page still behind the open picker; its lifetime is the popup element's. */
function lockBackgroundScroll(popup: HTMLElement | null) {
  if (!popup) return;
  const { documentElement, body } = document;
  const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior;
  const previousBodyOverflow = body.style.overflow;
  const previousBodyPaddingRight = body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

  documentElement.style.overscrollBehavior = "contain";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }

  const shouldAllowOverlayScroll = (target: EventTarget | null) => {
    return (
      target instanceof Element &&
      target.closest(
        "[data-model-picker-content], [data-model-picker-effort], [data-model-picker-option-menu]",
      )
    );
  };
  const preventBackgroundWheel = (event: WheelEvent) => {
    if (shouldAllowOverlayScroll(event.target)) {
      return;
    }
    event.preventDefault();
  };
  const preventBackgroundTouchMove = (event: TouchEvent) => {
    if (shouldAllowOverlayScroll(event.target)) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener("wheel", preventBackgroundWheel, { capture: true, passive: false });
  document.addEventListener("touchmove", preventBackgroundTouchMove, {
    capture: true,
    passive: false,
  });

  return () => {
    document.removeEventListener("wheel", preventBackgroundWheel, { capture: true });
    document.removeEventListener("touchmove", preventBackgroundTouchMove, { capture: true });
    documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
    body.style.overflow = previousBodyOverflow;
    body.style.paddingRight = previousBodyPaddingRight;
  };
}

/** What a docked effort column needs from its picker: the model it serves. */
export const DockedPickerContext = createContext<{ modelLabel: string }>({ modelLabel: "" });

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  environmentId: EnvironmentId | null;
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  modelSelectionPurpose?: ModelSelectionPurpose;
  activeProviderIconClassName?: string;
  instanceIndicatorBackground?: string;
  size?: ComposerControlSize;
  layout?: "current" | "classic";
  compact?: boolean;
  isComposerOwned?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  popupAlign?: "start" | "end";
  triggerClassName?: string;
  triggerVariant?: "outline" | "ghost";
  triggerLabel?: string;
  triggerAriaLabel?: string;
  placeholder?: string;
  fallbackToFirstModel?: boolean;
  auxiliaryModels?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  selectedAuxiliaryModel?: string | null;
  onAuxiliaryModelChange?: (model: string) => void;
  onOpenChange?: (open: boolean) => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** Shown after the model name inside the same trigger, such as the effort level. */
  triggerSuffix?: ReactNode;
  /** Names the suffix for the tooltip and screen readers. */
  triggerDetail?: string | null;
  /** Composer shortcuts this trigger answers besides the picker's own. */
  triggerShortcuts?: string;
  /**
   * Docks an effort column beside the list and a footer under both. The popup then stays open
   * until Escape or an outside press, and picking a model moves focus to its levels.
   */
  effortColumn?: ReactNode;
  footer?: ReactNode;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const size = props.size ?? "sm";
  const classic = props.layout === "classic";
  const docked = !classic && props.effortColumn !== undefined;

  const activeEntry =
    props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null;

  const activeInstanceId = props.activeInstanceId;
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? [];
  const isEmptySelection = props.model === "" && props.placeholder !== undefined;
  const selectedModel =
    isEmptySelection || props.selectedAuxiliaryModel
      ? undefined
      : (resolveModelPickerSelectedModel({
          driverKind: activeEntry?.driverKind,
          model: props.model,
          options: selectedInstanceOptions,
        }) ??
        (props.fallbackToFirstModel === false ||
        activeEntry?.driverKind === "opencode" ||
        activeEntry?.driverKind === "antigravity"
          ? undefined
          : selectedInstanceOptions[0]));
  const auxiliaryModel = props.auxiliaryModels?.find(
    (model) => model.id === props.selectedAuxiliaryModel,
  );
  const triggerTitle = props.selectedAuxiliaryModel
    ? (auxiliaryModel?.name ?? props.selectedAuxiliaryModel)
    : isEmptySelection
      ? (props.placeholder ?? "Choose model")
      : selectedModel
        ? getTriggerDisplayModelName(selectedModel, activeEntry?.driverKind)
        : props.model === ANTIGRAVITY_DEFAULT_MODEL
          ? "Choose model"
          : props.model || "Choose model";
  const triggerLabel = props.selectedAuxiliaryModel
    ? `AssemblyAI Gateway · ${triggerTitle}`
    : selectedModel
      ? `${getDisplayModelName(selectedModel)}${selectedModel.isUnavailable ? " (Unavailable)" : ""}`
      : triggerTitle;
  const showInstanceBadge =
    !isEmptySelection &&
    !props.selectedAuxiliaryModel &&
    activeEntry !== null &&
    shouldShowInstanceBadge(activeEntry, props.instanceEntries);

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  /**
   * Focuses the selected reasoning level, else the first level. With `rows: "any"` it falls back
   * to the column's first enabled option. False when nothing took focus.
   */
  const focusEffort = (rows: "levels" | "any") => {
    const column = popupRef.current?.querySelector("[data-model-picker-effort]");
    const level =
      column?.querySelector<HTMLElement>(
        '[data-effort-level][aria-checked="true"]:not(:disabled)',
      ) ?? column?.querySelector<HTMLElement>("[data-effort-level]:not(:disabled)");
    // No aria-checked here: an On switch is checked but is not where focus belongs.
    const row =
      level ??
      (rows === "any"
        ? column?.querySelector<HTMLElement>("[data-effort-row]:not(:disabled)")
        : null);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
    return row != null;
  };
  const openTarget = (target: "effort" | "permissions") => {
    if (target === "effort") {
      focusEffort("any");
      return;
    }
    popupRef.current
      ?.querySelector<HTMLButtonElement>("[data-composer-permissions-trigger]")
      ?.click();
  };

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    if (!docked) {
      setIsMenuOpen(false);
      return;
    }
    // The column renders the new model's levels on commit.
    window.requestAnimationFrame(() => focusEffort("levels"));
  };

  const shortcutLabel = props.keybindings
    ? shortcutLabelForCommand(props.keybindings, "modelPicker.toggle")
    : null;
  const selectedEntries = props.selectedModels?.map((selection) => {
    const entry = props.instanceEntries.find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: props.modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    const unavailable = model?.isUnavailable ? " (Unavailable)" : "";
    return {
      ...selection,
      entry,
      label: model
        ? `${getTriggerDisplayModelName(model, entry?.driverKind)}${unavailable}`
        : selection.model,
      fullLabel: model ? `${getDisplayModelName(model)}${unavailable}` : selection.model,
    };
  });
  const multipleLabel = selectedEntries
    ? selectedEntries.length === 0
      ? "Choose models"
      : `${selectedEntries
          .slice(0, 2)
          .map((selection) => selection.label)
          .join(", ")}${selectedEntries.length > 2 ? `, ${selectedEntries.length - 2} more` : ""}`
    : undefined;
  const allModelNames = selectedEntries
    ? selectedEntries.map((selection) => selection.fullLabel).join(", ") || "Choose models"
    : undefined;
  const triggerTooltipContent = [
    props.triggerLabel ?? allModelNames ?? triggerLabel,
    props.triggerDetail,
    shortcutLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const triggerText = props.triggerLabel ?? multipleLabel ?? triggerTitle;
  const triggerTextProps = {
    className: cn(
      "min-w-0 flex-1 overflow-hidden truncate",
      // Long names such as "Fusion (Claude Opus 5.5 Medium + SWE-2 High)" would push the composer.
      props.isComposerOwned && "max-w-56",
    ),
    "data-chat-provider-model-picker-label": "true",
  } as const;

  const auxiliaryOptions =
    props.onAuxiliaryModelChange && (props.auxiliaryModels?.length ?? 0) > 0 ? (
      <div
        className="max-h-48 overflow-y-auto border-t px-2 py-2"
        role="group"
        aria-label="AssemblyAI Gateway"
      >
        <p className="px-2 pb-1 text-xs text-muted-foreground">AssemblyAI Gateway</p>
        {props.auxiliaryModels?.map((model) => (
          <button
            key={model.id}
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
            aria-pressed={props.selectedAuxiliaryModel === model.id}
            disabled={props.disabled}
            onClick={() => {
              props.onAuxiliaryModelChange?.(model.id);
              setIsMenuOpen(false);
            }}
          >
            {model.name}
            {props.selectedAuxiliaryModel === model.id ? (
              <span className="ms-auto" aria-hidden>
                ✓
              </span>
            ) : null}
          </button>
        ))}
      </div>
    ) : null;
  const picker = (
    <ModelPickerContent
      layout={props.layout ?? "current"}
      searchInputRef={searchInputRef}
      environmentId={props.environmentId}
      modelSelectionPurpose={props.modelSelectionPurpose ?? "agent"}
      activeInstanceId={activeInstanceId}
      model={props.selectedAuxiliaryModel ? "" : props.model}
      {...(props.selectedModels !== undefined ? { selectedModels: props.selectedModels } : {})}
      {...(props.onToggleModel
        ? {
            onToggleModel: (instanceId: ProviderInstanceId, model: string) => {
              if (!props.disabled) props.onToggleModel?.(instanceId, model);
            },
          }
        : {})}
      lockedProvider={props.lockedProvider}
      lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
      instanceEntries={props.instanceEntries}
      {...(props.keybindings ? { keybindings: props.keybindings } : {})}
      modelOptionsByInstance={props.modelOptionsByInstance}
      terminalOpen={props.terminalOpen ?? false}
      onRequestClose={() => setIsMenuOpen(false)}
      {...(props.onOpenProviderSetup ? { onOpenProviderSetup: props.onOpenProviderSetup } : {})}
      getModelDisabledReason={(instanceId, model) =>
        props.disabled
          ? "Model picker is disabled"
          : (props.getModelDisabledReason?.(instanceId, model) ?? null)
      }
      onInstanceModelChange={handleInstanceModelChange}
      listFooter={
        <>
          {auxiliaryOptions}
          {docked && props.selectedModels === undefined ? (
            <ChatGptSharingControl provider={activeEntry?.snapshot ?? null} />
          ) : null}
        </>
      }
      {...(docked
        ? {
            docked,
            onFocusEffort: () => void focusEffort("any"),
          }
        : {})}
    />
  );

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
      onOpenChangeComplete={(open) => {
        const target = takeOpenTarget(triggerRef.current);
        if (open && docked && target) openTarget(target);
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            variant={props.triggerVariant}
            ref={triggerRef}
            aria-label={[
              props.triggerAriaLabel ?? props.triggerLabel ?? allModelNames ?? triggerLabel,
              props.triggerDetail,
            ]
              .filter(Boolean)
              .join(", ")}
            size={size}
            data-chat-provider-model-picker="true"
            data-composer-shortcut={props.triggerShortcuts}
            onClick={(event) => {
              if (!isMenuOpen || !docked) return;
              const target = takeOpenTarget(triggerRef.current);
              if (!target) return;
              // A shortcut aimed at the open picker moves within it instead of closing it.
              (
                event as typeof event & { preventBaseUIHandler?: () => void }
              ).preventBaseUIHandler?.();
              openTarget(target);
            }}
            className={cn(
              "min-w-0 shrink justify-between whitespace-nowrap",
              props.compact
                ? "max-w-42 shrink-0"
                : !props.isComposerOwned && "max-w-48 sm:max-w-56",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn("flex min-w-0 flex-1 items-center", size === "xs" ? "gap-1" : "gap-1.5")}
        >
          {classic && props.selectedAuxiliaryModel ? (
            <MicIcon className="size-4 shrink-0" aria-hidden="true" />
          ) : selectedEntries && props.triggerLabel === undefined ? (
            <span
              data-chat-provider-model-picker-icon
              className="flex shrink-0 items-center -space-x-1"
              aria-hidden="true"
            >
              {selectedEntries
                .slice(0, 3)
                .map((selection) =>
                  selection.entry ? (
                    <ProviderInstanceIcon
                      key={`${selection.instanceId}:${selection.model}`}
                      driverKind={selection.entry.driverKind}
                      displayName={selection.entry.displayName}
                      accentColor={selection.entry.accentColor}
                      acpRegistryAgentId={selection.entry.acpRegistryAgentId}
                      acpRegistryIconUrl={selection.entry.acpRegistryIconUrl}
                      className="size-4 rounded-full bg-(--chat-composer-glass-surface,var(--background)) ring-2 ring-(--chat-composer-glass-surface,var(--background))"
                      iconClassName="size-4"
                    />
                  ) : null,
                )}
              {selectedEntries.length > 3 ? (
                <span className="relative z-30 flex size-4 items-center justify-center rounded-full bg-(--chat-composer-glass-surface,var(--background)) text-3xs ring-2 ring-(--chat-composer-glass-surface,var(--background))">
                  +{selectedEntries.length - 3}
                </span>
              ) : null}
            </span>
          ) : activeEntry &&
            !isEmptySelection &&
            !props.selectedAuxiliaryModel &&
            props.triggerLabel === undefined ? (
            // Narrow compacted composers hide the provider icon before truncating the name.
            <span data-chat-provider-model-picker-icon className="contents">
              <ProviderInstanceIcon
                driverKind={activeEntry.driverKind}
                displayName={activeEntry.displayName}
                accentColor={activeEntry.accentColor}
                acpRegistryAgentId={activeEntry.acpRegistryAgentId}
                acpRegistryIconUrl={activeEntry.acpRegistryIconUrl}
                showBadge={showInstanceBadge}
                className="size-4"
                iconClassName={cn("size-4", props.activeProviderIconClassName)}
                indicatorBackground={props.instanceIndicatorBackground ?? "var(--contrast-input)"}
                badgeClassName={cn(
                  "right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs",
                  size === "xs" && "shadow-none",
                )}
              />
            </span>
          ) : null}
          {props.isComposerOwned && !classic ? (
            <span {...triggerTextProps}>{triggerText}</span>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span {...triggerTextProps} />}>{triggerText}</TooltipTrigger>
              <TooltipPopup side="top">{triggerTooltipContent}</TooltipPopup>
            </Tooltip>
          )}
          {classic ? null : props.triggerSuffix}
          {selectedModel?.isUnavailable && !selectedEntries && props.triggerLabel === undefined ? (
            <Badge variant="outline" size="sm">
              Unavailable
            </Badge>
          ) : null}
        </span>
        {classic ? (
          <span aria-hidden="true" className="flex items-center">
            <ComposerControlChevron size={size} />
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        {...(props.isComposerOwned ? composerFloatingLayerProps : {})}
        ref={(popup) => {
          popupRef.current = popup;
          const unlock = lockBackgroundScroll(popup);
          return () => {
            popupRef.current = null;
            unlock?.();
          };
        }}
        initialFocus={searchInputRef}
        align={props.popupAlign ?? "start"}
        // Docked, the popup opens above the composer and slides over it when that space is short,
        // so a short window gets its full height (Floating UI sizes to the viewport) instead of a sliver.
        {...(docked
          ? { side: "top" as const, collisionAvoidance: { side: "shift", align: "shift" } as const }
          : {})}
        className="before:hidden"
        padding="none"
        touchBackdrop
      >
        {docked ? (
          <DockedPickerContext value={{ modelLabel: triggerTitle }}>
            <div className="flex max-h-(--available-height) flex-col">
              {/* One fixed height, so a model with more options never resizes the popup. Short
                  windows shrink it and keep the footer. */}
              <div className="flex h-86.5 min-h-0 max-sm:h-auto max-sm:flex-col">
                {picker}
                <div
                  data-model-picker-effort
                  className="flex min-h-0 w-48 flex-col sm:shrink-0 border-l border-border/70 bg-muted/40 max-sm:h-64 max-sm:w-full max-sm:border-t max-sm:border-l-0"
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" || event.altKey || event.ctrlKey || event.metaKey)
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    searchInputRef.current?.focus();
                  }}
                >
                  {props.effortColumn}
                </div>
              </div>
              {props.footer}
            </div>
          </DockedPickerContext>
        ) : (
          picker
        )}
        {props.selectedModels === undefined && !docked ? (
          <ChatGptSharingControl provider={activeEntry?.snapshot ?? null} />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});
