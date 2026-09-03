import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  PreviewAnnotationPayload,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import {
  connectionStatusTitle,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { resolveThreadAbortPresentation } from "@t3tools/client-runtime/state/thread-abort";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  clampCollapsedComposerCursor,
  type ComposerSubmissionIntent,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  composerSubmissionIntentForEnter,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
} from "../../composer-logic";
import {
  resolvePlanImplementationSuggestion,
  type PlanImplementationStrategy,
  type PlanImplementationSuggestion,
  type PlanParallelismReviewStatus,
} from "../../planImplementation";
import {
  deriveComposerSendState,
  readFileAsDataUrl,
  resolveSpeechEnvironmentId,
} from "../ChatView.logic";
import { DISCONNECTED_COMPOSER_PLACEHOLDER } from "../../composerPlaceholder";
import {
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./composerMentionDrag";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerFileAttachment,
  type PersistedComposerImageAttachment,
  composerFileNeedsReattach,
  composerTargetKey,
  hydrateImagesFromPersisted,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftStore";
import {
  MAX_STASH_ENTRIES,
  partitionStashAttachments,
  usePromptStashStore,
  type PromptStashEntry,
} from "../../promptStashStore";
import { ComposerStashBadge } from "./ComposerStashBadge";
import { ComposerStashMenu } from "./ComposerStashMenu";
import {
  ComposerTasksBadge,
  ComposerTasksContent,
  ComposerTasksDrawer,
  type ComposerTaskStep,
  type ComposerTasksProgress,
} from "./ComposerTasksBadge";
import {
  ComposerActivityBanner,
  ComposerActivityRow,
  composerActivityVariant,
  resolveComposerActivityTokenUsage,
  type ComposerActivityStatus,
} from "./ComposerActivityStatus";
import type { ThreadSyncPhase } from "../../threadSync";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerSurface } from "./ComposerSurface";
import {
  ComposerBannerStack,
  type ComposerBannerStackContent,
  type ComposerBannerStackItem,
} from "./ComposerBannerStack";
import { compressImageForStash, prepareImageForAttachment } from "../../lib/imageCompression";
import {
  fileAttachmentTooLargeMessage,
  formatAttachmentSize,
} from "@t3tools/client-runtime/state/attachments";
import {
  attachmentsToReleaseOnUploadCapabilityLoss,
  classifyComposerAttachmentFile,
  fileAttachmentCapabilityBlockReason,
  fileAttachmentStagingLimit,
  normalizeComposerImageFileMimeType,
  shouldHandleComposerAttachmentPaste,
} from "./composerAttachmentFiles";
import {
  readAttachmentUpload,
  releaseAttachmentUpload,
  releaseDraftAttachment,
  releasePersistedAttachmentUpload,
  retryAttachmentUpload,
  startAttachmentUpload,
  useAttachmentUploadStore,
  verifyStashedAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import {
  attachmentUploadBlockReason,
  formatAttachmentUploadProgress,
} from "../../lib/attachmentUploadState";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { getTerminalFocusOwner } from "../../lib/terminalFocus";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../keybindings";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../lib/terminalContext";
import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import { type ElementContextDraft } from "../../lib/elementContext";
import { ComposerPendingElementContexts } from "./ComposerPendingElementContexts";
import { ComposerPendingReviewComments } from "./ComposerPendingReviewComments";
import { ComposerPreviewAnnotationCards } from "./ComposerPreviewAnnotationCards";
import {
  resolveComposerFooterGapClassName,
  shouldUseCompactComposerControls,
  shouldUseCompactComposerPrimaryActions,
} from "../composerFooterLayout";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "../ComposerPromptEditor";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerInteractionModeSelect } from "./ComposerInteractionModeSelect";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { ComposerControlIcon, ComposerSelectControl } from "./ComposerControl";
import { resolveComposerMenuActiveItemId } from "./composerMenuHighlight";
import { searchSlashCommandItems } from "./composerSlashCommandSearch";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
  renderProviderContextWindowMenuContent,
  renderProviderContextWindowPicker,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";
import { ContextWindowMeter } from "./ContextWindowMeter";
import {
  resolveContextWindowModelDisplayName,
  resolveManualCompactAction,
} from "./ContextWindowMeter.logic";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { basenameOfPath } from "../../pierre-icons";
import { cn, randomUUID } from "~/lib/utils";
import { Separator } from "../ui/separator";
import {
  getComposerPromptLengthValidationMessage,
  getComposerSubmissionValidationMessage,
  submitComposerDraft,
} from "./composerSubmission";
import { ComposerPromptLengthValidation } from "./ComposerPromptLengthValidation";
import { ForkHandoffBudgetNotice } from "./ForkHandoffBudgetNotice";
import type { FirstTurnForkBudget } from "../../lib/threadFork";
import {
  SURFACE_MORPH_EXIT_DURATION_MS,
  SURFACE_MORPH_SECONDARY_DURATION_MS as COMPOSER_SECONDARY_MORPH_DURATION_MS,
  captureSurfaceGeometry,
  createSurfaceMorphCoordinator,
  resolveSurfaceMorphOrigin,
  type SurfaceGeometry,
  type SurfaceMorphCoordinator,
  type SurfaceMorphDirection,
  type SurfaceMorphOrigin,
} from "./surfaceMorph";

type ComposerCommandMenuPosition = {
  bottom: number;
  left: number;
  maxHeight: number;
  width: number;
};

function composerCommandMenuPositionsEqual(
  a: ComposerCommandMenuPosition,
  b: ComposerCommandMenuPosition,
): boolean {
  return (
    a.bottom === b.bottom && a.left === b.left && a.maxHeight === b.maxHeight && a.width === b.width
  );
}

function ComposerCommandMenuLayer(props: {
  anchor: HTMLElement | null;
  children: ReactNode;
  coordinator: SurfaceMorphCoordinator | null;
  originKey: "command" | "stash";
  scopeKey: string;
}) {
  const [position, setPosition] = useState<ComposerCommandMenuPosition | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const previousPositionRef = useRef<ComposerCommandMenuPosition | null>(null);
  const surfaceSnapshotRef = useRef<DetachedComposerSurfaceSnapshot | null>(null);

  useLayoutEffect(() => {
    const anchor = props.anchor;
    if (!anchor) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const form = anchor.closest<HTMLElement>('[data-chat-composer-form="true"]');
      const mainSurface = form?.querySelector<HTMLElement>(
        '[data-chat-composer-main-surface="true"]',
      );
      const rect = (mainSurface ?? form ?? anchor).getBoundingClientRect();
      const rootFontSizePx =
        Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const drawerInsetRem =
        Number.parseFloat(
          window.getComputedStyle(form ?? anchor).getPropertyValue("--chat-composer-drawer-inset"),
        ) || 1.375;
      const drawerInset = drawerInsetRem * rootFontSizePx;
      // One extra pixel prevents fractional layout coordinates from exposing
      // the canvas between the drawer mask and the composer's foreground edge.
      // Mirrors --chat-composer-attachment-overlap: calc(1rem + 1px).
      const composerOverlap = rootFontSizePx + 1;
      const next = {
        bottom: window.innerHeight - rect.top - composerOverlap,
        left: rect.left + drawerInset,
        maxHeight: Math.max(96, rect.top - 24 + composerOverlap),
        width: Math.max(0, rect.width - drawerInset * 2),
      };
      setPosition((current) =>
        current && composerCommandMenuPositionsEqual(current, next) ? current : next,
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (observer) {
      // The composer is centered and capped at a max width, so opening a side
      // panel slides it sideways without ever resizing it. Watching the anchor
      // alone would leave the menu behind; the ancestors are what shrink, and
      // they resize on every frame of the panel animation.
      observer.observe(anchor);
      for (let element = anchor.parentElement; element; element = element.parentElement) {
        observer.observe(element);
      }
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchor]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const form = props.anchor?.closest<HTMLFormElement>('[data-chat-composer-form="true"]');
    const element = layer?.querySelector<HTMLElement>(
      '[data-composer-stash-drawer="true"], [data-composer-command-drawer="true"]',
    );
    if (!form || !element || !position || !props.coordinator) return;

    const geometry = captureSurfaceGeometry(element);
    const previous = surfaceSnapshotRef.current;
    const positionChanged =
      previousPositionRef.current !== null &&
      !composerCommandMenuPositionsEqual(previousPositionRef.current, position);
    if (!previous) {
      const origin = resolveDetachedSurfaceOrigin(form, geometry, props.originKey);
      if (origin) {
        const source = pointSurfaceGeometry(origin);
        props.coordinator.run({
          direction: detachedSurfaceDirection(source, geometry, false),
          durationMs: COMPOSER_SECONDARY_MORPH_DURATION_MS,
          element,
          from: source,
          to: geometry,
        });
      }
    } else if (!positionChanged && surfaceGeometriesDiffer(previous.geometry, geometry)) {
      props.coordinator.run({
        direction: detachedSurfaceDirection(previous.geometry, geometry, false),
        durationMs:
          geometry.rect.height < previous.geometry.rect.height
            ? SURFACE_MORPH_EXIT_DURATION_MS
            : COMPOSER_SECONDARY_MORPH_DURATION_MS,
        element,
        from: previous.geometry,
        to: geometry,
      });
    }

    surfaceSnapshotRef.current = {
      element,
      geometry,
      key: props.originKey,
      template: element.cloneNode(true) as HTMLElement,
    };
    previousPositionRef.current = position;
  });

  useLayoutEffect(
    () => () => {
      const snapshot = surfaceSnapshotRef.current;
      const form = props.anchor?.closest<HTMLFormElement>('[data-chat-composer-form="true"]');
      if (!snapshot || !form || !props.coordinator) return;

      const origin = resolveDetachedSurfaceOrigin(form, snapshot.geometry, snapshot.key);
      if (!origin) return;

      const proxy = createDetachedSurfaceExitProxy(snapshot);
      const destination = pointSurfaceGeometry(origin);
      const run = props.coordinator.run({
        direction: detachedSurfaceDirection(snapshot.geometry, destination, true),
        durationMs: SURFACE_MORPH_EXIT_DURATION_MS,
        element: proxy,
        from: snapshot.geometry,
        to: destination,
      });
      void run.finished.then(() => proxy.remove());
      surfaceSnapshotRef.current = null;
    },
    [props.anchor, props.coordinator, props.originKey],
  );

  if (!position) return null;

  return createPortal(
    <div
      ref={layerRef}
      className="pointer-events-auto fixed z-[70]"
      data-composer-drawer-layer="true"
      data-composer-surface-morph="secondary"
      data-composer-surface-morph-key={`detached-drawer:${props.originKey}`}
      data-composer-surface-morph-origin={props.originKey}
      data-composer-surface-morph-scope={props.scopeKey}
      style={{
        bottom: position.bottom,
        left: position.left,
        maxHeight: position.maxHeight,
        width: position.width,
      }}
    >
      {props.children}
    </div>,
    document.body,
  );
}

function ComposerFloatingBubblePortal({
  children,
  host,
}: {
  readonly children: ReactNode;
  readonly host: HTMLElement | null;
}) {
  if (!host) return null;
  return createPortal(
    <ComposerBanner.FloatingGroup>{children}</ComposerBanner.FloatingGroup>,
    host,
  );
}

type DetachedComposerSurfaceSnapshot = {
  readonly element: HTMLElement;
  readonly geometry: SurfaceGeometry;
  readonly key: string;
  readonly template: HTMLElement;
};

function surfaceGeometriesDiffer(from: SurfaceGeometry, to: SurfaceGeometry): boolean {
  return (
    Math.abs(from.rect.left - to.rect.left) >= 0.5 ||
    Math.abs(from.rect.top - to.rect.top) >= 0.5 ||
    Math.abs(from.rect.width - to.rect.width) >= 0.5 ||
    Math.abs(from.rect.height - to.rect.height) >= 0.5
  );
}

function pointSurfaceGeometry(origin: SurfaceMorphOrigin): SurfaceGeometry {
  return {
    rect: { left: origin.x - 4, top: origin.y - 4, width: 8, height: 8 },
    radii: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
  };
}

function detachedSurfaceDirection(
  from: SurfaceGeometry,
  to: SurfaceGeometry,
  exiting: boolean,
): SurfaceMorphDirection {
  const destinationBelowSource = to.rect.top >= from.rect.top;
  if (exiting) return destinationBelowSource ? "to-bottom" : "to-top";
  return destinationBelowSource ? "from-top" : "from-bottom";
}

function findComposerMorphTrigger(form: HTMLFormElement, key: string): HTMLElement | null {
  const triggers = form.querySelectorAll<HTMLElement>("[data-composer-surface-morph-trigger]");
  return (
    Array.from(triggers).find((trigger) => trigger.dataset.composerSurfaceMorphTrigger === key) ??
    null
  );
}

function resolveDetachedSurfaceOrigin(
  form: HTMLFormElement,
  destination: SurfaceGeometry,
  key: string,
): SurfaceMorphOrigin | null {
  const composer = form.querySelector<HTMLElement>('[data-chat-composer-main-surface="true"]');
  if (!composer) return null;

  const trigger = findComposerMorphTrigger(form, key);
  return resolveSurfaceMorphOrigin({
    composerRect: captureSurfaceGeometry(composer).rect,
    destinationRect: destination.rect,
    ...(trigger ? { triggerRect: captureSurfaceGeometry(trigger).rect } : {}),
  });
}

function createDetachedSurfaceExitProxy(snapshot: DetachedComposerSurfaceSnapshot): HTMLElement {
  const proxy = snapshot.template.cloneNode(true) as HTMLElement;
  proxy.removeAttribute("id");
  proxy.removeAttribute("data-composer-surface-morph-origin");
  proxy.removeAttribute("data-composer-surface-morph-key");
  proxy.setAttribute("aria-hidden", "true");
  proxy.setAttribute("data-composer-surface-morph-exit-proxy", "true");
  proxy.setAttribute("inert", "");
  proxy.inert = true;
  proxy.style.position = "fixed";
  proxy.style.left = `${snapshot.geometry.rect.left}px`;
  proxy.style.top = `${snapshot.geometry.rect.top}px`;
  proxy.style.width = `${snapshot.geometry.rect.width}px`;
  proxy.style.height = `${snapshot.geometry.rect.height}px`;
  proxy.style.margin = "0";
  proxy.style.pointerEvents = "none";
  proxy.style.zIndex = "70";
  proxy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  document.body.append(proxy);
  return proxy;
}
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  CircleAlertIcon,
  FileIcon,
  PaperclipIcon,
  type LucideIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  RotateCcwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { proposedPlanTitle } from "../../proposedPlan";
import { isPlanModeAvailable } from "../../providerModels";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  resolveProviderDriverKindForInstanceSelection,
  resolveSelectableProviderInstanceEntry,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  type AppModelOption,
  getAppModelOptionsForInstance,
  resolveParallelPlanReviewModelSelectionState,
} from "../../modelSelection";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { SessionPhase, Thread } from "../../types";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  formatProviderSkillDisplayName,
  getProviderSlashCommandsForSlashMenu,
  getProviderSkillsForSlashMenu,
} from "@t3tools/client-runtime/providerSkills";
import { searchProviderSkills } from "../../providerSkillSearch";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { useAssemblyAiDictation } from "../../hooks/useAssemblyAiDictation";
import { usePlanParallelismReview } from "../../hooks/usePlanParallelismReview";
import {
  createAssemblyAiStreamingTokenForEnvironment,
  translateSpeechTranscriptForEnvironment,
} from "../../environmentApi";
import { VoiceDictationControl } from "./VoiceDictationControl";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

const runtimeModeConfig: Record<
  RuntimeMode,
  {
    labelKey:
      | "chat.composer.access.supervised"
      | "chat.composer.access.autoAccept"
      | "chat.composer.access.auto"
      | "chat.composer.access.full";
    descriptionKey:
      | "chat.composer.access.supervisedDescription"
      | "chat.composer.access.autoAcceptDescription"
      | "chat.composer.access.autoDescription"
      | "chat.composer.access.fullDescription";
    icon: LucideIcon;
  }
