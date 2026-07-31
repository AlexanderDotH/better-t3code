// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import type * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeTimers from "node:timers";

import type { WorkspaceContextMatch, WorkspaceContextQueryMode } from "@t3tools/contracts";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

import {
  isWorkspaceContextSearchablePath,
  normalizeWorkspaceContextPath,
  shouldSkipWorkspaceContextDirectory,
} from "./WorkspaceContextPathPolicy.ts";

export const WORKSPACE_CONTEXT_MAX_PATH_ENTRIES = 25_000;
export const WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES = 200;
export const WORKSPACE_CONTEXT_MAX_SOURCE_BYTES = 1024 * 1024;
export const WORKSPACE_CONTEXT_SEARCH_DEADLINE_MS = 2_000;
const WORKSPACE_CONTEXT_MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const WORKSPACE_CONTEXT_CONCURRENCY = 4;
const DEADLINE_REACHED = Symbol("WorkspaceContextDeadlineReached");
const GIT_SECRET_EXCLUDE_PATHS = [
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/id_dsa",
  ":(exclude,glob)**/id_ecdsa",
  ":(exclude,glob)**/id_ed25519",
  ":(exclude,glob)**/id_rsa",
  ":(exclude,glob)**/*.key",
  ":(exclude,glob)**/*.p12",
  ":(exclude,glob)**/*.pfx",
  ":(exclude,glob)**/*.pem",
] as const;

export type WorkspaceContextEngineQuery = {
  readonly text: string;
  readonly mode: WorkspaceContextQueryMode;
  readonly maxResults: number;
};

export type WorkspaceContextEngineQueryResult = {
  readonly text: string;
  readonly mode: WorkspaceContextQueryMode;
  readonly matches: ReadonlyArray<WorkspaceContextMatch>;
  readonly truncated: boolean;
  readonly warnings: ReadonlyArray<string>;
};

export type WorkspaceContextDiscovery = {
  readonly backend: "git" | "filesystem";
  readonly queries: ReadonlyArray<WorkspaceContextEngineQueryResult>;
  readonly truncated: boolean;
  readonly warnings: ReadonlyArray<string>;
  readonly inventoryCount: number;
};

type InventoryEntry = {
  readonly path: string;
  readonly directory: boolean;
};

type WorkspaceInventory = {
  readonly entries: ReadonlyArray<InventoryEntry>;
  readonly filePaths: ReadonlySet<string>;
  readonly truncated: boolean;
};

type GitCommandResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly timedOut: boolean;
  readonly failed: boolean;
};

type ParsedContentMatches = {
  readonly matches: ReadonlyArray<WorkspaceContextMatch>;
  readonly truncated: boolean;
};

type TokenFileCandidate = {
  readonly path: string;
  readonly tokens: Set<string>;
  count: number;
  matchLine: number;
  excerpt: string;
};

function deadlineRemaining(deadlineAt: number): number {
  return Math.max(0, Math.floor(deadlineAt - performance.now()));
}

async function settleBeforeDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
): Promise<T | typeof DEADLINE_REACHED> {
  const remaining = deadlineRemaining(deadlineAt);
  if (remaining === 0) return DEADLINE_REACHED;
  let timeout: ReturnType<typeof NodeTimers.setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE_REACHED>((resolve) => {
    // This Promise-only scanner races node:fs promises before re-entering the Effect service.
    // @effect-diagnostics-next-line globalTimers:off
    timeout = NodeTimers.setTimeout(() => resolve(DEADLINE_REACHED), remaining);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) NodeTimers.clearTimeout(timeout);
  }
}

function runGit(
  workspaceRoot: string,
  args: ReadonlyArray<string>,
  deadlineAt: number,
): Promise<GitCommandResult> {
  const timeout = deadlineRemaining(deadlineAt);
  if (timeout === 0) {
    return Promise.resolve({ code: null, stdout: "", timedOut: true, failed: true });
  }

  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", workspaceRoot, ...args],
      {
        encoding: "utf8",
        maxBuffer: WORKSPACE_CONTEXT_MAX_GIT_OUTPUT_BYTES,
        timeout,
        windowsHide: true,
      },
      (error, stdout) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        const killed = error?.killed === true || error?.signal != null;
        resolve({
          code,
          stdout,
          timedOut: killed,
          failed: error !== null,
        });
      },
    );
  });
}

