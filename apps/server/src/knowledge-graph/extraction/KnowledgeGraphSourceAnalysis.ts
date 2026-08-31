// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

const MAX_SYMBOLS_PER_FILE = 64;
const MAX_IMPORTS_PER_FILE = 256;
const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
] as const;

interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface KnowledgeGraphSourceSymbol {
  readonly name: string;
  readonly line: number;
}

export interface KnowledgeGraphSourceImport {
  readonly specifier: string;
  readonly line: number;
}

export function normalizeKnowledgeGraphRelativePath(path: string): string {
  const normalized = NodePath.posix.normalize(path.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//u, "");
}

export function knowledgeGraphLanguageForPath(path: string): string | undefined {
  const extension = NodePath.posix.extname(path).toLowerCase();
  return {
    ".c": "C",
    ".cc": "C++",
    ".cpp": "C++",
    ".cs": "C#",
    ".go": "Go",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".php": "PHP",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".sh": "Shell",
    ".sql": "SQL",
    ".swift": "Swift",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
  }[extension];
}

export function knowledgeGraphTechnologyForPath(path: string): string | undefined {
  const language = knowledgeGraphLanguageForPath(path);
  if (language !== undefined) return language;
  const extension = NodePath.posix.extname(path).toLowerCase();
  return {
    ".css": "CSS",
    ".html": "HTML",
    ".json": "JSON",
    ".md": "Markdown",
    ".mdx": "Markdown",
    ".toml": "TOML",
    ".xml": "XML",
    ".yaml": "YAML",
    ".yml": "YAML",
  }[extension];
}

export function extractKnowledgeGraphSymbols(
  file: SourceFile,
): readonly KnowledgeGraphSourceSymbol[] {
  const language = knowledgeGraphLanguageForPath(file.path);
  if (language === undefined) return [];
  const patterns: readonly RegExp[] =
    language === "Python"
      ? [/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/u]
      : language === "Go"
        ? [/^\s*(?:func|type)\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/u]
        : language === "Rust"
          ? [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|trait|type|mod)\s+([A-Za-z_][\w]*)/u]
          : language === "Java" || language === "Kotlin"
            ? [
                /^\s*(?:(?:public|private|protected|internal|open|abstract|final|sealed|data|static)\s+)*(?:class|interface|enum|record|object|fun)\s+([A-Za-z_$][\w$]*)/u,
              ]
            : [
                /^\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const)\s+([A-Za-z_$][\w$]*)/u,
              ];
  const symbols: KnowledgeGraphSourceSymbol[] = [];
  const seen = new Set<string>();
  for (const [index, line] of file.content.split(/\r?\n/u).entries()) {
    for (const pattern of patterns) {
      const name = pattern.exec(line)?.[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      symbols.push({ name, line: index + 1 });
      break;
    }
    if (symbols.length === MAX_SYMBOLS_PER_FILE) break;
  }
  return symbols;
}

export function extractKnowledgeGraphImports(
  file: SourceFile,
): readonly KnowledgeGraphSourceImport[] {
  const imports: KnowledgeGraphSourceImport[] = [];
  const patterns = [
    /(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/gu,
    /^\s*import\s+["']([^"']+)["']/gu,
    /^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gu,
    /^\s*use\s+([A-Za-z_][\w:]*)/gu,
  ];
  for (const [index, line] of file.content.split(/\r?\n/u).entries()) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        const specifier = match[1]?.trim();
        if (specifier) imports.push({ specifier, line: index + 1 });
        if (imports.length === MAX_IMPORTS_PER_FILE) return imports;
      }
    }
  }
  return imports;
}

export function knowledgeGraphDependencyNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split(/[/:]/u)[0] ?? specifier;
}

export function resolveKnowledgeGraphRelativeImport(
  importerPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | null {
  const cleanSpecifier = specifier.split(/[?#]/u)[0] ?? specifier;
  const base = normalizeKnowledgeGraphRelativePath(
    NodePath.posix.join(NodePath.posix.dirname(importerPath), cleanSpecifier),
  );
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => filePaths.has(candidate)) ?? null;
}
