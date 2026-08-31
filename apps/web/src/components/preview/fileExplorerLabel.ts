import type { ExecutionEnvironmentPlatformOs, FileManagerRevealKind } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

export type RevealInFileExplorerMessageKey = Extract<
  InterfaceMessageKey,
  "browser.files.revealFinder" | "browser.files.revealFileExplorer" | "browser.files.revealFiles"
>;

export function revealInFileExplorerMessageKey(platform: string): RevealInFileExplorerMessageKey {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return "browser.files.revealFinder";
  if (normalized.includes("win")) return "browser.files.revealFileExplorer";
  return "browser.files.revealFiles";
}

/** Same wording keyed by an environment's reported OS rather than a
    navigator platform string, for actions that reveal on the server machine. */
export function revealInFileExplorerMessageKeyForOs(
  os: ExecutionEnvironmentPlatformOs,
): RevealInFileExplorerMessageKey {
  if (os === "darwin") return "browser.files.revealFinder";
  if (os === "windows") return "browser.files.revealFileExplorer";
  return "browser.files.revealFiles";
}

/** Server-selected wording, including Windows File Explorer reached from WSL. */
export function revealInFileExplorerMessageKeyForKind(
  kind: FileManagerRevealKind,
): RevealInFileExplorerMessageKey {
  if (kind === "finder") return "browser.files.revealFinder";
  if (kind === "file-explorer") return "browser.files.revealFileExplorer";
  return "browser.files.revealFiles";
}
