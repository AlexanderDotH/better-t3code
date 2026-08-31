// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { isIgnoredKnowledgeGraphWatchPath } from "./KnowledgeGraphPathPolicy.ts";
import { normalizeKnowledgeGraphRelativePath } from "./KnowledgeGraphSourceAnalysis.ts";

const COMMIT_MARKER = "__T3_KG_COMMIT__";
const MAX_COMMITS = 128;
const MAX_FILES_PER_COMMIT = 32;

export interface KnowledgeGraphCoChangeHistoryDependencies {
  readonly runGitLog: (cwd: string, args: readonly string[]) => Promise<string>;
}

const defaultDependencies: KnowledgeGraphCoChangeHistoryDependencies = {
  runGitLog: (cwd, args) =>
    new Promise((resolve, reject) => {
      NodeChildProcess.execFile(
        "git",
        [...args],
        { cwd, maxBuffer: 4 * 1_024 * 1_024, timeout: 5_000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
    }),
};

function completeGroup(groups: string[][], current: Set<string>): void {
  const paths = [...current].sort().slice(0, MAX_FILES_PER_COMMIT);
  if (paths.length > 1) groups.push(paths);
  current.clear();
}

export function parseKnowledgeGraphCoChangeHistory(output: string): readonly (readonly string[])[] {
  const groups: string[][] = [];
  const current = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    if (line.trim() === COMMIT_MARKER) {
      completeGroup(groups, current);
      continue;
    }
    const rawPath = line.trim();
    const path = normalizeKnowledgeGraphRelativePath(rawPath);
    if (
      NodePath.posix.isAbsolute(path) ||
      NodePath.win32.isAbsolute(rawPath) ||
      path.length === 0 ||
      path === ".." ||
      path.startsWith("../") ||
      isIgnoredKnowledgeGraphWatchPath(path)
    ) {
      continue;
    }
    current.add(path);
  }
  completeGroup(groups, current);
  return groups.slice(0, MAX_COMMITS);
}

export function readKnowledgeGraphCoChangeGroups(
  workspaceRoot: string,
  dependencies: KnowledgeGraphCoChangeHistoryDependencies = defaultDependencies,
): Effect.Effect<readonly (readonly string[])[]> {
  return Effect.tryPromise(() =>
    dependencies.runGitLog(workspaceRoot, [
      "-c",
      "core.quotepath=false",
      "log",
      `--max-count=${MAX_COMMITS}`,
      `--pretty=format:${COMMIT_MARKER}`,
      "--name-only",
      "--diff-filter=ACMR",
      "--no-renames",
      "--",
      ".",
    ]),
  ).pipe(
    Effect.map(parseKnowledgeGraphCoChangeHistory),
    Effect.orElseSucceed(() => []),
  );
}
