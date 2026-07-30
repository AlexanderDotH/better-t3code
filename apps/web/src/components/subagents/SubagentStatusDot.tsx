import { cn } from "~/lib/utils";

import type { SubagentStatusPresentation } from "./subagentPresentation";

export type SubagentIndicatorTone = "working" | "success" | "failure" | "stale" | "archived";

const DOT_TONE_CLASS_NAMES: Record<SubagentIndicatorTone, string> = {
  working:
    "bg-teal-500 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-teal-500)_14%,transparent)] dark:bg-teal-400",
  success: "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-success)_12%,transparent)]",
  failure:
    "bg-destructive shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-destructive)_12%,transparent)]",
  stale: "bg-muted-foreground/50 shadow-none",
  archived: "bg-muted-foreground/40 shadow-none",
};

const ICON_TONE_CLASS_NAMES: Record<SubagentIndicatorTone, string> = {
  working: "text-teal-600 dark:text-teal-300/90",
  success: "text-success",
  failure: "text-destructive",
  stale: "text-muted-foreground/60",
  archived: "text-muted-foreground/50",
};

export function subagentIndicatorToneFromPresentation(
  presentation: SubagentStatusPresentation,
): SubagentIndicatorTone {
  switch (presentation.tone) {
    case "progress":
      return "working";
    case "success":
      return "success";
    case "danger":
      return "failure";
    case "warning":
      return "failure";
    case "neutral":
      return "stale";
  }
}

export function subagentIndicatorIconClassName(tone: SubagentIndicatorTone): string {
  return ICON_TONE_CLASS_NAMES[tone];
}

export function SubagentStatusDot({
  presentation,
  tone = subagentIndicatorToneFromPresentation(presentation),
  className,
}: {
  readonly presentation: SubagentStatusPresentation;
  readonly tone?: SubagentIndicatorTone;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-subagent-tone-target={tone}
      className={cn(
        "size-2 shrink-0 rounded-full transition-[background-color,box-shadow] duration-300 ease-out",
        DOT_TONE_CLASS_NAMES[tone],
        tone === "working" && "animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}
