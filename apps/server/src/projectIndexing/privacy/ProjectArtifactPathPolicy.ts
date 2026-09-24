export type ProjectArtifactReason =
  | "chat archive"
  | "database artifact"
  | "runtime dump"
  | "log artifact";

const SERIALIZED_FORMATS = new Set([
  "json",
  "jsonc",
  "json5",
  "jsonl",
  "ndjson",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "tsv",
  "xml",
  "plist",
  "msgpack",
]);
const DOCUMENT_FORMATS = new Set(["txt", "md", "markdown", "html", "htm", "srt", "vtt"]);
const ARCHIVE_FORMATS = new Set(["zip", "tar", "7z", "gz", "bz2", "xz", "zst"]);

const CONFIG_FILENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "deno.json",
  "deno.jsonc",
  "composer.json",
  "appsettings.json",
  "runtimeconfig.json",
  "web.config",
  "app.config",
  "log4j.xml",
  "log4j2.xml",
  "log4j2.json",
  "log4j2.yaml",
  "log4j2.yml",
  "logback.xml",
  "pom.xml",
  "cargo.toml",
  "pyproject.toml",
]);
const CONFIG_DIRECTORIES = new Set([
  "schema",
  "schemas",
  "locales",
  "locale",
  "i18n",
  "l10n",
  "translations",
]);
const CHAT_DIRECTORIES = new Set([
  "chat-archive",
  "chat-archives",
  "chat-history",
  "chat-export",
  "chat-exports",
  "conversations",
  "sessions",
  "threads",
  "transcripts",
]);
const LOG_DIRECTORIES = new Set(["log", "logs", "runtime-logs"]);
const DUMP_DIRECTORIES = new Set([
  "dump",
  "dumps",
  "backup",
  "backups",
  "db-dumps",
  "database-dumps",
  "db-backups",
  "database-backups",
  "crashdumps",
  "crash-dumps",
  "heapdumps",
  "heap-dumps",
  "memory-dumps",
  "coredumps",
  "core-dumps",
]);
const RUNTIME_DATA_DIRECTORIES = new Set([
  "userdata",
  "user-data",
  "runtime-data",
  "runtime-state",
  "session-data",
  "thread-data",
  "conversation-data",
]);
const RUNTIME_DIRECTORIES = new Set(["runtime", "state", "cache"]);
const PROVIDER_DIRECTORIES = new Set(["codex", "claude", "cursor", "opencode"]);

const CHAT_COLLECTION =
  /^(?:(?:saved|exported|archived|chatgpt|claude|codex|cursor|opencode)-)?(?:conversations?|chats|sessions|threads|transcripts?)(?:-\d.*)?$/u;
const CHAT_EXPORT =
  /^(?:(?:chat|conversation|session|thread|message|chatgpt|claude|codex|cursor|opencode)s?-(?:archive|history|export|log|transcript|snapshot|backup)s?|chatarchive|chathistory|chatexport)(?:-.*)?$/u;
const DATABASE_EXPORT =
  /^(?:(?:db|database|postgres|postgresql|mysql|mariadb|mongodb|sqlite)-)?(?:dump|backup|snapshot|export)(?:-.*)?$|^(?:db|database)(?:dump|backup|snapshot|export)(?:-.*)?$/u;
const DATABASE_RECORD_EXPORT =
  /^(?:db|database|postgres|postgresql|mysql|mariadb|mongodb|sqlite)-?(?:dump|backup|snapshot|export)(?:-.*)?$/u;
const RUNTIME_EXPORT =
  /^(?:(?:runtime|process|session|application|app|thread|heap|memory|crash|state)-)?(?:dump|snapshot|trace|capture)(?:-.*)?$|^(?:runtime|process|session|application|app)-state(?:-.*)?$/u;
const RUNTIME_RECORD =
  /^(?:state|session|sessions|events|messages|history|cache|telemetry)(?:-.*)?$|^(?:\d{4}-\d{2}-\d{2}|[a-f0-9]{8}-[a-f0-9]{4}-)/u;
