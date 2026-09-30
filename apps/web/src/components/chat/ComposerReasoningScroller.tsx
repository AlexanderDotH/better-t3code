import type { EnvironmentId, ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { memo, useMemo } from "react";

import { workEntryIsProviderReasoning, type WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { WorkingReasoningLog } from "./WorkingReasoningDialog";

/** Turn records are ordered; stop at the previous turn instead of revisiting the thread history. */
function entriesForTurn<T extends { readonly turnId?: TurnId | null }>(
  entries: readonly T[],
  turnId: TurnId,
) {
  const recent: T[] = [];
  let foundTurn = false;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.turnId === turnId) {
      foundTurn = true;
      recent.push(entry);
    } else if (foundTurn && entry.turnId != null) {
      break;
    }
  }
  return recent.toReversed();
}

interface ReasoningTrace {
  readonly id: string;
  readonly detail: string;
  readonly createdAt: string;
  readonly streaming: boolean;
  readonly turnId: TurnId | null;
}

function reasoningTracesForTurn(
  entries: readonly WorkLogEntry[],
  messages: readonly ChatMessage[],
  turnId: TurnId | null,
): ReasoningTrace[] {
  if (turnId === null) return [];
  const canonical = entriesForTurn(messages, turnId).filter(
    (message) => message.role === "reasoning" && message.turnId === turnId && message.text.trim(),
  );
  const canonicalText = new Set(canonical.map((message) => message.text.trim()));
  const legacy = entriesForTurn(entries, turnId)
    .filter(
      (entry) =>
        entry.turnId === turnId &&
        entry.historyOrigin === undefined &&
        workEntryIsProviderReasoning(entry) &&
        entry.detail?.trim() &&
        !canonicalText.has(entry.detail.trim()),
    )
    .map((entry) => ({
      id: entry.id,
      detail: entry.detail!,
      createdAt: entry.createdAt,
      turnId: entry.turnId ?? null,
      streaming: true,
    }));
  return [
    ...legacy,
    ...canonical.map((message) => ({
      id: message.id,
      detail: message.text,
      createdAt: message.createdAt,
      turnId: message.turnId,
      streaming: message.streaming,
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
    () => reasoningTracesForTurn(props.entries, props.messages ?? [], props.turnId),
    [props.entries, props.messages, props.turnId],
  );
  if (entries.length === 0) return null;
  return (
    <div className="min-w-0 flex-1" data-composer-reasoning="true">
      <WorkingReasoningLog
        traces={entries}
        {...(props.turnId ? { followTurnId: props.turnId } : {})}
        key={`${props.environmentId}:${props.threadRef.threadId}:${props.turnId}`}
        compact
      />
    </div>
  );
});