function parentDirectories(relativePath: string): ReadonlyArray<string> {
  const directories: string[] = [];
  const firstSeparator = relativePath.lastIndexOf("/");
  let parent = firstSeparator < 0 ? "" : relativePath.slice(0, firstSeparator);
  while (parent) {
    directories.push(parent);
    const separator = parent.lastIndexOf("/");
    parent = separator < 0 ? "" : parent.slice(0, separator);
  }
  return directories;
}

function makeInventory(
  rawFilePaths: ReadonlyArray<string>,
  inputTruncated: boolean,
): WorkspaceInventory {
  const entriesByPath = new Map<string, InventoryEntry>();
  let truncated = inputTruncated;

  for (const rawPath of rawFilePaths) {
    const path = normalizeWorkspaceContextPath(rawPath);
    if (!path || !isWorkspaceContextSearchablePath(path)) continue;
    entriesByPath.set(path, { path, directory: false });
    for (const directory of parentDirectories(path)) {
      if (!entriesByPath.has(directory)) {
        entriesByPath.set(directory, { path: directory, directory: true });
      }
    }
    if (entriesByPath.size > WORKSPACE_CONTEXT_MAX_PATH_ENTRIES) {
      truncated = true;
      break;
    }
  }

  const entries = [...entriesByPath.values()]
    .toSorted((left, right) => left.path.localeCompare(right.path))
    .slice(0, WORKSPACE_CONTEXT_MAX_PATH_ENTRIES);
  const filePaths = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.path));
  return { entries, filePaths, truncated: truncated || entries.length < entriesByPath.size };
}

function pathMatchScore(path: string, query: string): number | null {
  const normalizedPath = path.toLowerCase();
  const basename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  const score = (value: string) =>
    scoreQueryMatch({
      value,
      query,
      exactBase: 0,
      prefixBase: 20,
      boundaryBase: 80,
      includesBase: 160,
      fuzzyBase: 320,
    });
  const fullScore = score(normalizedPath);
  const basenameScore = score(basename);
  if (fullScore === null) return basenameScore;
  if (basenameScore === null) return fullScore;
  return Math.min(fullScore, basenameScore);
}

function searchInventory(
  inventory: WorkspaceInventory,
  query: WorkspaceContextEngineQuery,
): ParsedContentMatches {
  const normalizedQuery = normalizeSearchQuery(query.text);
  const ranked: Array<{ item: WorkspaceContextMatch; score: number; tieBreaker: string }> = [];
  let totalMatches = 0;
  for (const entry of inventory.entries) {
    const score = pathMatchScore(entry.path, normalizedQuery);
    if (score === null) continue;
    totalMatches += 1;
    insertRankedSearchResult(
      ranked,
      { item: { path: entry.path, kind: "path" }, score, tieBreaker: entry.path },
      WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES,
    );
  }
  return {
    matches: ranked.slice(0, query.maxResults).map((entry) => entry.item),
    truncated:
      totalMatches > query.maxResults || totalMatches > WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES,
  };
}

function parseGitGrep(stdout: string, allowedPaths: ReadonlySet<string>): ParsedContentMatches {
  const matches: WorkspaceContextMatch[] = [];
  let cursor = 0;
  let truncated = false;
  while (cursor < stdout.length) {
    const pathEnd = stdout.indexOf("\0", cursor);
    if (pathEnd === -1) break;
    const lineEnd = stdout.indexOf("\0", pathEnd + 1);
    if (lineEnd === -1) break;
    const recordEnd = stdout.indexOf("\n", lineEnd + 1);
    const rawPath = stdout.slice(cursor, pathEnd);
    const lineText = stdout.slice(pathEnd + 1, lineEnd);
    const excerpt = stdout.slice(lineEnd + 1, recordEnd === -1 ? stdout.length : recordEnd);
    cursor = recordEnd === -1 ? stdout.length : recordEnd + 1;

    const path = normalizeWorkspaceContextPath(rawPath);
    const matchLine = Number.parseInt(lineText, 10);
    if (!path || !allowedPaths.has(path) || !Number.isSafeInteger(matchLine) || matchLine < 1) {
      continue;
    }
    if (matches.length >= WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES) {
      truncated = true;
      continue;
    }
    matches.push({
      path,
      kind: "content",
      matchLine,
      lineStart: matchLine,
      lineEnd: matchLine,
      excerpt,
    });
  }
  return { matches, truncated };
}

