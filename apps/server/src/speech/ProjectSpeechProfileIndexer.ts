import type { RepositoryIdentity } from "@t3tools/contracts";

import { isIgnoredProjectSpeechPath } from "./ProjectSpeechPathPolicy.ts";

export interface ProjectSpeechProfileWorkspaceEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
}

export interface ProjectSpeechProfileTextFile {
  readonly path: string;
  readonly contents: string;
}

export interface ProjectSpeechProfileInput {
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly repositoryIdentity?: RepositoryIdentity;
  readonly workspaceEntries: ReadonlyArray<ProjectSpeechProfileWorkspaceEntry>;
  readonly textFiles: ReadonlyArray<ProjectSpeechProfileTextFile>;
}

export interface ProjectSpeechProfileContent {
  readonly contextPrompt: string;
  readonly keyterms: ReadonlyArray<string>;
  readonly technologies: ReadonlyArray<string>;
}

interface TermCandidate {
  readonly normalized: string;
  value: string;
  priority: number;
  occurrences: number;
}

const MAX_CONTEXT_PROMPT_LENGTH = 1_750;
const MAX_KEYTERMS = 100;
const MAX_KEYTERM_LENGTH = 50;

function stringSet(values: string): Set<string> {
  return new Set(values.trim().split(/\s+/));
}

const COMMON_TERMS = stringSet(`
  a about all an and api app application architecture assets build code components config
  configuration constants constructor contributing data default development docs documentation
  example examples features files getting guide helpers http https index installation introduction
  json license main module modules overview package packages project readme requestid response
  scripts setup source spec src started test testing tests todo token types undefined usage userid
  utils uuid variables version welcome yaml
`);

const GENERIC_FILE_STEMS = new Set([
  ...COMMON_TERMS,
  "cargo",
  "composer",
  "dockerfile",
  "gemfile",
  "makefile",
  "package-lock",
  "pnpm-lock",
  "pom",
  "pubspec",
  "pyproject",
  "requirements",
  "tsconfig",
  "yarn",
]);

const TECHNOLOGY_BY_EXTENSION = new Map<string, string>(
  (
    [
      ["Astro", "astro"],
      ["C", "c"],
      ["C++", "cc cpp cxx"],
      ["C#", "cs"],
      ["Clojure", "clj cljs"],
      ["CSS", "css"],
      ["Dart", "dart"],
      ["Elixir", "ex exs"],
      ["Erlang", "erl"],
      ["F#", "fs"],
      ["Go", "go"],
      ["GraphQL", "gql graphql"],
      ["Haskell", "hs"],
      ["HTML", "html"],
      ["Java", "java"],
      ["JavaScript", "js jsx"],
      ["Kotlin", "kt kts"],
      ["Lua", "lua"],
      ["Objective-C", "m mm"],
      ["PHP", "php"],
      ["Protocol Buffers", "proto"],
      ["Python", "py"],
      ["R", "r"],
      ["Ruby", "rb"],
      ["Rust", "rs"],
      ["Scala", "scala"],
      ["Shell", "sh"],
      ["SQL", "sql"],
      ["Svelte", "svelte"],
      ["Swift", "swift"],
      ["Terraform", "tf"],
      ["TypeScript", "ts tsx"],
      ["Vue", "vue"],
      ["Zig", "zig"],
    ] as const
  ).flatMap(([technology, extensions]) =>
    extensions.split(" ").map((extension) => [extension, technology] as const),
  ),
);

