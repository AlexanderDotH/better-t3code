function stringSet(values: string): ReadonlySet<string> {
  return new Set(values.trim().split(/\s+/));
}

const IGNORED_DIRECTORY_NAMES = stringSet(`
  .cache .git .next .nuxt .output .parcel-cache .svelte-kit .turbo .venv .vite .vite-plus
  __generated__ __pycache__ artifact artifacts backup backups bin build coverage deriveddata dist
  generated node_modules obj out pods target temp third_party tmp vendor venv
`);

const SECRET_PATH_SEGMENTS = stringSet(`
  credential credentials private secret secrets
`);
const SECRET_PATH_SEGMENT_PREFIX = /^(?:credential|credentials|private|secret|secrets)(?:[._-]|$)/u;

const SOURCE_EXTENSIONS = stringSet(`
  c cc cjs cpp cs css cts go h hpp html java js json jsonc jsx kt kts less lua m md mdx mjs mm
  php prisma py rb rs sass scala scss sh sql swift toml ts tsx txt vue xml yaml yml zig
`);

const SOURCE_FILENAMES = new Set([
  "cargo.toml",
  "cmakelists.txt",
  "composer.json",
  "deno.json",
  "deno.jsonc",
  "dockerfile",
  "gemfile",
  "go.mod",
  "go.sum",
  "gradle.properties",
  "makefile",
  "package.json",
  "pnpm-workspace.yaml",
  "pom.xml",
  "pyproject.toml",
  "readme",
  "requirements.txt",
  "settings.gradle",
  "settings.gradle.kts",
]);

const SECRET_FILENAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "_netrc",
  "kubeconfig",
  "terraform.tfstate",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "id_xmss",
]);

const SECRET_CONFIGURATION_FILENAME =
  /^(?:auth|firebase[-_.]?adminsdk(?:[-_.][a-z0-9]+)*|oauth|passwords?|service[-_.]?account|tokens?)(?:[._-](?:dev|development|local|prod|production|stage|staging|test))*\.(?:conf|config|ini|json|jsonc|properties|toml|xml|ya?ml)$/u;

function normalizePath(path: string): readonly string[] {
  return path.replaceAll("\\", "/").split("/").filter(Boolean);
}

export function isIgnoredKnowledgeGraphDirectory(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized.startsWith(".") && normalized !== ".github") return true;
  return IGNORED_DIRECTORY_NAMES.has(normalized);
}

export function isSecretKnowledgeGraphPath(path: string): boolean {
  const segments = normalizePath(path).map((segment) => segment.toLowerCase());
  if (
    segments.some(
      (segment) => SECRET_PATH_SEGMENTS.has(segment) || SECRET_PATH_SEGMENT_PREFIX.test(segment),
    )
  ) {
    return true;
  }
  const filename = segments.at(-1) ?? "";
  if (filename === ".env" || filename.startsWith(".env.")) return true;
  if (SECRET_FILENAMES.has(filename)) return true;
  if (/^(?:credential|credentials|private|secret|secrets)(?:[._-]|$)/u.test(filename)) {
    return true;
  }
  if (SECRET_CONFIGURATION_FILENAME.test(filename)) return true;
  return /\.(?:jks|key|keystore|p12|pem|pfx)$/u.test(filename);
}

export function isIgnoredKnowledgeGraphWatchPath(path: string): boolean {
  if (isSecretKnowledgeGraphPath(path)) return true;
  return normalizePath(path).some(isIgnoredKnowledgeGraphDirectory);
}

export function isEligibleKnowledgeGraphFile(path: string): boolean {
  if (isIgnoredKnowledgeGraphWatchPath(path)) return false;
  const filename = normalizePath(path).at(-1)?.toLowerCase() ?? "";
  if (SOURCE_FILENAMES.has(filename)) return true;
  if (/(?:^|\.)(?:gen|generated|min)\.[^.]+$/u.test(filename) || filename.endsWith(".map")) {
    return false;
  }
  const extension = filename.includes(".") ? (filename.split(".").at(-1) ?? "") : "";
  return SOURCE_EXTENSIONS.has(extension);
}
