import {
  createChatReasoningScope,
  resolveReasoningDisplayMode,
  type ReasoningDisplayMode,
} from "@t3tools/client-runtime/chat-presentation";
import type { BetterT3SettingsV1, RunId } from "@t3tools/contracts";
import type { ThreadFeedActivity, ThreadFeedEntry } from "./threadActivity";

// Mobile showed traces in chat before the mode existed; keep that until this device picks one.
export function resolveMobileReasoningDisplayMode(
  settings: BetterT3SettingsV1 | undefined,
): ReasoningDisplayMode {
  if (!settings || !Object.hasOwn(settings.flags, "agent.reasoningVisibility")) return "chat";
  return resolveReasoningDisplayMode(settings);
}

type MessageEntry = Extract<ThreadFeedEntry, { type: "message" }>;
type ActivityGroup = Extract<ThreadFeedEntry, { type: "activity-group" }>;

interface ThreadReasoningBuild {
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly mode: ReasoningDisplayMode;
  readonly presented: ReadonlyArray<ThreadFeedEntry>;
  /** Feed entry `entry` starts a request whose rows start at `presented`. */
  readonly restarts: ReadonlyArray<{ readonly entry: number; readonly presented: number }>;
}

export function createThreadReasoningCache() {
  return {
    build: null as ThreadReasoningBuild | null,
    messages: new WeakMap<
      MessageEntry,
      { activities: ReadonlyArray<ThreadFeedActivity>; entry: MessageEntry }
    >(),
    groups: new WeakMap<
      ActivityGroup,
      {
        mode: ReasoningDisplayMode;
        activities: ReadonlyArray<ThreadFeedActivity>;
        entries: ThreadFeedEntry[];
      }
    >(),
  };
}

function sameActivities(
  left: ReadonlyArray<ThreadFeedActivity>,
  right: ReadonlyArray<ThreadFeedActivity>,
) {
  return left.length === right.length && left.every((activity, index) => activity === right[index]);
}

function isReasoning(activity: ThreadFeedActivity) {
  return activity.workEntry.itemType === "reasoning";
}

function reasoningScope(scope: string, runId: RunId | null) {
  return JSON.stringify([scope, runId]);
}

// Traces always take the main-thread request scope, so rows before such a
// request never depend on the entries after it.
function startsRequest(entry: ThreadFeedEntry | undefined) {
  return (
    entry?.type === "message" &&
    entry.message.role === "user" &&
    entry.message.replyTopicId === undefined
  );
}

function firstChangedIndex<T>(previous: ReadonlyArray<T>, next: ReadonlyArray<T>) {
  const limit = Math.min(previous.length, next.length);
  let index = 0;
  while (index < limit && previous[index] === next[index]) index += 1;
  return index;
}

