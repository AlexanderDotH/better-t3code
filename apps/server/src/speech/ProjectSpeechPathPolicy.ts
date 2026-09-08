function stringSet(values: string): ReadonlySet<string> {
  return new Set(values.trim().split(/\s+/));
}

const IGNORED_DIRECTORY_NAMES = stringSet(`
  .cache .git .next .nuxt .output .parcel-cache .svelte-kit .turbo .venv .vite .vite-plus
  __generated__ __pycache__ artifact artifacts backup backups bin build coverage deriveddata dist
  generated node_modules obj out pods target temp third_party tmp vendor venv
`);

export function isIgnoredProjectSpeechDirectoryName(name: string): boolean {
  return name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function isIgnoredProjectSpeechPath(path: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment.toLowerCase()))) return true;
  if (segments.slice(0, -1).some((segment) => segment.startsWith("."))) return true;

  const filename = segments.at(-1)?.toLowerCase() ?? "";
  return (
    filename === ".env" ||
    filename.startsWith(".env.") ||
    /(?:^|\.)(?:gen|generated|min)\.[^.]+$/.test(filename) ||
    filename.endsWith(".map")
  );
}
