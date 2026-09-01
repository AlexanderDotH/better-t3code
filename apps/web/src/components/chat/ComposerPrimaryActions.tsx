import { Fragment, memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import type { OrchestrationTurnAbortPhase } from "@t3tools/contracts";
import {
  createInterfaceTranslator,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import type {
  PlanImplementationStrategy,
  PlanImplementationSuggestion,
  PlanParallelismReviewStatus,
} from "../../planImplementation";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { StageBackdropButtonArt, useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  abortPhase?: OrchestrationTurnAbortPhase | null;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  /** Enter-to-send is disabled on mobile viewports, where stop would otherwise
   * be the only primary action and a running turn could not be steered. */
  showSendWhileRunning?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  planImplementationSuggestion?: PlanImplementationSuggestion | null;
  planParallelismReviewStatus?: PlanParallelismReviewStatus;
  onImplementPlan: (strategy: PlanImplementationStrategy) => void;
  onImplementPlanInNewThread: (strategy: PlanImplementationStrategy) => void;
}

interface PlanImplementationMenuAction {
  readonly id: string;
  readonly label: string;
  readonly target: "same-thread" | "new-thread";
  readonly strategy: PlanImplementationStrategy;
  readonly suggested: boolean;
}

interface PlanImplementationActionPresentation {
  readonly primaryLabel: string;
  readonly primaryAriaLabel: string | null;
  readonly menuActions: ReadonlyArray<PlanImplementationMenuAction>;
}

const STANDARD_IMPLEMENTATION_STRATEGY = { kind: "standard" } as const;
const englishTranslate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;
type Translate = InterfaceTranslator["message"];

interface PlanImplementationReviewPresentation {
  readonly actionsDisabled: boolean;
  readonly primaryLabel: string | null;
  readonly tooltip: string | null;
}

export function resolvePlanImplementationReviewPresentation(
  status: PlanParallelismReviewStatus,
  translate: Translate = englishTranslate,
): PlanImplementationReviewPresentation {
  if (status === "reviewing") {
    return {
      actionsDisabled: true,
      primaryLabel: translate("chat.composer.analyzingPlan"),
      tooltip: null,
    };
  }
  if (status === "fallback") {
    return {
      actionsDisabled: false,
      primaryLabel: null,
      tooltip: translate("chat.composer.planReviewFallback"),
    };
  }
  return {
    actionsDisabled: false,
    primaryLabel: null,
    tooltip: null,
  };
}

export function buildPlanImplementationActionPresentation(input: {
  readonly compact: boolean;
  readonly suggestion: PlanImplementationSuggestion | null;
  readonly translate?: Translate;
}): PlanImplementationActionPresentation {
  const translate = input.translate ?? englishTranslate;
  const suggestion = input.suggestion;
  if (!suggestion) {
    return {
      primaryLabel: translate("chat.composer.implement"),
      primaryAriaLabel: null,
      menuActions: [
        {
          id: "standard:new-thread",
          label: translate("chat.composer.implementNewThread"),
          target: "new-thread",
          strategy: STANDARD_IMPLEMENTATION_STRATEGY,
          suggested: false,
        },
      ],
    };
  }

  const suggestedCount = suggestion.strategy.count;
  const fullPrimaryLabel = translate("chat.composer.implementWithSubagents", {
    count: suggestedCount,
  });
  return {
    primaryLabel: input.compact
      ? translate("chat.composer.subagentCount", { count: suggestedCount })
      : fullPrimaryLabel,
    primaryAriaLabel: fullPrimaryLabel,
    menuActions: [
      {
        id: "standard:same-thread",
        label: translate("chat.composer.implementNormally"),
        target: "same-thread",
        strategy: STANDARD_IMPLEMENTATION_STRATEGY,
        suggested: false,
      },
      {
        id: "standard:new-thread",
        label: translate("chat.composer.implementNormallyNewThread"),
        target: "new-thread",
        strategy: STANDARD_IMPLEMENTATION_STRATEGY,
        suggested: false,
      },
      {
        id: `subagents:${suggestedCount}:new-thread`,
        label: translate("chat.composer.implementWithSubagentsNewThread", {
          count: suggestedCount,
        }),
        target: "new-thread",
        strategy: suggestion.strategy,
        suggested: true,
      },
      ...suggestion.supportedCounts.map(
        (count): PlanImplementationMenuAction => ({
          id: `subagents:${count}:same-thread`,
          label: translate("chat.composer.implementWithSubagents", { count }),
          target: "same-thread",
          strategy: { kind: "subagents", count },
          suggested: count === suggestedCount,
        }),
      ),
    ],
  };
}

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
  translate?: Translate;
}) => {
  const translate = input.translate ?? englishTranslate;
  if (input.isResponding) {
    return translate("chat.composer.submitting");
  }
  if (input.compact) {
    return input.isLastQuestion
      ? translate("chat.composer.submit")
      : translate("chat.composer.next");
  }
  if (!input.isLastQuestion) {
    return translate("chat.composer.nextQuestion");
  }
  return input.questionIndex > 0
    ? translate("chat.composer.submitAnswers")
    : translate("chat.composer.submitAnswer");
};

