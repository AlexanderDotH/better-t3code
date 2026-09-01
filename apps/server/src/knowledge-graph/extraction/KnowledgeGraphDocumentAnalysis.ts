// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import { normalizeKnowledgeGraphRelativePath } from "./KnowledgeGraphSourceAnalysis.ts";

export function isKnowledgeGraphDocumentationPath(path: string): boolean {
  const filename = NodePath.posix.basename(path).toLowerCase();
  return filename.startsWith("readme") || /\.(?:md|mdx)$/u.test(filename);
}

export function isKnowledgeGraphArchitecturePath(path: string): boolean {
  return /(?:^|\/)(?:architecture|architectural|adr(?:s)?|design|rfcs?)(?:[/.\-_]|$)/iu.test(path);
}

export function countKnowledgeGraphCoChanges(
  groups: readonly (readonly string[])[],
  knownFilePaths: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const paths = [...new Set(group.map(normalizeKnowledgeGraphRelativePath))]
      .filter((path) => knownFilePaths.has(path))
      .sort()
      .slice(0, 32);
    for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
        const pair = `${paths[leftIndex]}\0${paths[rightIndex]}`;
        counts.set(pair, (counts.get(pair) ?? 0) + 1);
      }
    }
  }
  return counts;
}
