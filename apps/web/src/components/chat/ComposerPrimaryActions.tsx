import { Fragment, memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import type {
  PlanImplementationStrategy,
  PlanImplementationSuggestion,
} from "../../planImplementation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

export type ComposerAbortPhase = "interrupting" | "force-stopping";

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  abortPhase?: ComposerAbortPhase | null;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  planImplementationSuggestion?: PlanImplementationSuggestion | null;
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

export function buildPlanImplementationActionPresentation(input: {
  readonly compact: boolean;
  readonly suggestion: PlanImplementationSuggestion | null;
}): PlanImplementationActionPresentation {
  const suggestion = input.suggestion;
  if (!suggestion) {
    return {
      primaryLabel: "Implement",
      primaryAriaLabel: null,
      menuActions: [
        {
          id: "standard:new-thread",
          label: "Implement in a new thread",
          target: "new-thread",
          strategy: STANDARD_IMPLEMENTATION_STRATEGY,
          suggested: false,
        },
      ],
    };
  }

  const suggestedCount = suggestion.strategy.count;
  const fullPrimaryLabel = `Implement with ${suggestedCount} subagents`;
  return {
    primaryLabel: input.compact ? `${suggestedCount} subagents` : fullPrimaryLabel,
    primaryAriaLabel: fullPrimaryLabel,
    menuActions: [
      {
        id: "standard:same-thread",
        label: "Implement normally",
        target: "same-thread",
        strategy: STANDARD_IMPLEMENTATION_STRATEGY,
        suggested: false,
      },
      {
        id: "standard:new-thread",
        label: "Implement normally in a new thread",
        target: "new-thread",
        strategy: STANDARD_IMPLEMENTATION_STRATEGY,
        suggested: false,
      },
      {
        id: `subagents:${suggestedCount}:new-thread`,
        label: `Implement with ${suggestedCount} subagents in a new thread`,
        target: "new-thread",
        strategy: suggestion.strategy,
        suggested: true,
      },
      ...suggestion.supportedCounts.map(
        (count): PlanImplementationMenuAction => ({
          id: `subagents:${count}:same-thread`,
          label: `Implement with ${count} subagents`,
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
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

export const formatStopGenerationLabel = (abortPhase: ComposerAbortPhase | null) => {
  if (abortPhase === "force-stopping") {
    return "Force stopping generation";
  }
  if (abortPhase === "interrupting") {
    return "Stopping generation";
  }
  return "Stop generation";
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
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  preserveComposerFocusOnPointerDown = false,
  onPreviousPendingQuestion,
  onInterrupt,
  planImplementationSuggestion = null,
  onImplementPlan,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
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
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "px-3" : "px-4")}
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
          })}
        </Button>
      </div>
    );
  }

  if (isRunning) {
    const abortPending = abortPhase !== null;
    return (
      <button
        type="button"
        className="flex size-8 enabled:cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 enabled:hover:bg-destructive enabled:hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:cursor-wait disabled:opacity-80 disabled:hover:scale-100 sm:h-8 sm:w-8"
        {...pointerFocusProps}
        onClick={onInterrupt}
        disabled={abortPending}
        aria-busy={abortPending || undefined}
        aria-label={formatStopGenerationLabel(abortPhase)}
      >
        {abortPending ? (
          <Spinner className="size-3.5" aria-hidden="true" />
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
          </svg>
        )}
      </button>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn("rounded-full", compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8")}
          {...pointerFocusProps}
          disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
        </Button>
      );
    }

    const implementationActions = buildPlanImplementationActionPresentation({
      compact,
      suggestion: planImplementationSuggestion,
    });
    const hasSubagentSuggestion = planImplementationSuggestion !== null;
    const actionsDisabled = isSendBusy || isConnecting || isEnvironmentUnavailable;

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-9 rounded-l-full rounded-r-none px-4 sm:h-8"
          {...pointerFocusProps}
          disabled={actionsDisabled}
          aria-label={implementationActions.primaryAriaLabel ?? undefined}
        >
          {isConnecting || isSendBusy ? "Sending..." : implementationActions.primaryLabel}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
                aria-label="Implementation actions"
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
                    <span className="ms-auto text-xs text-muted-foreground">Suggested</span>
                  ) : null}
                </MenuItem>
              </Fragment>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  return (
    <button
      type="submit"
      className="flex h-9 w-9 enabled:cursor-pointer items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-xs enabled:shadow-primary/24 enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 hover:bg-primary hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8"
      {...pointerFocusProps}
      disabled={isSendBusy || isConnecting || isEnvironmentUnavailable || !hasSendableContent}
      aria-label={
        isEnvironmentUnavailable
          ? "Environment disconnected"
          : isConnecting
            ? "Connecting"
            : isPreparingWorktree
              ? "Preparing worktree"
              : isSendBusy
                ? "Sending"
                : "Send message"
      }
    >
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
});
