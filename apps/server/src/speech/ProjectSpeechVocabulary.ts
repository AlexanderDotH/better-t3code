// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { SpeechVocabularyEntry } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { ServerConfig } from "../config.ts";
import { extractKnowledgeGraphManifestDependencies } from "../knowledge-graph/extraction/KnowledgeGraphManifestAnalysis.ts";
import { isEligibleKnowledgeGraphFile } from "../knowledge-graph/extraction/KnowledgeGraphPathPolicy.ts";
import {
  extractKnowledgeGraphImports,
  extractKnowledgeGraphSymbols,
  knowledgeGraphDependencyNameFromSpecifier,
  knowledgeGraphLanguageForPath,
} from "../knowledge-graph/extraction/KnowledgeGraphSourceAnalysis.ts";
import { isIgnoredProjectSpeechPath } from "./ProjectSpeechPathPolicy.ts";
import { ProjectSpeechWorkspaceScanner } from "./ProjectSpeechWorkspaceScanner.ts";

export const SPEECH_VOCABULARY_VERSION = 1;
export const SPEECH_VOCABULARY_REFRESH_INTERVAL_MS = 60_000;
export const SPEECH_VOCABULARY_CONTEXT_ENTRY_LIMIT = 200;
export const SPEECH_VOCABULARY_CONTEXT_CHAR_LIMIT = 16_000;
const MAX_SOURCE_FILE_BYTES = 1_048_576;
const MAX_CACHE_BYTES = 32 * 1_048_576;
const MAX_INDEX_ENTRIES = 100_000;
const MAX_SYMBOLS_PER_FILE = 128;
const MAX_CACHED_WORKSPACES = 16;
const MAX_STREAMING_KEYTERMS = 100;
const MAX_STREAMING_KEYTERM_CHARS = 50;

const CachedFile = Schema.Struct({
  path: Schema.String,
  fingerprint: Schema.String,
  entries: Schema.Array(SpeechVocabularyEntry),
});
type CachedFile = typeof CachedFile.Type;

const CachedVocabulary = Schema.Struct({
  version: Schema.Literal(SPEECH_VOCABULARY_VERSION),
  workspaceRoot: Schema.String,
  truncated: Schema.Boolean,
  files: Schema.Array(CachedFile),
});
type CachedVocabulary = typeof CachedVocabulary.Type;
const decodeCache = Schema.decodeUnknownOption(Schema.fromJsonString(CachedVocabulary));
const encodeCache = Schema.encodeEffect(Schema.fromJsonString(CachedVocabulary));

export interface ProjectSpeechVocabularySnapshot {
  readonly version: number;
  readonly entries: readonly SpeechVocabularyEntry[];
  readonly truncated: boolean;
}

export interface SpeechVocabularyContext {
  readonly entries: readonly SpeechVocabularyEntry[];
  readonly context: string;
  readonly truncated: boolean;
}

export class ProjectSpeechVocabularyError extends Schema.TaggedError<ProjectSpeechVocabularyError>()(
  "ProjectSpeechVocabularyError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The project speech vocabulary could not be refreshed.";
  }
}

export class ProjectSpeechVocabulary extends Context.Service<
  ProjectSpeechVocabulary,
  {
    readonly snapshot: (input: {
      readonly workspaceRoot: string;
    }) => Effect.Effect<ProjectSpeechVocabularySnapshot>;
    readonly refresh: (input: {
      readonly workspaceRoot: string;
    }) => Effect.Effect<ProjectSpeechVocabularySnapshot, ProjectSpeechVocabularyError>;
    readonly refreshInBackground: (input: {
      readonly workspaceRoot: string;
    }) => Effect.Effect<void>;
  }
>()("t3/speech/ProjectSpeechVocabulary") {}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left: SpeechVocabularyEntry, right: SpeechVocabularyEntry): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.kind, right.kind) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.name, right.name)
  );
}

function validRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !NodePath.posix.isAbsolute(path) &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes("\\") &&
    !path.split("/").some((segment) => segment === ".." || segment === "." || segment === "") &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    !isIgnoredProjectSpeechPath(path)
  );
}

