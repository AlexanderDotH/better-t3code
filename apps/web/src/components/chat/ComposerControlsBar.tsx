import {
  ContextWindowPicker,
  ContextWindowMenuContent,
  shouldRenderContextWindowControl,
  type ContextWindowPickerProps,
} from "./ContextWindowPicker";
import type { ContextWindowSelector } from "@t3tools/contracts";
import type { ComposerMode } from "@t3tools/contracts";
import type { ChatComposerProps } from "./ChatComposer";
import {
  getTraitsSectionVisibility,
  TraitsMenuContent,
  TraitsPicker,
  type PromptUltrathink,
} from "./TraitsPicker";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { type AppModelOption } from "../../modelSelection";
import { CircleAlertIcon } from "lucide-react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerControl, ComposerControlSeparator } from "./ComposerControl";
import {
  ComposerFooterModeControls,
  ComposerModelPicker,
  type RuntimeModeOption,
} from "./ComposerFooterControls";
import {
  type EnvironmentId,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { cn } from "~/lib/utils";
import { resolveComposerTraitsInput } from "./composerProviderState";
import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import type { useComposerProviderModel } from "./useComposerProviderModel";
import { resolveComposerControlsOwnership } from "./composerControlsOwnership";

/**
 * The composer footer controls: the model picker (which also holds effort, speed and
 * permissions), mode controls and the overflow menu for blocks that do not fit. Rendered in the
 * expanded footer or the resting controls host.
 */
// Model and effort share one trigger; it stays filled while its popup is open.
const MODEL_TRIGGER_STATES = "data-popup-open:bg-accent data-popup-open:text-foreground";

export function ComposerControlsBar(props: {
  onManualModelSelectionChange?: ((selection: ModelSelection) => void) | undefined;
  environmentId: EnvironmentId;
  composerLayout?: "current" | "classic" | undefined;
  planningDisabledReason?: string | null | undefined;
  contextWindowSelector?: ContextWindowSelector;
  autoReasoningEffort?: string | null | undefined;
  routeKind: ChatComposerProps["routeKind"];
  routeThreadRef: ChatComposerProps["routeThreadRef"];
  draftId: ChatComposerProps["draftId"];
  selectedProvider: ProviderDriverKind;
  selectedInstanceId: ProviderInstanceId;
  selectedModel: string;
  selectedProviderModels: ServerProvider["models"];
  composerModelOptions: ReturnType<typeof useComposerProviderModel>["composerModelOptions"];
  reportedModelSelection: ChatComposerProps["reportedModelSelection"];
  promptUltrathink: PromptUltrathink;
  onPromptEdit: (edit: (prompt: string) => string) => void;
  planModeEnabled: boolean;
  planModeUiEnabled: boolean;
  effortDisplay: EffortDisplay;
  /** The strip under a new thread names the permissions, so the row does not repeat them. */
  permissionsShownInStrip: boolean;
  composerMode: ComposerMode;
  deepPlanningDisabledReason: string | null;
  interactionMode: ProviderInteractionMode;
  compatibleRuntimeMode: RuntimeMode;
  defaultRuntimeMode: RuntimeMode | undefined;
  compatibleRuntimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  toggleInteractionMode: () => void;
  handleInteractionModeChange: (mode: ComposerMode) => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  composerControlsCollapsed: boolean;
  composerControlsCompact: boolean;
  composerControlsHidden: boolean;
  restingHiddenBlockCount: number;
  iconOnlyBlockCount: number;
  showProviderUnavailable: boolean;
  providerSetupInstanceId: ProviderInstanceId | undefined;
  onOpenProviderSetup: ChatComposerProps["onOpenProviderSetup"];
  providerCatalogPending: boolean;
  isSendBusy: boolean;
  multipleModelsEnabled: boolean;
  multipleModelSelections: ChatComposerProps["multipleModelSelections"];
  onMultipleModelSelectionsChange: ChatComposerProps["onMultipleModelSelectionsChange"];
  selectedModelSelection: ModelSelection;
  onProviderModelSelect: ChatComposerProps["onProviderModelSelect"];
  activeThreadModelSelection: ChatComposerProps["activeThreadModelSelection"];
  selectedModelForPickerWithCustomFallback: string;
  lockedProvider: ChatComposerProps["lockedProvider"];
  lockedContinuationGroupKey: string | null;
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings: ChatComposerProps["keybindings"];
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  terminalOpen: boolean;
  modelPickerOpen: boolean;
  onModelPickerOpenChange: (open: boolean) => void;
  modelPickerIconClassName: string | undefined;
  getModelDisabledReason: ChatComposerProps["getModelDisabledReason"];
}) {
  const {
    environmentId,
    routeKind,
    routeThreadRef,
    draftId,
    selectedProvider,
    selectedInstanceId,
    selectedModel,
    selectedProviderModels,
    composerModelOptions,
    reportedModelSelection,
    promptUltrathink,
    onPromptEdit,
    planModeEnabled,
    planModeUiEnabled,
    interactionMode,
    compatibleRuntimeMode,
    defaultRuntimeMode,
    compatibleRuntimeModeOptions,
    toggleInteractionMode,
    handleRuntimeModeChange,
    composerControlsCollapsed,
    composerControlsHidden,
    restingHiddenBlockCount: measuredHiddenBlockCount,
    iconOnlyBlockCount,
    showProviderUnavailable,
    providerSetupInstanceId,
    onOpenProviderSetup,
    providerCatalogPending,
    isSendBusy,
    multipleModelsEnabled,
    multipleModelSelections,
    onMultipleModelSelectionsChange,
    selectedModelSelection,
    onProviderModelSelect,
    activeThreadModelSelection,
    selectedModelForPickerWithCustomFallback,
    lockedProvider,
    lockedContinuationGroupKey,
    providerInstanceEntries,
    keybindings,
    modelOptionsByInstance,
    terminalOpen,
    modelPickerOpen,
    onModelPickerOpenChange,
    modelPickerIconClassName,
    getModelDisabledReason,
  } = props;
  const translate = useInterfaceTranslator().message;
  const classic = props.composerLayout === "classic";
  const accessMatchesDefault = compatibleRuntimeMode === defaultRuntimeMode;
  const controlSize = composerControlsCollapsed ? "xs" : "sm";
  const contextWindowProps = {
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    size: controlSize,
    isComposerOwned: true,
    hidden: composerControlsHidden,
    ...(props.onManualModelSelectionChange
      ? { onManualModelSelectionChange: props.onManualModelSelectionChange }
      : {}),
  } satisfies ContextWindowPickerProps;
  const showContextWindowPicker =
    (routeKind === "server" || draftId !== null) &&
    props.contextWindowSelector === "better-t3" &&
    shouldRenderContextWindowControl(contextWindowProps);
  const traitsInput = resolveComposerTraitsInput({
    onManualModelSelectionChange: props.onManualModelSelectionChange,
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    reportedModelSelection,
    hideContextWindow: showContextWindowPicker,
    autoReasoningEffort: props.autoReasoningEffort,
    promptUltrathink,
    onPromptEdit,
    planModeEnabled,
  });
  const hasTraitsControl =
    traitsInput !== null && getTraitsSectionVisibility(traitsInput).hasAnyControls;
  const {
    accessDisplay,
    hiddenBlockCount: restingHiddenBlockCount,
    hiddenBlockIds: hiddenRestingBlockIds,
    pickerOwnsModeShortcut,
  } = resolveComposerControlsOwnership({
    layout: props.composerLayout ?? "current",
    hasTraitsControl,
    matchesDefault: accessMatchesDefault || props.permissionsShownInStrip,
    collapsed: composerControlsCollapsed,
    compact: props.composerControlsCompact,
    hasContextWindowControl: showContextWindowPicker,
    measuredHiddenBlockCount,
  });
  const effort = describeComposerEffort(traitsInput, props.effortDisplay, controlSize);
  // Build and Chat need no planning support, so the mode block always shows.
  const restingBlockDefs = [
    ...((classic && hasTraitsControl) || showContextWindowPicker
      ? [
          {
            id: classic ? "traits" : "context",
            content: (
              <>
                {classic && traitsInput && hasTraitsControl ? (
                  <TraitsPicker
                    {...traitsInput}
                    size={controlSize}
                    hidden={composerControlsHidden || hiddenRestingBlockIds.includes("traits")}
                  />
                ) : null}
                {classic && hasTraitsControl && showContextWindowPicker ? (
                  <ComposerControlSeparator size={controlSize} />
                ) : null}
                {showContextWindowPicker ? (
                  <ContextWindowPicker
                    {...contextWindowProps}
                    hidden={
                      composerControlsHidden ||
                      hiddenRestingBlockIds.includes(classic ? "traits" : "context")
                    }
                  />
                ) : null}
              </>
            ),
          },
        ]
      : []),
    {
      id: "mode",
      content: (
        <ComposerFooterModeControls
          showInteractionModeToggle
          composerMode={props.composerMode}
          deepPlanningDisabledReason={props.deepPlanningDisabledReason}
          interactionMode={interactionMode}
          runtimeMode={compatibleRuntimeMode}
          runtimeModeOptions={compatibleRuntimeModeOptions}
          size={controlSize}
          hidden={composerControlsHidden || restingHiddenBlockCount > 0}
          accessDisplay={accessDisplay}
          emphasized={!accessMatchesDefault}
          onToggleInteractionMode={toggleInteractionMode}
          onComposerModeChange={props.handleInteractionModeChange}
          planningEnabled={planModeUiEnabled}
          planningDisabledReason={props.planningDisabledReason}
          onRuntimeModeChange={handleRuntimeModeChange}
        />
      ),
    },
  ];
  // Its own element, so typing (which rebuilds the controls around it) leaves it cached.
  const composerModelPicker = (
    <ComposerModelPicker
      environmentId={environmentId}
      layout={props.composerLayout ?? "current"}
      compact={false}
      isComposerOwned
      // The trigger grows away from this edge when its model or effort label changes.
      popupAlign={classic || composerControlsCollapsed ? "start" : "end"}
      disabled={providerCatalogPending || isSendBusy}
      multipleModelsEnabled={multipleModelsEnabled}
      multipleModelSelections={multipleModelSelections}
      onMultipleModelSelectionsChange={onMultipleModelSelectionsChange}
      selectedModelSelection={selectedModelSelection}
      onProviderModelSelect={onProviderModelSelect}
      activeInstanceId={
        providerCatalogPending
          ? (activeThreadModelSelection?.instanceId ?? selectedInstanceId)
          : selectedInstanceId
      }
      model={
        providerCatalogPending
          ? (activeThreadModelSelection?.model ?? selectedModelForPickerWithCustomFallback)
          : selectedModelForPickerWithCustomFallback
      }
      lockedProvider={lockedProvider}
      lockedContinuationGroupKey={lockedContinuationGroupKey}
      instanceEntries={providerInstanceEntries}
      keybindings={keybindings}
      modelOptionsByInstance={modelOptionsByInstance}
      size={controlSize}
      triggerClassName={cn(
        "group/model-trigger",
        MODEL_TRIGGER_STATES,
        composerControlsCollapsed ? "min-w-13 shrink text-xs!" : "min-w-13",
      )}
      triggerSuffix={classic ? undefined : effort.suffix}
      triggerDetail={classic ? null : effort.detail}
      {...(classic
        ? {}
        : {
            triggerShortcuts: pickerOwnsModeShortcut
              ? "composer.effort composer.mode"
              : "composer.effort",
          })}
      effortColumn={classic ? undefined : <ComposerEffortColumn traits={traitsInput} />}
      footer={
        classic ? undefined : (
          <ComposerPickerFooter
            traits={traitsInput}
            runtimeMode={compatibleRuntimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
            onRuntimeModeChange={handleRuntimeModeChange}
          />
        )
      }
      terminalOpen={terminalOpen}
      open={modelPickerOpen}
      instanceIndicatorBackground={
        composerControlsCollapsed
          ? "color-mix(in srgb, var(--chat-composer-glass-surface) var(--glass-opacity), transparent)"
          : "var(--contrast-input)"
      }
      {...(modelPickerIconClassName
        ? { activeProviderIconClassName: modelPickerIconClassName }
        : {})}
      onOpenChange={onModelPickerOpenChange}
      getModelDisabledReason={getModelDisabledReason}
      onOpenProviderSetup={onOpenProviderSetup}
    />
  );
  return showProviderUnavailable ? (
    <ComposerControl
      type="button"
      disabled={!providerSetupInstanceId}
      onClick={() => {
        if (providerSetupInstanceId) {
          onOpenProviderSetup(providerSetupInstanceId);
        }
      }}
      data-chat-provider-unavailable="true"
      className="shrink-0"
    >
      <CircleAlertIcon className="size-4" />
      {providerSetupInstanceId
        ? "Open provider settings"
        : translate("chat.composer.noProviderAvailable")}
    </ComposerControl>
  ) : (
    <>
      {composerModelPicker}

      <>
        {restingBlockDefs.map((def, index) => {
          const hidden = index >= restingBlockDefs.length - restingHiddenBlockCount;
          return (
            <div
              key={def.id}
              data-resting-block={def.id}
              data-composer-block-icon-only={
                index >= restingBlockDefs.length - iconOnlyBlockCount ? "true" : "false"
              }
              aria-hidden={hidden || undefined}
              inert={hidden || undefined}
              className={cn(
                "flex w-max min-w-max shrink-0 items-center gap-1",
                hidden && "pointer-events-none invisible absolute",
                index >= restingBlockDefs.length - iconOnlyBlockCount &&
                  "[&_[data-composer-control-label]]:pointer-events-none [&_[data-composer-control-label]]:invisible [&_[data-composer-control-label]]:absolute [&_[data-composer-control-label]]:w-max [&_[data-composer-control-label]]:max-w-none [&_[data-composer-control-compact-icon]]:[visibility:inherit] [&_[data-composer-control-compact-icon]]:relative",
              )}
            >
              {def.content}
            </div>
          );
        })}
        <div
          data-resting-controls-overflow
          aria-hidden={hiddenRestingBlockIds.length === 0 || undefined}
          inert={hiddenRestingBlockIds.length === 0 || undefined}
          className={cn(
            "min-w-0 shrink-0",
            hiddenRestingBlockIds.length === 0 && "pointer-events-none invisible absolute",
          )}
        >
          <CompactComposerControlsMenu
            traitsContent={
              classic &&
              hiddenRestingBlockIds.includes("traits") &&
              traitsInput &&
              hasTraitsControl ? (
                <TraitsMenuContent {...traitsInput} />
              ) : undefined
            }
            contextWindowContent={
              hiddenRestingBlockIds.includes(classic ? "traits" : "context") &&
              showContextWindowPicker ? (
                <ContextWindowMenuContent {...contextWindowProps} />
              ) : undefined
            }
            interactionMode={interactionMode}
            composerMode={props.composerMode}
            deepPlanningDisabledReason={props.deepPlanningDisabledReason}
            planningEnabled={planModeUiEnabled}
            planningDisabledReason={props.planningDisabledReason}
            runtimeMode={compatibleRuntimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
            size={controlSize}
            hidden={composerControlsHidden || hiddenRestingBlockIds.length === 0}
            showInteractionModeToggle={hiddenRestingBlockIds.includes("mode")}
            showPermissions={classic && hiddenRestingBlockIds.includes("mode")}
            onToggleInteractionMode={toggleInteractionMode}
            onComposerModeChange={props.handleInteractionModeChange}
            onRuntimeModeChange={handleRuntimeModeChange}
          />
        </div>
      </>
    </>
  );
}
