import type { ExtensionCatalogEntry } from "@t3tools/contracts";

export function normalizeCatalogQuery(query: string) {
  return query.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

export function levenshteinDistance(left: string, right: string, limit = Infinity) {
  if (Math.abs(left.length - right.length) > limit * 2) return limit + 1;
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = Array.from({ length: b.length + 1 }, () => 0);
  for (let row = 1; row <= a.length; row++) {
    current[0] = row;
    let minimum = row;
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      minimum = Math.min(minimum, current[column]!);
    }
    if (minimum > limit) return limit + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length]!;
}

function searchText(value: string) {
  return normalizeCatalogQuery(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenScore(query: string, candidate: string) {
  if (candidate === query) return 10;
  if (candidate.startsWith(query)) return 9;
  if (candidate.includes(query)) return 8;
  const limit = query.length >= 5 ? 2 : query.length >= 3 ? 1 : 0;
  if (!limit || query.length > 64) return 0;
  const distance = levenshteinDistance(query, candidate, limit);
  return distance <= limit ? 6 - distance : 0;
}

function entryScore(entry: ExtensionCatalogEntry, query: string, terms: readonly string[]) {
  const names = [
    searchText(entry.name),
    searchText((entry.kind === "mcp" ? entry.source : entry.id).split("/").at(-1) ?? ""),
  ];
  if (names.includes(query)) return 100_000;
  if (names.some((name) => name.startsWith(query))) return 90_000;
  if (names.some((name) => name.includes(query))) return 80_000;
  const fields = [
    { text: names.join(" "), weight: 4 },
    { text: searchText(entry.source), weight: 2 },
    { text: searchText(entry.description), weight: 1 },
  ].map((field) => ({ words: [...new Set(field.text.split(" "))], weight: field.weight }));
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const field of fields) {
      for (const word of field.words) best = Math.max(best, field.weight * tokenScore(term, word));
    }
    if (!best) return 0;
    score += best;
  }
  return score;
}

export function rankCatalogEntries(
  entries: readonly ExtensionCatalogEntry[],
  query: string,
  options: { includeUnmatched?: boolean } = {},
) {
  const normalized = searchText(query);
  if (!normalized) return [...entries];
  const terms = [...new Set(normalized.split(" "))];
  return entries
    .map((entry, index) => ({ entry, index, score: entryScore(entry, normalized, terms) }))
    .filter((match) => match.score > 0 || options.includeUnmatched)
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map((match) => match.entry);
}

export function catalogCandidateQueries(query: string) {
  const words = searchText(query)
    .split(" ")
    .filter((word) => word.length >= 2);
  if (words.length > 1)
    return [...new Set(words)].toSorted((a, b) => b.length - a.length).slice(0, 3);
  const word = words[0];
  if (!word || word.length > 64) return [];
  if (word.length <= 4)
    return [...new Set([word.slice(0, -1), word.slice(1)])].filter((part) => part.length >= 2);
  const size = Math.ceil(word.length / 3);
  return [
    ...new Set([word.slice(0, size), word.slice(size, size * 2), word.slice(size * 2)]),
  ].filter((part) => part.length >= (word.length >= 8 ? 3 : 2) && part !== word);
}
