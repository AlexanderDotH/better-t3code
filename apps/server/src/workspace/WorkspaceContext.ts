// @effect-diagnostics nodeBuiltinImport:off
/**
 * Deterministic, watcher-free repository discovery and batched workspace reads.
 *
 * The trusted workspace root comes from authenticated server state, never from
 * the public tool input. Explicit reads delegate to WorkspaceFileSystem so its
 * path, symlink, binary, and size boundaries remain the single source of truth.
 */
import * as NodeFSP from "node:fs/promises";

import type {
  WorkspaceContextInput,
  WorkspaceContextMatch,
  WorkspaceContextQueryResult,
  WorkspaceContextReadResult,
  WorkspaceContextResult,
} from "@t3tools/contracts";
import {
  WORKSPACE_CONTEXT_DEFAULT_CONTEXT_LINES,
  WORKSPACE_CONTEXT_DEFAULT_RESULTS_PER_QUERY,
  WORKSPACE_CONTEXT_MAX_READ_LINES,
  WorkspaceContextPathError,
  WorkspaceContextSearchError,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  discoverWorkspaceContext,
  type WorkspaceContextDiscovery,
  type WorkspaceContextEngineQuery,
} from "./WorkspaceContextEngine.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";

export {
  WorkspaceContextPathError,
  WorkspaceContextSearchError,
  WorkspaceContextUnavailableError,
} from "@t3tools/contracts";

export const WORKSPACE_CONTEXT_MAX_RESPONSE_TEXT_BYTES = 64 * 1024;
const WORKSPACE_CONTEXT_READ_CONCURRENCY = 4;

type WorkspaceContextExecutionError =
  | WorkspaceContextUnavailableError
  | WorkspaceContextPathError
  | WorkspaceContextSearchError;

type CachedRead =
  | {
      readonly status: "ok";
      readonly path: string;
      readonly contents: string;
      readonly sourceTruncated: boolean;
    }
  | {
      readonly status: "error";
      readonly path: string;
      readonly error: "not_found" | "binary" | "unreadable";
      readonly message: string;
    };

type MutableMatch = {
  path: string;
  kind: "path" | "content";
  matchLine?: number | undefined;
  lineStart?: number | undefined;
  lineEnd?: number | undefined;
  excerpt?: string | undefined;
};

type MutableQueryResult = {
  text: string;
  mode: "auto" | "path" | "content";
  matches: MutableMatch[];
  truncated: boolean;
  warnings: string[];
};

type MutableReadResult =
  | {
      status: "ok";
      path: string;
      lineStart: number;
      lineEnd: number;
      text: string;
      truncated: boolean;
    }
  | {
      status: "error";
      path: string;
      error: "not_found" | "binary" | "unreadable";
      message: string;
    };

type TextSlot = {
  readonly get: () => string;
  readonly truncate: (maxBytes: number) => boolean;
};

function nodeErrorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

const validateWorkspaceRoot = Effect.fn("WorkspaceContext.validateWorkspaceRoot")(function* (
  workspaceRoot: string,
) {
  const realRoot = yield* Effect.tryPromise({
    try: () => NodeFSP.realpath(workspaceRoot),
    catch: (cause) =>
      new WorkspaceContextUnavailableError({
        reason:
          nodeErrorCode(cause) === "ENOENT"
            ? "workspace_root_not_found"
            : "workspace_root_unreadable",
        cause,
      }),
  });
  const stat = yield* Effect.tryPromise({
    try: () => NodeFSP.stat(realRoot),
    catch: (cause) =>
      new WorkspaceContextUnavailableError({
        reason: "workspace_root_unreadable",
        cause,
      }),
  });
  if (!stat.isDirectory()) {
    return yield* new WorkspaceContextUnavailableError({
      reason: "workspace_root_not_directory",
    });
  }
  return realRoot;
});

function mapReadFailure(
  relativePath: string,
  error: WorkspaceFileSystem.WorkspaceFileSystemError | { readonly _tag: string },
): Effect.Effect<CachedRead, WorkspaceContextPathError> {
  if (
    error._tag === "WorkspacePathOutsideRootError" ||
    error._tag === "WorkspaceFilePathEscapeError"
  ) {
    return Effect.fail(
      new WorkspaceContextPathError({ relativePath, reason: "path_outside_root" }),
    );
  }
  if (error._tag === "WorkspaceBinaryFileError") {
    return Effect.succeed({
      status: "error",
      path: relativePath,
      error: "binary",
      message: "Workspace file is binary.",
    });
  }
  if (
    error._tag === "WorkspaceFileSystemOperationError" &&
    "cause" in error &&
    nodeErrorCode(error.cause) === "ENOENT"
  ) {
    return Effect.succeed({
      status: "error",
      path: relativePath,
      error: "not_found",
      message: "Workspace file was not found.",
    });
  }
  return Effect.succeed({
    status: "error",
    path: relativePath,
    error: "unreadable",
    message: "Workspace file could not be read.",
  });
}

