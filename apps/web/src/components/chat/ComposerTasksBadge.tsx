import { CheckIcon, CircleDotIcon, CircleIcon, ListTodoIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { formatDuration } from "../../session-logic";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

export interface ComposerTasksProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ComposerTaskStep {
  readonly durationMs?: number;
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

const TASK_STEP_PRESENTATION = {
  completed: {
    icon: CheckIcon,
    iconClassName: "bg-success/10 text-success",
    label: "Completed",
    rowClassName: "text-muted-foreground",
  },
  inProgress: {
    icon: CircleDotIcon,
    iconClassName: "bg-info/10 text-info",
    label: "In progress",
    rowClassName: "bg-info/10 text-foreground ring-1 ring-inset ring-info/20",
  },
  pending: {
    icon: CircleIcon,
    iconClassName: "bg-muted/60 text-muted-foreground/50",
    label: "Pending",
    rowClassName: "text-muted-foreground/65",
  },
} as const satisfies Record<
  ComposerTaskStep["status"],
  {
    readonly icon: typeof CheckIcon;
    readonly iconClassName: string;
    readonly label: string;
    readonly rowClassName: string;
  }
>;

function keyedTaskSteps(steps: readonly ComposerTaskStep[]) {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = occurrences.get(step.step) ?? 0;
    occurrences.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

function TaskSegments({
  className,
  steps,
}: {
  readonly className?: string;
  readonly steps: readonly ComposerTaskStep[];
}) {
  if (steps.length <= 1) return null;

  return (
    <span aria-hidden className={cn("flex w-10 shrink-0 items-center gap-0.5", className)}>
      {keyedTaskSteps(steps).map(({ key, step }) => (
        <span
          key={key}
          className={cn(
            "h-[3px] min-w-0 flex-1 rounded-full",
            step.status === "completed"
              ? "bg-success"
              : step.status === "inProgress"
                ? "bg-info"
                : "bg-muted-foreground/25",
          )}
        />
      ))}
    </span>
  );
}

function ComposerTaskListItem({ step }: { readonly step: ComposerTaskStep }) {
  const presentation = TASK_STEP_PRESENTATION[step.status];
  const StatusIcon = presentation.icon;
  const timing =
    step.durationMs !== undefined
      ? formatDuration(step.durationMs)
      : step.status === "inProgress"
        ? "Now"
        : null;

  return (
    <li
      className={cn(
        "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg px-2.5 py-2 text-xs leading-5",
        presentation.rowClassName,
      )}
      data-composer-task-status={step.status}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md",
          presentation.iconClassName,
        )}
      >
        <StatusIcon className="size-3" />
      </span>
      <span className="min-w-0 break-words">
        <span className="sr-only">{presentation.label}: </span>
        {step.step}
      </span>
      {timing !== null ? (
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] leading-4 tabular-nums",
            step.status === "inProgress"
              ? "bg-info/10 font-medium text-info-foreground"
              : "bg-muted/60 text-muted-foreground",
          )}
          data-composer-task-duration="true"
        >
          {timing}
        </span>
      ) : null}
    </li>
  );
}

