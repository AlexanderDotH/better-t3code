import { reasoningTitleMarkdown } from "@t3tools/client-runtime/work-log/reasoning";
import type { TurnId } from "@t3tools/contracts";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import type { Root, RootContent } from "mdast";
import {
  createContext,
  memo,
  use,
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  readonly turnId?: TurnId | null;
  readonly createdAt?: string;
}

interface ReasoningSelection {
  readonly traces: readonly WorkingReasoningTrace[];
  readonly turnId?: TurnId;
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
  readonly activeTurnId: TurnId | null;
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
  const openReasoning = useCallback(
    (next: ReasoningSelection) => {
      if (props.enabled !== false) setDialogState({ scope: props.streamIdPrefix, selection: next });
    },
    [props.enabled, props.streamIdPrefix],
  );
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setDialogState({ scope: props.streamIdPrefix, selection: null });
    },
    [props.streamIdPrefix],
  );
  const label = useInterfaceTranslator().message("chat.timeline.thinking");
  const traces = useMemo(() => {
    if (!selection) return [];
    const selectedIds = new Set(selection.traces.map((trace) => trace.id));
    const matches = (id: string, turnId: TurnId | null | undefined) =>
      selection.turnId === undefined ? selectedIds.has(id) : turnId === selection.turnId;
    const canonical = props.messages.filter(
      (message) => message.role === "reasoning" && matches(message.id, message.turnId),
    );
    const traceKey = (turnId: TurnId | null | undefined, detail: string) =>
      `${turnId ?? ""}:${detail.trim()}`;
    const canonicalText = new Set(
      canonical.map((message) => traceKey(message.turnId, message.text)),
    );
    const next: WorkingReasoningTrace[] = canonical.map((message) => ({
      id: message.id,
      detail: message.text,
      turnId: message.turnId,
      createdAt: message.createdAt,
      streaming:
        message.streaming && message.turnId !== null && message.turnId === props.activeTurnId,
    }));
    for (const entry of props.entries) {
      if (
        workEntryIsProviderReasoning(entry) &&
        matches(entry.id, entry.turnId) &&
        (selection.turnId === undefined || entry.historyOrigin === undefined) &&
        entry.detail?.trim() &&
        !canonicalText.has(traceKey(entry.turnId, entry.detail))
      ) {
        next.push({
          id: entry.id,
          detail: entry.detail,
          turnId: entry.turnId ?? null,
          createdAt: entry.createdAt,
          streaming: entry.turnId != null && entry.turnId === props.activeTurnId,
        });
      }
    }
    const currentIds = new Set(next.map((trace) => trace.id));
    for (const snapshot of selection.traces) {
      if (
        !currentIds.has(snapshot.id) &&
        !canonicalText.has(traceKey(snapshot.turnId, snapshot.detail))
      ) {
        next.push({
          ...snapshot,
          streaming:
            snapshot.streaming && snapshot.turnId != null && snapshot.turnId === props.activeTurnId,
        });
      }
    }
    return next.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
  }, [selection, props.entries, props.messages, props.activeTurnId]);

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
export const ReasoningTitle = memo(function ReasoningTitle({
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
  readonly followTurnId?: TurnId;
  readonly compact?: boolean;
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
              ...(props.followTurnId ? { turnId: props.followTurnId } : {}),
            })
          }
          data-reasoning-log="true"
          className={
            props.compact
              ? "flex min-w-0 w-full items-center justify-center gap-1.5 rounded-md text-2xs text-secondary-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "flex min-h-6 min-w-0 w-full items-center gap-1.5 rounded-md px-0.5 text-start text-sm text-secondary-label hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          }
        />
      }
    >
      {props.compact ? null : <BrainIcon aria-hidden className="size-4 shrink-0 text-icon-muted" />}
      <span className="min-w-0 truncate">
        <ReasoningTitle title={reasoningTitleMarkdown(trace.detail, label)} fallback={label} />
      </span>
      <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-icon-muted" />
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
          className={props.compact ? "composer-reasoning-lyrics-content" : undefined}
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
