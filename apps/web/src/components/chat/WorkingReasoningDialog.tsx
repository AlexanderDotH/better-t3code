import { useStableCallback } from "../../hooks/useStableCallback";
import { reasoningTitleMarkdown } from "@t3tools/client-runtime/work-log/reasoning";
import type { ChatVisualMode, RunId } from "@t3tools/contracts";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import type { Root, RootContent } from "mdast";
import { createContext, memo, use, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import ChatMarkdown from "../ChatMarkdown";
import { Dialog, DialogHeader, DialogPopup, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useReasoningFollow } from "./useReasoningFollow";
import { workEntryIsProviderReasoning, type WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";

export interface WorkingReasoningTrace {
  readonly id: string;
  readonly detail: string;
  readonly streaming: boolean;
  readonly runId?: RunId | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

interface ReasoningSelection {
  readonly traces: readonly WorkingReasoningTrace[];
  readonly runId?: RunId;
}

const WorkingReasoningDialogContext = createContext<
  ((selection: ReasoningSelection) => void) | null
>(null);

type MarkdownOptions = Pick<
  ComponentProps<typeof ChatMarkdown>,
  | "cwd"
  | "threadRef"
  | "environmentId"
  | "skills"
  | "onVisualizationAction"
  | "onImageExpand"
  | "onUseArtifactTemplate"
>;

/** Keep the dialog alive when a live status strip or recycled work row disappears. */
export function WorkingReasoningDialogProvider(props: {
  readonly children: ReactNode;
  readonly entries: readonly WorkLogEntry[];
  readonly messages: readonly ChatMessage[];
  readonly activeRunId: RunId | null;
  readonly isWorking: boolean;
  readonly enabled?: boolean;
  readonly streamIdPrefix: string;
  readonly streamingMotionEnabled: boolean;
  readonly markdownOptions?: MarkdownOptions;
}) {
  const [dialogState, setDialogState] = useState<{
    scope: string;
    selection: ReasoningSelection | null;
  }>(() => ({ scope: props.streamIdPrefix, selection: null }));
  const enabled = props.enabled !== false;
  const selection =
    enabled && dialogState.scope === props.streamIdPrefix ? dialogState.selection : null;
  if (dialogState.scope !== props.streamIdPrefix || (!enabled && dialogState.selection !== null)) {
    setDialogState({ scope: props.streamIdPrefix, selection: null });
  }
  const openReasoning = useStableCallback((next: ReasoningSelection) => {
    if (props.enabled !== false) setDialogState({ scope: props.streamIdPrefix, selection: next });
  });
  const onOpenChange = useStableCallback((open: boolean) => {
    if (!open) setDialogState({ scope: props.streamIdPrefix, selection: null });
  });
  const label = useInterfaceTranslator().message("chat.timeline.thinking");
  const traces = (() => {
    if (!selection) return [];
    const selectedIds = new Set(selection.traces.map((trace) => trace.id));
    const matches = (id: string, runId: RunId | null | undefined) =>
      selection.runId === undefined ? selectedIds.has(id) : runId === selection.runId;
    const canonical: ChatMessage[] = [];
    const traceKey = (runId: RunId | null | undefined, detail: string) =>
      `${runId ?? ""}:${detail.trim()}`;
    const canonicalText = new Set(
      canonical.map((message) => traceKey(message.runId, message.text)),
    );
    const next: WorkingReasoningTrace[] = canonical.map((message) => ({
      id: message.id,
      detail: message.text,
      runId: message.runId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      streaming: message.streaming && message.runId !== null && message.runId === props.activeRunId,
    }));
    for (const entry of props.entries) {
      if (
        workEntryIsProviderReasoning(entry) &&
        matches(entry.id, entry.runId) &&
        entry.detail?.trim() &&
        !canonicalText.has(traceKey(entry.runId, entry.detail))
      ) {
        next.push({
          id: entry.id,
          detail: entry.detail,
          runId: entry.runId ?? null,
          createdAt: entry.createdAt,
          streaming: entry.runId != null && entry.runId === props.activeRunId,
        });
      }
    }
    const currentIds = new Set(next.map((trace) => trace.id));
    for (const snapshot of selection.traces) {
      if (
        !currentIds.has(snapshot.id) &&
        !canonicalText.has(traceKey(snapshot.runId, snapshot.detail))
      ) {
        next.push({
          ...snapshot,
          streaming:
            snapshot.streaming && snapshot.runId != null && snapshot.runId === props.activeRunId,
        });
      }
    }
    return next.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
  })();

  return (
    <Dialog open={selection !== null} onOpenChange={onOpenChange}>
      <WorkingReasoningDialogContext value={openReasoning}>
        {props.children}
      </WorkingReasoningDialogContext>
      {selection ? (
        <DialogPopup variant="panel" className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle size="sm">{label}</DialogTitle>
          </DialogHeader>
          <WorkingReasoningContent
            traces={traces}
            active={props.isWorking}
            streamIdPrefix={props.streamIdPrefix}
            streamingMotionEnabled={props.streamingMotionEnabled}
            {...(props.markdownOptions ? { markdownOptions: props.markdownOptions } : {})}
          />
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}

function remarkReasoningTitle(fallback: string) {
  return (tree: Root) => {
    const plainText = (node: Root | RootContent): string => {
      if (node.type === "html" || node.type === "definition") return "";
      if ("alt" in node) return node.alt ?? "";
      if ("value" in node) return node.value;
      if ("children" in node) return node.children.map(plainText).join("");
      return node.type === "break" ? " " : "";
    };
    tree.children = [
      { type: "text", value: plainText(tree).replace(/\s+/g, " ").trim() || fallback },
    ];
  };
}

/** Parse only the title line, so streamed body appends do not reparse the log label. */
const ReasoningTitle = memo(function ReasoningTitle({
  title,
  fallback,
}: {
  title: string;
  fallback: string;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, [remarkReasoningTitle, fallback]]}>
      {title}
    </ReactMarkdown>
  );
});

export function WorkingReasoningLog(props: {
  readonly traces: readonly WorkingReasoningTrace[];
  readonly followRunId?: RunId;
  readonly compact?: boolean;
  readonly chatVisualMode?: ChatVisualMode;
}) {
  const openReasoning = use(WorkingReasoningDialogContext);
  const label = useInterfaceTranslator().message("chat.timeline.thinking");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { viewportRef, contentRef, ...scrollHandlers } = useReasoningFollow(
    props.traces,
    reducedMotion,
    props.compact === true,
  );
  const latest = props.traces.at(-1);
  const better = props.chatVisualMode === "better-t3" && !props.compact;
  if (!latest) return null;
  const renderTitle = (trace: WorkingReasoningTrace) => (
    <DialogTrigger
      key={trace.id}
      render={
        <button
          type="button"
          onClick={() =>
            openReasoning?.({
              traces: props.traces,
              ...(props.followRunId ? { runId: props.followRunId } : {}),
            })
          }
          data-reasoning-log="true"
          data-presentation-status={better || undefined}
          className={
            props.compact
              ? "flex min-w-0 w-full items-center justify-center gap-1.5 rounded-md text-2xs text-secondary-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              : better
                ? "better-chat-pill-row max-w-full cursor-pointer text-start text-message-foreground focus-visible:outline-2 focus-visible:outline-ring"
                : cn(
                    "flex min-h-6 min-w-0 w-full items-center gap-1.5 rounded-md px-0.5 text-start text-secondary-label hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    props.chatVisualMode === "classic" ? "text-xs" : "text-sm",
                  )
          }
        />
      }
    >
      {props.compact ? null : better ? (
        <span className="flex size-6 shrink-0 items-center justify-center">
          <BrainIcon aria-hidden className="size-4 shrink-0" />
        </span>
      ) : (
        <BrainIcon
          aria-hidden
          className={cn(
            "shrink-0 text-icon-muted",
            props.chatVisualMode === "classic" ? "size-3.5" : "size-4",
          )}
        />
      )}
      <span className="min-w-0 truncate">
        <ReasoningTitle title={reasoningTitleMarkdown(trace.detail, label)} fallback={label} />
      </span>
      <ChevronRightIcon
        aria-hidden
        className={cn("size-3 shrink-0", better ? "better-chat-chevron" : "text-icon-muted")}
      />
    </DialogTrigger>
  );
  return (
    <>
      <div
        ref={viewportRef}
        {...scrollHandlers}
        className={props.compact ? "composer-reasoning-lyrics" : "min-w-0"}
      >
        <div
          ref={contentRef}
          className={cn(
            props.compact && "composer-reasoning-lyrics-content",
            better && "better-chat-bubble better-chat-status",
          )}
          data-chat-compact={better || undefined}
        >
          {(props.compact ? props.traces : [latest]).map(renderTitle)}
        </div>
      </div>
    </>
  );
}

function WorkingReasoningContent(props: {
  readonly traces: readonly WorkingReasoningTrace[];
  readonly active: boolean;
  readonly streamIdPrefix: string;
  readonly streamingMotionEnabled: boolean;
  readonly markdownOptions?: MarkdownOptions;
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { viewportRef, contentRef, ...scrollHandlers } = useReasoningFollow(
    props.traces,
    reducedMotion,
  );
  return (
    <div
      ref={viewportRef}
      {...scrollHandlers}
      className="min-h-0 max-h-[60dvh] overflow-y-auto overscroll-contain px-6 pb-6"
      data-working-reasoning-content="true"
      tabIndex={0}
    >
      <div ref={contentRef} className="flex min-w-0 flex-col gap-3">
        {props.traces.map((trace, index) => {
          const streaming = props.active && trace.streaming && index === props.traces.length - 1;
          return (
            <ChatMarkdown
              {...props.markdownOptions}
              cwd={props.markdownOptions?.cwd}
              key={trace.id}
              text={trace.detail}
              isStreaming={streaming}
              streamId={`${props.streamIdPrefix}:reasoning:${trace.id}`}
              animateInitialStreamChunk={false}
              streamingMotionEnabled={props.streamingMotionEnabled}
              className="text-sm text-secondary-label"
              lineBreaks
            />
          );
        })}
      </div>
    </div>
  );
}
