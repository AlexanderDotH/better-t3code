// Broad repository discovery intentionally excludes dependency, generated,
// build, cache, VCS, and commonly secret-bearing paths. Explicit reads remain
// available through WorkspaceFileSystem and its stricter root/symlink checks.
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".gradle",
  ".hg",
  ".idea",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svn",
  ".turbo",
  ".vite",
  "__generated__",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const PRIVATE_KEY_FILE_NAMES = new Set(["id_dsa", "id_ecdsa", "id_ed25519", "id_rsa"]);

const PRIVATE_KEY_EXTENSIONS = [".key", ".p12", ".pfx", ".pem"];

export function normalizeWorkspaceContextPath(input: string): string | null {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.includes("\0")) return null;
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

export function shouldSkipWorkspaceContextDirectory(name: string): boolean {
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export function isWorkspaceContextSecretPath(relativePath: string): boolean {
  const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1).toLowerCase();
  if (basename.startsWith(".env")) return true;
  if (PRIVATE_KEY_FILE_NAMES.has(basename)) return true;
  return PRIVATE_KEY_EXTENSIONS.some((extension) => basename.endsWith(extension));
}

export function isWorkspaceContextSearchablePath(relativePath: string): boolean {
  const normalized = normalizeWorkspaceContextPath(relativePath);
  if (!normalized || isWorkspaceContextSecretPath(normalized)) return false;
  const segments = normalized.split("/");
  return !segments.slice(0, -1).some(shouldSkipWorkspaceContextDirectory);
}
