import type {
  OrchestrationMessage,
  OrchestrationSubagentDetail,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  BotIcon,
  CircleAlertIcon,
  ClipboardListIcon,
  MessageSquareIcon,
  WrenchIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { formatShortTimestamp } from "../timestampFormat";
import ChatMarkdown from "./ChatMarkdown";
import {
  deriveSubagentTranscriptEntries,
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
  type SubagentStatusPresentation,
  type SubagentTranscriptEntry,
} from "./subagents/subagentPresentation";
import { SubagentStatusDot } from "./subagents/SubagentStatusDot";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Spinner } from "./ui/spinner";

const EMPTY_COMMITTED_MESSAGE_IDS: ReadonlySet<string> = new Set();

export interface SubagentTranscriptPanelProps {
  readonly subagent: OrchestrationSubagentDetail | null;
  readonly isLoading?: boolean;
  readonly errorMessage?: string | null;
  readonly markdownCwd?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly timestampFormat?: TimestampFormat;
  readonly className?: string;
}

interface SubagentInitialStreamAnimationInput {
  readonly committedScopeId: string | null;
  readonly committedMessageIds: ReadonlySet<string>;
  readonly currentScopeId: string;
  readonly messageId: string;
  readonly isAssistant: boolean;
  readonly isStreaming: boolean;
}

export function resolveSubagentInitialStreamAnimation({
  committedScopeId,
  committedMessageIds,
  currentScopeId,
  messageId,
  isAssistant,
  isStreaming,
}: SubagentInitialStreamAnimationInput): boolean {
  return (
    isAssistant &&
    isStreaming &&
    committedScopeId === currentScopeId &&
    !committedMessageIds.has(messageId)
  );
}

export const SubagentTranscriptPanel = memo(function SubagentTranscriptPanel({
  subagent,
  isLoading = false,
  errorMessage = null,
  markdownCwd,
  threadRef,
  timestampFormat = "locale",
  className,
}: SubagentTranscriptPanelProps) {
  const entries = useMemo(
    () => (subagent ? deriveSubagentTranscriptEntries(subagent) : []),
    [subagent],
  );
  const streamScopeId = subagent ? String(subagent.id) : "";
  const shouldAnimateInitialStreamChunk = useSubagentInitialStreamAnimationRegistry(
    streamScopeId,
    entries,
  );

  if (isLoading && !subagent) {
    return (
      <PanelState className={className}>
        <Spinner className="size-4 text-muted-foreground" />
        <span>Loading agent transcript</span>
      </PanelState>
    );
  }

  if (errorMessage && !subagent) {
    return (
      <PanelState className={className}>
        <CircleAlertIcon aria-hidden="true" className="size-4 text-destructive" />
        <span className="font-medium text-foreground">Agent transcript unavailable</span>
        <span className="max-w-sm text-center text-muted-foreground">{errorMessage}</span>
      </PanelState>
    );
  }

  if (!subagent) {
    return (
      <PanelState className={className}>
        <BotIcon aria-hidden="true" className="size-5 text-muted-foreground/70" />
        <span>Select an agent to inspect its transcript</span>
      </PanelState>
    );
  }

  const name = resolveSubagentDisplayName(subagent);
  const status = resolveSubagentStatusPresentation(subagent);

  return (
    <section
      aria-label={`${name} transcript`}
      className={cn("flex h-full min-h-0 min-w-0 flex-col bg-background", className)}
    >
      <SubagentTranscriptHeader
        subagent={subagent}
        name={name}
        status={status}
        errorMessage={errorMessage}
      />
      <ScrollArea className="min-h-0 flex-1" scrollFade scrollbarGutter>
        <ol className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-5">
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              <SubagentTranscriptEntryView
                entry={entry}
                agentName={name}
                markdownCwd={markdownCwd}
                threadRef={threadRef}
                timestampFormat={timestampFormat}
                streamScopeId={streamScopeId}
                animateInitialStreamChunk={
                  entry.kind === "message" &&
                  shouldAnimateInitialStreamChunk(
                    entry.message.id,
                    entry.message.role === "assistant",
                    entry.message.streaming,
                  )
                }
              />
            </li>
          ))}
          {entries.length === 0 ? (
            <li className="py-12 text-center text-sm text-muted-foreground">
              No transcript events yet.
            </li>
          ) : null}
        </ol>
      </ScrollArea>
    </section>
  );
});

