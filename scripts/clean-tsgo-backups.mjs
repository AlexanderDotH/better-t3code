// Deletes stale tsgo backup files left behind by `effect-tsgo patch`.
//
// The patch command backs up the real tsgo binary to `tsgo.original`, and if
// that name is taken it writes `tsgo.original.1`, `.2`, ... without ever
// cleaning up. On runners that restore node_modules from a build cache
// (Vercel), backups accumulate across deploys until patch hard-fails at 101
// with "Too many backup files exist". Removing them is safe: from the second
// patch onward the backup is just the previously-patched binary, and pnpm
// restores the pristine one whenever the package is re-materialized.
//
// Runs as part of `prepare`, so it must only use node builtins.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

function isTsgoBackupFile(fileName) {
  return /^tsgo(\.exe)?\.original/.test(fileName);
}

function collectBackups() {
  const pnpmDir = NodePath.join("node_modules", ".pnpm");
  if (!NodeFS.existsSync(pnpmDir)) {
    return [];
  }

  const nativePreviewEntries = NodeFS.readdirSync(pnpmDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith("@typescript+native-preview-"),
  );

  const backups = [];
  for (const nativePreviewEntry of nativePreviewEntries) {
    const nativePreviewModulesDir = NodePath.join(
      pnpmDir,
      nativePreviewEntry.name,
      "node_modules",
      "@typescript",
    );
    if (!NodeFS.existsSync(nativePreviewModulesDir)) {
      continue;
    }

    const previewDirs = NodeFS.readdirSync(nativePreviewModulesDir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("native-preview-"),
    );

    for (const previewDir of previewDirs) {
      const libDir = NodePath.join(nativePreviewModulesDir, previewDir.name, "lib");
      if (!NodeFS.existsSync(libDir)) {
        continue;
      }

      for (const file of NodeFS.readdirSync(libDir, { withFileTypes: true })) {
        if (file.isFile() && isTsgoBackupFile(file.name)) {
          backups.push(NodePath.join(libDir, file.name));
        }
      }
    }
  }

  return backups;
}

const backups = collectBackups();

for (const backup of backups) {
  NodeFS.rmSync(backup, { force: true });
}

if (backups.length > 0) {
  console.log(`Removed ${backups.length} stale tsgo backup(s)`);
}