export const ComposerTasksBadge = memo(function ComposerTasksBadge({
  expanded,
  hasTrailingShoulder = false,
  onDismiss,
  onToggle,
  placement = "tab",
  progress,
  steps,
}: {
  readonly expanded: boolean;
  readonly hasTrailingShoulder?: boolean;
  readonly onDismiss: () => void;
  readonly onToggle: () => void;
  readonly placement?: "floating" | "inline" | "tab";
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  if (progress.totalSteps <= 0) return null;

  const allDone = progress.completedSteps >= progress.totalSteps;
  const label = `Tasks: ${progress.completedSteps} of ${progress.totalSteps} complete. Current task: ${progress.step}`;
  if (placement === "inline") {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5" data-composer-tasks-badge="true">
        <Button
          size="micro"
          variant="ghost-muted"
          aria-expanded={expanded}
          aria-label={label}
          className="shrink-0 gap-1 px-1.5"
          onClick={onToggle}
          onPointerDown={(event) => event.preventDefault()}
        >
          <ListTodoIcon aria-hidden className="size-3 shrink-0 text-info" />
          <span className="font-medium text-info-foreground">Tasks</span>
          <TaskSegments steps={steps} />
          <span
            className={cn(
              "font-medium tabular-nums",
              allDone ? "text-success" : "text-muted-foreground",
            )}
          >
            {progress.completedSteps}/{progress.totalSteps}
          </span>
        </Button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Dismiss tasks for this turn"
          className="shrink-0"
          onClick={onDismiss}
          onPointerDown={(event) => event.preventDefault()}
        >
          <XIcon aria-hidden className="size-2.5" />
        </Button>
      </span>
    );
  }

  const floating = placement === "floating";
  return (
    <div
      className={cn(
        floating
          ? "chat-composer-top-drawer chat-composer-top-drawer-floating flex min-h-10 min-w-0 items-center gap-2 px-3 py-2 text-xs leading-none text-muted-foreground sm:px-5"
          : "chat-composer-shoulder-tab chat-composer-tasks-tab absolute -top-7 left-4 z-0 flex h-8 items-center gap-1 rounded-t-xl border border-b-0 px-3 pb-1 text-xs leading-none text-muted-foreground",
        !floating && (hasTrailingShoulder ? "right-28" : "right-4"),
        allDone && "text-foreground",
      )}
      data-composer-tasks-badge="true"
      data-variant="info"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={label}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-muted-foreground hover:text-foreground"
        onClick={onToggle}
        onPointerDown={(event) => event.preventDefault()}
      >
        <ListTodoIcon aria-hidden className="size-3.5 shrink-0 text-info" />
        <span className="shrink-0 font-medium text-info-foreground">Tasks</span>
        <span
          className="min-w-0 flex-1 truncate text-left font-medium text-foreground/80"
          data-composer-task-current="true"
        >
          {progress.step}
        </span>
        <span
          className={cn(
            "shrink-0 font-medium tabular-nums",
            allDone ? "text-success" : "text-muted-foreground",
          )}
        >
          {progress.completedSteps}/{progress.totalSteps}
        </span>
        <TaskSegments className="w-10 sm:w-20" steps={steps} />
      </button>
      <Button
        size="icon-micro"
        variant="ghost-muted"
        aria-label="Dismiss tasks for this turn"
        className="shrink-0"
        onClick={onDismiss}
        onPointerDown={(event) => event.preventDefault()}
      >
        <XIcon aria-hidden className="size-3" />
      </Button>
    </div>
  );
});

export const ComposerTasksDrawer = memo(function ComposerTasksDrawer({
  onDismiss,
  onCollapse,
  progress,
  steps,
}: {
  readonly onDismiss: () => void;
  readonly onCollapse: () => void;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
}) {
  return (
    <div
      className="chat-composer-top-drawer chat-composer-top-drawer-floating"
      data-chat-composer-tasks-drawer="true"
      data-variant="info"
    >
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 sm:px-5">
        <button
          type="button"
          aria-expanded="true"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch text-left text-muted-foreground hover:text-foreground"
          onClick={onCollapse}
          onPointerDown={(event) => event.preventDefault()}
        >
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-info/10 text-info"
          >
            <ListTodoIcon className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-info-foreground">Tasks</span>
            <span className="block text-[10px] leading-4 text-muted-foreground tabular-nums">
              {progress.completedSteps} of {progress.totalSteps} complete
            </span>
          </span>
        </button>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label="Dismiss tasks for this turn"
          className="shrink-0"
          onClick={onDismiss}
          onPointerDown={(event) => event.preventDefault()}
        >
          <XIcon aria-hidden className="size-3" />
        </Button>
      </div>
      <div
        aria-label={`Tasks: ${progress.completedSteps} of ${progress.totalSteps} complete`}
        aria-valuemax={progress.totalSteps}
        aria-valuemin={0}
        aria-valuenow={Math.min(progress.completedSteps, progress.totalSteps)}
        className="px-4 pb-2.5 sm:px-5"
        role="progressbar"
      >
        <TaskSegments className="w-full gap-1" steps={steps} />
      </div>
      <ol
        aria-label="Task progress steps"
        className="mx-4 mb-4 max-h-[min(20rem,45vh)] space-y-1 overflow-y-auto overscroll-contain sm:mx-5"
      >
        {keyedTaskSteps(steps).map(({ key, step }) => (
          <ComposerTaskListItem key={key} step={step} />
        ))}
      </ol>
    </div>
  );
});
