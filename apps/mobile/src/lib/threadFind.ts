import type { ThreadFeedEntry } from "./threadActivity";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { assistantQuoteSourceText } from "./assistantQuote";

export interface TextMatch {
  readonly start: number;
  readonly end: number;
}
export interface ThreadFindMatch extends TextMatch {
  readonly entryId: string;
}

export function findTextMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function nextFindMatchIndex(index: number, direction: 1 | -1, count: number) {
  if (count === 0) return -1;
  if (index < 0) return direction === 1 ? 0 : count - 1;
  return (index + direction + count) % count;
}

export function findMatchLineOffset(
  text: string,
  start: number,
  lines: ReadonlyArray<{ readonly text: string; readonly y: number }>,
) {
  let cursor = 0;
  for (const line of lines) {
    const offset = text.indexOf(line.text, cursor);
    const lineStart = offset === -1 ? cursor : offset;
    const end = lineStart + line.text.length;
    if (start < end) return line.y;
    cursor = end;
  }
  return null;
}

export function reconcileFindMatchIndex(
  matches: ReadonlyArray<ThreadFindMatch>,
  selected: ThreadFindMatch | null,
) {
  if (selected) {
    const index = matches.findIndex(
      (match) => match.entryId === selected.entryId && match.start === selected.start,
    );
    if (index >= 0) return index;
  }
  return matches.length ? 0 : -1;
}

export function createThreadFindIndex() {
  const entries = new WeakMap<ThreadFeedEntry, { query: string; matches: ThreadFindMatch[] }>();
  const textByEntry = new WeakMap<ThreadFeedEntry, string>();
  const text = (entry: ThreadFeedEntry) => {
    const previous = textByEntry.get(entry);
    if (previous !== undefined) return previous;
    const source =
      entry.type === "message"
        ? assistantQuoteSourceText(assistantCitationsToPlainText(entry.message.text))
        : entry.type === "activity-group"
          ? entry.activities
              .map((activity) => [activity.summary, activity.detail].filter(Boolean).join("\n"))
              .join("\n\n")
          : "";
    textByEntry.set(entry, source);
    return source;
  };
  const find = (
    feed: ReadonlyArray<ThreadFeedEntry>,
    query: string,
  ): ReadonlyArray<ThreadFindMatch> => {
    if (!query) return [];
    return feed.flatMap((entry) => {
      const previous = entries.get(entry);
      if (previous?.query === query) return previous.matches;
      const matches = findTextMatches(text(entry), query).map((match) => ({
        ...match,
        entryId: entry.id,
      }));
      entries.set(entry, { query, matches });
      return matches;
    });
  };
  return Object.assign(find, { text });
}
