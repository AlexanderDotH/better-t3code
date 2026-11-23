import { reasoningTitleMarkdown } from "@t3tools/client-runtime/work-log/reasoning";
import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "../../hooks/useStableCallback";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { useId, useState, type ComponentProps } from "react";
import ChatMarkdown from "../ChatMarkdown";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ReasoningTitle, type WorkingReasoningTrace } from "./WorkingReasoningDialog";
import { ChatDetailPanel } from "./ChatDetailPanel";
import { useChatWidthMotion } from "./ChatSizeMotion";
import { cn } from "../../lib/utils";
import { formatReasoningDuration, reasoningDurationMs } from "./reasoningDuration";

type ReasoningMarkdownProps = Omit<ComponentProps<typeof ChatMarkdown>, "text">;

const titleRowClassName = "better-chat-pill-row max-w-full text-start text-message-foreground";
const disclosureClassName = `${titleRowClassName} cursor-pointer focus-visible:outline-2 focus-visible:outline-ring`;

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
  markdown: ReasoningMarkdownProps;
}) {
  const translator = useInterfaceTranslator();
  const active = traces.some((trace) => trace.streaming);
  const label = translator.message(active ? "chat.timeline.thinking" : "chat.timeline.thought");
  const duration = active ? null : reasoningDurationMs(traces);
  const durationLabel = formatReasoningDuration(duration, translator);
  const durationLabelRef = useStableCallback((content: HTMLSpanElement | null) => {
    const container = content?.parentElement;
    if (!container || !content) return;
    const measure = () =>
      container.style.setProperty("--chat-reasoning-duration-width", `${content.offsetWidth}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    return observeResize(content, measure);
  });
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
          className={disclosureClassName}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <BrainIcon aria-hidden className="size-4 shrink-0" />
          </span>
          <span className="min-w-0 truncate">{label}</span>
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
        <div className="better-chat-work-group-details">
          {traces.map((trace) => (
            <ReasoningTraceRow
              key={trace.id}
              trace={trace}
              fallback={label}
              motion={motion}
              markdown={markdown}
            />
          ))}
        </div>
      </ChatDetailPanel>
    </div>
  );
}

function ReasoningTraceRow({
  trace,
  fallback,
  motion,
  markdown,
}: {
  trace: WorkingReasoningTrace;
  fallback: string;
  motion: boolean;
  markdown: ReasoningMarkdownProps;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const text = trace.detail.trimStart();
  const title = reasoningTitleMarkdown(text, "");
  const description = text.slice(title.length).replace(/^[ \t]*(?:\r\n?|\n)/, "");
  const titleContent = <ReasoningTitle title={title || fallback} fallback={fallback} />;
  if (!description.trim()) {
    return (
      <div className={cn("better-chat-work select-text wrap-anywhere", titleRowClassName)}>
        {titleContent}
      </div>
    );
  }
  const detail = /^(?:#{1,6}[ \t]+\S|\*\*.+\*\*$|__.+__$)/.test(title) ? description : trace.detail;
  return (
    <div className="better-chat-work">
      <button
        data-presentation-status
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
        className={disclosureClassName}
      >
        <span className="min-w-0 truncate">{titleContent}</span>
        <ChevronRightIcon
          aria-hidden
          className={cn("better-chat-chevron size-3 shrink-0", expanded && "rotate-90")}
        />
      </button>
      <ChatDetailPanel expanded={expanded} motion={motion} id={panelId}>
        <div className="better-chat-work-output select-text">
          <ChatMarkdown
            {...markdown}
            text={detail}
            streamId={
              markdown.streamId === undefined ? undefined : `${markdown.streamId}:${trace.id}`
            }
            isStreaming={trace.streaming}
            animateInitialStreamChunk={false}
            streamingBlockMotionEnabled={false}
            lineBreaks
          />
        </div>
      </ChatDetailPanel>
    </div>
  );
}