export const formatStopGenerationLabel = (
  abortPhase: OrchestrationTurnAbortPhase | null,
  translate: Translate = englishTranslate,
) => {
  if (abortPhase === "force-stopping") {
    return translate("chat.composer.forceStoppingGeneration");
  }
  if (abortPhase === "interrupting") {
    return translate("chat.composer.forceStopGeneration");
  }
  return translate("chat.composer.stopGeneration");
};

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  abortPhase = null,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  sendDisabledReason,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  preserveComposerFocusOnPointerDown = false,
  showSendWhileRunning = false,
  onPreviousPendingQuestion,
  onInterrupt,
  planImplementationSuggestion = null,
  planParallelismReviewStatus = "idle",
  onImplementPlan,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const translate = useInterfaceTranslator().message;
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const isSendDisabled = sendDisabledReason !== null;
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );

  const renderStopGenerationButton = (insidePendingAction: boolean) => {
    const forceStopPending = abortPhase === "force-stopping";
    return (
      <button
        type="button"
        className={cn(
          "flex enabled:cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 enabled:hover:bg-destructive enabled:hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:cursor-wait disabled:opacity-80 disabled:hover:scale-100",
          insidePendingAction
            ? "size-8 sm:size-7"
            : showSendWhileRunning && hasSendableContent
              ? "size-9 sm:size-8"
              : "size-8 sm:h-8 sm:w-8",
        )}
        {...pointerFocusProps}
        onClick={onInterrupt}
        disabled={forceStopPending}
        aria-busy={forceStopPending || undefined}
        aria-label={formatStopGenerationLabel(abortPhase, translate)}
      >
        {forceStopPending ? (
          <Spinner className="size-3.5" aria-hidden="true" />
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
          </svg>
        )}
      </button>
    );
  };

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {isRunning ? renderStopGenerationButton(true) : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label={translate("chat.composer.previousQuestion")}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              {translate("chat.composer.previous")}
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          className={cn(
            "rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover",
            compact ? "px-3" : "px-4",
          )}
          {...pointerFocusProps}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
            translate,
          })}
        </Button>
      </div>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn(
            "rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover",
            compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8",
          )}
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy
            ? translate("chat.composer.sendingProgress")
            : translate("chat.composer.refine")}
        </Button>
      );
    }

    const implementationActions = buildPlanImplementationActionPresentation({
      compact,
      suggestion: planImplementationSuggestion,
      translate,
    });
    const reviewPresentation = resolvePlanImplementationReviewPresentation(
      planParallelismReviewStatus,
      translate,
    );
    const hasSubagentSuggestion = planImplementationSuggestion !== null;
    const actionsDisabled =
      isSendBusy ||
      isSendDisabled ||
      isConnecting ||
      isEnvironmentUnavailable ||
      reviewPresentation.actionsDisabled;
    const primaryLabel =
      isConnecting || isSendBusy
        ? translate("chat.composer.sendingProgress")
        : (reviewPresentation.primaryLabel ?? implementationActions.primaryLabel);
    const primaryButton = (
      <Button
        type="submit"
        size="sm"
        className="h-9 rounded-l-full rounded-r-none bg-message-action px-4 text-message-action-foreground hover:bg-message-action-hover sm:h-8"
        {...pointerFocusProps}
        disabled={actionsDisabled}
        aria-busy={planParallelismReviewStatus === "reviewing" || undefined}
        aria-label={
          reviewPresentation.primaryLabel ?? implementationActions.primaryAriaLabel ?? undefined
        }
      >
        {planParallelismReviewStatus === "reviewing" ? (
          <Spinner className="size-3.5" aria-hidden="true" />
        ) : null}
        {primaryLabel}
      </Button>
    );

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        {reviewPresentation.tooltip ? (
          <Tooltip>
            <TooltipTrigger render={primaryButton} />
            <TooltipPopup side="top">{reviewPresentation.tooltip}</TooltipPopup>
          </Tooltip>
        ) : (
          primaryButton
        )}
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-message-action-foreground/20 bg-message-action px-2 text-message-action-foreground hover:bg-message-action-hover sm:h-8"
                aria-label={translate("chat.composer.implementationActions")}
                {...pointerFocusProps}
                disabled={actionsDisabled}
              />
            }
          >
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top">
            {implementationActions.menuActions.map((action, index) => (
              <Fragment key={action.id}>
                {hasSubagentSuggestion && index === 3 ? <MenuSeparator /> : null}
                <MenuItem
                  disabled={actionsDisabled}
                  onClick={() => {
                    if (action.target === "new-thread") {
                      void onImplementPlanInNewThread(action.strategy);
                      return;
                    }
                    void onImplementPlan(action.strategy);
                  }}
                >
                  <span>{action.label}</span>
                  {action.suggested ? (
                    <span className="ms-auto text-xs text-muted-foreground">
                      {translate("chat.composer.suggested")}
                    </span>
                  ) : null}
                </MenuItem>
              </Fragment>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  const sendButton = (
    <button
      type="submit"
      className={cn(
        "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8",
        stageBackdropVariant
          ? "bg-transparent text-white enabled:shadow-black/24 enabled:hover:brightness-110"
          : "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover",
      )}
      {...pointerFocusProps}
      disabled={
        isSendBusy ||
        isSendDisabled ||
        isConnecting ||
        isEnvironmentUnavailable ||
        !hasSendableContent
      }
      aria-label={
        isEnvironmentUnavailable
          ? translate("chat.composer.environmentDisconnected")
          : sendDisabledReason
            ? sendDisabledReason
            : isConnecting
              ? translate("chat.composer.connecting")
              : isPreparingWorktree
                ? translate("chat.composer.preparingWorktreeLabel")
                : isSendBusy
                  ? translate("chat.composer.sending")
                  : translate("chat.composer.sendMessage")
      }
    >
      {stageBackdropVariant ? (
        <span className="absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt variant={stageBackdropVariant} />
        </span>
      ) : null}
      {isConnecting || isSendBusy ? (
        <Spinner className="size-3.5" aria-hidden="true" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );

  if (!isRunning) {
    return sendButton;
  }

  return (
    <>
      {renderStopGenerationButton(false)}
      {showSendWhileRunning && hasSendableContent ? sendButton : null}
    </>
  );
});
