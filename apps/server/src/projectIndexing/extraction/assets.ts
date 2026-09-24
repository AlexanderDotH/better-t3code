// @effect-diagnostics nodeBuiltinImport:off - Compiler processes and worker threads require real filesystem assets outside Electron archives.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/** ASAR is an Electron filesystem abstraction, not an operating-system directory. */
export function unpackedAssetPath(filePath: string): string {
  return filePath.replace(/(^|[\\/])([^\\/]+\.asar)(?=[\\/]|$)/i, "$1$2.unpacked");
}

export function resolveFilesystemAsset(filePath: string): string {
  const unpacked = unpackedAssetPath(filePath);
  try {
    const resolved = NodeFS.realpathSync(unpacked);
    if (unpackedAssetPath(resolved) !== resolved || !NodeFS.statSync(resolved).isFile()) {
      throw new Error("Asset is not a regular unpacked file.");
    }
    return resolved;
  } catch (cause) {
    throw new Error(`Project indexer asset is missing from the real filesystem: ${unpacked}`, {
      cause,
    });
  }
}

export function filesystemModuleUrl(moduleUrl: string): URL {
  return NodeURL.pathToFileURL(resolveFilesystemAsset(NodeURL.fileURLToPath(moduleUrl)));
}

/** Resolve from the unpacked module tree; a host's unrelated node_modules must not hide an incomplete package. */
export function resolveIndexerPackage(moduleUrl: string, packageName: string): string {
  const modulePath = NodeURL.fileURLToPath(moduleUrl);
  const require = NodeModule.createRequire(filesystemModuleUrl(moduleUrl));
  const packagePath = resolveFilesystemAsset(require.resolve(`${packageName}/package.json`));
  const archiveRoot = /^(.*?\.asar(?:\.unpacked)?)(?=[\\/]|$)/i.exec(modulePath)?.[1];
  if (archiveRoot) {
    const root = NodeFS.realpathSync(unpackedAssetPath(archiveRoot));
    const relative = NodePath.relative(root, packagePath);
    if (
      relative === ".." ||
      relative.startsWith(`..${NodePath.sep}`) ||
      NodePath.isAbsolute(relative)
    ) {
      throw new Error(
        `Project indexer dependency is not present in the unpacked application: ${packageName}`,
      );
    }
  }
  return packagePath;
}