> = {
  "approval-required": {
    labelKey: "chat.composer.access.supervised",
    descriptionKey: "chat.composer.access.supervisedDescription",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    labelKey: "chat.composer.access.autoAccept",
    descriptionKey: "chat.composer.access.autoAcceptDescription",
    icon: PenLineIcon,
  },
  auto: {
    labelKey: "chat.composer.access.auto",
    descriptionKey: "chat.composer.access.autoDescription",
    icon: SparklesIcon,
  },
  "full-access": {
    labelKey: "chat.composer.access.full",
    descriptionKey: "chat.composer.access.fullDescription",
    icon: LockOpenIcon,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
const COMPOSER_FLOATING_LAYER_SELECTOR = [
  '[data-composer-drawer-layer="true"]',
  '[data-slot="popover-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

function isInsideComposerFloatingLayer(element: Element): boolean {
  return element.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  showInteractionModeSelect: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const RuntimeModeIcon = runtimeModeOption.icon;

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

      <Tooltip>
        <Select
          value={props.runtimeMode}
          onValueChange={(value) => props.onRuntimeModeChange(value!)}
        >
          <TooltipTrigger
            render={
              <ComposerSelectControl
                className="font-medium"
                aria-label={translate("chat.composer.runtimeMode")}
              />
            }
          >
            <ComposerControlIcon icon={RuntimeModeIcon} />
            <SelectValue>{translate(runtimeModeOption.labelKey)}</SelectValue>
          </TooltipTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {runtimeModeOptions.map((mode) => {
              const option = runtimeModeConfig[mode];
              const OptionIcon = option.icon;
              return (
                <SelectItem key={mode} value={mode} hideIndicator className="min-w-64 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        {translate(option.labelKey)}
                      </span>
                      <span className="text-muted-foreground text-xs leading-4">
                        {translate(option.descriptionKey)}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        <TooltipPopup side="top">{translate(runtimeModeOption.descriptionKey)}</TooltipPopup>
      </Tooltip>

      {props.showInteractionModeSelect ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
          <ComposerInteractionModeSelect
            value={props.interactionMode}
            onValueChange={props.onInteractionModeChange}
          />
        </>
      ) : null}
    </>
  );
});

const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  activeContextWindow: ContextWindowSnapshot | null;
  activeThreadModelDisplayName: string | null;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  abortPhase: ReturnType<typeof resolveThreadAbortPresentation>["phase"];
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  showSendWhileRunning?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  planImplementationSuggestion: PlanImplementationSuggestion | null;
  planParallelismReviewStatus: PlanParallelismReviewStatus;
  onImplementPlan: (strategy: PlanImplementationStrategy) => void;
  onImplementPlanInNewThread: (strategy: PlanImplementationStrategy) => void;
  onCompactContext?: (() => void) | undefined;
  compactDisabled: boolean;
  compactDisabledReason: string | null;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <>
      {props.activeContextWindow ? (
        <ContextWindowMeter
          usage={props.activeContextWindow}
          modelDisplayName={props.activeThreadModelDisplayName}
          onCompact={props.onCompactContext}
          compactDisabled={props.compactDisabled}
          compactDisabledReason={props.compactDisabledReason}
        />
      ) : null}
      {props.isPreparingWorktree ? (
        <span className="text-secondary-label text-xs">
          {translate("chat.composer.preparingWorktree")}
        </span>
      ) : null}
      <ComposerPrimaryActions
        compact={props.compact}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        abortPhase={props.abortPhase}
        showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
        promptHasText={props.promptHasText}
        isSendBusy={props.isSendBusy}
        sendDisabledReason={props.sendDisabledReason}
        isConnecting={props.isConnecting}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        showSendWhileRunning={props.showSendWhileRunning ?? false}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        planImplementationSuggestion={props.planImplementationSuggestion}
        planParallelismReviewStatus={props.planParallelismReviewStatus}
        onImplementPlan={props.onImplementPlan}
        onImplementPlanInNewThread={props.onImplementPlanInNewThread}
      />
    </>
  );
});

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  addDroppedFiles: (files: File[]) => void;
  insertTextAtEnd: (text: string, options?: { ensureLeadingBoundary?: boolean }) => boolean;
  openModelPicker: () => void;
  toggleModelPicker: () => void;
  isModelPickerOpen: () => boolean;
  isVoiceRecordingActive: () => boolean;
  dismissTransientUi: () => void;
  compactContext: () => void;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  };
  /** Reset composer cursor/trigger/highlight after external prompt mutations (e.g. onSend). */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Get the current prompt/effort/model state for use in send. */
  getSendContext: () => {
    prompt: string;
    images: ComposerImageAttachment[];
    files: ComposerFileAttachment[];
    terminalContexts: TerminalContextDraft[];
    elementContexts: ElementContextDraft[];
    previewAnnotations: PreviewAnnotationPayload[];
    reviewComments: ReviewCommentContext[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    providerAvailable: boolean;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
    planImplementationSuggestion: PlanImplementationSuggestion | null;
  };
  /** Validate the fully composed text immediately before a provider turn starts. */
  validateProviderInput: (providerInput: string) => boolean;
}

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