const LOG_EXPORT =
  /^(?:log|logs|(?:(?:application|app|runtime|process|session|chat|error|debug|access|audit|event|trace|build|server)s?)-logs?)(?:-.*)?$/u;

function marker(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[._\s]+/gu, "-")
    .replace(/^-+/u, "");
}

/** File formats distinguish stored records from implementation files in similarly named modules. */
export function projectArtifactPathReason(relativePath: string): ProjectArtifactReason | null {
  const segments = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  const originalName = segments.at(-1) ?? "";
  const name = originalName.toLowerCase().replace(/\.(?:gz|bz2|xz|zst|br)$/u, "");
  const compressed = name !== originalName.toLowerCase();
  const directories = segments.slice(0, -1).map(marker);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const stem = marker(
    originalName.replace(/\.(?:gz|bz2|xz|zst|br)$/iu, "").replace(/\.[^.]+$/u, ""),
  );

  if (/\.(?:sqlite(?:3)?|db(?:3)?|mdb|accdb|wal|shm)(?:-(?:wal|shm|journal))?$/u.test(name))
    return "database artifact";
  if (/\.log(?:[.-](?:\d|old|bak)[^/]*)?$/u.test(name)) return "log artifact";
  if (/\.(?:dump|dmp|core|hprof|heapsnapshot|heapprofile|cpuprofile|stacktrace|trace)$/u.test(name))
    return "runtime dump";

  if (
    CONFIG_FILENAMES.has(name) ||
    /(?:^|-)(?:schema|config|configuration|policy)(?:-.*)?$/u.test(stem) ||
    /^(?:tsconfig|jsconfig|appsettings)(?:-.*)?$/u.test(stem) ||
    stem.endsWith("-runtimeconfig")
  )
    return null;
  if (
    SERIALIZED_FORMATS.has(extension) &&
    directories.some((directory) => CONFIG_DIRECTORIES.has(directory))
  )
    return null;

  if (extension === "sql")
    return compressed ||
      DATABASE_EXPORT.test(stem) ||
      directories.some((directory) => DUMP_DIRECTORIES.has(directory))
      ? "database artifact"
      : null;
  const serialized = SERIALIZED_FORMATS.has(extension);
  const document = DOCUMENT_FORMATS.has(extension);
  const archive = compressed || ARCHIVE_FORMATS.has(extension);
  if (!serialized && !document && !archive) return null;

  if (
    CHAT_EXPORT.test(stem) ||
    ((serialized || archive) &&
      (CHAT_COLLECTION.test(stem) ||
        directories.some((directory) => CHAT_DIRECTORIES.has(directory)) ||
        (/^(?:history|messages|conversation|conversations|session|sessions)(?:-.*)?$/u.test(stem) &&
          directories.some((directory) => PROVIDER_DIRECTORIES.has(directory))))) ||
    ((extension === "txt" || (document && RUNTIME_RECORD.test(stem))) &&
      directories.some((directory) => CHAT_DIRECTORIES.has(directory)))
  )
    return "chat archive";
  if (DATABASE_RECORD_EXPORT.test(stem)) return "database artifact";
  if (
    LOG_EXPORT.test(stem) ||
    ((serialized || archive || extension === "txt" || (document && RUNTIME_RECORD.test(stem))) &&
      directories.some((directory) => LOG_DIRECTORIES.has(directory)))
  )
    return "log artifact";
  if (
    RUNTIME_EXPORT.test(stem) ||
    directories.some((directory) => DUMP_DIRECTORIES.has(directory)) ||
    ((serialized || archive || document) &&
      (directories.some((directory) => RUNTIME_DATA_DIRECTORIES.has(directory)) ||
        segments
          .slice(0, -1)
          .some((directory) => directory === ".cache" || directory === ".state") ||
        (directories.includes("runtime") &&
          directories.some((directory) => directory === "cache" || directory === "state")) ||
        (RUNTIME_RECORD.test(stem) &&
          directories.some((directory) => RUNTIME_DIRECTORIES.has(directory)))))
  )
    return "runtime dump";
  return null;
}
