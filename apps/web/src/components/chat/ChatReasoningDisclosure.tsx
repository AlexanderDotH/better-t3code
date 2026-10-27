import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useId, type ComponentProps } from "react";
import ChatMarkdown from "../ChatMarkdown";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { WorkingReasoningTrace } from "./WorkingReasoningDialog";
import { ChatDetailPanel } from "./ChatDetailPanel";
import { useChatWidthMotion } from "./ChatSizeMotion";
import { ChatThinkingIndicator } from "./ChatThinkingIndicator";
import { cn } from "../../lib/utils";
import { formatReasoningDuration, reasoningDurationMs } from "./reasoningDuration";

export function ChatReasoningDisclosure({
  traces,
  motion,
  expanded,
  onExpandedChange,
  markdown,
}: {
  traces: readonly WorkingReasoningTrace[];
  motion: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  markdown: Omit<ComponentProps<typeof ChatMarkdown>, "text">;
}) {
  const translator = useInterfaceTranslator();
  const active = traces.some((trace) => trace.streaming);
  const label = translator.message(active ? "chat.timeline.thinking" : "chat.timeline.thought");
  const duration = active ? null : reasoningDurationMs(traces);
  const durationLabel = formatReasoningDuration(duration, translator);
  const durationLabelRef = useCallback((content: HTMLSpanElement | null) => {
    const container = content?.parentElement;
    if (!container || !content) return;
    const measure = () =>
      container.style.setProperty("--chat-reasoning-duration-width", `${content.offsetWidth}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const panelId = useId();
  const widthRef = useChatWidthMotion<HTMLButtonElement>(`${traces.length}:${active}`, motion);
  if (traces.length === 0) return null;
  return (
    <div className="better-chat-reasoning" data-motion={motion}>
      <div className="better-chat-bubble better-chat-status" data-chat-compact="true">
        <button
          data-presentation-status
          ref={widthRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onExpandedChange(!expanded)}
          className="better-chat-pill-row max-w-full cursor-pointer text-left text-message-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {active ? (
            <ChatThinkingIndicator motion={motion} />
          ) : (
            <>
              <span className="flex size-6 shrink-0 items-center justify-center">
                <BrainIcon aria-hidden className="size-4 shrink-0" />
              </span>
              <span className="min-w-0 truncate">{label}</span>
            </>
          )}
          {traces.length > 1 ? (
            <span className="text-muted-foreground tabular-nums">{traces.length}</span>
          ) : null}
          <ChevronRightIcon
            aria-hidden
            className={cn("better-chat-chevron size-3 shrink-0", expanded && "rotate-90")}
          />
          {!active ? (
            <span className="better-chat-reasoning-duration text-muted-foreground">
              <span ref={durationLabelRef} className="better-chat-reasoning-duration-label">
                {durationLabel}
              </span>
            </span>
          ) : null}
        </button>
      </div>
      <ChatDetailPanel expanded={expanded} motion={motion} id={panelId}>
        <div className="better-chat-reasoning-details">
          <span aria-hidden className="better-chat-reasoning-rail" />
          <div className="better-chat-reasoning-output max-h-96 space-y-4 overflow-auto text-xs">
            {traces.map((trace) => (
              <ChatMarkdown
                {...markdown}
                key={trace.id}
                text={trace.detail}
                streamId={`${markdown.streamId}:${trace.id}`}
                isStreaming={trace.streaming}
                animateInitialStreamChunk={false}
                streamingBlockMotionEnabled={false}
                lineBreaks
              />
            ))}
          </div>
        </div>
      </ChatDetailPanel>
    </div>
  );
}
