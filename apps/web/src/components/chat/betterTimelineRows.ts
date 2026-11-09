import { createChatReasoningScope } from "@t3tools/client-runtime/chat-presentation";
import {
  summarizeToolGroup,
  toolGroupSummaryKind,
} from "@t3tools/client-runtime/work-log/presentation";
import type { ChatVisualMode, RunId } from "@t3tools/contracts";
import {
  workEntryDisplayIndicatesToolFailure,
  workEntryIsProviderReasoning,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

type ToolRow = Extract<MessagesTimelineRow, { kind: "work" | "work-live" | "work-toggle" }>;

export interface BetterTimelineOptions {
  readonly chatVisualMode?: ChatVisualMode;
  readonly showReasoning?: boolean;
  readonly showWorkingReasoning?: boolean;
  readonly showMessageReasoning?: boolean;
  readonly hideWorkingIndicator?: boolean;
  readonly nativeSubagentDisplay?: boolean;
  /** The run whose task list the composer bubble shows; its task rows leave the timeline. */
  readonly composerPlanRunId?: RunId | null;
}

function groupsReasoning(options: BetterTimelineOptions) {
  return (
    options.chatVisualMode === "better-t3" ||
    options.showMessageReasoning ||
    options.showWorkingReasoning
  );
}

export function timelinePresentationEntries(
  entries: ReadonlyArray<TimelineEntry>,
  options: BetterTimelineOptions,
) {
  const keepReasoning = !groupsReasoning(options) && options.showReasoning !== false;
  const composerPlanRunId = options.composerPlanRunId ?? null;
  if (keepReasoning && options.nativeSubagentDisplay !== false && composerPlanRunId === null) {
    return entries;
  }
  return entries.filter((entry) => {
    if (
      composerPlanRunId !== null &&
      entry.kind === "work" &&
      entry.entry.itemType === "todo_list" &&
      entry.entry.runId === composerPlanRunId
    )
      return false;
    if (
      options.nativeSubagentDisplay === false &&
      ((entry.kind === "event" && entry.projectedItem.item.type === "subagent") ||
        (entry.kind === "work" && entry.entry.itemType === "subagent"))
    )
      return false;
    return keepReasoning || entry.kind !== "work" || !workEntryIsProviderReasoning(entry.entry);
  });
}

function reasoningRows(
  entries: ReadonlyArray<TimelineEntry>,
  options: BetterTimelineOptions,
  activeRunId: RunId | null,
  isWorking: boolean,
) {
  if (
    !groupsReasoning(options) ||
    (options.showReasoning === false && !options.showWorkingReasoning)
  )
    return [];
  const scopeFor = createChatReasoningScope();
  const groups = new Map<string, Extract<MessagesTimelineRow, { kind: "activity-group" }>>();
  for (const entry of entries) {
    const scope = scopeFor(entry.kind === "message" ? entry.message : undefined);
    if (entry.kind !== "work" || !workEntryIsProviderReasoning(entry.entry)) continue;
    let group = groups.get(scope);
    if (!group) {
      group = {
        kind: "activity-group",
        id: `activity-group:${entry.id}`,
        createdAt: entry.createdAt,
        runId: entry.entry.runId ?? null,
        groupId: `activity-group:${entry.id}`,
        entries: [],
        active: false,
        expanded: false,
      };
      groups.set(scope, group);
    }
    group.entries.push(entry);
    group.active ||= isWorking && (entry.entry.runId == null || entry.entry.runId === activeRunId);
  }
  return [...groups.values()];
}

function combinableEntries(row: MessagesTimelineRow): WorkLogEntry[] | null {
  const entries =
    row.kind === "work-toggle"
      ? row.detailEntries
      : row.kind === "work" || row.kind === "work-live"
        ? row.groupedEntries
        : undefined;
  if (
    !entries?.length ||
    entries.some(
      (entry) =>
        workEntryIsProviderReasoning(entry) ||
        entry.itemType === "subagent" ||
        entry.itemType === "compaction" ||
        entry.itemType === "approval_request" ||
        entry.questionAnswer !== undefined ||
        entry.tone === "error",
    )
  )
    return null;
  return entries;
}

function combineToolRows(
  rows: MessagesTimelineRow[],
  expandedGroupIds: ReadonlySet<string> | undefined,
) {
  const result: MessagesTimelineRow[] = [];
  let group: { row: ToolRow; entries: WorkLogEntry[] }[] = [];
  let groupIndex = -1;
  const flush = () => {
    const first = group[0];
    if (first && (group.length > 1 || first.entries.length > 1)) {
      const byId = new Map<string, WorkLogEntry>();
      for (const item of group) for (const entry of item.entries) byId.set(entry.id, entry);
      const entries = [...byId.values()];
      const groupId = first.row.kind === "work" ? `work-group:${first.row.id}` : first.row.groupId;
      const identity = {
        id: `tools:${groupId}`,
        createdAt: first.row.createdAt,
        groupId,
        expanded: expandedGroupIds?.has(groupId) ?? false,
      };
      const live = group.findLast((item) => item.row.kind === "work-live" && item.row.active)?.row;
      if (live?.kind === "work-live")
        result[groupIndex] = { ...live, ...identity, groupedEntries: entries };
      else {
        const source =
          entries.find((entry) => entry.toolSource) ??
          entries.findLast((entry) => entry.toolSurface || entry.toolIcon);
        const icon = source?.toolIcon ?? source?.toolSource?.icon;
        result[groupIndex] = {
          kind: "work-toggle",
          ...identity,
          runId: entries[0]?.runId ?? null,
          hiddenCount: entries.length,
          detailEntries: entries,
          summary: summarizeToolGroup(entries).summary,
          summaryKind: toolGroupSummaryKind(entries),
          ...(source?.toolSurface ? { toolSurface: source.toolSurface } : {}),
          ...(icon ? { toolIcon: icon } : {}),
          hasFailure: entries.some(workEntryDisplayIndicatesToolFailure),
        };
      }
    }
    group = [];
    groupIndex = -1;
  };
  for (const row of rows) {
    const entries = combinableEntries(row);
    if (
      entries &&
      (row.kind === "work" || row.kind === "work-live" || row.kind === "work-toggle")
    ) {
      if (group.length === 0) {
        groupIndex = result.length;
        result.push(row);
      }
      group.push({ row, entries });
      continue;
    }
    const emptyAssistant =
      row.kind === "message" &&
      row.message.role === "assistant" &&
      !row.message.text.trim() &&
      !row.message.attachments?.length;
    if (
      row.kind !== "activity-group" &&
      !emptyAssistant &&
      row.kind !== "thinking" &&
      row.kind !== "working" &&
      row.kind !== "turn-fold"
    )
      flush();
    result.push(row);
  }
  flush();
  return result;
}

export function presentBetterTimelineRows(
  rows: MessagesTimelineRow[],
  entries: ReadonlyArray<TimelineEntry>,
  options: BetterTimelineOptions,
  activeRunId: RunId | null,
  isWorking: boolean,
  expandedGroupIds: ReadonlySet<string> | undefined,
  collapsedFoldMemberIds: ReadonlySet<string>,
): MessagesTimelineRow[] {
  const scopeFor = createChatReasoningScope();
  const scopeByEntry = new Map<string, string>();
  const assistantByScope = new Map<string, string>();
  const collapsedScopes = new Set<string>();
  for (const entry of entries) {
    const scope = scopeFor(entry.kind === "message" ? entry.message : undefined);
    scopeByEntry.set(entry.id, scope);
    if (collapsedFoldMemberIds.has(entry.id)) collapsedScopes.add(scope);
    if (entry.kind === "message" && entry.message.role === "assistant" && entry.message.text.trim())
      assistantByScope.set(scope, entry.message.id);
  }
  const groups = reasoningRows(entries, options, activeRunId, isWorking).filter(
    (group) =>
      !options.showWorkingReasoning ||
      !collapsedScopes.has(scopeByEntry.get(group.entries[0]?.id ?? "") ?? ""),
  );
  const tail = entries.at(-1);
  const activeReasoning =
    tail?.kind === "work" &&
    workEntryIsProviderReasoning(tail.entry) &&
    tail.entry.toolLifecycleStatus === "inProgress" &&
    groups.some((group) => group.active && group.entries.at(-1)?.id === tail.id);
  const result = activeReasoning ? rows.filter((row) => row.kind !== "thinking") : [...rows];
  for (const group of groups) {
    const scope = scopeByEntry.get(group.entries[0]?.id ?? "");
    const assistantId = scope === undefined ? undefined : assistantByScope.get(scope);
    if (assistantId && options.showMessageReasoning) {
      const messageIndex = result.findIndex(
        (row) => row.kind === "message" && row.message.id === assistantId,
      );
      const messageRow = result[messageIndex];
      if (messageRow?.kind === "message") {
        result[messageIndex] = { ...messageRow, reasoningGroup: group };
        continue;
      }
    }

    const nextIndex = result.findIndex(
      (row) => row.createdAt !== null && row.createdAt > group.createdAt,
    );
    result.splice(nextIndex < 0 ? result.length : nextIndex, 0, group);
  }
  return options.chatVisualMode === "better-t3"
    ? combineToolRows(result, expandedGroupIds)
    : result;
}