export function presentThreadReasoning(
  feed: ReadonlyArray<ThreadFeedEntry>,
  mode: ReasoningDisplayMode,
  cache = createThreadReasoningCache(),
): ReadonlyArray<ThreadFeedEntry> {
  if (mode === "chat") return feed;
  const previous = cache.build?.mode === mode ? cache.build : null;
  let restartIndex = -1;
  if (previous !== null) {
    const firstChanged = firstChangedIndex(previous.feed, feed);
    restartIndex = previous.restarts.length - 1;
    while (
      restartIndex >= 0 &&
      (previous.restarts[restartIndex]!.entry > firstChanged ||
        !startsRequest(feed[previous.restarts[restartIndex]!.entry]))
    ) {
      restartIndex -= 1;
    }
  }
  const restart = restartIndex === -1 ? null : previous!.restarts[restartIndex]!;
  const start = restart?.entry ?? 0;
  const presented = restart === null ? [] : previous!.presented.slice(0, restart.presented);
  const restarts = restart === null ? [] : previous!.restarts.slice(0, restartIndex);

  const scopeFor = createChatReasoningScope();
  const keys = new Map<ThreadFeedEntry, string>();
  const recipients = new Map<string, MessageEntry>();
  const traces = new Map<string, ThreadFeedActivity[]>();
  const attached = new Set<ThreadFeedActivity>();
  if (mode === "message") {
    // A trace joins its request's last answer once an answer follows it; until then it stays where it streams.
    const waiting = new Map<string, ThreadFeedActivity[]>();
    for (let index = start; index < feed.length; index += 1) {
      const entry = feed[index]!;
      const scope = scopeFor(entry.type === "message" ? entry.message : undefined);
      if (entry.type === "activity-group") {
        const key = reasoningScope(scope, entry.runId);
        for (const activity of entry.activities) {
          if (!isReasoning(activity)) continue;
          const pending = waiting.get(key);
          if (pending) pending.push(activity);
          else waiting.set(key, [activity]);
        }
        continue;
      }
      if (
        entry.type !== "message" ||
        entry.message.role !== "assistant" ||
        (!entry.message.text.trim() && entry.message.attachments.length === 0)
      ) {
        continue;
      }
      const key = reasoningScope(scope, entry.message.runId);
      keys.set(entry, key);
      recipients.set(key, entry);
      const pending = waiting.get(key);
      if (!pending) continue;
      waiting.delete(key);
      for (const activity of pending) attached.add(activity);
      const answered = traces.get(key);
      if (answered) answered.push(...pending);
      else traces.set(key, pending);
    }
  }

  const presentEntry = (entry: ThreadFeedEntry): ThreadFeedEntry[] => {
    if (entry.type === "message") {
      const key = keys.get(entry);
      const activities = key === undefined ? undefined : traces.get(key);
      if (key === undefined || recipients.get(key) !== entry || !activities?.length) {
        return [entry];
      }
      const previousMessage = cache.messages.get(entry);
      if (previousMessage && sameActivities(previousMessage.activities, activities)) {
        return [previousMessage.entry];
      }
      const next = { ...entry, message: { ...entry.message, reasoning: activities } };
      cache.messages.set(entry, { activities, entry: next });
      return [next];
    }
    if (entry.type !== "activity-group") return [entry];
    const previousGroup = cache.groups.get(entry);
    if (mode !== "message" && previousGroup?.mode === mode) return previousGroup.entries;
    if (mode === "working") {
      const groups: ThreadFeedActivity[][] = [];
      for (const activity of entry.activities) {
        const group = groups.at(-1);
        if (group && isReasoning(group[0]!) === isReasoning(activity)) {
          group.push(activity);
        } else {
          groups.push([activity]);
        }
      }
      const entries =
        groups.length === 1
          ? [entry]
          : groups.map((activities) => ({
              ...entry,
              id: `reasoning-source:${activities[0]!.id}`,
              activities,
            }));
      cache.groups.set(entry, { mode, activities: entry.activities, entries });
      return entries;
    }
    const activities = entry.activities.filter(
      (activity) => !isReasoning(activity) || (mode === "message" && !attached.has(activity)),
    );
    if (previousGroup?.mode === mode && sameActivities(previousGroup.activities, activities)) {
      return previousGroup.entries;
    }
    const entries =
      activities.length === 0
        ? []
        : [activities.length === entry.activities.length ? entry : { ...entry, activities }];
    cache.groups.set(entry, { mode, activities, entries });
    return entries;
  };

  for (let index = start; index < feed.length; index += 1) {
    const entry = feed[index]!;
    if (startsRequest(entry)) restarts.push({ entry: index, presented: presented.length });
    presented.push(...presentEntry(entry));
  }
  cache.build = { feed, mode, presented, restarts };
  return presented;
}

export function workingReasoningGroups(feed: ReadonlyArray<ThreadFeedEntry>) {
  const groups = new Map<string, ReadonlyArray<ThreadFeedActivity>>();
  for (const entry of feed) {
    if (
      entry.type !== "activity-group" ||
      !entry.activities.length ||
      !entry.activities.every(isReasoning)
    )
      continue;
    groups.set(`work-group:${entry.activities[0]!.id}`, entry.activities);
  }
  return groups;
}

/** The tapped group's traces, followed by the later traces of its run so a live run keeps streaming in. */
export function workingReasoningForGroup(
  groups: ReadonlyMap<string, ReadonlyArray<ThreadFeedActivity>>,
  groupId: string,
) {
  const group = groups.get(groupId);
  if (!group) return undefined;
  const runId = group[0]?.runId;
  if (runId == null) return group;
  const activities: ThreadFeedActivity[] = [];
  let reached = false;
  for (const [id, candidate] of groups) {
    reached ||= id === groupId;
    if (reached && candidate[0]?.runId === runId) activities.push(...candidate);
  }
  return activities;
}