function splitLines(contents: string): ReadonlyArray<string> {
  return contents.split(/\r?\n/);
}

function explicitReadResult(
  input: NonNullable<WorkspaceContextInput["reads"]>[number],
  read: CachedRead,
): MutableReadResult {
  if (read.status === "error") return { ...read };
  const startLine = input.startLine ?? 1;
  const requestedEnd = input.endLine;
  const maximumEnd = startLine + WORKSPACE_CONTEXT_MAX_READ_LINES - 1;
  const effectiveEnd = Math.min(requestedEnd ?? maximumEnd, maximumEnd);
  const lines = splitLines(read.contents);
  const selected = startLine <= lines.length ? lines.slice(startLine - 1, effectiveEnd) : [];
  const lineEnd = selected.length > 0 ? startLine + selected.length - 1 : startLine;
  const rangeTruncated =
    (requestedEnd !== undefined && requestedEnd > maximumEnd) ||
    (requestedEnd === undefined && lines.length > effectiveEnd);
  return {
    status: "ok",
    path: read.path,
    lineStart: startLine,
    lineEnd,
    text: selected.join("\n"),
    truncated: read.sourceTruncated || rangeTruncated,
  };
}

function hydrateMatch(
  match: WorkspaceContextMatch,
  cachedRead: CachedRead | undefined,
  contextLines: number,
): MutableMatch {
  if (match.kind !== "content" || match.matchLine === undefined || cachedRead?.status !== "ok") {
    return { ...match };
  }
  const lines = splitLines(cachedRead.contents);
  if (match.matchLine > lines.length) return { ...match };
  const lineStart = Math.max(1, match.matchLine - contextLines);
  const lineEnd = Math.min(lines.length, match.matchLine + contextLines);
  return {
    ...match,
    lineStart,
    lineEnd,
    excerpt: lines.slice(lineStart - 1, lineEnd).join("\n"),
  };
}

function truncateUtf8(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(input) <= maxBytes) return input;
  let low = 0;
  let high = input.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(input.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return input.slice(0, low);
}

function makeBudgetSlots(
  queries: MutableQueryResult[],
  reads: MutableReadResult[],
): ReadonlyArray<TextSlot> {
  const groups: TextSlot[][] = [];
  for (const read of reads) {
    if (read.status !== "ok") continue;
    groups.push([
      {
        get: () => read.text,
        truncate: (maxBytes) => {
          const next = truncateUtf8(read.text, maxBytes);
          if (next === read.text) return false;
          read.text = next;
          read.truncated = true;
          return true;
        },
      },
    ]);
  }
  for (const query of queries) {
    const slots = query.matches.flatMap((match): TextSlot[] => {
      if (match.excerpt === undefined) return [];
      return [
        {
          get: () => match.excerpt ?? "",
          truncate: (maxBytes) => {
            const current = match.excerpt ?? "";
            const next = truncateUtf8(current, maxBytes);
            if (next === current) return false;
            match.excerpt = next;
            query.truncated = true;
            return true;
          },
        },
      ];
    });
    if (slots.length > 0) groups.push(slots);
  }

  const ordered: TextSlot[] = [];
  for (let offset = 0; groups.some((group) => offset < group.length); offset += 1) {
    for (const group of groups) {
      const slot = group[offset];
      if (slot) ordered.push(slot);
    }
  }
  return ordered;
}

function applyTextBudget(queries: MutableQueryResult[], reads: MutableReadResult[]): boolean {
  const slots = makeBudgetSlots(queries, reads);
  let remaining = WORKSPACE_CONTEXT_MAX_RESPONSE_TEXT_BYTES;
  let truncated = false;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot) continue;
    const fairShare = Math.floor(remaining / (slots.length - index));
    if (slot.truncate(fairShare)) truncated = true;
    remaining -= Buffer.byteLength(slot.get());
  }
  return truncated;
}

