import type { EnvironmentId, ScopedThreadRef, RunId } from "@t3tools/contracts";
import { memo } from "react";

import { workEntryIsProviderReasoning, type WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { WorkingReasoningLog } from "./WorkingReasoningDialog";

/** Turn records are ordered; stop at the previous turn instead of revisiting the thread history. */
function entriesForTurn<T extends { readonly runId?: RunId | null }>(
  entries: readonly T[],
  runId: RunId,
) {
  const recent: T[] = [];
  let foundTurn = false;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.runId === runId) {
      foundTurn = true;
      recent.push(entry);
    } else if (foundTurn && entry.runId != null) {
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
  readonly runId: RunId | null;
}

function reasoningTracesForTurn(
  entries: readonly WorkLogEntry[],
  messages: readonly ChatMessage[],
  runId: RunId | null,
): ReasoningTrace[] {
  if (runId === null) return [];
  const canonical: ChatMessage[] = [];
  const canonicalText = new Set(canonical.map((message) => message.text.trim()));
  const legacy = entriesForTurn(entries, runId)
    .filter(
      (entry) =>
        entry.runId === runId &&
        workEntryIsProviderReasoning(entry) &&
        entry.detail?.trim() &&
        !canonicalText.has(entry.detail.trim()),
    )
    .map((entry) => ({
      id: entry.id,
      detail: entry.detail!,
      createdAt: entry.createdAt,
      runId: entry.runId ?? null,
      streaming: true,
    }));
  return [
    ...legacy,
    ...canonical.map((message) => ({
      id: message.id,
      detail: message.text,
      createdAt: message.createdAt,
      runId: message.runId,
      streaming: message.streaming,
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function hasComposerReasoning(
  entries: readonly WorkLogEntry[],
  runId: RunId | null,
): boolean {
  return reasoningTracesForTurn(entries, [], runId).length > 0;
}

export const ComposerReasoningScroller = memo(function ComposerReasoningScroller(props: {
  readonly entries: readonly WorkLogEntry[];
  readonly messages?: readonly ChatMessage[];
  readonly active?: boolean;
  readonly runId: RunId | null;
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
}) {
  const entries = reasoningTracesForTurn(props.entries, props.messages ?? [], props.runId);
  if (entries.length === 0) return null;
  return (
    <div className="min-w-0 flex-1" data-composer-reasoning="true">
      <WorkingReasoningLog
        traces={entries}
        {...(props.runId ? { followRunId: props.runId } : {})}
        key={`${props.environmentId}:${props.threadRef.threadId}:${props.runId}`}
        compact
      />
    </div>
  );
});
