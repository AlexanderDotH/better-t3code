import { cn } from "~/lib/utils";

import type { SubagentStatusPresentation } from "./subagentPresentation";

export type SubagentIndicatorTone = "working" | "success" | "failure" | "stale" | "archived";

const DOT_TONE_CLASS_NAMES: Record<SubagentIndicatorTone, string> = {
  working:
    "bg-sky-500 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-sky-500)_14%,transparent)] dark:bg-sky-300/80",
  success: "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-success)_12%,transparent)]",
  failure:
    "bg-destructive shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-destructive)_12%,transparent)]",
  stale: "bg-muted-foreground/50 shadow-none",
  archived: "bg-muted-foreground/40 shadow-none",
};

const ICON_TONE_CLASS_NAMES: Record<SubagentIndicatorTone, string> = {
  working: "text-sky-600 dark:text-sky-300/80",
  success: "text-success",
  failure: "text-destructive",
  stale: "text-muted-foreground/60",
  archived: "text-muted-foreground/50",
};

export function subagentIndicatorToneFromPresentation(
  presentation: SubagentStatusPresentation,
): SubagentIndicatorTone {
  if (presentation.tone === "progress") {
    return "working";
  }
  if (presentation.tone === "success") {
    return "success";
  }
  if (presentation.tone === "danger" || presentation.tone === "warning") {
    return "failure";
  }
  return "stale";
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