function PanelState({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 px-6 text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SubagentTranscriptHeader({
  subagent,
  name,
  status,
  errorMessage,
}: {
  readonly subagent: OrchestrationSubagentDetail;
  readonly name: string;
  readonly status: SubagentStatusPresentation;
  readonly errorMessage: string | null;
}) {
  const metadata = [subagent.role, subagent.model, subagent.reasoningEffort].filter(
    (value): value is string => Boolean(value),
  );

  return (
    <header className="shrink-0 border-b border-border/60 bg-card/35 py-3 pr-12 pl-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shadow-xs">
          <BotIcon aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{name}</h2>
            <Badge variant="outline" size="sm">
              <SubagentStatusDot presentation={status} className="size-1.5" />
              {status.label}
            </Badge>
          </div>
          {metadata.length > 0 ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {metadata.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>

      <div
        aria-live="polite"
        className="mt-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
        role="status"
      >
        <p className="text-xs font-medium text-foreground/90">{status.activity}</p>
        {status.detail ? (
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{status.detail}</p>
        ) : null}
      </div>

      {subagent.task ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {subagent.task}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <span>{errorMessage}</span>
        </p>
      ) : null}
    </header>
  );
}

function SubagentTranscriptEntryView({
  entry,
  agentName,
  markdownCwd,
  threadRef,
  timestampFormat,
  streamScopeId,
  animateInitialStreamChunk,
}: {
  readonly entry: SubagentTranscriptEntry;
  readonly agentName: string;
  readonly markdownCwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly streamScopeId: string;
  readonly animateInitialStreamChunk: boolean;
}) {
  if (entry.kind === "message") {
    return (
      <TranscriptMessage
        message={entry.message}
        agentName={agentName}
        markdownCwd={markdownCwd}
        threadRef={threadRef}
        timestampFormat={timestampFormat}
        streamId={`${streamScopeId}:${String(entry.message.id)}`}
        animateInitialStreamChunk={animateInitialStreamChunk}
      />
    );
  }

  if (entry.kind === "proposed-plan") {
    return (
      <article className="rounded-xl border border-info/20 bg-info/5 p-3.5">
        <EntryHeading
          icon={<ClipboardListIcon aria-hidden="true" className="size-3.5" />}
          label="Proposed plan"
          createdAt={entry.createdAt}
          timestampFormat={timestampFormat}
        />
        <ChatMarkdown
          className="mt-3"
          text={entry.proposedPlan.planMarkdown}
          cwd={markdownCwd}
          threadRef={threadRef}
          isStreaming={false}
        />
      </article>
    );
  }

  return <TranscriptActivity activity={entry.activity} timestampFormat={timestampFormat} />;
}

function TranscriptMessage({
  message,
  agentName,
  markdownCwd,
  threadRef,
  timestampFormat,
  streamId,
  animateInitialStreamChunk,
}: {
  readonly message: OrchestrationMessage;
  readonly agentName: string;
  readonly markdownCwd: string | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly streamId: string;
  readonly animateInitialStreamChunk: boolean;
}) {
  const roleLabel =
    message.role === "assistant" ? agentName : message.role === "user" ? "Input" : "System";

  return (
    <article
      className={cn(
        "rounded-xl border p-3.5",
        message.role === "assistant" && "border-border/65 bg-card/45",
        message.role === "user" && "border-primary/15 bg-primary/5",
        message.role === "system" && "border-border/50 bg-muted/25",
      )}
    >
      <EntryHeading
        icon={<MessageSquareIcon aria-hidden="true" className="size-3.5" />}
        label={roleLabel}
        createdAt={message.createdAt}
        timestampFormat={timestampFormat}
        trailing={message.streaming ? <Badge size="sm">Streaming</Badge> : null}
      />
      <ChatMarkdown
        className="mt-2.5"
        text={message.text}
        cwd={markdownCwd}
        threadRef={threadRef}
        isStreaming={message.streaming}
        streamId={message.role === "assistant" ? streamId : undefined}
        animateInitialStreamChunk={message.role === "assistant" ? animateInitialStreamChunk : false}
        lineBreaks={message.role === "user"}
      />
    </article>
  );
}

function useSubagentInitialStreamAnimationRegistry(
  scopeId: string,
  entries: ReadonlyArray<SubagentTranscriptEntry>,
) {
  const committedRef = useRef<{
    readonly scopeId: string;
    readonly messageIds: ReadonlySet<string>;
  } | null>(null);
  const currentMessageIds = useMemo(
    () =>
      new Set(
        entries.flatMap((entry) => (entry.kind === "message" ? [String(entry.message.id)] : [])),
      ),
    [entries],
  );

  useEffect(() => {
    committedRef.current = { scopeId, messageIds: currentMessageIds };
  }, [currentMessageIds, scopeId]);

  return useCallback(
    (messageId: OrchestrationMessage["id"], isAssistant: boolean, isStreaming: boolean) =>
      resolveSubagentInitialStreamAnimation({
        committedScopeId: committedRef.current?.scopeId ?? null,
        committedMessageIds: committedRef.current?.messageIds ?? EMPTY_COMMITTED_MESSAGE_IDS,
        currentScopeId: scopeId,
        messageId: String(messageId),
        isAssistant,
        isStreaming,
      }),
    [scopeId],
  );
}

function TranscriptActivity({
  activity,
  timestampFormat,
}: {
  readonly activity: OrchestrationThreadActivity;
  readonly timestampFormat: TimestampFormat;
}) {
  const serializedPayload = serializeActivityPayload(activity.payload);

  return (
    <article
      className={cn(
        "rounded-xl border px-3.5 py-3",
        activity.tone === "error"
          ? "border-destructive/25 bg-destructive/5"
          : "border-border/55 bg-muted/15",
      )}
    >
      <EntryHeading
        icon={
          activity.tone === "error" ? (
            <CircleAlertIcon aria-hidden="true" className="size-3.5 text-destructive" />
          ) : (
            <WrenchIcon aria-hidden="true" className="size-3.5" />
          )
        }
        label={activity.summary}
        createdAt={activity.createdAt}
        timestampFormat={timestampFormat}
      />
      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/65">
        {activity.kind}
      </p>
      {serializedPayload ? (
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Event details
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/80 p-2.5 font-mono text-[10px] leading-4 text-foreground/75">
            {serializedPayload}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function EntryHeading({
  icon,
  label,
  createdAt,
  timestampFormat,
  trailing,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly createdAt: string;
  readonly timestampFormat: TimestampFormat;
  readonly trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">{label}</span>
      {trailing}
      <time className="shrink-0 text-[10px] tabular-nums" dateTime={createdAt}>
        {formatShortTimestamp(createdAt, timestampFormat)}
      </time>
    </div>
  );
}

function serializeActivityPayload(payload: unknown): string | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  try {
    const serialized = JSON.stringify(payload, null, 2);
    if (!serialized || serialized === "{}" || serialized === "[]") {
      return null;
    }
    return serialized;
  } catch {
    return String(payload);
  }
}
