import { cn } from "~/lib/utils";

import type { SubagentStatusPresentation } from "./subagentPresentation";

const TONE_CLASS_NAMES: Record<SubagentStatusPresentation["tone"], string> = {
  progress: "bg-info shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-info)_12%,transparent)]",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/55",
};

export function SubagentStatusDot({
  presentation,
  className,
}: {
  readonly presentation: SubagentStatusPresentation;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        TONE_CLASS_NAMES[presentation.tone],
        presentation.tone === "progress" && "animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}