function queryTokens(query: string): ReadonlyArray<string> {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tokens.filter((token) => token.length >= 3))];
}

function rankTokenCandidates(
  candidates: ReadonlyMap<string, TokenFileCandidate>,
  query: WorkspaceContextEngineQuery,
): ReadonlyArray<WorkspaceContextMatch> {
  const normalizedQuery = normalizeSearchQuery(query.text);
  return [...candidates.values()]
    .toSorted((left, right) => {
      const coverage = right.tokens.size - left.tokens.size;
      if (coverage !== 0) return coverage;
      const count = right.count - left.count;
      if (count !== 0) return count;
      const leftScore = pathMatchScore(left.path, normalizedQuery) ?? Number.MAX_SAFE_INTEGER;
      const rightScore = pathMatchScore(right.path, normalizedQuery) ?? Number.MAX_SAFE_INTEGER;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.path.localeCompare(right.path);
    })
    .slice(0, query.maxResults)
    .map((candidate) => ({
      path: candidate.path,
      kind: "content" as const,
      matchLine: candidate.matchLine,
      lineStart: candidate.matchLine,
      lineEnd: candidate.matchLine,
      excerpt: candidate.excerpt,
    }));
}

function tokenMatches(
  matches: ReadonlyArray<WorkspaceContextMatch>,
  tokens: ReadonlyArray<string>,
  query: WorkspaceContextEngineQuery,
): {
  readonly matches: ReadonlyArray<WorkspaceContextMatch>;
  readonly candidateCount: number;
} {
  const candidates = new Map<string, TokenFileCandidate>();
  for (const match of matches) {
    if (match.kind !== "content" || match.matchLine === undefined) continue;
    const excerpt = match.excerpt ?? "";
    const matchedTokens = tokens.filter((token) => excerpt.includes(token));
    if (matchedTokens.length === 0) continue;
    const existing = candidates.get(match.path);
    if (existing) {
      existing.count += 1;
      for (const token of matchedTokens) existing.tokens.add(token);
      continue;
    }
    candidates.set(match.path, {
      path: match.path,
      tokens: new Set(matchedTokens),
      count: 1,
      matchLine: match.matchLine,
      excerpt,
    });
  }

  return {
    matches: rankTokenCandidates(candidates, query),
    candidateCount: candidates.size,
  };
}

async function gitContentSearch(
  workspaceRoot: string,
  inventory: WorkspaceInventory,
  query: WorkspaceContextEngineQuery,
  deadlineAt: number,
): Promise<ParsedContentMatches & { readonly warnings: ReadonlyArray<string> }> {
  const literal = await runGit(
    workspaceRoot,
    [
      "grep",
      "-n",
      "-I",
      "-F",
      "-z",
      "--untracked",
      "--exclude-standard",
      "-e",
      query.text,
      "--",
      ".",
      ...GIT_SECRET_EXCLUDE_PATHS,
    ],
    deadlineAt,
  );
  if (literal.timedOut) {
    return { matches: [], truncated: true, warnings: ["Content search reached its deadline."] };
  }
  if (literal.failed && literal.code !== 1) {
    return {
      matches: [],
      truncated: false,
      warnings: ["One content search could not be completed."],
    };
  }
  const parsedLiteral = parseGitGrep(literal.stdout, inventory.filePaths);
  if (parsedLiteral.matches.length > 0) {
    return {
      matches: parsedLiteral.matches.slice(0, query.maxResults),
      truncated: parsedLiteral.truncated || parsedLiteral.matches.length > query.maxResults,
      warnings: [],
    };
  }

  const tokens = queryTokens(query.text);
  if (tokens.length < 2) return { matches: [], truncated: false, warnings: [] };
  const tokenResult = await runGit(
    workspaceRoot,
    [
      "grep",
      "-n",
      "-I",
      "-F",
      "-z",
      "--untracked",
      "--exclude-standard",
      ...tokens.flatMap((token) => ["-e", token]),
      "--",
      ".",
      ...GIT_SECRET_EXCLUDE_PATHS,
    ],
    deadlineAt,
  );
  if (tokenResult.timedOut) {
    return { matches: [], truncated: true, warnings: ["Content search reached its deadline."] };
  }
  if (tokenResult.failed && tokenResult.code !== 1) {
    return {
      matches: [],
      truncated: false,
      warnings: ["One content search could not be completed."],
    };
  }
  const parsedTokens = parseGitGrep(tokenResult.stdout, inventory.filePaths);
  const rankedTokens = tokenMatches(parsedTokens.matches, tokens, query);
  return {
    matches: rankedTokens.matches,
    truncated:
      parsedTokens.truncated ||
      rankedTokens.candidateCount > query.maxResults ||
      parsedTokens.matches.length > WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES,
    warnings: [],
  };
}

