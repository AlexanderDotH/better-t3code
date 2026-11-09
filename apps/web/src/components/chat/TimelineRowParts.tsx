import { use, type ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { observeResize } from "~/lib/observeResize";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import {
  formatChatTimestampTooltip,
  formatDayAwareTimestamp,
  formatShortTimestamp,
} from "../../timestampFormat";
import { TimelineRowCtx } from "./timelineRowContext";

export const MESSAGE_HEADING_LEVEL = 3;

export function MessageAuthorHeading({ children }: { children: string }) {
  return <h3 className="sr-only select-none">{children}</h3>;
}

/** Classic timestamps drop the day; the tooltip still carries the full date. */
export function formatTimelineTimestamp(
  createdAt: string,
  timestampFormat: TimestampFormat,
  chatVisualMode: string | undefined,
) {
  return (chatVisualMode === "classic" ? formatShortTimestamp : formatDayAwareTimestamp)(
    createdAt,
    timestampFormat,
  );
}

// The pill animates its width, so it publishes the measured label width to CSS.
function measurePillLabel(label: HTMLSpanElement | null) {
  const timestamp = label?.parentElement;
  if (!label || !timestamp) return;
  const measure = () =>
    timestamp.style.setProperty("--chat-timestamp-width", `${label.offsetWidth}px`);
  measure();
  return observeResize(label, measure);
}

/** Reveals the timestamp on hover or focus without adding a tab stop.
 * A Better T3 pill reveals by width, so it opens and closes smoothly.
 */
export function TimelineRowTimestamp({
  createdAt,
  timestampFormat,
  className,
  alwaysVisible = false,
  pill = false,
}: {
  createdAt: string;
  timestampFormat: TimestampFormat;
  className?: string;
  alwaysVisible?: boolean;
  pill?: boolean;
}) {
  const chatVisualMode = use(TimelineRowCtx)?.chatVisualMode;
  const revealWidth = pill && chatVisualMode === "better-t3" && !alwaysVisible;
  const label = pill
    ? formatDayAwareTimestamp(createdAt, timestampFormat)
    : formatTimelineTimestamp(createdAt, timestampFormat, chatVisualMode);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              revealWidth
                ? "better-chat-timestamp text-muted-foreground text-xs tabular-nums"
                : "pointer-events-none absolute me-1 shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100 group-focus-within/timeline-row:pointer-events-auto group-focus-within/timeline-row:static group-focus-within/timeline-row:opacity-100",
              alwaysVisible && "pointer-events-auto static opacity-100",
              className,
            )}
          />
        }
      >
        {revealWidth ? (
          <span ref={measurePillLabel} className="better-chat-timestamp-label">
            {label}
          </span>
        ) : (
          label
        )}
      </TooltipTrigger>
      <TooltipPopup>{formatChatTimestampTooltip(createdAt, timestampFormat)}</TooltipPopup>
    </Tooltip>
  );
}

/** Better T3 keeps live rows still: the shimmer repaints every frame on high-refresh displays. */
export function ActivityShimmerOverlay({ children }: { children: ReactNode }) {
  if (use(TimelineRowCtx)?.chatVisualMode === "better-t3") return null;
  return (
    <span
      aria-hidden
      className="live-activity-focus pointer-events-none absolute inset-y-0 select-none"
    >
      <span className="live-activity-focus-counter block">
        <span className="live-activity-focus-aligned block text-foreground">{children}</span>
      </span>
    </span>
  );
}