const TECHNOLOGY_BY_PACKAGE = new Map<string, string>([
  ["@nestjs/core", "NestJS"],
  ["@prisma/client", "Prisma"],
  ["@sveltejs/kit", "SvelteKit"],
  ["@trpc/server", "tRPC"],
  ["astro", "Astro"],
  ["drizzle-orm", "Drizzle ORM"],
  ["effect", "Effect"],
  ["electron", "Electron"],
  ["expo", "Expo"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["graphql", "GraphQL"],
  ["hono", "Hono"],
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["pg", "PostgreSQL"],
  ["prisma", "Prisma"],
  ["react", "React"],
  ["react-dom", "React"],
  ["react-native", "React Native"],
  ["solid-js", "SolidJS"],
  ["svelte", "Svelte"],
  ["tailwindcss", "Tailwind CSS"],
  ["typescript", "TypeScript"],
  ["vite", "Vite"],
  ["vite-plus", "Vite+"],
  ["vitest", "Vitest"],
  ["vue", "Vue"],
]);

const TECHNOLOGY_BY_FILENAME = new Map<string, string>([
  ["cargo.toml", "Rust"],
  ["composer.json", "PHP"],
  ["containerfile", "Docker"],
  ["dockerfile", "Docker"],
  ["gemfile", "Ruby"],
  ["go.mod", "Go"],
  ["mix.exs", "Elixir"],
  ["package.swift", "Swift"],
  ["pipfile", "Python"],
  ["pom.xml", "Java"],
  ["pubspec.yaml", "Dart"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
]);

const CONTENT_TECHNOLOGY_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["Docker", /\bDocker\b/],
  ["Effect", /\bEffect(?:-TS)?\b|from\s+["']effect(?:\/[^"']*)?["']/],
  ["Electron", /\bElectron\b/],
  ["Flutter", /\bFlutter\b|\bsdk:\s*flutter\b/i],
  ["GraphQL", /\bGraphQL\b/],
  ["JavaScript", /\bJavaScript\b/],
  ["Kubernetes", /\bKubernetes\b/],
  ["Next.js", /\bNext\.js\b|from\s+["']next(?:\/[^"']*)?["']/],
  ["Node.js", /\bNode\.js\b/],
  ["PostgreSQL", /\bPostgreSQL\b|\bPostgres\b/],
  ["React", /\bReact(?:\.js)?\b|from\s+["']react(?:\/[^"']*)?["']/],
  ["React Native", /\bReact Native\b/],
  ["Redis", /\bRedis\b/],
  ["SQLite", /\bSQLite\b/],
  ["Svelte", /\bSvelte\b/],
  ["Tailwind CSS", /\bTailwind CSS\b/],
  ["Tauri", /\bTauri\b/],
  ["TypeScript", /\bTypeScript\b/],
  ["Vite", /\bVite\b/],
  ["Vue", /\bVue(?:\.js)?\b/],
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const IDENTIFIER_PATTERN =
  /(?<![\p{L}\p{N}_])(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*|[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+|[A-Z]{2,}[A-Za-z0-9]*)(?![\p{L}\p{N}_])/gu;
const URL_PATTERN = /\b(?:https?|wss?|ssh|git):\/\/\S+|\bgit@\S+|\bwww\.\S+/gi;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(?:api[_-]?key|apikey|secret|password|passwd|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token)\s*[:=]/i;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? ""
  );
}

function cleanTerm(raw: string, allowCommon = false): string | undefined {
  const value = raw
    .normalize("NFKC")
    .replace(/^[\s`'"“”‘’()[\]{}<>:;,.!?]+|[\s`'"“”‘’()[\]{}<>:;,.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < (allowCommon ? 1 : 2) || value.length > MAX_KEYTERM_LENGTH) return undefined;
  if (!/\p{L}/u.test(value) || !/^[\p{L}\p{N}@._+/# -]+$/u.test(value)) return undefined;
  if (/\b(?:https?|wss?|ssh|git):\/\//i.test(value) || /^(?:git@|www\.)/i.test(value)) {
    return undefined;
  }
  if (/^[\w.-]+\.(?:com|dev|io|net|org)(?:\/|$)/i.test(value)) return undefined;
  if (/^(?:sha(?:1|256)?[-_:])?[a-f0-9]{7,}$/i.test(value)) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return undefined;
  }
  if (
    /^(?:sk|pk)[_-](?:live|test)[_-]|^gh[pousr]_|^github_pat_|^xox[baprs]-|^akia[0-9a-z]{12,}/i.test(
      value,
    )
  ) {
    return undefined;
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return undefined;
  if (/\b(?:begin private key|private key end)\b/i.test(value)) return undefined;

  const characterClasses =
    Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/\d/.test(value));
  const uniqueness = new Set(value.toLowerCase()).size / value.length;
  if (value.length >= 28 && characterClasses === 3 && uniqueness > 0.6) return undefined;

  const normalized = value.toLowerCase();
  const words = normalized.split(/[\s._+/#-]+/).filter(Boolean);
  if (
    !allowCommon &&
    (COMMON_TERMS.has(normalized) || words.every((word) => COMMON_TERMS.has(word)))
  ) {
    return undefined;
  }
  return value;
}

function addCandidate(
  candidates: Map<string, TermCandidate>,
  raw: string | undefined,
  priority: number,
  allowCommon = false,
): void {
  if (raw === undefined) return;
  const value = cleanTerm(raw, allowCommon);
  if (value === undefined) return;

  const normalized = value.toLowerCase();
  const existing = candidates.get(normalized);
  if (existing === undefined) {
    candidates.set(normalized, { normalized, value, priority, occurrences: 1 });
    return;
  }

  existing.occurrences += 1;
  if (priority > existing.priority) {
    existing.value = value;
    existing.priority = priority;
  }
}

function rankCandidates(candidates: ReadonlyMap<string, TermCandidate>): Array<string> {
  return [...candidates.values()]
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.occurrences - left.occurrences ||
        compareText(left.normalized, right.normalized) ||
        compareText(left.value, right.value),
    )
    .slice(0, MAX_KEYTERMS)
    .map((candidate) => candidate.value);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function parseJsonRecord(contents: string): Readonly<Record<string, unknown>> | undefined {
  try {
    return asRecord(JSON.parse(contents) as unknown);
  } catch {
    return undefined;
  }
}

function recordValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function detectPackageTechnologies(contents: string, technologies: Set<string>): void {
  const manifest = parseJsonRecord(contents);
  if (manifest === undefined) return;

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = asRecord(recordValue(manifest, field));
    if (dependencies === undefined) continue;
    for (const packageName of Object.keys(dependencies).sort(compareText)) {
      const normalized = packageName.toLowerCase();
      const technology = TECHNOLOGY_BY_PACKAGE.get(normalized);
      if (technology !== undefined) technologies.add(technology);
      if (normalized.startsWith("@angular/")) technologies.add("Angular");
      if (normalized.startsWith("@effect/")) technologies.add("Effect");
    }
  }

  const engines = asRecord(recordValue(manifest, "engines"));
  if (engines !== undefined && typeof recordValue(engines, "node") === "string") {
    technologies.add("Node.js");
  }
  const packageManager = recordValue(manifest, "packageManager");
  if (typeof packageManager !== "string") return;
  const manager = packageManager.split("@")[0]?.toLowerCase();
  if (manager === "bun") technologies.add("Bun");
  if (manager === "npm") technologies.add("npm");
  if (manager === "pnpm") technologies.add("pnpm");
  if (manager === "yarn") technologies.add("Yarn");
}

function detectPathTechnologies(path: string, technologies: Set<string>): void {
  const filename = basename(path).toLowerCase();
  const extension = filename.includes(".") ? filename.split(".").at(-1) : undefined;
  const extensionTechnology =
    extension === undefined ? undefined : TECHNOLOGY_BY_EXTENSION.get(extension);
  if (extensionTechnology !== undefined) technologies.add(extensionTechnology);

  const filenameTechnology = TECHNOLOGY_BY_FILENAME.get(filename);
  if (filenameTechnology !== undefined) technologies.add(filenameTechnology);
  if (filename.startsWith("vite.config.")) technologies.add("Vite");
  if (filename.startsWith("next.config.")) technologies.add("Next.js");
  if (filename.startsWith("nuxt.config.")) technologies.add("Nuxt");
  if (filename.startsWith("svelte.config.")) technologies.add("Svelte");
  if (filename.startsWith("tsconfig")) technologies.add("TypeScript");
  if (filename.startsWith("build.gradle")) technologies.add("Java");
  if (filename.startsWith("docker-compose.")) technologies.add("Docker");
}

function sortedTextFiles(input: ProjectSpeechProfileInput): Array<ProjectSpeechProfileTextFile> {
  return [...input.textFiles]
    .filter((file) => !isIgnoredProjectSpeechPath(file.path))
    .sort(
      (left, right) =>
        compareText(left.path, right.path) || compareText(left.contents, right.contents),
    );
}

function detectTechnologies(input: ProjectSpeechProfileInput): Array<string> {
  const technologies = new Set<string>();
  const paths = [
    ...input.workspaceEntries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
    ...input.textFiles.map((file) => file.path),
  ]
    .filter((path) => !isIgnoredProjectSpeechPath(path))
    .sort(compareText);

  for (const path of paths) detectPathTechnologies(path, technologies);
  for (const file of sortedTextFiles(input)) {
    if (basename(file.path).toLowerCase() === "package.json") {
      detectPackageTechnologies(file.contents, technologies);
    }
    for (const [technology, pattern] of CONTENT_TECHNOLOGY_RULES) {
      if (pattern.test(file.contents)) technologies.add(technology);
    }
  }
  return [...technologies].sort(compareText);
}

function projectNames(input: ProjectSpeechProfileInput, includeOwner: boolean): Array<string> {
  const names: Array<string> = [];
  const seen = new Set<string>();
  const rawNames = [
    input.projectTitle,
    input.repositoryIdentity?.displayName,
    input.repositoryIdentity?.name,
    ...(includeOwner ? [input.repositoryIdentity?.owner] : []),
  ];

  for (const rawName of rawNames) {
    if (rawName === undefined) continue;
    const name = cleanTerm(rawName);
    if (name === undefined || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }

  if (names.length === 0) {
    const workspaceName = cleanTerm(basename(input.workspaceRoot));
    if (workspaceName !== undefined) names.push(workspaceName);
  }
  return names;
}

function fileStem(path: string): string | undefined {
  const filename = basename(path);
  if (filename === "" || filename.startsWith(".")) return undefined;

  let stem = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  for (const suffix of [".test", ".spec", ".stories", ".story", ".config", ".d"] as const) {
    if (stem.toLowerCase().endsWith(suffix)) stem = stem.slice(0, -suffix.length);
  }
  return GENERIC_FILE_STEMS.has(stem.toLowerCase()) ? undefined : stem;
}

function manifestName(file: ProjectSpeechProfileTextFile): string | undefined {
  const filename = basename(file.path).toLowerCase();
  if (filename === "package.json" || filename === "composer.json") {
    const manifest = parseJsonRecord(file.contents);
    const name = manifest === undefined ? undefined : recordValue(manifest, "name");
    return typeof name === "string" ? name : undefined;
  }
  if (filename === "cargo.toml") return file.contents.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
  if (filename === "pyproject.toml")
    return file.contents.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
  if (filename === "pubspec.yaml") return file.contents.match(/^name:\s*([^\s#]+)/m)?.[1];
  if (filename === "go.mod") {
    const modulePath = file.contents.match(/^module\s+([^\s]+)/m)?.[1]?.replace(/\.git$/, "");
    return modulePath === undefined ? undefined : basename(modulePath);
  }
  if (filename === "pom.xml") return file.contents.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1];
  if (filename === "mix.exs") return file.contents.match(/\bapp:\s*:([a-zA-Z0-9_-]+)/)?.[1];
  return undefined;
}

function cleanHeading(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`]/g, "")
    .replace(/[:|–—]/g, " ")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

function indexTextFile(
  file: ProjectSpeechProfileTextFile,
  candidates: Map<string, TermCandidate>,
): void {
  addCandidate(candidates, manifestName(file), 90);
  const readme = /^readme(?:\.[^.]*)?$/i.test(basename(file.path));

  for (const line of file.contents.split(/\r?\n/)) {
    if (readme) {
      const heading = line.match(/^#{1,4}\s+(.+)$/)?.[1];
      if (heading !== undefined) addCandidate(candidates, cleanHeading(heading), 70);
    }
    if (SENSITIVE_ASSIGNMENT_PATTERN.test(line)) continue;

    const safeLine = line.replace(URL_PATTERN, " ").replace(EMAIL_PATTERN, " ");
    for (const match of safeLine.matchAll(IDENTIFIER_PATTERN)) {
      addCandidate(candidates, match[0], 50);
    }
  }
}

function naturalList(values: ReadonlyArray<string>): string {
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function buildContextPrompt(
  names: ReadonlyArray<string>,
  technologies: ReadonlyArray<string>,
  examples: ReadonlyArray<string>,
): string {
  const subject = names[0] === undefined ? "a software project" : `the ${names[0]} project`;
  const sentences = [`Software-development dictation for ${subject}.`];
  const describedTechnologies = technologies.slice(0, 6);
  if (describedTechnologies.length > 0) {
    sentences.push(`The codebase uses ${naturalList(describedTechnologies)}.`);
  }
  sentences.push(
    examples.length > 0
      ? `Discussion covers source code, architecture, tests, and project-specific components such as ${naturalList(examples.slice(0, 3))}.`
      : "Discussion covers source code, architecture, tests, and implementation details.",
  );
  return sentences.join(" ").slice(0, MAX_CONTEXT_PROMPT_LENGTH).trimEnd();
}

function buildProjectSpeechProfileContent(
  input: ProjectSpeechProfileInput,
  indexed: boolean,
): ProjectSpeechProfileContent {
  const technologies = detectTechnologies(input);
  const names = projectNames(input, indexed);
  const candidates = new Map<string, TermCandidate>();

  names.forEach((name, index) => addCandidate(candidates, name, 100 - index));
  for (const technology of technologies) addCandidate(candidates, technology, 85, true);

  if (indexed) {
    const paths = [
      ...input.workspaceEntries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
      ...input.textFiles.map((file) => file.path),
    ]
      .filter((path) => !isIgnoredProjectSpeechPath(path))
      .sort(compareText);
    for (const path of paths) addCandidate(candidates, fileStem(path), 60);
    for (const file of sortedTextFiles(input)) indexTextFile(file, candidates);
  }

  const keyterms = rankCandidates(candidates);
  const excludedExamples = new Set([...names, ...technologies].map((term) => term.toLowerCase()));
  const examples = indexed
    ? keyterms.filter((term) => !excludedExamples.has(term.toLowerCase())).slice(0, 3)
    : [];

  return {
    contextPrompt: buildContextPrompt(names, technologies, examples),
    keyterms,
    technologies,
  };
}

export function buildIndexedProjectSpeechProfileContent(
  input: ProjectSpeechProfileInput,
): ProjectSpeechProfileContent {
  return buildProjectSpeechProfileContent(input, true);
}

export function buildBasicProjectSpeechProfileContent(
  input: ProjectSpeechProfileInput,
): ProjectSpeechProfileContent {
  return buildProjectSpeechProfileContent(input, false);
}
