// @effect-diagnostics nodeBuiltinImport:off - Native modules and compiler payloads load from the runtime's real filesystem.
import * as NodeModule from "node:module";
import * as NodeSea from "node:sea";
import * as NodeURL from "node:url";

export function runtimeModuleUrl(moduleUrl: string): string {
  return NodeSea.isSea() ? NodeURL.pathToFileURL(process.execPath).href : moduleUrl;
}

/** ASAR paths must resolve to the unpacked files used by Node and native loaders. */
export function unpackedFilePath(filePath: string): string {
  return filePath.replace(/(^|[\\/])([^\\/]+\.asar)(?=[\\/]|$)/i, "$1$2.unpacked");
}

export function createFileBackedRequire(moduleUrl: string) {
  // Electron resolves archived wrappers and redirects native binaries itself.
  // Rewriting the origin to .unpacked hides dependencies that remain archived.
  return NodeModule.createRequire(runtimeModuleUrl(moduleUrl));
}