function classifySymbol(line: string): SpeechVocabularyEntry["kind"] {
  if (/\b(?:class|struct|record)\s/u.test(line)) return "class";
  if (/\b(?:interface|type|enum|trait|protocol)\s/u.test(line)) return "type";
  if (/\b(?:function|func|fn|fun|def)\s|=>/u.test(line)) return "function";
  return "variable";
}

function isUsableName(name: string): boolean {
  return (
    name.length > 1 &&
    name.length <= 200 &&
    /^[\p{L}\p{N}_@$./:+-]+$/u.test(name) &&
    !name.includes("://") &&
    !/^(?:gh[pousr]_|github_pat_|sk[-_]|xox[baprs]-|AKIA[0-9A-Z])/u.test(name)
  );
}

export function extractSpeechVocabularyFile(input: {
  readonly path: string;
  readonly content: string;
}): readonly SpeechVocabularyEntry[] {
  if (!validRelativePath(input.path)) return [];
  const entries: SpeechVocabularyEntry[] = [
    { kind: "file", name: NodePath.posix.basename(input.path), path: input.path },
  ];
  const lines = input.content.split(/\r?\n/u);
  const source = { ...input, path: input.path.replace(/\.[cm](js|ts)$/u, ".$1") };
  const symbols = [...extractKnowledgeGraphSymbols(source)];
  const language = knowledgeGraphLanguageForPath(source.path);
  for (const [index, line] of lines.entries()) {
    if (language === undefined || symbols.length >= MAX_SYMBOLS_PER_FILE) break;
    const name =
      language === "Python"
        ? /^([A-Za-z_]\w*)\s*(?::[^=]+)?=/u.exec(line)?.[1]
        : /^\s*(?:(?:export|public|private|internal|pub|static|final)\s+)*(?:let|var|val|const|func|struct|protocol|class)\s+([A-Za-z_$][\w$]*)/u.exec(
            line,
          )?.[1];
    if (name && !symbols.some((symbol) => symbol.name === name)) {
      symbols.push({ name, line: index + 1 });
    }
  }
  for (const symbol of symbols) {
    if (!isUsableName(symbol.name)) continue;
    entries.push({
      kind: classifySymbol(lines[symbol.line - 1] ?? ""),
      name: symbol.name,
      path: input.path,
      line: symbol.line,
    });
  }
  const libraries = new Map<string, number | undefined>();
  for (const dependency of extractKnowledgeGraphManifestDependencies(input)) {
    if (isUsableName(dependency)) libraries.set(dependency, undefined);
  }
  for (const imported of extractKnowledgeGraphImports(input)) {
    if (/^[./#]/u.test(imported.specifier) || imported.specifier.includes("://")) continue;
    const name = knowledgeGraphDependencyNameFromSpecifier(imported.specifier);
    if (isUsableName(name) && !libraries.has(name)) libraries.set(name, imported.line);
  }
  for (const [name, line] of libraries) {
    entries.push({
      kind: "library",
      name,
      path: input.path,
      ...(line === undefined ? {} : { line }),
    });
  }
  return entries.sort(compareEntries);
}

function normalizeSpokenName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:dot|punkt|period)\b/gu, ".")
    .replace(/\b(?:slash|backslash)\b/gu, "/")
    .replaceAll("\\", "/")
    .replace(/[^\p{L}\p{N}./@_-]/gu, "");
}

export function matchSpeechVocabularyFiles(
  entries: readonly SpeechVocabularyEntry[],
  reference: string,
): readonly { readonly path: string; readonly symbols: readonly SpeechVocabularyEntry[] }[] {
  const normalized = normalizeSpokenName(reference).replace(/^\.\//u, "");
  if (normalized.length === 0) return [];
  const qualified = normalized.includes("/");
  const hasExtension = NodePath.posix.basename(normalized).includes(".");
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const target = normalizeSpokenName(qualified ? entry.path : entry.name);
    const stem = hasExtension ? target : target.replace(/\.[^/.]+$/u, "");
    if (stem === normalized || (qualified && stem.endsWith(`/${normalized}`)))
      files.add(entry.path);
  }
  const symbolsByPath = new Map<string, SpeechVocabularyEntry[]>();
  for (const entry of entries) {
    if (entry.kind === "file" || entry.kind === "library" || !files.has(entry.path)) continue;
    const symbols = symbolsByPath.get(entry.path) ?? [];
    symbols.push(entry);
    symbolsByPath.set(entry.path, symbols);
  }
  return [...files]
    .sort(compareText)
    .map((path) => ({ path, symbols: symbolsByPath.get(path) ?? [] }));
}