export interface ChatComposerProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  attachmentUploadsCapabilityKnown: boolean;
  supportsAttachmentUploads: boolean;
  maxFileAttachmentBytes: number | null;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  // Thread context
  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  forceExpandedOnMobile: boolean;
  projectSelectionRequired: boolean;

  // Session phase
  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isPreparingWorktree: boolean;
  floatingBubbleHost: HTMLElement | null;
  surfaceMorphScopeKey: string;
  bannerItems: readonly ComposerBannerStackItem[];
  environmentUnavailable: {
    readonly label: string;
    readonly connection: EnvironmentConnectionPresentation;
  } | null;

  // Pending approvals / inputs
  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: { id: string; multiSelect?: boolean | undefined } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  respondingRequestIds: ApprovalRequestId[];

  // Plan
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  activeTasksProgress: ComposerTasksProgress | null;
  activeTaskSteps: readonly ComposerTaskStep[] | null;
  isWorking: boolean;
  activeWorkStartedAt: string | null;
  threadSyncPhase: ThreadSyncPhase | null;

  // Mode
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;

  // Provider / model
  lockedProvider: ProviderDriverKind | null;
  providerStatuses: ServerProvider[];
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;
  autoReasoningEffort: string | null;

  // Context window
  firstTurnForkBudget: FirstTurnForkBudget | null;
  activeContextWindow: ContextWindowSnapshot | null;
  compactDisabled: boolean;
  compactDisabledReason: string | null;
  canManualCompact?: boolean;
  onManualCompact?: () => void;

  // Misc
  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;
  voiceInputConfigured: boolean;

  // Refs the parent needs kept in sync
  promptRef: React.RefObject<string>;
  composerImagesRef: React.RefObject<ComposerImageAttachment[]>;
  composerFilesRef: React.RefObject<ComposerFileAttachment[]>;
  composerTerminalContextsRef: React.RefObject<TerminalContextDraft[]>;
  composerElementContextsRef: React.RefObject<ElementContextDraft[]>;
  composerRef: React.RefObject<ChatComposerHandle | null>;

  // Callbacks
  onSend: (e?: { preventDefault: () => void }, intent?: ComposerSubmissionIntent) => void;
  onInterrupt: () => void;
  onImplementPlan: (strategy: PlanImplementationStrategy) => void;
  onImplementPlanInNewThread: (strategy: PlanImplementationStrategy) => void;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  onThreadModelSelectionChange: (
    threadRef: ScopedThreadRef,
    modelSelection: ModelSelection,
  ) => void;
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;

  focusComposer: () => void;
  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onVoiceRecordingActiveChange?: (active: boolean) => void;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ChatComposer = memo(function ChatComposer(props: ChatComposerProps) {
  const translate = useInterfaceTranslator().message;
  const {
    composerDraftTarget,
    environmentId,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
    routeKind,
    routeThreadRef,
    draftId,
    activeThreadId,
    activeThreadEnvironmentId,
    activeThread,
    isServerThread: _isServerThread,
    isLocalDraftThread: _isLocalDraftThread,
    forceExpandedOnMobile,
    projectSelectionRequired,
    phase,
    isConnecting,
    isSendBusy,
    sendDisabledReason: externalSendDisabledReason,
    isPreparingWorktree,
    environmentUnavailable,
    activePendingApproval,
    pendingApprovals,
    pendingUserInputs,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    respondingRequestIds,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    firstTurnForkBudget,
    isWorking,
    activeWorkStartedAt,
    runtimeMode,
    interactionMode,
    lockedProvider,
    providerStatuses,
    activeProjectDefaultModelSelection,
    activeThreadModelSelection,
    activeContextWindow,
    compactDisabled,
    compactDisabledReason,
    resolvedTheme,
    settings,
    keybindings,
    terminalOpen,
    gitCwd,
    voiceInputConfigured,
    promptRef,
    composerRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    composerElementContextsRef,
    onSend,
    onInterrupt,
    onImplementPlan,
    onImplementPlanInNewThread,
    onRespondToApproval,
    onSelectActivePendingUserInputOption,
    onAdvanceActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    onChangeActivePendingUserInputCustomAnswer,
    onProviderModelSelect,
    onThreadModelSelectionChange,
    getModelDisabledReason,
    toggleInteractionMode,
    handleRuntimeModeChange,
    handleInteractionModeChange,
    focusComposer,
    scheduleComposerFocus,
    setThreadError,
    onExpandImage,
    onVoiceRecordingActiveChange,
  } = props;
  const activeTasksProgress = props.threadSyncPhase === null ? props.activeTasksProgress : null;
  const activeTaskSteps = props.threadSyncPhase === null ? props.activeTaskSteps : null;
  // ------------------------------------------------------------------
  // Store subscriptions (prompt / images / terminal contexts)
  // ------------------------------------------------------------------
  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  // Live target key, for async flows that must notice a thread switch that
  // happened while they awaited.
  const composerDraftTargetKeyRef = useRef("");
  composerDraftTargetKeyRef.current = composerTargetKey(composerDraftTarget);
  const prompt = composerDraft.prompt;
  const composerImages = composerDraft.images;
  const composerFiles = composerDraft.files;
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerElementContexts = composerDraft.elementContexts;
  const composerPreviewAnnotations = composerDraft.previewAnnotations;
  const composerReviewComments = composerDraft.reviewComments;
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
  const abortPresentation = resolveThreadAbortPresentation(activeThread?.session ?? null);
  const isAbortPending = abortPresentation.phase !== null;
  const uploadsByImageId = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const needsReattachFileCount = composerFiles.filter(composerFileNeedsReattach).length;
  const fileStagingLimit = fileAttachmentStagingLimit({
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });
  const fileCapabilityBlockReason = fileAttachmentCapabilityBlockReason({
    files: composerFiles,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });
  const attachmentBlockReason =
    fileCapabilityBlockReason ??
    (supportsAttachmentUploads
      ? needsReattachFileCount > 0
        ? needsReattachFileCount === 1
          ? "Attach the interrupted file again or remove it"
          : "Attach the interrupted files again or remove them"
        : attachmentUploadBlockReason({
            imageIds: [...composerImages, ...composerFiles].map((attachment) => attachment.id),
            uploadsByImageId,
            environmentId,
          })
      : null);
  const sendDisabledReason =
    externalSendDisabledReason ?? (activePendingProgress ? null : attachmentBlockReason);
  const isSendDisabled = sendDisabledReason !== null;

  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImage = useComposerDraftStore((store) => store.addImage);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const addComposerDraftFiles = useComposerDraftStore((store) => store.addFiles);
  const removeComposerDraftFile = useComposerDraftStore((store) => store.removeFile);
  const setComposerDraftFileUpload = useComposerDraftStore((store) => store.setFileUpload);
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const removeComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.removeTerminalContext,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const removeComposerDraftElementContext = useComposerDraftStore(
    (store) => store.removeElementContext,
  );
  const removeComposerDraftPreviewAnnotation = useComposerDraftStore(
    (store) => store.removePreviewAnnotation,
  );
  const removeComposerDraftReviewComment = useComposerDraftStore(
    (store) => store.removeReviewComment,
  );
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const clearComposerDraftPromptAndImages = useComposerDraftStore(
    (store) => store.clearComposerPromptAndImages,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const preferredModelPickerInstanceId = useComposerDraftStore(
    (store) => store.stickyActiveProvider,
  );
  const setStickyActiveProvider = useComposerDraftStore((store) => store.setStickyActiveProvider);

  useEffect(() => {
    if (!attachmentUploadsCapabilityKnown) {
      return;
    }
    if (!supportsAttachmentUploads) {
      // The capability can flap on reconnect or version skew. Deleting a
      // persisted hydrated upload here would make the next send fail
      // verification while the file still sits in the draft.
      for (const attachment of attachmentsToReleaseOnUploadCapabilityLoss([
        ...composerImages,
        ...composerFiles,
      ])) {
        releaseAttachmentUpload(attachment.id);
      }
      return;
    }
    const invalidFiles =
      maxFileAttachmentBytes === null
        ? composerFiles
        : composerFiles.filter((file) => file.sizeBytes > maxFileAttachmentBytes);
    for (const attachment of attachmentsToReleaseOnUploadCapabilityLoss(invalidFiles)) {
      releaseAttachmentUpload(attachment.id);
    }
    const uploadableFiles =
      maxFileAttachmentBytes === null
        ? []
        : composerFiles.filter((file) => file.sizeBytes <= maxFileAttachmentBytes);
    const uploadableAttachments = [...composerImages, ...uploadableFiles];
    for (const attachment of uploadableAttachments) {
      // A needs-reattach file has no bytes to upload and no upload to verify.
      if (attachment.type === "file" && composerFileNeedsReattach(attachment)) {
        continue;
      }
      startAttachmentUpload({ environmentId, image: attachment, draftTarget: composerDraftTarget });
    }
  }, [
    attachmentUploadsCapabilityKnown,
    composerDraftTarget,
    composerFiles,
    composerImages,
    environmentId,
    maxFileAttachmentBytes,
    supportsAttachmentUploads,
  ]);

  useEffect(() => {
    for (const file of composerFiles) {
      if (
        !attachmentUploadsCapabilityKnown ||
        !supportsAttachmentUploads ||
        maxFileAttachmentBytes === null ||
        file.sizeBytes > maxFileAttachmentBytes
      ) {
        continue;
      }
      const upload = uploadsByImageId[file.id];
      if (upload?.status === "ready" && upload.environmentId === environmentId) {
        setComposerDraftFileUpload(
          composerDraftTarget,
          file.id,
          environmentId,
          upload.attachmentId,
        );
      }
    }
  }, [
    attachmentUploadsCapabilityKnown,
    composerDraftTarget,
    composerFiles,
    environmentId,
    maxFileAttachmentBytes,
    setComposerDraftFileUpload,
    supportsAttachmentUploads,
    uploadsByImageId,
  ]);

  // ------------------------------------------------------------------
  // Model state
  // ------------------------------------------------------------------
  // Instance-aware projection of the wire provider list. One entry per
  // configured instance (default built-in + any custom `providerInstances.*`),
  // sorted default-first per driver kind for a stable picker order.
  const providerInstanceEntries = useMemo<ReadonlyArray<ProviderInstanceEntry>>(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
      ),
    [providerStatuses, settings],
  );
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    activeThread?.session?.providerInstanceId ??
    activeThreadModelSelection?.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const explicitSelectedInstanceId = selectedProviderByThreadId ?? threadProvider;

  const unlockedSelectedProvider =
    resolveProviderDriverKindForInstanceSelection(
      providerInstanceEntries,
      providerStatuses,
      explicitSelectedInstanceId,
    ) ??
    providerInstanceEntries[0]?.driverKind ??
    ProviderDriverKind.make("unconfigured");
  const requestedDriverKind: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
  const lockedContinuationGroupKey = useMemo((): string | null => {
    if (!lockedProvider || !activeThread) return null;
    const lockedInstanceId =
      activeThread.session?.providerInstanceId ?? activeThreadModelSelection?.instanceId;
    if (!lockedInstanceId) return null;
    return (
      providerInstanceEntries.find((entry) => entry.instanceId === lockedInstanceId)
        ?.continuationGroupKey ?? null
    );
  }, [
    activeThread,
    activeThreadModelSelection?.instanceId,
    lockedProvider,
    providerInstanceEntries,
  ]);

  // Resolve which configured instance the composer is currently targeting.
  // Priority:
  //   1. The composer draft's `activeProvider` — the user's unsaved pick
  //      from the model picker (must win, otherwise the UI appears to
  //      ignore picker selections).
  //   2. Thread's persisted instance id (server-side saved selection).
  //   3. Project default's instance id.
  //   4. First enabled entry matching the current driver kind.
  //   5. First enabled entry overall / default instance for the kind.
  //
  const selectedInstanceId = useMemo<ProviderInstanceId>(() => {
    const candidates: Array<string | null | undefined> = [
      composerDraft.activeProvider,
      activeThread?.session?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const match = providerInstanceEntries.find(
        (entry) => entry.instanceId === candidate && entry.enabled && entry.isAvailable,
      );
      if (match) {
        // When locked to a specific driver kind, ignore persisted instance
        // ids from a different kind or continuation group.
        if (lockedProvider && match.driverKind !== lockedProvider) continue;
        if (
          lockedContinuationGroupKey &&
          match.continuationGroupKey !== lockedContinuationGroupKey
        ) {
          continue;
        }
        return match.instanceId;
      }
    }
    const compatibleEntries = providerInstanceEntries.filter(
      (entry) =>
        (!lockedProvider || entry.driverKind === lockedProvider) &&
        (!lockedContinuationGroupKey || entry.continuationGroupKey === lockedContinuationGroupKey),
    );
    const requestedDriverEntries = compatibleEntries.filter(
      (entry) => entry.driverKind === requestedDriverKind,
    );
    return (
      resolveSelectableProviderInstanceEntry(requestedDriverEntries, undefined)?.instanceId ??
      resolveSelectableProviderInstanceEntry(compatibleEntries, undefined)?.instanceId ??
      NO_PROVIDER_MODEL_SELECTION.instanceId
    );
  }, [
    activeProjectDefaultModelSelection?.instanceId,
    activeThread?.session?.providerInstanceId,
    activeThreadModelSelection?.instanceId,
    composerDraft.activeProvider,
    lockedContinuationGroupKey,
    lockedProvider,
    providerInstanceEntries,
    requestedDriverKind,
  ]);

  // Resolve the active instance's snapshot by `instanceId` so a custom
  // instance gets its own slash commands, skills, and model list — not
  // the first snapshot for the same driver kind.
  const selectedProviderEntry = useMemo(
    () => providerInstanceEntries.find((entry) => entry.instanceId === selectedInstanceId),
    [providerInstanceEntries, selectedInstanceId],
  );
  const noProviderAvailable = selectedProviderEntry === undefined;
  const resolvedCompactDisabledReason =
    compactDisabledReason ?? (noProviderAvailable ? "Compacting is unavailable right now" : null);
  // The driver kind follows the instance that will actually run the turn,
  // which can differ from the persisted selection when that selection is
  // disabled.
  const selectedProvider: ProviderDriverKind =
    selectedProviderEntry?.driverKind ?? requestedDriverKind;

  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadRef: composerDraftTarget,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: activeThreadModelSelection,
    projectModelSelection: activeProjectDefaultModelSelection,
    settings,
  });
  const selectedProviderStatus = useMemo(
    () => selectedProviderEntry?.snapshot ?? null,
    [selectedProviderEntry],
  );
  const selectedProviderSkills = useMemo(
    () => selectedProviderStatus?.skills ?? [],
    [selectedProviderStatus?.skills],
  );
  const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
    () => selectedProviderEntry?.models ?? [],
    [selectedProviderEntry],
  );
  const planReviewerSelection = useMemo(
    () => resolveParallelPlanReviewModelSelectionState(settings, providerStatuses),
    [providerStatuses, settings],
  );
  const planReviewerProviderStatus = useMemo(
    () =>
      providerStatuses.find(
        (provider) => provider.instanceId === planReviewerSelection.instanceId,
      ) ?? null,
    [planReviewerSelection.instanceId, providerStatuses],
  );
  const planParallelismReview = usePlanParallelismReview({
    enabled:
      settings.experimentalParallelPlanImplementation &&
      showPlanFollowUpPrompt &&
      environmentUnavailable === null,
    environmentId,
    threadId: activeThreadId,
    plan: activeProposedPlan,
    implementationProvider: selectedProviderStatus,
    reviewerProvider: planReviewerProviderStatus,
    reviewerSelection: planReviewerSelection,
  });
  const planImplementationSuggestion = useMemo(
    () =>
      activeProposedPlan
        ? resolvePlanImplementationSuggestion({
            featureEnabled: settings.experimentalParallelPlanImplementation,
            planMarkdown: activeProposedPlan.planMarkdown,
            provider: selectedProviderStatus,
            reviewedSubagentCount: planParallelismReview.reviewedSubagentCount,
          })
        : null,
    [
      activeProposedPlan,
      planParallelismReview.reviewedSubagentCount,
      selectedProviderStatus,
      settings.experimentalParallelPlanImplementation,
    ],
  );

  const composerPromptInjectionState = useMemo(
    () => getComposerPromptInjectionState(prompt),
    [prompt],
  );
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        promptInjectionState: composerPromptInjectionState,
        modelOptions: composerModelOptions?.[selectedInstanceId],
        planModeEnabled: settings.planModeEnabled,
      }),
    [
      composerModelOptions,
      composerPromptInjectionState,
      selectedInstanceId,
      selectedModel,
      selectedProvider,
      selectedProviderModels,
      settings.planModeEnabled,
    ],
  );

  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  const planModeUiEnabled = useMemo(
    () =>
      isPlanModeAvailable({
        providers: providerStatuses,
        provider: selectedProvider,
        legacyPlanModeEnabled: settings.planModeEnabled,
      }),
    [providerStatuses, selectedProvider, settings.planModeEnabled],
  );
  const selectedModelSelection = useMemo<ModelSelection>(
    () => createModelSelection(selectedInstanceId, selectedModel, selectedModelOptionsForDispatch),
    [selectedInstanceId, selectedModel, selectedModelOptionsForDispatch],
  );
  const selectedModelForPicker = selectedModel;
  // Instance-keyed option list so the picker can show each configured
  // instance (built-in + custom) as a first-class sidebar entry. The
  // options are server-reported models plus that exact instance's
  // configured custom models. A missing OpenCode selection is included as
  // an unavailable row until the catalog reports it again.
  const modelOptionsByInstance = useMemo<
    ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
  >(() => {
    const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of providerInstanceEntries) {
      out.set(
        entry.instanceId,
        getAppModelOptionsForInstance(
          settings,
          entry,
          entry.instanceId === selectedInstanceId ? selectedModelForPicker : null,
        ),
      );
    }
    return out;
  }, [providerInstanceEntries, selectedInstanceId, selectedModelForPicker, settings]);
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [modelOptionsByInstance, selectedInstanceId, selectedModelForPicker, selectedProvider]);

  // ------------------------------------------------------------------
  // Context window
  // ------------------------------------------------------------------
  const activeThreadModelDisplayName = useMemo(
    () => resolveContextWindowModelDisplayName(activeThreadModelSelection, modelOptionsByInstance),
    [activeThreadModelSelection, modelOptionsByInstance],
  );

  // ------------------------------------------------------------------
  // Composer-local state
  // ------------------------------------------------------------------
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(prompt, prompt.length),
  );
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
    null,
  );
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(
    () => !settings.showExpandedComposerControls,
  );
  const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
  const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [composerSubmissionError, setComposerSubmissionError] = useState<string | null>(null);
  const [providerInputSubmissionError, setProviderInputSubmissionError] = useState<string | null>(
    null,
  );
  const [composerMenuAnchor, setComposerMenuAnchor] = useState<HTMLDivElement | null>(null);
  const [isStashMenuOpen, setIsStashMenuOpen] = useState(false);
  const [isTasksDrawerOpen, setIsTasksDrawerOpen] = useState(false);
  const [stashPulse, setStashPulse] = useState<{ key: number; active: boolean }>({
    key: 0,
    active: false,
  });
  const [surfaceMorphCoordinator] = useState<SurfaceMorphCoordinator | null>(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return null;
    return createSurfaceMorphCoordinator({ windowTarget: window, documentTarget: document });
  });
  const isMobileViewport = useMediaQuery("max-sm");
  const isComposerCollapsedMobile =
    isMobileViewport && !forceExpandedOnMobile && !isComposerFocused;
  const providerInputLimit = firstTurnForkBudget?.remainingInputChars;
  const attachmentLimit = Math.max(
    0,
    Math.min(
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
      firstTurnForkBudget?.remainingAttachmentCount ?? PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    ),
  );

  // ------------------------------------------------------------------
  // Refs
  // ------------------------------------------------------------------
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement>(null);
  const providerInputRejectedRef = useRef(false);
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const composerBlurFrameRef = useRef<number | null>(null);
  const mobileComposerExpandFrameRef = useRef<number | null>(null);
  const mobileComposerExpandReleaseFrameRef = useRef<number | null>(null);
  const mobileComposerExpandInFlightRef = useRef(false);
  const stashPulseKeyRef = useRef(0);
  const stashPulseTimeoutRef = useRef<number | null>(null);
  const markedMorphTriggerElementsRef = useRef<Set<HTMLElement>>(new Set());
  const markedMorphDrawerElementsRef = useRef<Set<HTMLElement>>(new Set());
  const surfaceMorphScopeKeyRef = useRef(props.surfaceMorphScopeKey);
  /**
   * Snapshots currently being encoded, keyed by target+prompt+image ids.
   * Keyed rather than boolean so a genuinely different prompt (or a different
   * thread) can still be stashed while an earlier encode is running.
   */
  const stashInFlightRef = useRef<Set<string>>(new Set());
  /**
   * Count of pasted images still being compressed, per thread. Reserved
   * against the attachment limit so concurrent pastes can't overshoot it,
   * and checked before sending or compacting so an image cannot move into
   * the next draft.
   */
  const pendingImageCompressionsRef = useRef<Map<ThreadId, number>>(new Map());

  useLayoutEffect(() => {
    if (surfaceMorphScopeKeyRef.current === props.surfaceMorphScopeKey) return;
    surfaceMorphCoordinator?.cancel();
    surfaceMorphScopeKeyRef.current = props.surfaceMorphScopeKey;
  }, [props.surfaceMorphScopeKey, surfaceMorphCoordinator]);

  useEffect(
    () => () => {
      surfaceMorphCoordinator?.dispose();
    },
    [surfaceMorphCoordinator],
  );

  useLayoutEffect(() => {
    const form = composerFormRef.current;
    if (!form) return;

    for (const trigger of markedMorphTriggerElementsRef.current) {
      if (!trigger.isConnected) markedMorphTriggerElementsRef.current.delete(trigger);
    }
    for (const drawer of markedMorphDrawerElementsRef.current) {
      if (!drawer.isConnected) markedMorphDrawerElementsRef.current.delete(drawer);
    }

    // These controls live in focused child components that intentionally do
    // not forward arbitrary DOM props. Mark the real buttons after the commit
    // so origin capture stays pixel-accurate without adding layout wrappers.
    const morphRoots = [form];
    for (const root of morphRoots) {
      root.querySelectorAll<HTMLElement>('[data-prompt-stash-badge="true"]').forEach((trigger) => {
        trigger.setAttribute("data-composer-surface-morph-trigger", "stash");
        markedMorphTriggerElementsRef.current.add(trigger);
      });
      root
        .querySelectorAll<HTMLElement>('[data-composer-tasks-badge="true"] button[aria-expanded]')
        .forEach((trigger) => {
          trigger.setAttribute("data-composer-surface-morph-trigger", "tasks");
          markedMorphTriggerElementsRef.current.add(trigger);
        });
      root
        .querySelectorAll<HTMLElement>('[data-chat-composer-tasks-drawer="true"]')
        .forEach((drawer) => {
          drawer.setAttribute("data-composer-surface-morph", "secondary");
          drawer.setAttribute("data-composer-surface-morph-key", "tasks-drawer");
          drawer.setAttribute("data-composer-surface-morph-origin", "tasks");
          markedMorphDrawerElementsRef.current.add(drawer);
        });
    }
  });

  useEffect(
    () => () => {
      for (const trigger of markedMorphTriggerElementsRef.current) {
        trigger.removeAttribute("data-composer-surface-morph-trigger");
      }
      for (const drawer of markedMorphDrawerElementsRef.current) {
        drawer.removeAttribute("data-composer-surface-morph");
        drawer.removeAttribute("data-composer-surface-morph-key");
        drawer.removeAttribute("data-composer-surface-morph-origin");
      }
      markedMorphTriggerElementsRef.current.clear();
      markedMorphDrawerElementsRef.current.clear();
    },
    [],
  );

  // ------------------------------------------------------------------
  // Derived: composer send state
  // ------------------------------------------------------------------
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length + composerFiles.length,
        terminalContexts: composerTerminalContexts,
        elementContextCount:
          composerElementContexts.length +
          composerPreviewAnnotations.length +
          composerReviewComments.length,
      }),
    [
      composerElementContexts.length,
      composerFiles.length,
      composerImages.length,
      composerPreviewAnnotations.length,
      composerReviewComments.length,
      composerTerminalContexts,
      prompt,
    ],
  );

  // ------------------------------------------------------------------
  // Derived: composer trigger / menu
  // ------------------------------------------------------------------
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  const workspaceEntries = useComposerPathSearch({
    environmentId,
    cwd: isPathTrigger ? gitCwd : null,
    query: isPathTrigger ? pathTriggerQuery : null,
  });

  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return workspaceEntries.entries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path",
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
      }));
    }
    if (composerTrigger.kind === "slash-command") {
      const builtInSlashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: translate("chat.composer.command.modelLabel"),
          description: translate("chat.composer.command.modelDescription"),
        },
        ...(planModeUiEnabled
          ? ([
              {
                id: "slash:plan",
                type: "slash-command",
                command: "plan",
                label: translate("chat.composer.command.planLabel"),
                description: translate("chat.composer.command.planDescription"),
              },
              {
                id: "slash:default",
                type: "slash-command",
                command: "default",
                label: translate("chat.composer.command.defaultLabel"),
                description: translate("chat.composer.command.defaultDescription"),
              },
            ] as const)
          : []),
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const slashMenuSkills = getProviderSkillsForSlashMenu(
        selectedProviderStatus?.skills ?? [],
        settings.showSkillsInSlashMenu,
      );
      const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
        selectedProviderStatus?.slashCommands ?? [],
        slashMenuSkills,
      ).map((command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: selectedProvider,
        command,
        label: `/${command.name}`,
        description:
          command.description ??
          command.input?.hint ??
          translate("chat.composer.command.runProviderCommand"),
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const skillItems = slashMenuSkills.map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: `/skill:${skill.name}`,
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope
            ? translate("chat.composer.command.providerSkillScope", { scope: skill.scope })
            : ""),
      }));
      const slashCommandItems = [
        ...builtInSlashCommandItems,
        ...providerSlashCommandItems,
        ...skillItems,
      ];
      return searchSlashCommandItems(slashCommandItems, query);
    }
    if (composerTrigger.kind === "skill") {
      return searchProviderSkills(selectedProviderSkills, composerTrigger.query).map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope
            ? translate("chat.composer.command.providerSkillScope", { scope: skill.scope })
            : translate("chat.composer.command.runProviderSkill")),
      }));
    }
    return [];
  }, [
    composerTrigger,
    planModeUiEnabled,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderStatus,
    settings.showSkillsInSlashMenu,
    translate,
    workspaceEntries.entries,
  ]);

  const composerMenuOpen = Boolean(composerTrigger);
  const composerMenuSearchKey = composerTrigger
    ? `${composerTrigger.kind}:${composerTrigger.query.trim().toLowerCase()}`
    : null;
  const activeComposerMenuItem = useMemo(() => {
    const activeItemId = resolveComposerMenuActiveItemId({
      items: composerMenuItems,
      highlightedItemId: composerHighlightedItemId,
      currentSearchKey: composerMenuSearchKey,
      highlightedSearchKey: composerHighlightedSearchKey,
    });
    return composerMenuItems.find((item) => item.id === activeItemId) ?? null;
  }, [
    composerHighlightedItemId,
    composerHighlightedSearchKey,
    composerMenuItems,
    composerMenuSearchKey,
  ]);

  composerMenuOpenRef.current = composerMenuOpen;
  composerMenuItemsRef.current = composerMenuItems;
  activeComposerMenuItemRef.current = activeComposerMenuItem;

  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );

  const isComposerApprovalState = activePendingApproval !== null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const showComposerTopDrawer =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (!isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan !== null);
  const showCollapsedMobilePromptRow =
    isComposerCollapsedMobile && !isComposerApprovalState && pendingUserInputs.length === 0;

  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const composerFooterActionLayoutKey = useMemo(() => {
    if (activePendingProgress) {
      return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
    }
    if (phase === "running") {
      return "running";
    }
    if (showPlanFollowUpPrompt) {
      return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
    }
    return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
  }, [
    activePendingIsResponding,
    activePendingProgress,
    composerSendState.hasSendableContent,
    isConnecting,
    isPreparingWorktree,
    isSendBusy,
    phase,
    prompt,
    showPlanFollowUpPrompt,
  ]);

  const isComposerMenuLoading =
    composerTriggerKind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending;
  const composerMenuEmptyState = useMemo(() => {
    if (composerTriggerKind === "skill") {
      return "No skills found. Try / to browse provider commands.";
    }
    return composerTriggerKind === "path"
      ? "No matching files or folders."
      : "No matching command.";
  }, [composerTriggerKind]);

  // ------------------------------------------------------------------
  // Provider traits UI
  // ------------------------------------------------------------------
  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      if (nextPrompt === promptRef.current) {
        scheduleComposerFocus();
        return;
      }
      promptRef.current = nextPrompt;
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [composerDraftTarget, promptRef, scheduleComposerFocus, setComposerDraftPrompt],
  );
  const providerTraitsMenuContent = renderProviderTraitsMenuContent({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    prompt,
    onPromptChange: setPromptFromTraits,
    planModeEnabled: settings.planModeEnabled,
    autoReasoningEffort: props.autoReasoningEffort,
  });
  const providerTraitsPicker = renderProviderTraitsPicker({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    prompt,
    onPromptChange: setPromptFromTraits,
    planModeEnabled: settings.planModeEnabled,
    autoReasoningEffort: props.autoReasoningEffort,
  });
  const providerContextWindowMenuContent = renderProviderContextWindowMenuContent({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    prompt,
    onPromptChange: setPromptFromTraits,
    onThreadModelSelectionChange,
    planModeEnabled: settings.planModeEnabled,
  });
  const providerContextWindowPicker = renderProviderContextWindowPicker({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    prompt,
    onPromptChange: setPromptFromTraits,
    onThreadModelSelectionChange,
    planModeEnabled: settings.planModeEnabled,
  });
  const composerFooterHasContextWindowControl = Boolean(providerContextWindowPicker);
  const pendingPrimaryAction = useMemo(
    () =>
      activePendingProgress
        ? {
            questionIndex: activePendingProgress.questionIndex,
            isLastQuestion: activePendingProgress.isLastQuestion,
            canAdvance: activePendingProgress.canAdvance,
            isResponding: activePendingIsResponding,
            isComplete: Boolean(activePendingResolvedAnswers),
          }
        : null,
    [activePendingIsResponding, activePendingProgress, activePendingResolvedAnswers],
  );
  const collapsedComposerPrimaryActionDisabled =
    phase === "running" ||
    isAbortPending ||
    isSendBusy ||
    isSendDisabled ||
    isConnecting ||
    noProviderAvailable ||
    projectSelectionRequired ||
    environmentUnavailable !== null ||
    !composerSendState.hasSendableContent;
  const collapsedComposerPrimaryActionLabel = "Send message";
  const showMobilePendingAnswerActions =
    isMobileViewport && !isComposerCollapsedMobile && pendingPrimaryAction !== null;

  // ------------------------------------------------------------------
  // Prompt helpers
  // ------------------------------------------------------------------
  const setPrompt = useCallback(
    (nextPrompt: string) => {
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    },
    [composerDraftTarget, setComposerDraftPrompt],
  );

  const addComposerImage = useCallback(
    (image: ComposerImageAttachment) => {
      addComposerDraftImage(composerDraftTarget, image);
    },
    [composerDraftTarget, addComposerDraftImage],
  );

  const addComposerImagesToDraft = useCallback(
    (images: ComposerImageAttachment[]) => {
      addComposerDraftImages(composerDraftTarget, images);
    },
    [composerDraftTarget, addComposerDraftImages],
  );

  const addComposerFilesToDraft = useCallback(
    (files: ComposerFileAttachment[]) => {
      addComposerDraftFiles(composerDraftTarget, files);
    },
    [addComposerDraftFiles, composerDraftTarget],
  );

  const removeComposerImageFromDraft = useCallback(
    (imageId: string) => {
      releaseAttachmentUpload(imageId);
      removeComposerDraftImage(composerDraftTarget, imageId);
    },
    [composerDraftTarget, removeComposerDraftImage],
  );

  const removeComposerFileFromDraft = useCallback(
    (fileId: string) => {
      // Release by the draft attachment, not the bare queue key: a hydrated
      // file's upload lives server-side under its persisted attachment id.
      const file = composerFilesRef.current.find((candidate) => candidate.id === fileId);
      if (file) {
        releaseDraftAttachment(file);
      } else {
        releaseAttachmentUpload(fileId);
      }
      removeComposerDraftFile(composerDraftTarget, fileId);
    },
    [composerDraftTarget, composerFilesRef, removeComposerDraftFile],
  );

  const removeComposerTerminalContextFromDraft = useCallback(
    (contextId: string) => {
      const contextIndex = composerTerminalContexts.findIndex(
        (context) => context.id === contextId,
      );
      if (contextIndex < 0) return;
      const removal = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
      promptRef.current = removal.prompt;
      setPrompt(removal.prompt);
      removeComposerDraftTerminalContext(composerDraftTarget, contextId);
      const nextCursor = collapseExpandedComposerCursor(removal.prompt, removal.cursor);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(removal.prompt, removal.cursor));
    },
    [
      composerDraftTarget,
      composerTerminalContexts,
      promptRef,
      removeComposerDraftTerminalContext,
      setPrompt,
    ],
  );

  // ------------------------------------------------------------------
  // Sync refs back to parent
  // ------------------------------------------------------------------
  useEffect(() => {
    promptRef.current = prompt;
    setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
  }, [prompt, promptRef]);

  useEffect(() => {
    if (composerSubmissionError === null) return;
    const nextError = getComposerPromptLengthValidationMessage(prompt, providerInputLimit);
    if (nextError !== composerSubmissionError) {
      setComposerSubmissionError(nextError);
    }
  }, [composerSubmissionError, prompt, providerInputLimit]);

  useEffect(() => {
    setProviderInputSubmissionError(null);
  }, [
    composerElementContexts,
    composerPreviewAnnotations,
    composerReviewComments,
    composerTerminalContexts,
    prompt,
    selectedModel,
    selectedPromptEffort,
    selectedProvider,
  ]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages, composerImagesRef]);

  useEffect(() => {
    composerFilesRef.current = composerFiles;
  }, [composerFiles, composerFilesRef]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts, composerTerminalContextsRef]);

  useEffect(() => {
    composerElementContextsRef.current = composerElementContexts;
  }, [composerElementContexts, composerElementContextsRef]);

  // ------------------------------------------------------------------
  // Composer menu highlight sync
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
      return;
    }
    const nextActiveItemId = resolveComposerMenuActiveItemId({
      items: composerMenuItems,
      highlightedItemId: composerHighlightedItemId,
      currentSearchKey: composerMenuSearchKey,
      highlightedSearchKey: composerHighlightedSearchKey,
    });
    setComposerHighlightedItemId((existing) =>
      existing === nextActiveItemId ? existing : nextActiveItemId,
    );
    setComposerHighlightedSearchKey((existing) =>
      existing === composerMenuSearchKey ? existing : composerMenuSearchKey,
    );
  }, [
    composerHighlightedItemId,
    composerHighlightedSearchKey,
    composerMenuItems,
    composerMenuOpen,
    composerMenuSearchKey,
  ]);

  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);

  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      lastSyncedPendingInputRef.current = null;
      return;
    }

    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      detectComposerTrigger(
        nextCustomAnswer,
        expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
      ),
    );
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.customAnswer,
    activePendingProgress?.activeQuestion?.id,
    activePendingUserInput?.requestId,
    promptRef,
  ]);

  // ------------------------------------------------------------------
  // Reset compositor state on thread/draft change
  // ------------------------------------------------------------------
  useEffect(() => {
    setComposerHighlightedItemId(null);
    setComposerSubmissionError(null);
    setProviderInputSubmissionError(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
    setIsDragOverComposer(false);
  }, [draftId, activeThreadId, promptRef]);

  // ------------------------------------------------------------------
  // Footer compact layout observation
  // ------------------------------------------------------------------
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;
    const measureFooterCompactness = () => {
      const composerFormWidth = measureComposerFormWidth();
      const footerCompact = shouldUseCompactComposerControls(composerFormWidth, {
        showExpandedComposerControls: settings.showExpandedComposerControls,
        hasContextWindowControl: composerFooterHasContextWindowControl,
        hasWideActions: composerFooterHasWideActions,
      });
      const primaryActionsCompact =
        footerCompact &&
        shouldUseCompactComposerPrimaryActions(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });
      return {
        primaryActionsCompact,
        footerCompact,
      };
    };

    const initialCompactness = measureFooterCompactness();
    setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
    setIsComposerFooterCompact(initialCompactness.footerCompact);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const nextCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact((previous) =>
        previous === nextCompactness.primaryActionsCompact
          ? previous
          : nextCompactness.primaryActionsCompact,
      );
      setIsComposerFooterCompact((previous) =>
        previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
      );
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
    };
  }, [
    activeThreadId,
    composerFooterActionLayoutKey,
    composerFooterHasContextWindowControl,
    composerFooterHasWideActions,
    settings.showExpandedComposerControls,
  ]);

  // ------------------------------------------------------------------
  // Image persist effect
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(composerDraftTarget);
        return;
      }
      const getPersistedAttachmentsForThread = () =>
        getComposerDraft(composerDraftTarget)?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(composerDraftTarget, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds: Array<string> = [];
        for (const attachment of fallbackPersistedAttachments) {
          if (currentImageIds.has(attachment.id)) {
            fallbackPersistedIds.push(attachment.id);
          }
        }
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(composerDraftTarget, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    composerDraftTarget,
    clearComposerDraftPersistedAttachments,
    composerImages,
    getComposerDraft,
    syncComposerDraftPersistedAttachments,
  ]);

  // ------------------------------------------------------------------
  // Callbacks: prompt change
  // ------------------------------------------------------------------
  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[],
    ) => {
      if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
        );
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
        setComposerDraftTerminalContexts(
          composerDraftTarget,
          syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
        );
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      activePendingProgress?.activeQuestion,
      pendingUserInputs.length,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setPrompt,
      composerDraftTarget,
      composerTerminalContexts,
      setComposerDraftTerminalContexts,
    ],
  );

  // ------------------------------------------------------------------
  // Callbacks: prompt replacement / menu
  // ------------------------------------------------------------------
  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
    ): boolean => {
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        options?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== options.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingQuestion.id,
          next.text,
          nextCursor,
          nextExpandedCursor,
          false,
        );
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(next.text, nextExpandedCursor));
      if (options?.focusEditorAfterReplace !== false) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCursor);
        });
      }
      return true;
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setPrompt,
    ],
  );

  const readComposerSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
    };
  }, [composerCursor, composerTerminalContexts, promptRef]);

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        const replacement = `${serializeComposerFileLink(item.path)} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "model") {
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
            focusEditorAfterReplace: false,
          });
          if (applied) {
            setComposerHighlightedItemId(null);
            setIsComposerModelPickerOpen(true);
          }
          return;
        }
        void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "provider-slash-command") {
        const replacement = `/${item.command.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "skill") {
        const replacement =
          trigger.kind === "slash-command" ? `/${item.skill.name} ` : `$${item.skill.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
    },
    [applyPromptReplacement, handleInteractionModeChange, resolveActiveComposerTrigger],
  );

  const onComposerMenuItemHighlighted = useCallback(
    (itemId: string | null) => {
      setComposerHighlightedItemId(itemId);
      setComposerHighlightedSearchKey(composerMenuSearchKey);
    },
    [composerMenuSearchKey],
  );

  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) return;
      const highlightedIndex = composerMenuItems.findIndex(
        (item) => item.id === composerHighlightedItemId,
      );
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      const nextItem = composerMenuItems[nextIndex];
      setComposerHighlightedItemId(nextItem?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems],
  );

  const blurMobileComposerAfterSend = useCallback(() => {
    if (!isMobileViewport) return;
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
    setIsComposerFocused(false);
  }, [isMobileViewport]);

  const shouldBlurMobileComposerOnSubmit = useCallback(() => {
    if (!isMobileViewport) return false;
    if (
      isSendBusy ||
      isSendDisabled ||
      isAbortPending ||
      isConnecting ||
      noProviderAvailable ||
      environmentUnavailable !== null ||
      phase === "running"
    ) {
      return false;
    }
    if (activePendingProgress) {
      return activePendingProgress.isLastQuestion && Boolean(activePendingResolvedAnswers);
    }
    return showPlanFollowUpPrompt || composerSendState.hasSendableContent;
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    isAbortPending,
    composerSendState.hasSendableContent,
    environmentUnavailable,
    isConnecting,
    isMobileViewport,
    isSendBusy,
    isSendDisabled,
    noProviderAvailable,
    phase,
    showPlanFollowUpPrompt,
  ]);

  const voiceLifecycleKey =
    typeof composerDraftTarget === "string"
      ? `draft:${composerDraftTarget}`
      : `thread:${composerDraftTarget.environmentId}:${composerDraftTarget.threadId}`;
  const voiceEnvironmentId = resolveSpeechEnvironmentId(environmentId, activeThreadEnvironmentId);
  const getVoiceDraftSnapshot = useCallback(
    () => ({ text: promptRef.current, cursor: composerCursor }),
    [composerCursor, promptRef],
  );
  const applyVoiceDraftSnapshot = useCallback(
    ({ text, cursor }: { readonly text: string; readonly cursor: number }) => {
      const nextCursor = clampCollapsedComposerCursor(text, cursor);
      onPromptChange(
        text,
        nextCursor,
        expandCollapsedComposerCursor(text, nextCursor),
        false,
        composerTerminalContextsRef.current.map((context) => context.id),
      );
    },
    [composerTerminalContextsRef, onPromptChange],
  );
  const reportVoiceNotice = useCallback(
    ({ title, error }: { readonly title: string; readonly error: Error }) => {
      toastManager.add({ type: "error", title, description: error.message });
    },
    [],
  );
  const createVoiceStreamingToken = useCallback(() => {
    if (!activeThread) {
      return Promise.reject(new Error("Project context is unavailable for voice input."));
    }
    return createAssemblyAiStreamingTokenForEnvironment(voiceEnvironmentId, activeThread.projectId);
  }, [activeThread, voiceEnvironmentId]);
  const transformVoiceTranscript = useCallback(
    async (text: string) => {
      if (!activeThread) {
        throw new Error("Project context is unavailable for voice translation.");
      }
      const result = await translateSpeechTranscriptForEnvironment(voiceEnvironmentId, {
        projectId: activeThread.projectId,
        text,
      });
      return result.text;
    },
    [activeThread, voiceEnvironmentId],
  );
  const voiceDictation = useAssemblyAiDictation({
    configured: voiceInputConfigured,
    lifecycleKey: voiceLifecycleKey,
    getDraftSnapshot: getVoiceDraftSnapshot,
    applyDraftSnapshot: applyVoiceDraftSnapshot,
    onNotice: reportVoiceNotice,
    createToken: createVoiceStreamingToken,
    ...(settings.voiceInputOutputLanguage === "english"
      ? { transformTranscript: transformVoiceTranscript }
      : {}),
  });
  const voiceRecordingState = voiceDictation.state;
  const voiceRecordingActive = voiceDictation.active;
  const startVoiceRecording = voiceDictation.start;
  const stopVoiceRecording = voiceDictation.stop;
  useEffect(() => {
    onVoiceRecordingActiveChange?.(voiceRecordingActive);
    return () => onVoiceRecordingActiveChange?.(false);
  }, [onVoiceRecordingActiveChange, voiceRecordingActive]);
  const submitComposer = useCallback(
    (event?: { preventDefault: () => void }, intent: ComposerSubmissionIntent = "foreground") => {
      if (noProviderAvailable || isSendDisabled || isAbortPending || voiceRecordingActive) {
        event?.preventDefault();
        return;
      }
      if (
        planParallelismReview.status === "reviewing" &&
        showPlanFollowUpPrompt &&
        promptRef.current.trim().length === 0
      ) {
        event?.preventDefault();
        return;
      }
      // A send while a pasted image is still compressing would strand that
      // image: the turn snapshot wouldn't include it, and it would surface
      // in the *next* draft instead. Only oversized images hit this — small
      // files clear the pending counter within a microtask.
      if (activeThreadId && (pendingImageCompressionsRef.current.get(activeThreadId) ?? 0) > 0) {
        event?.preventDefault();
        toastManager.add({
          type: "info",
          title: translate("chat.composer.imageCompressing"),
          description: translate("chat.composer.imageCompressBeforeSend"),
        });
        return;
      }
      const submission = submitComposerDraft({
        prompt: promptRef.current,
        ...(providerInputLimit !== undefined ? { maxInputChars: providerInputLimit } : {}),
        submissionTarget: activePendingProgress ? "pending-user-input" : "provider-turn",
        event,
        onSend: (sendEvent) => {
          // ChatView reports its final composed-input preflight through the
          // composer handle before its first asynchronous send step.
          providerInputRejectedRef.current = false;
          onSend(sendEvent, intent);
          return !providerInputRejectedRef.current;
        },
      });
      setComposerSubmissionError(submission.validationMessage);
      if (!submission.didDispatch) return;
      if (shouldBlurMobileComposerOnSubmit()) {
        blurMobileComposerAfterSend();
      }
    },
    [
      activeThreadId,
      activePendingProgress,
      providerInputLimit,
      isAbortPending,
      blurMobileComposerAfterSend,
      isSendDisabled,
      noProviderAvailable,
      onSend,
      planParallelismReview.status,
      promptRef,
      shouldBlurMobileComposerOnSubmit,
      showPlanFollowUpPrompt,
      translate,
      voiceRecordingActive,
    ],
  );
  const compactThreadContext = useCallback(() => {
    if (
      compactDisabled ||
      noProviderAvailable ||
      composerSendState.hasSendableContent ||
      activePendingApproval !== null ||
      pendingUserInputs.length > 0 ||
      phase === "running" ||
      isSendBusy ||
      isConnecting ||
      !activeThreadId
    ) {
      return;
    }
    // The compact buttons cannot see the compression counter (it lives in
    // a ref), so they render enabled during a paste; toast instead of
    // silently ignoring the click.
    if ((pendingImageCompressionsRef.current.get(activeThreadId) ?? 0) > 0) {
      toastManager.add({
        type: "info",
        title: translate("chat.composer.imageCompressing"),
        description: translate("chat.composer.imageCompressBeforeCompact"),
      });
      return;
    }

    promptRef.current = "/compact";
    setComposerDraftPrompt(composerDraftTarget, "/compact");
    submitComposer();
    // A blocked dispatch (busy send ref, provider preflight rejection)
    // would leave the injected "/compact" behind as if the user typed it.
    // Clearing here is safe even when the send did dispatch: the send
    // snapshots its prompt synchronously and clears the draft itself.
    if (promptRef.current === "/compact") {
      promptRef.current = "";
      setComposerDraftPrompt(composerDraftTarget, "");
    }
  }, [
    activePendingApproval,
    activeThreadId,
    compactDisabled,
    composerDraftTarget,
    composerSendState.hasSendableContent,
    isConnecting,
    isSendBusy,
    noProviderAvailable,
    pendingUserInputs.length,
    phase,
    promptRef,
    setComposerDraftPrompt,
    submitComposer,
    translate,
  ]);
  const manualCompactAction = resolveManualCompactAction({
    provider: selectedProvider,
    canManualCompact: props.canManualCompact === true,
    compactClaude: compactThreadContext,
    compactProvider: props.onManualCompact,
  });
  const expandMobileComposer = useCallback(() => {
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    if (mobileComposerExpandFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
    }
    if (mobileComposerExpandReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
    }
    mobileComposerExpandInFlightRef.current = true;
    setIsComposerFocused(true);
    mobileComposerExpandFrameRef.current = window.requestAnimationFrame(() => {
      mobileComposerExpandFrameRef.current = null;
      composerEditorRef.current?.focusAtEnd();
      mobileComposerExpandReleaseFrameRef.current = window.requestAnimationFrame(() => {
        mobileComposerExpandReleaseFrameRef.current = null;
        mobileComposerExpandInFlightRef.current = false;
      });
    });
  }, []);

  // ------------------------------------------------------------------
  // Callbacks: command key
  // ------------------------------------------------------------------
  const onComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (key === "Tab" && event.shiftKey) {
      if (!planModeUiEnabled) return false;
      toggleInteractionMode();
      return true;
    }
    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = composerMenuOpenRef.current || trigger !== null;
    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current;
      const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if ((key === "Enter" || key === "Tab") && selectedItem) {
        onSelectComposerItem(selectedItem);
        return true;
      }
    }
    const submissionIntent =
      key === "Enter"
        ? composerSubmissionIntentForEnter({
            isMobileViewport,
            shiftKey: event.shiftKey,
            modifierKey: event.metaKey || event.ctrlKey,
            isDraftThread: routeKind === "draft",
          })
        : null;
    if (submissionIntent) {
      submitComposer(undefined, submissionIntent);
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------
  // Prompt stash (⌘S)
  // ------------------------------------------------------------------
  // Files remain tied to the environment that owns their uploaded bytes.
  const stashQueue = usePromptStashStore((state) => state.entries);
  const stashEntryToQueue = usePromptStashStore((state) => state.stashEntry);
  const takeStashEntry = usePromptStashStore((state) => state.takeEntry);
  const finalizeStashEntryImages = usePromptStashStore((state) => state.finalizeEntryImages);

  useEffect(() => {
    return () => {
      if (stashPulseTimeoutRef.current !== null) {
        window.clearTimeout(stashPulseTimeoutRef.current);
      }
    };
  }, []);

  /** Briefly highlight the badge so the save registers without a flourish. */
  const pulseStashBadge = useCallback(() => {
    stashPulseKeyRef.current += 1;
    setStashPulse({ key: stashPulseKeyRef.current, active: true });
    if (stashPulseTimeoutRef.current !== null) {
      window.clearTimeout(stashPulseTimeoutRef.current);
    }
    stashPulseTimeoutRef.current = window.setTimeout(() => {
      stashPulseTimeoutRef.current = null;
      setStashPulse((current) => ({ ...current, active: false }));
    }, 1200);
  }, []);

  const restoreStashEntry = useCallback(
    async (menuEntry: PromptStashEntry) => {
      const filesToVerify = menuEntry.files ?? [];
      if (filesToVerify.some((file) => file.environmentId !== environmentId)) {
        toastManager.add({
          type: "error",
          title: translate("chat.stash.otherEnvironmentTitle"),
          description: translate("chat.stash.otherEnvironmentDescription"),
        });
        return;
      }
      setIsStashMenuOpen(false);

      // The server sweeps pending uploads after 24 hours, so ask before
      // reattaching. An expired upload restores as a needs-reattach row
      // instead of a reference the next send would fail to verify. Verify
      // BEFORE taking: the take removes the entry from durable storage, and a
      // tab closed during this await must still find it there after reload.
      const verifications = await Promise.all(
        filesToVerify.map((file) =>
          verifyStashedAttachmentUpload({ environmentId, attachmentId: file.attachmentId }),
        ),
      );
      const expiredAttachmentIds = new Set(
        filesToVerify
          .filter((_, index) => verifications[index]?.status === "missing")
          .map((file) => file.attachmentId),
      );

      // A thread switch during the verify await would mix the new thread's
      // prompt with this invocation's captured target. Nothing was taken yet,
      // so abort and leave the entry restorable where the user now is.
      if (composerTargetKey(composerDraftTarget) !== composerDraftTargetKeyRef.current) {
        return;
      }

      // The take is also the double-activation guard (click + Enter): the
      // second caller finds the entry gone and stops here.
      const { entry, durable } = takeStashEntry(menuEntry.id);
      if (!entry) return;
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: translate("chat.stash.restoreMayReappearTitle"),
          description: translate("chat.stash.restoreMayReappearDescription"),
          data: { hideCopyButton: true },
        });
      }

      const currentPrompt = promptRef.current;
      // An image-only stash must not append blank lines to whatever is
      // already in the composer.
      const nextPrompt =
        entry.prompt.length === 0
          ? currentPrompt
          : currentPrompt.trim().length
            ? `${currentPrompt.replace(/\s+$/, "")}\n\n${entry.prompt}`
            : entry.prompt;
      const promptChanged = nextPrompt !== currentPrompt;
      if (promptChanged) {
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
        setComposerTrigger(null);
      }

      let unrestoredFileNames: string[] = [];
      const expiredFileNames: string[] = [];
      let restoredFileCount = 0;
      const stashedFiles = entry.files ?? [];
      if (stashedFiles.length > 0) {
        const fileDedupKey = (file: {
          readonly mimeType: string;
          readonly sizeBytes: number;
          readonly name: string;
        }) => `${file.mimeType}\u0000${file.sizeBytes}\u0000${file.name}`;
        const composerFilesNow = composerFilesRef.current;
        const existingFileIds = new Set(composerFilesNow.map((file) => file.id));
        const retainedUploadIds = new Set(
          composerFilesNow.flatMap((file) =>
            file.uploadedAttachmentId ? [file.uploadedAttachmentId] : [],
          ),
        );
        const existingFileKeys = new Set(composerFilesNow.map(fileDedupKey));
        const reattachMarkerKeys = new Set(
          composerFilesNow.filter(composerFileNeedsReattach).map(fileDedupKey),
        );
        const duplicateFiles: PersistedComposerFileAttachment[] = [];
        const markerReplacements: ComposerFileAttachment[] = [];
        const appendedFiles: ComposerFileAttachment[] = [];
        for (const file of stashedFiles) {
          const expired = expiredAttachmentIds.has(file.attachmentId);
          const key = fileDedupKey(file);
          const restored: ComposerFileAttachment = {
            type: "file",
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            file: null,
            // An expired upload carries no ids, so it hydrates as a
            // needs-reattach row and the "Attach again" flow takes over.
            ...(expired
              ? {}
              : { uploadedAttachmentId: file.attachmentId, uploadEnvironmentId: environmentId }),
          };
          if (existingFileIds.has(file.id)) {
            if (!expired && !retainedUploadIds.has(file.attachmentId)) {
              duplicateFiles.push(file);
            }
            continue;
          }
          if (existingFileKeys.has(key)) {
            if (reattachMarkerKeys.has(key)) {
              // The draft row with this identity is a needs-reattach marker,
              // not a real duplicate. Replace it (addFiles swaps a matching
              // marker in place) instead of deleting the only uploaded copy.
              reattachMarkerKeys.delete(key);
              existingFileIds.add(file.id);
              if (expired) {
                // The draft's marker already says "attach again"; nothing to
                // restore or release, but say why the stash copy is gone.
                expiredFileNames.push(file.name);
              } else {
                retainedUploadIds.add(file.attachmentId);
                markerReplacements.push(restored);
              }
              continue;
            }
            if (!expired && !retainedUploadIds.has(file.attachmentId)) {
              duplicateFiles.push(file);
            }
            continue;
          }
          existingFileIds.add(file.id);
          existingFileKeys.add(key);
          if (expired) {
            expiredFileNames.push(file.name);
          } else {
            retainedUploadIds.add(file.attachmentId);
          }
          appendedFiles.push(restored);
        }
        const capacity = Math.max(
          0,
          attachmentLimit - composerImagesRef.current.length - composerFilesNow.length,
        );
        // Marker replacements reuse their marker's slot; only appended files
        // consume capacity.
        const filesToAppend = appendedFiles.slice(0, capacity);
        const skippedFiles = appendedFiles.slice(capacity);
        unrestoredFileNames = skippedFiles.map((file) => file.name);
        // A non-durable take can resurrect the stash entry after a reload;
        // deleting these uploads would leave it pointing at nothing.
        if (durable) {
          for (const file of duplicateFiles) {
            releasePersistedAttachmentUpload({
              id: file.id,
              environmentId,
              attachmentId: file.attachmentId,
            });
          }
          for (const file of skippedFiles) {
            if (file.uploadedAttachmentId) {
              releasePersistedAttachmentUpload({
                id: file.id,
                environmentId,
                attachmentId: file.uploadedAttachmentId,
              });
            }
          }
        }
        const restoredFiles = [...markerReplacements, ...filesToAppend];
        if (restoredFiles.length > 0) {
          addComposerDraftFiles(composerDraftTarget, restoredFiles);
          restoredFileCount = filesToAppend.length;
        }
      }

      let unrestoredImageNames: string[] = [];
      if (entry.attachments.length > 0) {
        const existingIds = new Set(composerImagesRef.current.map((image) => image.id));
        // The draft store also dedupes by mimeType+sizeBytes+name, so filter
        // on the same key here. Counting a duplicate against capacity would
        // burn a slot the store then refuses to fill, pushing a genuinely
        // unique image into the overflow list for nothing.
        const existingDedupKeys = new Set(
          composerImagesRef.current.map(
            (image) => `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`,
          ),
        );
        const capacity = Math.max(
          0,
          attachmentLimit -
            composerImagesRef.current.length -
            composerFilesRef.current.length -
            restoredFileCount,
        );
        const pending = entry.attachments.filter(
          (attachment) =>
            !existingIds.has(attachment.id) &&
            !existingDedupKeys.has(
              `${attachment.mimeType}\u0000${attachment.sizeBytes}\u0000${attachment.name}`,
            ),
        );
        // Anything past the attachment limit cannot be restored. The entry is
        // already out of the queue, so report the overflow by name instead of
        // discarding it silently.
        unrestoredImageNames = pending.slice(capacity).map((attachment) => attachment.name);
        const restoredImages = hydrateImagesFromPersisted(pending.slice(0, capacity));
        if (restoredImages.length > 0) {
          addComposerDraftImages(composerDraftTarget, restoredImages);
        }
      }

      // Deliberately no model/provider restore: the stash exists to carry a
      // prompt across threads and providers, so whatever the composer has
      // selected right now stays selected.

      // Each cause gets its own sentence so "too large" is never blamed for a
      // file that actually failed to decode, or for one the composer simply
      // had no room to take back.
      const missingImageReasons: string[] = [];
      if (entry.droppedImageNames.length > 0) {
        missingImageReasons.push(
          translate("chat.stash.reasonTooLarge", {
            names: entry.droppedImageNames.join(", "),
          }),
        );
      }
      if (entry.unreadableImageNames && entry.unreadableImageNames.length > 0) {
        missingImageReasons.push(
          translate("chat.stash.reasonUnreadable", {
            names: entry.unreadableImageNames.join(", "),
          }),
        );
      }
      if (unrestoredImageNames.length > 0) {
        missingImageReasons.push(
          translate("chat.stash.reasonAttachmentLimit", {
            names: unrestoredImageNames.join(", "),
            count: attachmentLimit,
          }),
        );
      }
      if (unrestoredFileNames.length > 0) {
        missingImageReasons.push(
          translate("chat.stash.reasonAttachmentLimit", {
            names: unrestoredFileNames.join(", "),
            count: attachmentLimit,
          }),
        );
      }
      if (expiredFileNames.length > 0) {
        missingImageReasons.push(
          translate("chat.stash.reasonExpired", { names: expiredFileNames.join(", ") }),
        );
      }
      if (missingImageReasons.length > 0) {
        toastManager.add({
          type: "warning",
          title: translate("chat.stash.attachmentsNotRestored"),
          description: missingImageReasons.join(" "),
        });
      }

      // Only yank the caret to the end when text was actually inserted;
      // restoring images alone should leave the user where they were typing.
      if (promptChanged) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAtEnd();
        });
      }
    },
    [
      addComposerDraftFiles,
      addComposerDraftImages,
      attachmentLimit,
      composerDraftTarget,
      composerFilesRef,
      composerImagesRef,
      environmentId,
      promptRef,
      setComposerDraftPrompt,
      takeStashEntry,
      translate,
    ],
  );

  const deleteStashEntry = useCallback(
    (entry: PromptStashEntry) => {
      const { entry: removed, durable } = takeStashEntry(entry.id);
      if (!stashQueue.some((candidate) => candidate.id !== entry.id)) {
        setIsStashMenuOpen(false);
      }
      if (durable && removed) {
        for (const file of removed.files ?? []) {
          releasePersistedAttachmentUpload({
            id: file.id,
            environmentId: file.environmentId,
            attachmentId: file.attachmentId,
          });
        }
      }
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: translate("chat.stash.deleteMayReappearTitle"),
          description: translate("chat.stash.deleteMayReappearDescription"),
          data: { hideCopyButton: true },
        });
      }
    },
    [stashQueue, takeStashEntry, translate],
  );

  const stashCurrentPrompt = useCallback(async () => {
    // Terminal-context placeholders reference live sessions the stash can't
    // round-trip, so they are stripped from the stashed prompt.
    const prompt = promptRef.current.split(INLINE_TERMINAL_CONTEXT_PLACEHOLDER).join("").trim();
    const images = [...composerImagesRef.current];
    const files = [...composerFilesRef.current];
    if (prompt.length === 0 && images.length === 0 && files.length === 0) {
      setIsStashMenuOpen((open) => !open);
      return;
    }
    const stashedFiles: PersistedComposerFileAttachment[] = [];
    for (const file of files) {
      if (composerFileNeedsReattach(file)) {
        toastManager.add({
          type: "error",
          title: translate("chat.stash.attachDroppedFiles"),
        });
        return;
      }
      const upload = readAttachmentUpload(file.id);
      if (upload?.status !== "ready" || upload.environmentId !== environmentId) {
        toastManager.add({
          type: "error",
          title: translate("chat.stash.waitForUploads"),
        });
        return;
      }
      stashedFiles.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        attachmentId: upload.attachmentId,
        environmentId,
      });
    }
    // A repeat ⌘S on the *same* still-unencoded snapshot would stash it
    // twice. Guard on the snapshot itself rather than a bare boolean: once
    // the composer has been cleared the user can type something genuinely
    // new (or switch threads) while encoding continues, and that deserves its
    // own entry.
    const snapshotKey = `${String(composerDraftTarget)}\u0000${prompt}\u0000${images
      .map((image) => `image:${image.id}`)
      .concat(files.map((file) => `file:${file.id}`))
      .join(",")}`;
    if (stashInFlightRef.current.has(snapshotKey)) return;
    stashInFlightRef.current.add(snapshotKey);

    const stashTarget = composerDraftTarget;
    const entryId = randomUUID();
    try {
      // Persist the text-only entry *first*, then clear. Ordering matters in
      // both directions: writing before clearing means a crash or closed tab
      // mid-encode still leaves the prompt recoverable, while clearing before
      // the async image work means edits typed during encoding are not wiped.
      // Images are appended to the stored entry as they finish encoding.
      const { evicted, written, durable } = stashEntryToQueue({
        id: entryId,
        createdAt: new Date().toISOString(),
        prompt,
        attachments: [],
        ...(stashedFiles.length > 0 ? { files: stashedFiles } : {}),
        droppedImageNames: [],
        unreadableImageNames: [],
        pendingImageCount: images.length,
      });

      // Clearing the composer is only safe once the write actually landed.
      // If it was rejected (quota) the store has already rolled itself back,
      // so leave the composer untouched rather than making it the second
      // casualty of a reload.
      if (!written) {
        toastManager.add({
          type: "error",
          title: translate("chat.stash.failedTitle"),
          description: translate("chat.stash.failedDescription"),
          data: { hideCopyButton: true },
        });
        return;
      }
      // Written but only into the in-memory fallback (localStorage blocked):
      // the entry is visible and restorable this session, so proceed with the
      // clear, but say it won't survive a reload.
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: translate("chat.stash.memoryOnlyTitle"),
          description: translate("chat.stash.memoryOnlyDescription"),
          data: { hideCopyButton: true },
        });
      }

      // Terminal and preview context stays behind because the stash cannot restore it.
      promptRef.current = "";
      clearComposerDraftPromptAndImages(stashTarget);
      for (const image of images) {
        releaseAttachmentUpload(image.id);
      }
      setComposerCursor(0);
      setComposerTrigger(null);
      pulseStashBadge();

      if (evicted) {
        for (const file of evicted.files ?? []) {
          releasePersistedAttachmentUpload({
            id: file.id,
            environmentId: file.environmentId,
            attachmentId: file.attachmentId,
          });
        }
        toastManager.add({
          type: "warning",
          title: translate("chat.stash.oldestDiscardedTitle"),
          description: translate("chat.stash.oldestDiscardedDescription", {
            count: MAX_STASH_ENTRIES,
          }),
          data: { hideCopyButton: true },
        });
      }

      // Images are re-encoded for the stash rather than stored verbatim: the
      // composer allows up to 10MB per image, but localStorage gives the whole
      // origin ~5MB. Only the stashed copy shrinks; the live attachment (and
      // anything sent without stashing) keeps the original file.
      const candidateAttachments: PersistedComposerImageAttachment[] = [];
      const oversizedImageNames: string[] = [];
      const unreadableImageNames: string[] = [];
      for (const image of images) {
        const result = await compressImageForStash(image.file);
        if (!result.ok) {
          // "too large" and "could not be read" are distinct outcomes; the
          // menu and restore toast report them separately.
          (result.reason === "too-large" ? oversizedImageNames : unreadableImageNames).push(
            image.name,
          );
          continue;
        }
        candidateAttachments.push({
          id: image.id,
          name: image.name,
          mimeType: result.image.mimeType,
          sizeBytes: result.image.sizeBytes,
          dataUrl: result.image.dataUrl,
        });
      }
      const { kept, droppedNames } = partitionStashAttachments(candidateAttachments);

      const { attached, durable: imagesDurable } = finalizeStashEntryImages(entryId, {
        attachments: kept,
        droppedImageNames: [...oversizedImageNames, ...droppedNames],
        unreadableImageNames,
      });
      if (attached) {
        // The second phase can be rejected on its own: the text-only entry
        // fit, but adding image payloads pushed past the quota. Disk would
        // then still hold the phase-one entry with pendingImageCount set,
        // which reads as an orphan after reload — so say so now. Gated on the
        // entry write having been durable: on the in-memory fallback nothing
        // is ever durable, and the session-only warning already covered it.
        if (!imagesDurable && durable && images.length > 0) {
          toastManager.add({
            type: "warning",
            title: translate("chat.stash.imagesNotSavedTitle"),
            description: translate("chat.stash.imagesNotSavedDescription"),
            data: { hideCopyButton: true },
          });
        }
      } else if (kept.length > 0) {
        // The entry was restored or deleted before its images finished
        // encoding, so they have nowhere to land. Say so rather than letting
        // them evaporate.
        toastManager.add({
          type: "warning",
          title: translate("chat.stash.imagesDidNotAttachTitle"),
          description: translate("chat.stash.imagesDidNotAttachDescription", {
            count: kept.length,
          }),
          data: { hideCopyButton: true },
        });
      }
    } finally {
      // Must clear on every path: a throw that left this set would wedge this
      // snapshot's ⌘S until the composer remounts.
      stashInFlightRef.current.delete(snapshotKey);
    }
  }, [
    clearComposerDraftPromptAndImages,
    composerDraftTarget,
    composerFilesRef,
    composerImagesRef,
    environmentId,
    finalizeStashEntryImages,
    promptRef,
    pulseStashBadge,
    stashEntryToQueue,
    translate,
  ]);

  const toggleStashMenu = useCallback(() => {
    setIsStashMenuOpen((open) => !open);
  }, []);
  const toggleInlineStashMenu = useCallback(() => {
    if (isComposerCollapsedMobile) {
      expandMobileComposer();
      setIsStashMenuOpen(true);
      return;
    }
    toggleStashMenu();
  }, [expandMobileComposer, isComposerCollapsedMobile, toggleStashMenu]);
  const toggleTasksDrawer = useCallback(() => {
    setIsTasksDrawerOpen((open) => !open);
  }, []);
  const activityTokenUsage = useMemo(
    () =>
      resolveComposerActivityTokenUsage({
        activeWorkStartedAt,
        snapshot: activeContextWindow,
      }),
    [activeContextWindow, activeWorkStartedAt],
  );
  const activityStatus = useMemo<ComposerActivityStatus | undefined>(
    () =>
      props.threadSyncPhase
        ? { kind: "sync", phase: props.threadSyncPhase }
        : isWorking
          ? { kind: "working", startedAt: activeWorkStartedAt, ...activityTokenUsage }
          : undefined,
    [props.threadSyncPhase, isWorking, activeWorkStartedAt, activityTokenUsage],
  );
  const hasBannerItems = props.bannerItems.length > 0;
  const hasBlockingComposerTopDrawer =
    activePendingApproval !== null || pendingUserInputs.length > 0;
  const showInlineStashBadge =
    stashQueue.length > 0 &&
    !isComposerApprovalState &&
    (hasBannerItems || showComposerTopDrawer || isTasksDrawerOpen || isMobileViewport);
  const inlineStashBadge = showInlineStashBadge ? (
    <ComposerStashBadge
      count={stashQueue.length}
      menuOpen={isStashMenuOpen}
      placement="inline"
      pulseKey={stashPulse.key}
      pulsing={stashPulse.active}
      onToggleMenu={toggleInlineStashMenu}
    />
  ) : null;
  const showInlineTasksBadge =
    activeTasksProgress !== null &&
    activeTaskSteps !== null &&
    !isTasksDrawerOpen &&
    !hasBlockingComposerTopDrawer &&
    (hasBannerItems || showComposerTopDrawer || isComposerCollapsedMobile);
  const inlineTasksBadge = showInlineTasksBadge ? (
    <ComposerTasksBadge
      expanded={false}
      onToggle={toggleTasksDrawer}
      placement="inline"
      progress={activeTasksProgress}
      steps={activeTaskSteps}
      activityStatus={activityStatus}
    />
  ) : null;
  const showShoulderTabs =
    !hasBannerItems && !showComposerTopDrawer && !isTasksDrawerOpen && !isComposerCollapsedMobile;
  const hasShoulderTab =
    showShoulderTabs &&
    (activityStatus !== undefined ||
      (stashQueue.length > 0 && !showInlineStashBadge) ||
      (activeTasksProgress !== null &&
        activeTaskSteps !== null &&
        activeTasksProgress.totalSteps > 0));
  const tasksHostActivityStatus =
    activeTasksProgress !== null &&
    activeTasksProgress.totalSteps > 0 &&
    activeTaskSteps !== null &&
    !hasBlockingComposerTopDrawer &&
    (showShoulderTabs || showInlineTasksBadge || isTasksDrawerOpen);
  const standaloneActivityStatus = !tasksHostActivityStatus ? activityStatus : undefined;
  const activityStackContent = hasBannerItems ? (
    !hasBlockingComposerTopDrawer && activeTasksProgress && activeTaskSteps ? (
      <ComposerTasksContent
        expanded={isTasksDrawerOpen}
        onToggle={toggleTasksDrawer}
        progress={activeTasksProgress}
        steps={activeTaskSteps}
        activityStatus={activityStatus}
      />
    ) : activityStatus ? (
      <ComposerActivityRow status={activityStatus} />
    ) : null
  ) : null;
  const activityStackItem: ComposerBannerStackContent | null = activityStackContent
    ? {
        id: "composer-activity",
        variant: activityStatus ? composerActivityVariant(activityStatus) : "activity",
        priority: "activity",
        content: activityStackContent,
      }
    : null;
  const bannerStackItems = activityStackItem
    ? [...props.bannerItems, activityStackItem]
    : props.bannerItems;
  useEffect(() => {
    if (activeTasksProgress === null || activeTaskSteps === null) {
      setIsTasksDrawerOpen(false);
    }
  }, [activeTaskSteps, activeTasksProgress]);

  useEffect(() => {
    if (hasBlockingComposerTopDrawer) {
      setIsTasksDrawerOpen(false);
    }
  }, [hasBlockingComposerTopDrawer]);

  useEffect(() => {
    setIsTasksDrawerOpen(false);
  }, [activeThreadId]);

  // Close the stash menu whenever the trigger-driven command menu opens so
  // the two popovers never stack in the same layer, and when the user
  // resumes typing (the menu is a transient picker, not a panel).
  useEffect(() => {
    if (composerMenuOpen) {
      setIsStashMenuOpen(false);
    }
  }, [composerMenuOpen]);
  useEffect(() => {
    setIsStashMenuOpen(false);
  }, [prompt]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: getTerminalFocusOwner() !== null,
          terminalOpen,
          modelPickerOpen: isComposerModelPickerOpen,
        },
      });
      if (command !== "composer.stash") return;
      // Always claim the shortcut so the browser save dialog never opens,
      // even when the composer is in a state that can't stash.
      event.preventDefault();
      event.stopPropagation();
      if (isCommandPaletteOpen()) {
        return;
      }
      if (pendingUserInputs.length > 0 && !isComposerApprovalState) {
        setIsStashMenuOpen((open) => !open);
        return;
      }
      if (isComposerApprovalState || projectSelectionRequired || activePendingProgress !== null) {
        return;
      }
      void stashCurrentPrompt();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activePendingProgress,
    isComposerApprovalState,
    isComposerModelPickerOpen,
    keybindings,
    pendingUserInputs.length,
    projectSelectionRequired,
    stashCurrentPrompt,
    terminalOpen,
  ]);

  // ------------------------------------------------------------------
  // Callbacks: attachments
  // ------------------------------------------------------------------
  const addComposerAttachments = async (files: File[]) => {
    if (!activeThreadId || files.length === 0) return;
    if (pendingUserInputs.length > 0) {
      toastManager.add({
        type: "error",
        title: translate("chat.composer.attachAfterPlanQuestions"),
      });
      return;
    }
    // Captured before the awaits below: the user may switch threads while a
    // large image is being compressed, and the attachments and errors belong
    // to the thread the paste happened in.
    const threadId = activeThreadId;

    // Validation happens synchronously so concurrent pastes see each other:
    // accepted files reserve their attachment slots (via the pending counter)
    // before the first await, keeping the total under the limit.
    const pendingCount = pendingImageCompressionsRef.current.get(threadId) ?? 0;
    let reservedCount =
      composerImagesRef.current.length + composerFilesRef.current.length + pendingCount;
    // A pick that matches a needs-reattach marker replaces it in the draft, so
    // it must not consume a slot; a draft full of markers would otherwise hit
    // the capacity error before the replacement path could run.
    const reattachKeys = new Set(
      composerFilesRef.current
        .filter(composerFileNeedsReattach)
        .map((file) => `${file.mimeType}\u0000${file.sizeBytes}\u0000${file.name}`),
    );
    const acceptedImages: File[] = [];
    const acceptedFiles: ComposerFileAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      const attachmentKind = classifyComposerAttachmentFile(file);
      const replacesReattachMarker =
        attachmentKind === "file" &&
        reattachKeys.delete(
          `${file.type || "application/octet-stream"}\u0000${file.size}\u0000${file.name || "file"}`,
        );
      if (!replacesReattachMarker && reservedCount >= attachmentLimit) {
        error = `You can attach up to ${attachmentLimit} files per message.`;
        // Keep scanning: a later file in this batch can still replace a
        // needs-reattach marker without needing a free slot.
        continue;
      }
      if (attachmentKind === "unsupported-image") {
        error = `'${file.name}' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.`;
        continue;
      }
      if (attachmentKind === "image") {
        acceptedImages.push(normalizeComposerImageFileMimeType(file));
      } else {
        if (fileStagingLimit === null) {
          error = "This server does not support file attachments.";
          continue;
        }
        if (file.size <= 0) {
          error = `'${file.name}' is empty or could not be read.`;
          continue;
        }
        if (file.size > fileStagingLimit) {
          error = fileAttachmentTooLargeMessage(file.name, fileStagingLimit);
          continue;
        }
        acceptedFiles.push({
          type: "file",
          id: randomUUID(),
          name: file.name || "file",
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          file,
        });
      }
      if (!replacesReattachMarker) {
        reservedCount += 1;
      }
    }
    setThreadError(threadId, error);
    if (acceptedFiles.length > 0) {
      addComposerFilesToDraft(acceptedFiles);
    }
    if (acceptedImages.length === 0) return;

    pendingImageCompressionsRef.current.set(threadId, pendingCount + acceptedImages.length);
    try {
      const nextImages: ComposerImageAttachment[] = [];
      let compressionError: string | null = null;
      for (const file of acceptedImages) {
        // Images over the wire cap are downscaled to fit rather than
        // refused; files already within it pass through byte-for-byte.
        const compressed = await prepareImageForAttachment(
          file,
          PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
        );
        if (!compressed.ok) {
          compressionError =
            compressed.reason === "unreadable"
              ? `'${file.name}' could not be read as an image.`
              : `'${file.name}' is too large to attach, even after compression.`;
          continue;
        }
        const attachmentFile = compressed.file;
        const previewUrl = URL.createObjectURL(attachmentFile);
        nextImages.push({
          type: "image",
          id: randomUUID(),
          name: attachmentFile.name || "image",
          mimeType: attachmentFile.type,
          sizeBytes: attachmentFile.size,
          previewUrl,
          file: attachmentFile,
        });
      }
      if (nextImages.length === 1 && nextImages[0]) {
        addComposerImage(nextImages[0]);
      } else if (nextImages.length > 1) {
        addComposerImagesToDraft(nextImages);
      }
      // Only failures are reported here. Success must not pass `null`: by
      // now other work (a failed send, an overlapping paste) may have set a
      // thread error this call knows nothing about, and clearing it would
      // swallow that message.
      if (compressionError !== null) {
        setThreadError(threadId, compressionError);
      }
    } finally {
      const remaining =
        (pendingImageCompressionsRef.current.get(threadId) ?? 0) - acceptedImages.length;
      if (remaining > 0) {
        pendingImageCompressionsRef.current.set(threadId, remaining);
      } else {
        pendingImageCompressionsRef.current.delete(threadId);
      }
    }
  };

  const removeComposerImage = (imageId: string) => {
    removeComposerImageFromDraft(imageId);
  };

  // ------------------------------------------------------------------
  // Callbacks: paste / drag
  // ------------------------------------------------------------------
  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    // Claimable pastes go through even when plan questions are pending or the
    // composer is at its attachment limit: `addComposerAttachments` surfaces
    // those as a toast and a thread error. An early return here would swallow
    // the paste with no feedback.
    if (
      files.length === 0 ||
      !activeThreadId ||
      !shouldHandleComposerAttachmentPaste({
        files,
        plainText: event.clipboardData.getData("text/plain"),
      })
    ) {
      return;
    }
    event.preventDefault();
    void addComposerAttachments(files);
  };

  const insertComposerTextAtEnd = (
    text: string,
    options?: { ensureLeadingBoundary?: boolean },
  ): boolean => {
    if (
      text.length === 0 ||
      isConnecting ||
      isComposerApprovalState ||
      pendingUserInputs.length > 0 ||
      projectSelectionRequired
    ) {
      return false;
    }
    const prompt = promptRef.current;
    const needsLeadingSpace =
      (options?.ensureLeadingBoundary ?? false) && prompt.length > 0 && !/\s$/.test(prompt);
    return applyPromptReplacement(
      prompt.length,
      prompt.length,
      needsLeadingSpace ? ` ${text}` : text,
    );
  };

  // File-tree drags land as mentions. Handled in the capture phase so the
  // editor never sees the drop; the load-bearing rules (native stop, "move"
  // effect, no eager focus) live in makeComposerMentionDragHandlers.
  const composerMentionDragHandlers = makeComposerMentionDragHandlers({
    insertMentionAtEnd: (text) => insertComposerTextAtEnd(text, { ensureLeadingBoundary: true }),
    setDragActive: setIsDragOverComposer,
    onInsertRejected: () => {
      toastManager.add({
        type: "error",
        title: translate("chat.composer.addToChatFailed"),
        description: translate("chat.composer.addToChatBusy"),
      });
    },
  });

  const onComposerMentionDragLeaveCapture = (event: React.DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasComposerMention(event.dataTransfer.types)) return;
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragOverComposer(false);
  };

  // A cancelled drag (Escape) can end without a dragleave on the hovered
  // target, which would leave the drop highlight stuck. dragend always fires
  // on the in-page drag source and bubbles to window, so it is the reset of
  // last resort while the highlight is up.
  useEffect(() => {
    if (!isDragOverComposer) return;
    const onWindowDragEnd = () => {
      setIsDragOverComposer(false);
    };
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, [isDragOverComposer]);
  const handleInterruptPrimaryAction = useCallback(() => {
    void onInterrupt();
  }, [onInterrupt]);
  const handleImplementPlanPrimaryAction = useCallback(
    (strategy: PlanImplementationStrategy) => {
      void onImplementPlan(strategy);
    },
    [onImplementPlan],
  );
  const handleImplementPlanInNewThreadPrimaryAction = useCallback(
    (strategy: PlanImplementationStrategy) => {
      void onImplementPlanInNewThread(strategy);
    },
    [onImplementPlanInNewThread],
  );
  const scheduleComposerCollapseCheck = useCallback(() => {
    if (!isMobileViewport) {
      return;
    }
    if (mobileComposerExpandInFlightRef.current) {
      return;
    }
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
    }
    composerBlurFrameRef.current = window.requestAnimationFrame(() => {
      composerBlurFrameRef.current = null;
      if (mobileComposerExpandInFlightRef.current) {
        return;
      }
      const composerSurface = composerSurfaceRef.current;
      const composerForm = composerFormRef.current;
      const activeElement = document.activeElement;
      if (activeElement instanceof Element && isInsideComposerFloatingLayer(activeElement)) {
        return;
      }
      if (
        activeElement instanceof Node &&
        ((composerSurface && composerSurface.contains(activeElement)) ||
          (composerForm && composerForm.contains(activeElement)))
      ) {
        return;
      }
      setIsComposerFocused(false);
    });
  }, [isMobileViewport]);

  useEffect(() => {
    return () => {
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
      }
      if (mobileComposerExpandFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
      }
      if (mobileComposerExpandReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Imperative handle
  // ------------------------------------------------------------------
  useImperativeHandle(
    composerRef,
    () => ({
      focusAtEnd: () => {
        composerEditorRef.current?.focusAtEnd();
      },
      focusAt: (cursor: number) => {
        composerEditorRef.current?.focusAt(cursor);
      },
      addDroppedFiles: (files: File[]) => {
        void addComposerAttachments(files);
        focusComposer();
      },
      insertTextAtEnd: insertComposerTextAtEnd,
      openModelPicker: () => {
        setIsComposerModelPickerOpen(true);
      },
      toggleModelPicker: () => {
        setIsComposerModelPickerOpen((open) => !open);
      },
      compactContext: compactThreadContext,
      isModelPickerOpen: () => isComposerModelPickerOpen,
      isVoiceRecordingActive: () => voiceRecordingActive,
      dismissTransientUi: () => {
        setIsComposerModelPickerOpen(false);
        setIsStashMenuOpen(false);
        setComposerHighlightedItemId(null);
        setComposerTrigger(null);
      },
      readSnapshot: () => {
        return readComposerSnapshot();
      },
      resetCursorState: (options?: {
        cursor?: number;
        prompt?: string;
        detectTrigger?: boolean;
      }) => {
        const promptForState = options?.prompt ?? promptRef.current;
        const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
        setComposerHighlightedItemId(null);
        setComposerCursor(cursor);
        setComposerTrigger(
          options?.detectTrigger
            ? detectComposerTrigger(
                promptForState,
                expandCollapsedComposerCursor(promptForState, cursor),
              )
            : null,
        );
      },
      addTerminalContext: (selection: TerminalContextSelection) => {
        if (!activeThread) return;
        const snapshot = composerEditorRef.current?.readSnapshot() ?? {
          value: promptRef.current,
          cursor: composerCursor,
          expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
          terminalContextIds: composerTerminalContexts.map((context) => context.id),
        };
        const insertion = insertInlineTerminalContextPlaceholder(
          snapshot.value,
          snapshot.expandedCursor,
        );
        const nextCollapsedCursor = collapseExpandedComposerCursor(
          insertion.prompt,
          insertion.cursor,
        );
        const inserted = insertComposerDraftTerminalContext(
          composerDraftTarget,
          insertion.prompt,
          {
            id: randomUUID(),
            threadId: activeThread.id,
            createdAt: new Date().toISOString(),
            ...selection,
          },
          insertion.contextIndex,
        );
        if (!inserted) return;
        promptRef.current = insertion.prompt;
        setComposerCursor(nextCollapsedCursor);
        setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCollapsedCursor);
        });
      },
      getSendContext: () => ({
        prompt: promptRef.current,
        images: composerImagesRef.current,
        files: composerFilesRef.current,
        terminalContexts: composerTerminalContextsRef.current,
        elementContexts: composerElementContextsRef.current,
        previewAnnotations: composerPreviewAnnotations,
        reviewComments: composerReviewComments,
        selectedPromptEffort,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        providerAvailable: !noProviderAvailable,
        selectedProvider,
        selectedModel,
        selectedProviderModels,
        planImplementationSuggestion,
      }),
      validateProviderInput: (providerInput: string) => {
        const validationMessage = getComposerSubmissionValidationMessage({
          prompt: promptRef.current,
          providerInput,
          ...(providerInputLimit !== undefined ? { maxInputChars: providerInputLimit } : {}),
          submissionTarget: "provider-turn",
        });
        providerInputRejectedRef.current = validationMessage !== null;
        setProviderInputSubmissionError(validationMessage);
        return validationMessage === null;
      },
    }),
    [
      activeThread,
      addComposerAttachments,
      composerDraftTarget,
      composerCursor,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      promptRef,
      composerImagesRef,
      composerFilesRef,
      composerTerminalContextsRef,
      composerElementContextsRef,
      composerPreviewAnnotations,
      composerReviewComments,
      focusComposer,
      isConnecting,
      isComposerApprovalState,
      pendingUserInputs.length,
      projectSelectionRequired,
      applyPromptReplacement,
      isComposerModelPickerOpen,
      voiceRecordingActive,
      readComposerSnapshot,
      selectedModel,
      selectedModelOptionsForDispatch,
      selectedModelSelection,
      noProviderAvailable,
      selectedPromptEffort,
      selectedProvider,
      selectedProviderModels,
      planImplementationSuggestion,
      providerInputLimit,
      compactThreadContext,
    ],
  );

  // Render
  // ------------------------------------------------------------------
  return (
    <form
      ref={composerFormRef}
      onSubmit={submitComposer}
      onFocusCapture={(event) => {
        const activeElement = event.target;
        if (
          isComposerCollapsedMobile &&
          activeElement instanceof HTMLElement &&
          activeElement.closest('[data-chat-composer-collapsed-controls="true"]')
        ) {
          return;
        }
        if (composerBlurFrameRef.current !== null) {
          window.cancelAnimationFrame(composerBlurFrameRef.current);
          composerBlurFrameRef.current = null;
        }
        setIsComposerFocused(true);
      }}
      onBlurCapture={() => {
        scheduleComposerCollapseCheck();
      }}
      onDragEnterCapture={composerMentionDragHandlers.onDragEnter}
      onDragOverCapture={composerMentionDragHandlers.onDragOver}
      onDragLeaveCapture={onComposerMentionDragLeaveCapture}
      onDropCapture={composerMentionDragHandlers.onDrop}
      className="mx-auto w-full min-w-0 max-w-3xl"
      data-chat-composer-form="true"
    >
      <ComposerFloatingBubblePortal host={props.floatingBubbleHost}>
        <ComposerBannerStack
          key={activeThreadId}
          className="relative z-0"
          items={bannerStackItems}
          placement="floating"
        />
        {!activityStackItem &&
        (inlineTasksBadge || (standaloneActivityStatus && !showShoulderTabs)) ? (
          <ComposerBanner.Attachment>
            {inlineTasksBadge ??
              (standaloneActivityStatus ? (
                <ComposerActivityBanner status={standaloneActivityStatus} />
              ) : null)}
          </ComposerBanner.Attachment>
        ) : null}
        {showComposerTopDrawer && (!isTasksDrawerOpen || hasBlockingComposerTopDrawer) ? (
          <ComposerBanner.Attachment>
            <ComposerBanner.Root
              data-chat-composer-top-drawer="true"
              variant={activePendingApproval ? "warning" : "info"}
            >
              {activePendingApproval ? (
                <ComposerBanner.Row
                  layout="wrap-actions"
                  data-chat-composer-collapsed-controls="true"
                >
                  <ComposerBanner.Icon />
                  <ComposerBanner.Content>
                    <ComposerPendingApprovalPanel
                      approval={activePendingApproval}
                      pendingCount={pendingApprovals.length}
                    />
                  </ComposerBanner.Content>
                  <ComposerBanner.Actions>
                    <ComposerPendingApprovalActions
                      requestId={activePendingApproval.requestId}
                      isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                      options={activePendingApproval.options}
                      onRespondToApproval={onRespondToApproval}
                    />
                  </ComposerBanner.Actions>
                </ComposerBanner.Row>
              ) : !isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  respondingRequestIds={respondingRequestIds}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={onSelectActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                />
              ) : !isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan ? (
                <ComposerPlanFollowUpBanner
                  key={activeProposedPlan.id}
                  planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                />
              ) : isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
                <div data-chat-composer-collapsed-controls="true">
                  <ComposerPendingUserInputPanel
                    pendingUserInputs={pendingUserInputs}
                    respondingRequestIds={respondingRequestIds}
                    answers={activePendingDraftAnswers}
                    questionIndex={activePendingQuestionIndex}
                    onToggleOption={onSelectActivePendingUserInputOption}
                    onAdvance={onAdvanceActivePendingUserInput}
                  />
                  <ComposerBanner.Body>
                    <div
                      data-chat-composer-mobile-pending-compact="true"
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background/55 p-1.5 pl-3 transition-colors hover:bg-background/80",
                        !activePendingProgress?.activeQuestion?.multiSelect && "p-0",
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          "min-w-0 flex-1 truncate bg-transparent py-1.5 text-left text-sm",
                          activePendingProgress?.customAnswer
                            ? "text-foreground"
                            : "text-placeholder",
                          !activePendingProgress?.activeQuestion?.multiSelect && "px-3 py-2",
                        )}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={expandMobileComposer}
                        aria-label={translate("chat.composer.customAnswer")}
                      >
                        {activePendingProgress?.customAnswer ||
                          translate("chat.composer.customAnswer")}
                      </button>
                      {inlineTasksBadge}
                      {inlineStashBadge}
                      {activePendingProgress?.activeQuestion?.multiSelect ? (
                        <ComposerPrimaryActions
                          compact
                          pendingAction={pendingPrimaryAction}
                          isRunning={false}
                          showPlanFollowUpPrompt={false}
                          promptHasText={false}
                          isSendBusy={isSendBusy}
                          sendDisabledReason={sendDisabledReason}
                          isConnecting={isConnecting}
                          isEnvironmentUnavailable={
                            environmentUnavailable !== null ||
                            noProviderAvailable ||
                            projectSelectionRequired
                          }
                          isPreparingWorktree={false}
                          hasSendableContent={false}
                          preserveComposerFocusOnPointerDown
                          onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                          onInterrupt={handleInterruptPrimaryAction}
                          onImplementPlan={handleImplementPlanPrimaryAction}
                          onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                        />
                      ) : null}
                    </div>
                  </ComposerBanner.Body>
                </div>
              ) : null}
            </ComposerBanner.Root>
          </ComposerBanner.Attachment>
        ) : null}
        {!activityStackItem &&
        isTasksDrawerOpen &&
        !hasBlockingComposerTopDrawer &&
        activeTasksProgress &&
        activeTaskSteps ? (
          <ComposerTasksDrawer
            onCollapse={toggleTasksDrawer}
            progress={activeTasksProgress}
            steps={activeTaskSteps}
            activityStatus={activityStatus}
          />
        ) : null}
        {hasShoulderTab ? (
          <ComposerBanner.Dock>
            {standaloneActivityStatus ? (
              <ComposerActivityBanner status={standaloneActivityStatus} />
            ) : null}
            {activeTasksProgress && activeTaskSteps ? (
              <ComposerTasksBadge
                expanded={false}
                onToggle={toggleTasksDrawer}
                progress={activeTasksProgress}
                steps={activeTaskSteps}
                activityStatus={activityStatus}
              />
            ) : null}
            {!showInlineStashBadge ? (
              <ComposerStashBadge
                count={stashQueue.length}
                menuOpen={isStashMenuOpen}
                pulseKey={stashPulse.key}
                pulsing={stashPulse.active}
                onToggleMenu={toggleStashMenu}
              />
            ) : null}
          </ComposerBanner.Dock>
        ) : null}
      </ComposerFloatingBubblePortal>
      <div className="relative">
        <ComposerSurface.Main className={composerProviderState.composerFrameClassName}>
          <div
            ref={composerSurfaceRef}
            data-chat-composer-surface="true"
            data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
            className={cn(
              "rounded-[20px] transition-[background-color] duration-200",
              isDragOverComposer ? "bg-accent/45 ring-1 ring-primary/70" : null,
              projectSelectionRequired ? "opacity-75" : null,
              composerProviderState.composerSurfaceClassName,
            )}
          >
            {showCollapsedMobilePromptRow ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate bg-transparent p-0 text-left text-[14px] focus:outline-none",
                    (activePendingProgress ? activePendingProgress.customAnswer : prompt.trim())
                      ? "text-foreground"
                      : "text-placeholder",
                  )}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={expandMobileComposer}
                  aria-label={translate("chat.composer.expand")}
                >
                  {activePendingProgress
                    ? activePendingProgress.customAnswer ||
                      translate("chat.composer.customAnswerPlaceholder")
                    : prompt.trim() ||
                      (noProviderAvailable
                        ? translate("chat.composer.enableProvider")
                        : translate("chat.composer.askAnything"))}
                </button>
                {inlineStashBadge}
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover disabled:opacity-30"
                  disabled={collapsedComposerPrimaryActionDisabled || voiceRecordingActive}
                  aria-label={collapsedComposerPrimaryActionLabel}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    submitComposer();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 3L8 13M8 3L4 7M8 3L12 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}

            <div
              ref={setComposerMenuAnchor}
              data-composer-surface-morph-trigger="command"
              className={cn(
                "relative px-3 pb-2 sm:px-4",
                "pt-3.5 sm:pt-4",
                isComposerApprovalState && "pb-3 sm:pb-4",
                isComposerCollapsedMobile && "hidden",
              )}
            >
              {isStashMenuOpen && !composerMenuOpen && !isComposerApprovalState && (
                <ComposerCommandMenuLayer
                  anchor={composerMenuAnchor}
                  coordinator={surfaceMorphCoordinator}
                  originKey="stash"
                  scopeKey={props.surfaceMorphScopeKey}
                >
                  <ComposerStashMenu
                    entries={stashQueue}
                    stashShortcutLabel={shortcutLabelForCommand(keybindings, "composer.stash", {
                      context: {
                        terminalFocus: false,
                        terminalOpen,
                        modelPickerOpen: false,
                      },
                    })}
                    onRestore={restoreStashEntry}
                    onDelete={deleteStashEntry}
                    onClose={() => setIsStashMenuOpen(false)}
                  />
                </ComposerCommandMenuLayer>
              )}

              {composerMenuOpen && !isComposerApprovalState && (
                <ComposerCommandMenuLayer
                  anchor={composerMenuAnchor}
                  coordinator={surfaceMorphCoordinator}
                  originKey="command"
                  scopeKey={props.surfaceMorphScopeKey}
                >
                  <ComposerCommandMenu
                    items={composerMenuItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={isComposerMenuLoading}
                    triggerKind={composerTriggerKind}
                    emptyStateText={composerMenuEmptyState}
                    activeItemId={activeComposerMenuItem?.id ?? null}
                    onHighlightedItemChange={onComposerMenuItemHighlighted}
                    onSelect={onSelectComposerItem}
                  />
                </ComposerCommandMenuLayer>
              )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerPreviewAnnotations.length > 0 && (
                  <ComposerPreviewAnnotationCards
                    annotations={composerPreviewAnnotations}
                    images={composerImages}
                    {...(supportsAttachmentUploads
                      ? {
                          uploadsByImageId,
                          onRetryUpload: (image: ComposerImageAttachment) =>
                            retryAttachmentUpload({
                              environmentId,
                              image,
                              draftTarget: composerDraftTarget,
                            }),
                        }
                      : {})}
                    onRemove={(annotationId) => {
                      releaseAttachmentUpload(annotationId);
                      removeComposerDraftPreviewAnnotation(composerDraftTarget, annotationId);
                    }}
                    onExpandImage={(imageId) => {
                      const preview = buildExpandedImagePreview(composerImages, imageId);
                      if (preview) onExpandImage(preview);
                    }}
                    className="mb-3"
                  />
                )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerReviewComments.length > 0 && (
                  <ComposerPendingReviewComments
                    comments={composerReviewComments}
                    onRemove={(commentId) =>
                      removeComposerDraftReviewComment(composerDraftTarget, commentId)
                    }
                    className="mb-3"
                  />
                )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerElementContexts.length > 0 && (
                  <ComposerPendingElementContexts
                    contexts={composerElementContexts}
                    onRemove={(contextId) =>
                      removeComposerDraftElementContext(composerDraftTarget, contextId)
                    }
                    className="mb-3"
                  />
                )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerImages.some(
                  (image) =>
                    !composerPreviewAnnotations.some((annotation) => annotation.id === image.id),
                ) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {composerImages
                      .filter(
                        (image) =>
                          !composerPreviewAnnotations.some(
                            (annotation) => annotation.id === image.id,
                          ),
                      )
                      .map((image) => {
                        const upload = supportsAttachmentUploads
                          ? uploadsByImageId[image.id]
                          : undefined;
                        return (
                          <div
                            key={image.id}
                            className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/80 bg-background"
                          >
                            {image.previewUrl ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                aria-label={translate("chat.timeline.previewImage", {
                                  name: image.name,
                                })}
                                onClick={() => {
                                  const preview = buildExpandedImagePreview(
                                    composerImages,
                                    image.id,
                                  );
                                  if (!preview) return;
                                  onExpandImage(preview);
                                }}
                              >
                                <img
                                  src={image.previewUrl}
                                  alt={image.name}
                                  className="h-full w-full object-cover"
                                />
                              </button>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-secondary-label">
                                {image.name}
                              </div>
                            )}
                            {nonPersistedComposerImageIdSet.has(image.id) && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span
                                      role="img"
                                      aria-label={translate("chat.composer.draftAttachmentWarning")}
                                      className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                    >
                                      <CircleAlertIcon className="size-3" />
                                    </span>
                                  }
                                />
                                <TooltipPopup
                                  side="top"
                                  className="max-w-64 whitespace-normal leading-tight"
                                >
                                  {translate("chat.composer.draftAttachmentWarningDetail")}
                                </TooltipPopup>
                              </Tooltip>
                            )}
                            {upload?.status === "uploading" && (
                              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-1 text-center text-[10px] text-foreground">
                                {formatAttachmentUploadProgress(upload.progress)}
                              </span>
                            )}
                            {upload?.status === "failed" && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      className="absolute bottom-1 left-1 bg-background/85 hover:bg-background/95"
                                      onClick={() =>
                                        retryAttachmentUpload({
                                          environmentId,
                                          image,
                                          draftTarget: composerDraftTarget,
                                        })
                                      }
                                      aria-label={`Retry upload for ${image.name}`}
                                    />
                                  }
                                >
                                  <RotateCcwIcon />
                                </TooltipTrigger>
                                <TooltipPopup
                                  side="top"
                                  className="max-w-64 whitespace-normal leading-tight"
                                >
                                  {upload.reason}
                                </TooltipPopup>
                              </Tooltip>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                              onClick={() => removeComposerImage(image.id)}
                              aria-label={`Remove ${image.name}`}
                            >
                              <XIcon />
                            </Button>
                          </div>
                        );
                      })}
                  </div>
                )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                pendingUserInputs.length === 0 &&
                composerFiles.length > 0 && (
                  <div className="mb-3 flex flex-col gap-1">
                    {composerFiles.map((file) => {
                      const fileCanUpload =
                        supportsAttachmentUploads &&
                        maxFileAttachmentBytes !== null &&
                        file.sizeBytes <= maxFileAttachmentBytes;
                      const upload = fileCanUpload ? uploadsByImageId[file.id] : undefined;
                      const needsReattach = composerFileNeedsReattach(file);
                      const canReattachFile =
                        fileStagingLimit !== null && file.sizeBytes <= fileStagingLimit;
                      return (
                        <div
                          key={file.id}
                          className="flex min-w-0 items-center gap-2 py-1 text-sm text-foreground"
                        >
                          <FileIcon className="size-4 shrink-0 text-secondary-label" />
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                          <span className="shrink-0 text-xs text-secondary-label">
                            {needsReattach
                              ? canReattachFile
                                ? "Attach again"
                                : "Remove to send"
                              : upload?.status === "uploading"
                                ? formatAttachmentUploadProgress(upload.progress)
                                : formatAttachmentSize(file.sizeBytes)}
                          </span>
                          {!needsReattach && upload?.status === "failed" ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() =>
                                      retryAttachmentUpload({
                                        environmentId,
                                        image: file,
                                        draftTarget: composerDraftTarget,
                                      })
                                    }
                                    aria-label={`Retry upload for ${file.name}`}
                                  />
                                }
                              >
                                <RotateCcwIcon />
                              </TooltipTrigger>
                              <TooltipPopup
                                side="top"
                                className="max-w-64 whitespace-normal leading-tight"
                              >
                                {upload.reason}
                              </TooltipPopup>
                            </Tooltip>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeComposerFileFromDraft(file.id)}
                            aria-label={`Remove ${file.name}`}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

              <div className="relative">
                <ComposerPromptEditor
                  editorRef={composerEditorRef}
                  value={
                    isComposerApprovalState
                      ? ""
                      : activePendingProgress
                        ? activePendingProgress.customAnswer
                        : prompt
                  }
                  cursor={composerCursor}
                  terminalContexts={
                    !isComposerApprovalState && pendingUserInputs.length === 0
                      ? composerTerminalContexts
                      : []
                  }
                  skills={selectedProviderStatus?.skills ?? []}
                  {...(showMobilePendingAnswerActions ? { className: "max-sm:pb-11" } : {})}
                  onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                  onChange={onPromptChange}
                  onCommandKeyDown={onComposerCommandKey}
                  onPaste={onComposerPaste}
                  placeholder={
                    isComposerApprovalState
                      ? (activePendingApproval?.detail ??
                        "Resolve this approval request to continue")
                      : activePendingProgress
                        ? "Type your own answer, or leave this blank to use the selected option"
                        : showPlanFollowUpPrompt && activeProposedPlan
                          ? "Add feedback to refine the plan, or leave this blank to implement it"
                          : projectSelectionRequired
                            ? "Choose a project above to start a thread"
                            : noProviderAvailable
                              ? "Enable a provider in Settings to send a message"
                              : environmentUnavailable
                                ? `${environmentUnavailable.label}: ${connectionStatusTitle(
                                    environmentUnavailable.connection,
                                  )}`
                                : phase === "disconnected"
                                  ? DISCONNECTED_COMPOSER_PLACEHOLDER
                                  : "Ask anything, @tag files/folders, $use skills, or / for commands"
                  }
                  disabled={
                    isConnecting ||
                    voiceRecordingActive ||
                    isComposerApprovalState ||
                    projectSelectionRequired ||
                    (environmentUnavailable !== null && activePendingProgress === null)
                  }
                />
                {showMobilePendingAnswerActions ? (
                  <div
                    data-chat-composer-mobile-pending-actions="true"
                    className="absolute bottom-0 right-0 flex items-center justify-end gap-1"
                  >
                    {inlineStashBadge}
                    <ComposerPrimaryActions
                      compact
                      pendingAction={pendingPrimaryAction}
                      isRunning={false}
                      showPlanFollowUpPrompt={false}
                      promptHasText={false}
                      isSendBusy={isSendBusy}
                      sendDisabledReason={sendDisabledReason}
                      isConnecting={isConnecting}
                      isEnvironmentUnavailable={
                        environmentUnavailable !== null ||
                        noProviderAvailable ||
                        projectSelectionRequired
                      }
                      isPreparingWorktree={false}
                      hasSendableContent={false}
                      preserveComposerFocusOnPointerDown
                      onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                      onInterrupt={handleInterruptPrimaryAction}
                      onImplementPlan={handleImplementPlanPrimaryAction}
                      onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <ComposerPromptLengthValidation
              message={providerInputSubmissionError ?? composerSubmissionError}
            />
            <ForkHandoffBudgetNotice budget={firstTurnForkBudget} />

            {/* Bottom toolbar */}
            {isComposerCollapsedMobile || isComposerApprovalState ? null : (
              <div
                data-chat-composer-footer="true"
                data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
                className={cn(
                  "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-3 pb-3 sm:px-4 sm:pb-4",
                  pendingUserInputs.length > 0 && "pt-2",
                  resolveComposerFooterGapClassName({
                    compact: isComposerFooterCompact,
                    voiceRecordingActive,
                  }),
                  showMobilePendingAnswerActions && "hidden sm:flex",
                )}
              >
                <div className="-m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-3.5 [scrollbar-color:color-mix(in_srgb,var(--contrast-border)_78%,transparent)_transparent] [&>*]:shrink-0 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--contrast-border)_78%,transparent)] [&::-webkit-scrollbar-track]:bg-transparent">
                  {noProviderAvailable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled
                      data-chat-provider-unavailable="true"
                      className="shrink-0 gap-2 px-2 text-secondary-label sm:px-3"
                    >
                      <CircleAlertIcon className="size-4" />
                      {translate("chat.composer.noProviderAvailable")}
                    </Button>
                  ) : (
                    <ProviderModelPicker
                      compact={isComposerFooterCompact}
                      activeInstanceId={selectedInstanceId}
                      preferredInstanceId={preferredModelPickerInstanceId}
                      model={selectedModelForPickerWithCustomFallback}
                      lockedProvider={lockedProvider}
                      lockedContinuationGroupKey={lockedContinuationGroupKey}
                      instanceEntries={providerInstanceEntries}
                      keybindings={keybindings}
                      modelOptionsByInstance={modelOptionsByInstance}
                      triggerClassName="-ms-2.5"
                      terminalOpen={terminalOpen}
                      open={isComposerModelPickerOpen}
                      {...(composerProviderState.modelPickerIconClassName
                        ? {
                            activeProviderIconClassName:
                              composerProviderState.modelPickerIconClassName,
                          }
                        : {})}
                      onOpenChange={(open) => {
                        setIsComposerModelPickerOpen(open);
                      }}
                      getModelDisabledReason={getModelDisabledReason}
                      onInstanceSelect={setStickyActiveProvider}
                      onInstanceModelChange={onProviderModelSelect}
                    />
                  )}

                  {!isComposerFooterCompact &&
                  (providerContextWindowPicker || providerTraitsPicker) ? (
                    <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
                  ) : null}

                  {isComposerFooterCompact ? (
                    <CompactComposerControlsMenu
                      interactionMode={interactionMode}
                      runtimeMode={runtimeMode}
                      showInteractionModeSelect={planModeUiEnabled}
                      traitsMenuContent={providerTraitsMenuContent}
                      contextWindowMenuContent={providerContextWindowMenuContent}
                      onInteractionModeChange={handleInteractionModeChange}
                      onRuntimeModeChange={handleRuntimeModeChange}
                    />
                  ) : (
                    <>
                      {providerTraitsPicker}
                      {providerTraitsPicker && providerContextWindowPicker ? (
                        <Separator
                          orientation="vertical"
                          className="mx-0.5 hidden h-4 sm:block"
                          data-chat-composer-traits-context-separator="true"
                        />
                      ) : null}
                      {providerContextWindowPicker}
                      <ComposerFooterModeControls
                        showInteractionModeSelect={planModeUiEnabled}
                        interactionMode={interactionMode}
                        runtimeMode={runtimeMode}
                        onInteractionModeChange={handleInteractionModeChange}
                        onRuntimeModeChange={handleRuntimeModeChange}
                      />
                    </>
                  )}
                </div>

                {/* Right side: send / stop button */}
                <div
                  data-chat-composer-actions="right"
                  data-chat-composer-primary-actions-compact={
                    isComposerPrimaryActionsCompact ? "true" : "false"
                  }
                  className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                >
                  {fileStagingLimit !== null && pendingUserInputs.length === 0 ? (
                    <>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files ?? []);
                          event.currentTarget.value = "";
                          void addComposerAttachments(files);
                          focusComposer();
                        }}
                      />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onPointerDown={(event) => event.preventDefault()}
                              onClick={() => attachmentInputRef.current?.click()}
                              aria-label={translate("chat.composer.attachFiles")}
                            />
                          }
                        >
                          <PaperclipIcon />
                        </TooltipTrigger>
                        <TooltipPopup>{translate("chat.composer.attachFiles")}</TooltipPopup>
                      </Tooltip>
                    </>
                  ) : null}
                  {showMobilePendingAnswerActions ? null : inlineStashBadge}
                  {voiceInputConfigured || voiceRecordingActive ? (
                    <VoiceDictationControl
                      state={voiceRecordingState}
                      audioWaveform={voiceDictation.audioWaveform}
                      disabled={
                        isConnecting ||
                        isSendBusy ||
                        isSendDisabled ||
                        isAbortPending ||
                        noProviderAvailable ||
                        projectSelectionRequired ||
                        phase === "running" ||
                        isComposerApprovalState ||
                        environmentUnavailable !== null ||
                        pendingUserInputs.length > 0
                      }
                      onStart={startVoiceRecording}
                      onStop={stopVoiceRecording}
                    />
                  ) : null}
                  <ComposerFooterPrimaryActions
                    compact={isComposerPrimaryActionsCompact}
                    activeContextWindow={activeContextWindow}
                    activeThreadModelDisplayName={activeThreadModelDisplayName}
                    pendingAction={pendingPrimaryAction}
                    isRunning={abortPresentation.showStopAction}
                    abortPhase={abortPresentation.phase}
                    showPlanFollowUpPrompt={
                      pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                    }
                    promptHasText={prompt.trim().length > 0}
                    isSendBusy={isSendBusy || voiceRecordingActive}
                    sendDisabledReason={sendDisabledReason}
                    isConnecting={isConnecting}
                    isEnvironmentUnavailable={
                      environmentUnavailable !== null ||
                      noProviderAvailable ||
                      projectSelectionRequired
                    }
                    isPreparingWorktree={isPreparingWorktree}
                    hasSendableContent={composerSendState.hasSendableContent}
                    preserveComposerFocusOnPointerDown={isMobileViewport}
                    showSendWhileRunning={isMobileViewport}
                    onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                    onInterrupt={handleInterruptPrimaryAction}
                    planImplementationSuggestion={planImplementationSuggestion}
                    planParallelismReviewStatus={planParallelismReview.status}
                    onImplementPlan={handleImplementPlanPrimaryAction}
                    onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                    compactDisabled={
                      compactDisabled || noProviderAvailable || isSendBusy || isConnecting
                    }
                    compactDisabledReason={resolvedCompactDisabledReason}
                    {...(manualCompactAction ? { onCompactContext: manualCompactAction } : {})}
                  />
                </div>
              </div>
            )}
          </div>
        </ComposerSurface.Main>
      </div>
    </form>
  );
});
