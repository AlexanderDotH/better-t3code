import type { EnvironmentId, ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { workEntryIsProviderReasoning, type WorkLogEntry } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";

import "./ComposerReasoningScroller.css";

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

export const ComposerReasoningScroller = memo(function ComposerReasoningScroller(props: {
  readonly entries: readonly WorkLogEntry[];
  readonly turnId: TurnId | null;
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly streamingMotionEnabled: boolean;
}) {
  const entries = useMemo(
    () => latestReasoningEntries(props.entries, props.turnId),
    [props.entries, props.turnId],
  );
  if (entries.length === 0) return null;
  return (
    <ReasoningLyrics
      {...props}
      entries={entries}
      key={`${props.environmentId}:${props.threadRef.threadId}:${props.turnId}`}
    />
  );
});

function ReasoningLyrics(props: {
  readonly entries: readonly WorkLogEntry[];
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
            isStreaming={index === props.entries.length - 1}
            streamId={`${props.environmentId}:${props.threadRef.threadId}:reasoning:${entry.id}`}
            animateInitialStreamChunk
            streamingMotionEnabled={props.streamingMotionEnabled}
            className={
              index === props.entries.length - 1
                ? "text-[11px] text-foreground/85"
                : "text-[11px] text-muted-foreground/55"
            }
            lineBreaks
          />
        ))}
      </div>
    </div>
  );
}