function nameWords(name: string): readonly string[] {
  return name
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

const ENTRY_PRIORITY: Readonly<Record<SpeechVocabularyEntry["kind"], number>> = {
  class: 6,
  function: 5,
  type: 4,
  file: 3,
  library: 2,
  variable: 1,
};

function rankSpeechVocabulary(entries: readonly SpeechVocabularyEntry[], transcript: string) {
  const spoken = normalizeSpokenName(transcript).replace(/[^\p{L}\p{N}]/gu, "");
  const words = new Set(nameWords(transcript));
  return entries
    .map((entry) => {
      const stem = entry.kind === "file" ? entry.name.replace(/\.[^.]+$/u, "") : entry.name;
      const normalized = normalizeSpokenName(stem).replace(/[^\p{L}\p{N}]/gu, "");
      const wholeName = normalized.length > 2 && spoken.includes(normalized) ? 100 : 0;
      const matchingWords = nameWords(stem).filter((word) => words.has(word)).length;
      const matchingPathWords = nameWords(entry.path).filter((word) => words.has(word)).length;
      return { entry, score: wholeName + matchingWords * 10 + matchingPathWords };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        ENTRY_PRIORITY[right.entry.kind] - ENTRY_PRIORITY[left.entry.kind] ||
        compareEntries(left.entry, right.entry),
    );
}

export function selectSpeechVocabularyContext(
  entries: readonly SpeechVocabularyEntry[],
  transcript: string,
): SpeechVocabularyContext {
  const selected: SpeechVocabularyEntry[] = [];
  let contextLength = 2;
  for (const { entry } of rankSpeechVocabulary(entries, transcript)) {
    const entryLength = JSON.stringify(entry).length + (selected.length === 0 ? 0 : 1);
    if (selected.length === SPEECH_VOCABULARY_CONTEXT_ENTRY_LIMIT) break;
    if (contextLength + entryLength > SPEECH_VOCABULARY_CONTEXT_CHAR_LIMIT) continue;
    selected.push(entry);
    contextLength += entryLength;
  }
  return {
    entries: selected,
    context: JSON.stringify(selected),
    truncated: selected.length < entries.length,
  };
}

export function speechVocabularyKeyterms(
  entries: readonly SpeechVocabularyEntry[],
): readonly string[] {
  const terms = new Map<string, string>();
  for (const [kind] of Object.entries(ENTRY_PRIORITY).sort((left, right) => right[1] - left[1])) {
    for (const entry of entries) {
      if (
        entry.kind !== kind ||
        entry.name.length > MAX_STREAMING_KEYTERM_CHARS ||
        !isUsableName(entry.name)
      )
        continue;
      const key = entry.name.toLowerCase();
      if (!terms.has(key)) terms.set(key, entry.name);
      if (terms.size === MAX_STREAMING_KEYTERMS) return [...terms.values()];
    }
  }
  return [...terms.values()];
}

function fingerprint(stat: NodeFS.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

async function readVocabularyFile(
  canonicalRoot: string,
  relativePath: string,
  previous: CachedFile | undefined,
): Promise<CachedFile | null> {
  if (!validRelativePath(relativePath)) return null;
  const absolutePath = NodePath.join(canonicalRoot, relativePath);
  const canonicalPath = await NodeFSP.realpath(absolutePath);
  if (canonicalPath !== absolutePath) return null;
  const stat = await NodeFSP.lstat(absolutePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  const currentFingerprint = fingerprint(stat);
  if (previous?.fingerprint === currentFingerprint) return previous;
  const fileEntry: SpeechVocabularyEntry = {
    kind: "file",
    name: NodePath.posix.basename(relativePath),
    path: relativePath,
  };
  if (!isEligibleKnowledgeGraphFile(relativePath) || stat.size > BigInt(MAX_SOURCE_FILE_BYTES)) {
    return { path: relativePath, fingerprint: currentFingerprint, entries: [fileEntry] };
  }
  const file = await NodeFSP.open(
    absolutePath,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
  );
  try {
    const beforeRead = await file.stat({ bigint: true });
    if (!beforeRead.isFile() || beforeRead.size > BigInt(MAX_SOURCE_FILE_BYTES)) return null;
    const bytes = await file.readFile();
    const afterRead = await file.stat({ bigint: true });
    if (
      fingerprint(beforeRead) !== fingerprint(afterRead) ||
      BigInt(bytes.length) !== afterRead.size
    )
      return null;
    return {
      path: relativePath,
      fingerprint: fingerprint(afterRead),
      entries: bytes.includes(0)
        ? [fileEntry]
        : extractSpeechVocabularyFile({ path: relativePath, content: bytes.toString("utf8") }),
    };
  } finally {
    await file.close();
  }
}

function snapshotOf(cache: CachedVocabulary): ProjectSpeechVocabularySnapshot {
  return {
    version: cache.version,
    entries: cache.files.flatMap((file) => file.entries).sort(compareEntries),
    truncated: cache.truncated,
  };
}

interface WorkspaceVocabularyState {
  cache: CachedVocabulary;
  snapshot: ProjectSpeechVocabularySnapshot;
  loaded: boolean;
  loading: Promise<CachedVocabulary | null> | undefined;
  lastRefresh: number;
  active: Fiber.Fiber<ProjectSpeechVocabularySnapshot, ProjectSpeechVocabularyError> | undefined;
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const scanner = yield* ProjectSpeechWorkspaceScanner;
  const scope = yield* Scope.Scope;
  const directory = NodePath.join(config.providerStatusCacheDir, "speech-vocabulary");
  const states = new Map<string, WorkspaceVocabularyState>();

  const cachePath = (root: string) =>
    NodePath.join(directory, `${NodeCrypto.createHash("sha256").update(root).digest("hex")}.json`);
  const stateFor = (workspaceRoot: string): WorkspaceVocabularyState => {
    const root = NodePath.resolve(workspaceRoot);
    const existing = states.get(root);
    if (existing) {
      states.delete(root);
      states.set(root, existing);
      return existing;
    }
    for (const [key, state] of states) {
      if (states.size < MAX_CACHED_WORKSPACES) break;
      if (state.active === undefined) states.delete(key);
    }
    const cache: CachedVocabulary = {
      version: SPEECH_VOCABULARY_VERSION,
      workspaceRoot: root,
      files: [],
      truncated: false,
    };
    const state: WorkspaceVocabularyState = {
      cache,
      snapshot: snapshotOf(cache),
      loaded: false,
      loading: undefined,
      lastRefresh: Number.NEGATIVE_INFINITY,
      active: undefined,
    };
    states.set(root, state);
    return state;
  };

  const load = Effect.fn("ProjectSpeechVocabulary.load")(function* (
    state: WorkspaceVocabularyState,
  ) {
    if (state.loaded) return;
    const root = state.cache.workspaceRoot;
    if (state.loading === undefined) {
      state.loading = (async () => {
        const path = cachePath(root);
        const metadata = await NodeFSP.stat(path);
        if (metadata.size > MAX_CACHE_BYTES) return null;
        const decoded = decodeCache(await NodeFSP.readFile(path, "utf8"));
        if (decoded._tag === "None" || decoded.value.workspaceRoot !== root) return null;
        if (
          decoded.value.files.some(
            (file) =>
              !validRelativePath(file.path) ||
              file.entries.some((entry) => entry.path !== file.path),
          )
        )
          return null;
        if (
          decoded.value.files.reduce((count, file) => count + file.entries.length, 0) >
          MAX_INDEX_ENTRIES
        )
          return null;
        return decoded.value;
      })().catch(() => null);
    }
    const loading = state.loading;
    const cached = yield* Effect.promise(() => loading);
    if (!state.loaded) {
      if (cached !== null) {
        state.cache = cached;
        state.snapshot = snapshotOf(cached);
      }
      state.loaded = true;
      state.loading = undefined;
    }
  });

  const rebuild = Effect.fn("ProjectSpeechVocabulary.rebuild")(function* (
    state: WorkspaceVocabularyState,
  ) {
    yield* load(state);
    const root = state.cache.workspaceRoot;
    const canonicalRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(root),
      catch: (cause) => new ProjectSpeechVocabularyError({ cause }),
    });
    const scanned = yield* scanner
      .scan(canonicalRoot)
      .pipe(Effect.mapError((cause) => new ProjectSpeechVocabularyError({ cause })));
    const previous = new Map(state.cache.files.map((file) => [file.path, file]));
    const paths = scanned.entries
      .filter((entry) => entry.kind === "file" && validRelativePath(entry.path))
      .map((entry) => entry.path)
      .sort(compareText);
    const files: CachedFile[] = [];
    let entryCount = 0;
    let truncated = scanned.truncated;
    for (const relativePath of paths) {
      const file = yield* Effect.tryPromise(() =>
        readVocabularyFile(canonicalRoot, relativePath, previous.get(relativePath)),
      ).pipe(Effect.orElseSucceed(() => null));
      if (file === null) {
        truncated = true;
        continue;
      }
      const remaining = MAX_INDEX_ENTRIES - entryCount;
      if (file.entries.length > remaining) {
        truncated = true;
        break;
      }
      files.push(file);
      entryCount += file.entries.length;
    }
    state.cache = { version: SPEECH_VOCABULARY_VERSION, workspaceRoot: root, truncated, files };
    state.snapshot = snapshotOf(state.cache);
    const serialized = yield* encodeCache(state.cache).pipe(
      Effect.mapError((cause) => new ProjectSpeechVocabularyError({ cause })),
    );
    if (Buffer.byteLength(serialized) <= MAX_CACHE_BYTES) {
      yield* Effect.tryPromise(async () => {
        await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
        const destination = cachePath(root);
        const temporary = `${destination}.${NodeCrypto.randomUUID()}.tmp`;
        try {
          await NodeFSP.writeFile(temporary, serialized, { mode: 0o600 });
          await NodeFSP.rename(temporary, destination);
        } finally {
          await NodeFSP.rm(temporary, { force: true });
        }
      }).pipe(Effect.ignore);
    }
    return state.snapshot;
  });

  const beginRefresh = Effect.fn("ProjectSpeechVocabulary.beginRefresh")(function* (
    state: WorkspaceVocabularyState,
  ) {
    if (state.active !== undefined) return state.active;
    state.lastRefresh = yield* Clock.currentTimeMillis;
    const fiber = yield* rebuild(state).pipe(
      Effect.catchDefect((cause) => Effect.fail(new ProjectSpeechVocabularyError({ cause }))),
      Effect.ensuring(
        Effect.sync(() => {
          state.active = undefined;
        }),
      ),
      Effect.forkIn(scope),
    );
    state.active = fiber;
    return fiber;
  });

  const snapshot: ProjectSpeechVocabulary["Service"]["snapshot"] = Effect.fn(
    "ProjectSpeechVocabulary.snapshot",
  )(function* ({ workspaceRoot }) {
    const state = stateFor(workspaceRoot);
    yield* load(state);
    return state.snapshot;
  });
  const refresh: ProjectSpeechVocabulary["Service"]["refresh"] = Effect.fn(
    "ProjectSpeechVocabulary.refresh",
  )(function* ({ workspaceRoot }) {
    return yield* Fiber.join(yield* beginRefresh(stateFor(workspaceRoot)));
  });
  const refreshInBackground: ProjectSpeechVocabulary["Service"]["refreshInBackground"] = Effect.fn(
    "ProjectSpeechVocabulary.refreshInBackground",
  )(function* ({ workspaceRoot }) {
    const state = stateFor(workspaceRoot);
    const now = yield* Clock.currentTimeMillis;
    if (
      state.active !== undefined ||
      now - state.lastRefresh < SPEECH_VOCABULARY_REFRESH_INTERVAL_MS
    )
      return;
    yield* beginRefresh(state);
  });
  return ProjectSpeechVocabulary.of({ snapshot, refresh, refreshInBackground });
});

export const layer = Layer.effect(ProjectSpeechVocabulary, make);
