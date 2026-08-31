import { describe, expect, it } from "vite-plus/test";

import {
  revealInFileExplorerMessageKey,
  revealInFileExplorerMessageKeyForKind,
  revealInFileExplorerMessageKeyForOs,
} from "./fileExplorerLabel";

describe("revealInFileExplorerMessageKey", () => {
  it.each([
    ["MacIntel", "browser.files.revealFinder"],
    ["Win32", "browser.files.revealFileExplorer"],
    ["Linux x86_64", "browser.files.revealFiles"],
  ])("maps %s to %s", (platform, expected) => {
    expect(revealInFileExplorerMessageKey(platform)).toBe(expected);
  });
});

describe("revealInFileExplorerMessageKeyForOs", () => {
  it.each([
    ["darwin", "browser.files.revealFinder"],
    ["windows", "browser.files.revealFileExplorer"],
    ["linux", "browser.files.revealFiles"],
    ["unknown", "browser.files.revealFiles"],
  ] as const)("maps %s to %s", (os, expected) => {
    expect(revealInFileExplorerMessageKeyForOs(os)).toBe(expected);
  });
});

describe("revealInFileExplorerMessageKeyForKind", () => {
  it.each([
    ["finder", "browser.files.revealFinder"],
    ["file-explorer", "browser.files.revealFileExplorer"],
    ["files", "browser.files.revealFiles"],
  ] as const)("maps %s to %s", (kind, expected) => {
    expect(revealInFileExplorerMessageKeyForKind(kind)).toBe(expected);
  });
});