function mergeAutoMatches(
  content: ReadonlyArray<WorkspaceContextMatch>,
  paths: ReadonlyArray<WorkspaceContextMatch>,
  limit: number,
): ReadonlyArray<WorkspaceContextMatch> {
  const byPath = new Map<string, WorkspaceContextMatch>();
  for (const match of content) {
    if (!byPath.has(match.path)) byPath.set(match.path, match);
  }
  for (const match of paths) {
    if (!byPath.has(match.path)) byPath.set(match.path, match);
  }
  return [...byPath.values()].slice(0, limit);
}

async function mapConcurrent<A, B>(
  values: ReadonlyArray<A>,
  concurrency: number,
  f: (value: A, index: number) => Promise<B>,
): Promise<ReadonlyArray<B>> {
  const results = Array.from<B | undefined>({ length: values.length });
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await f(value, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results as B[];
}

async function discoverGit(
  workspaceRoot: string,
  queries: ReadonlyArray<WorkspaceContextEngineQuery>,
  deadlineAt: number,
): Promise<WorkspaceContextDiscovery | null> {
  const inventoryCommand = await runGit(
    workspaceRoot,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
    deadlineAt,
  );
  if (inventoryCommand.failed) return null;
  const rawPaths = inventoryCommand.stdout.split("\0");
  const inventory = makeInventory(
    rawPaths.slice(0, WORKSPACE_CONTEXT_MAX_PATH_ENTRIES + 1),
    rawPaths.length - 1 > WORKSPACE_CONTEXT_MAX_PATH_ENTRIES,
  );
  const queryResults = await mapConcurrent(
    queries,
    WORKSPACE_CONTEXT_CONCURRENCY,
    async (query): Promise<WorkspaceContextEngineQueryResult> => {
      const pathResult =
        query.mode === "content"
          ? { matches: [], truncated: false }
          : searchInventory(inventory, query);
      const contentResult =
        query.mode === "path"
          ? { matches: [], truncated: false, warnings: [] }
          : await gitContentSearch(workspaceRoot, inventory, query, deadlineAt);
      const matches =
        query.mode === "auto"
          ? mergeAutoMatches(contentResult.matches, pathResult.matches, query.maxResults)
          : query.mode === "content"
            ? contentResult.matches
            : pathResult.matches;
      return {
        text: query.text,
        mode: query.mode,
        matches,
        truncated: inventory.truncated || pathResult.truncated || contentResult.truncated,
        warnings: contentResult.warnings,
      };
    },
  );
  return {
    backend: "git",
    queries: queryResults,
    truncated: inventory.truncated || queryResults.some((query) => query.truncated),
    warnings: inventory.truncated ? ["Workspace inventory reached its 25,000-entry limit."] : [],
    inventoryCount: inventory.entries.length,
  };
}

async function scanFilesystem(
  workspaceRoot: string,
  deadlineAt: number,
): Promise<{ readonly inventory: WorkspaceInventory; readonly deadlineReached: boolean }> {
  const pendingDirectories = [workspaceRoot];
  const filePaths: string[] = [];
  let deadlineReached = false;
  let hitEntryLimit = false;
  while (pendingDirectories.length > 0) {
    if (deadlineRemaining(deadlineAt) === 0) {
      deadlineReached = true;
      break;
    }
    const directory = pendingDirectories.pop();
    if (!directory) break;
    let entries: NodeFS.Dirent<string>[];
    try {
      const result = await settleBeforeDeadline(
        NodeFSP.readdir(directory, { withFileTypes: true, encoding: "utf8" }),
        deadlineAt,
      );
      if (result === DEADLINE_REACHED) {
        deadlineReached = true;
        break;
      }
      entries = result;
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = NodePath.join(directory, entry.name);
      const relativePath = normalizeWorkspaceContextPath(
        NodePath.relative(workspaceRoot, absolutePath),
      );
      if (!relativePath) continue;
      if (entry.isDirectory()) {
        if (!shouldSkipWorkspaceContextDirectory(entry.name)) pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isWorkspaceContextSearchablePath(relativePath)) continue;
      filePaths.push(relativePath);
      if (filePaths.length > WORKSPACE_CONTEXT_MAX_PATH_ENTRIES) {
        hitEntryLimit = true;
        break;
      }
    }
    if (hitEntryLimit) break;
  }
  return {
    inventory: makeInventory(
      filePaths.slice(0, WORKSPACE_CONTEXT_MAX_PATH_ENTRIES),
      hitEntryLimit || deadlineReached,
    ),
    deadlineReached,
  };
}

async function readFallbackFile(
  workspaceRoot: string,
  relativePath: string,
  deadlineAt: number,
): Promise<string | null> {
  const absolutePath = NodePath.join(workspaceRoot, relativePath);
  const operation = (async () => {
    try {
      const realPath = await NodeFSP.realpath(absolutePath);
      const relativeRealPath = NodePath.relative(workspaceRoot, realPath);
      if (
        relativeRealPath === ".." ||
        relativeRealPath.startsWith(`..${NodePath.sep}`) ||
        NodePath.isAbsolute(relativeRealPath)
      ) {
        return null;
      }
      const stat = await NodeFSP.stat(realPath);
      if (!stat.isFile() || stat.size > WORKSPACE_CONTEXT_MAX_SOURCE_BYTES) return null;
      const bytes = await NodeFSP.readFile(realPath);
      if (bytes.includes(0)) return null;
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return null;
    }
  })();
  const result = await settleBeforeDeadline(operation, deadlineAt);
  return result === DEADLINE_REACHED ? null : result;
}

function addFallbackMatches(
  contents: string,
  relativePath: string,
  query: WorkspaceContextEngineQuery,
  literalMatches: WorkspaceContextMatch[],
  tokenCandidates: Map<string, TokenFileCandidate>,
  deadlineAt: number,
): boolean {
  const tokens = queryTokens(query.text);
  let truncated = false;
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (index % 128 === 0 && deadlineRemaining(deadlineAt) === 0) return true;
    const line = lines[index] ?? "";
    if (line.includes(query.text)) {
      if (literalMatches.length < WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES) {
        literalMatches.push({
          path: relativePath,
          kind: "content",
          matchLine: index + 1,
          lineStart: index + 1,
          lineEnd: index + 1,
          excerpt: line,
        });
      } else {
        truncated = true;
      }
    }
    const matchedTokens = tokens.filter((token) => line.includes(token));
    if (matchedTokens.length === 0) continue;
    const existing = tokenCandidates.get(relativePath);
    if (existing) {
      existing.count += 1;
      for (const token of matchedTokens) existing.tokens.add(token);
      continue;
    }
    if (tokenCandidates.size >= WORKSPACE_CONTEXT_MAX_INTERNAL_CANDIDATES) {
      truncated = true;
      continue;
    }
    tokenCandidates.set(relativePath, {
      path: relativePath,
      tokens: new Set(matchedTokens),
      count: 1,
      matchLine: index + 1,
      excerpt: line,
    });
  }
  return truncated;
}

