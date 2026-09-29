import type { EnvironmentId, ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { workEntryIsProviderReasoning, type WorkLogEntry } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import type { ChatMessage } from "../../types";

const VISIBLE_REASONING_ENTRIES = 3;

export function latestReasoningEntries(entries: readonly WorkLogEntry[], turnId: TurnId | null) {
  if (turnId === null) return [];
  const recent: WorkLogEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (
      entry.turnId === turnId &&
      entry.historyOrigin === undefined &&
      workEntryIsProviderReasoning(entry) &&
      entry.detail?.trim()
    ) {
      recent.push(entry);
      if (recent.length === VISIBLE_REASONING_ENTRIES) break;
    }
  }
  return recent.toReversed();
}

interface ReasoningTrace {
  readonly id: string;
  readonly detail: string;
  readonly createdAt: string;
  readonly streaming: boolean;
}

export function latestReasoningTraces(
  entries: readonly WorkLogEntry[],
  messages: readonly ChatMessage[],
  turnId: TurnId | null,
): ReasoningTrace[] {
  if (turnId === null) return [];
  const canonical: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "reasoning" && message.turnId === turnId && message.text.trim()) {
      canonical.unshift(message);
      if (canonical.length === VISIBLE_REASONING_ENTRIES) break;
    }
  }
  const canonicalText = new Set(canonical.map((message) => message.text.trim()));
  const legacy = latestReasoningEntries(entries, turnId)
    .filter((entry) => !canonicalText.has(entry.detail!.trim()))
    .map((entry) => ({
      id: entry.id,
      detail: entry.detail!,
      createdAt: entry.createdAt,
      streaming: true,
    }));
  return [
    ...legacy,
    ...canonical.map((message) => ({
      id: message.id,
      detail: message.text,
      createdAt: message.createdAt,
      streaming: message.streaming,
    })),
  ]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-VISIBLE_REASONING_ENTRIES);
}

export const ComposerReasoningScroller = memo(function ComposerReasoningScroller(props: {
  readonly entries: readonly WorkLogEntry[];
  readonly messages?: readonly ChatMessage[];
  readonly active?: boolean;
  readonly turnId: TurnId | null;
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly streamingMotionEnabled: boolean;
}) {
  const entries = useMemo(
    () => latestReasoningTraces(props.entries, props.messages ?? [], props.turnId),
    [props.entries, props.messages, props.turnId],
  );
  if (entries.length === 0) return null;
  return (
    <ReasoningLyrics
      {...props}
      entries={entries}
      active={props.active ?? true}
      key={`${props.environmentId}:${props.threadRef.threadId}:${props.turnId}`}
    />
  );
});

function ReasoningLyrics(props: {
  readonly entries: readonly ReasoningTrace[];
  readonly active: boolean;
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly streamingMotionEnabled: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followLatestLine = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight - viewport.clientHeight,
        behavior: "instant",
      });
    }
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(followLatestLine);
    observer.observe(content);
    return () => observer.disconnect();
  }, [followLatestLine]);

  // Replacing the oldest trace can leave the content height unchanged.
  useLayoutEffect(followLatestLine, [followLatestLine, props.entries]);

  return (
    <div
      ref={viewportRef}
      className="composer-reasoning-lyrics"
      data-composer-reasoning="true"
      role="region"
      aria-label={translate("settings.betterT3.preview.agent.reasoning")}
      tabIndex={0}
    >
      <div ref={contentRef} className="composer-reasoning-lyrics-content">
        {props.entries.map((entry, index) => (
          <ChatMarkdown
            key={entry.id}
            text={entry.detail ?? ""}
            cwd={props.cwd}
            threadRef={props.threadRef}
            environmentId={props.environmentId}
            isStreaming={props.active && entry.streaming && index === props.entries.length - 1}
            streamId={`${props.environmentId}:${props.threadRef.threadId}:reasoning:${entry.id}`}
            animateInitialStreamChunk={props.active && entry.streaming}
            streamingMotionEnabled={props.streamingMotionEnabled}
            className={
              index === props.entries.length - 1
                ? "text-2xs text-foreground/85"
                : "text-2xs text-muted-foreground/55"
            }
            lineBreaks
          />
        ))}
      </div>
    </div>
  );
}