function engineQueries(input: WorkspaceContextInput): ReadonlyArray<WorkspaceContextEngineQuery> {
  return (input.queries ?? []).map((query) => ({
    text: query.text,
    mode: query.mode ?? "auto",
    maxResults: input.maxResultsPerQuery ?? WORKSPACE_CONTEXT_DEFAULT_RESULTS_PER_QUERY,
  }));
}

function contentMatchPaths(discovery: WorkspaceContextDiscovery): ReadonlyArray<string> {
  return discovery.queries.flatMap((query) =>
    query.matches.flatMap((match) => (match.kind === "content" ? [match.path] : [])),
  );
}

export class WorkspaceContext extends Context.Service<
  WorkspaceContext,
  {
    readonly execute: (request: {
      readonly workspaceRoot: string;
      readonly input: WorkspaceContextInput;
    }) => Effect.Effect<WorkspaceContextResult, WorkspaceContextExecutionError>;
  }
>()("t3/workspace/WorkspaceContext") {}

export const make = Effect.gen(function* () {
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;

  const execute: WorkspaceContext["Service"]["execute"] = Effect.fn("WorkspaceContext.execute")(
    function* (request) {
      const workspaceRoot = yield* validateWorkspaceRoot(request.workspaceRoot);
      const queries = engineQueries(request.input);
      const discovery = yield* Effect.tryPromise({
        try: () => discoverWorkspaceContext({ workspaceRoot, queries }),
        catch: (cause) =>
          new WorkspaceContextSearchError({
            backend: "filesystem",
            operation: "inventory",
            reason: "operation_failed",
            cause,
          }),
      });

      const requestedPaths = [
        ...contentMatchPaths(discovery),
        ...(request.input.reads ?? []).map((read) => read.path),
      ];
      const uniquePaths = [...new Set(requestedPaths)];
      const cachedReads = yield* Effect.forEach(
        uniquePaths,
        (relativePath) =>
          workspaceFileSystem.readFile({ cwd: workspaceRoot, relativePath }).pipe(
            Effect.map(
              (read): CachedRead => ({
                status: "ok",
                path: read.relativePath,
                contents: read.contents,
                sourceTruncated: read.truncated,
              }),
            ),
            Effect.catch((error) => mapReadFailure(relativePath, error)),
            Effect.map((read) => [relativePath, read] as const),
          ),
        { concurrency: WORKSPACE_CONTEXT_READ_CONCURRENCY },
      );
      const readByPath = new Map(cachedReads);
      const contextLines = request.input.contextLines ?? WORKSPACE_CONTEXT_DEFAULT_CONTEXT_LINES;
      const queryResults: MutableQueryResult[] = discovery.queries.map((query) => {
        const failedContextRead = query.matches.some(
          (match) => match.kind === "content" && readByPath.get(match.path)?.status === "error",
        );
        return {
          text: query.text,
          mode: query.mode,
          matches: query.matches.map((match) =>
            hydrateMatch(match, readByPath.get(match.path), contextLines),
          ),
          truncated: query.truncated,
          warnings: failedContextRead
            ? [...query.warnings, "Some match context could not be loaded."]
            : [...query.warnings],
        };
      });
      const readResults: MutableReadResult[] = (request.input.reads ?? []).map((read) => {
        const cached = readByPath.get(read.path);
        if (cached) return explicitReadResult(read, cached);
        return {
          status: "error",
          path: read.path,
          error: "unreadable",
          message: "Workspace file could not be read.",
        };
      });
      const budgetTruncated = applyTextBudget(queryResults, readResults);
      const truncated =
        discovery.truncated ||
        budgetTruncated ||
        queryResults.some((query) => query.truncated) ||
        readResults.some((read) => read.status === "ok" && read.truncated);

      yield* Effect.annotateCurrentSpan({
        backend: discovery.backend,
        inventoryCount: discovery.inventoryCount,
        queryCount: queryResults.length,
        matchCount: queryResults.reduce((count, query) => count + query.matches.length, 0),
        readCount: readResults.length,
        truncated,
      });

      return {
        queries: queryResults as WorkspaceContextQueryResult[],
        reads: readResults as WorkspaceContextReadResult[],
        truncated,
        warnings: [...discovery.warnings],
      } satisfies WorkspaceContextResult;
    },
  );

  return WorkspaceContext.of({ execute });
});

export const layer = Layer.effect(WorkspaceContext, make);