async function discoverFilesystem(
  workspaceRoot: string,
  queries: ReadonlyArray<WorkspaceContextEngineQuery>,
  deadlineAt: number,
): Promise<WorkspaceContextDiscovery> {
  const scan = await scanFilesystem(workspaceRoot, deadlineAt);
  const contentQueries = queries.filter((query) => query.mode !== "path");
  const literalByQuery = new Map(
    contentQueries.map((query) => [query, [] as WorkspaceContextMatch[]]),
  );
  const tokensByQuery = new Map(
    contentQueries.map((query) => [query, new Map<string, TokenFileCandidate>()]),
  );
  const truncatedQueries = new Set<WorkspaceContextEngineQuery>();
  const filePaths = [...scan.inventory.filePaths];
  for (let offset = 0; offset < filePaths.length; offset += WORKSPACE_CONTEXT_CONCURRENCY) {
    if (deadlineRemaining(deadlineAt) === 0) break;
    const batch = filePaths.slice(offset, offset + WORKSPACE_CONTEXT_CONCURRENCY);
    const files = await Promise.all(
      batch.map(async (relativePath) => ({
        relativePath,
        contents: await readFallbackFile(workspaceRoot, relativePath, deadlineAt),
      })),
    );
    for (const file of files) {
      if (file.contents === null) continue;
      for (const query of contentQueries) {
        const literal = literalByQuery.get(query);
        const tokens = tokensByQuery.get(query);
        if (!literal || !tokens) continue;
        if (
          addFallbackMatches(file.contents, file.relativePath, query, literal, tokens, deadlineAt)
        ) {
          truncatedQueries.add(query);
        }
      }
    }
  }
  const deadlineReached = scan.deadlineReached || deadlineRemaining(deadlineAt) === 0;
  const results = queries.map((query): WorkspaceContextEngineQueryResult => {
    const pathResult =
      query.mode === "content"
        ? { matches: [], truncated: false }
        : searchInventory(scan.inventory, query);
    const literalMatches = literalByQuery.get(query) ?? [];
    const tokenCandidates = tokensByQuery.get(query) ?? new Map<string, TokenFileCandidate>();
    const contentMatches =
      literalMatches.length > 0
        ? literalMatches.slice(0, query.maxResults)
        : rankTokenCandidates(tokenCandidates, query);
    const matches =
      query.mode === "auto"
        ? mergeAutoMatches(contentMatches, pathResult.matches, query.maxResults)
        : query.mode === "content"
          ? contentMatches
          : pathResult.matches;
    return {
      text: query.text,
      mode: query.mode,
      matches,
      truncated:
        scan.inventory.truncated ||
        deadlineReached ||
        pathResult.truncated ||
        truncatedQueries.has(query) ||
        literalMatches.length > query.maxResults ||
        (literalMatches.length === 0 && tokenCandidates.size > query.maxResults),
      warnings: deadlineReached ? ["Content search reached its deadline."] : [],
    };
  });
  const warnings = ["Git inventory unavailable; used filesystem fallback."];
  if (scan.inventory.truncated) warnings.push("Workspace inventory was truncated.");
  if (deadlineReached) warnings.push("Workspace search reached its deadline.");
  return {
    backend: "filesystem",
    queries: results,
    truncated:
      scan.inventory.truncated || deadlineReached || results.some((query) => query.truncated),
    warnings,
    inventoryCount: scan.inventory.entries.length,
  };
}

export async function discoverWorkspaceContext(input: {
  readonly workspaceRoot: string;
  readonly queries: ReadonlyArray<WorkspaceContextEngineQuery>;
}): Promise<WorkspaceContextDiscovery> {
  const deadlineAt = performance.now() + WORKSPACE_CONTEXT_SEARCH_DEADLINE_MS;
  const git = await discoverGit(input.workspaceRoot, input.queries, deadlineAt);
  if (git) return git;
  return discoverFilesystem(input.workspaceRoot, input.queries, deadlineAt);
}

/** Internal deterministic boundaries exposed only for focused unit tests. */
export const __testing = {
  discoverFilesystem,
  makeInventory,
};
