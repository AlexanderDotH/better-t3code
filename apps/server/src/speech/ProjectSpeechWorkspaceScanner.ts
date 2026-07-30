// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import type { ProjectEntry } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { isIgnoredProjectSpeechDirectoryName } from "./ProjectSpeechPathPolicy.ts";

const DEFAULT_ENTRY_LIMIT = 25_000;

export interface ProjectSpeechWorkspaceScanResult {
  readonly entries: ReadonlyArray<ProjectEntry>;
  readonly truncated: boolean;
}

export class ProjectSpeechWorkspaceScanError extends Schema.TaggedErrorClass<ProjectSpeechWorkspaceScanError>()(
  "ProjectSpeechWorkspaceScanError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const target = this.relativePath.length === 0 ? this.workspaceRoot : this.relativePath;
    return `Could not scan project speech context at '${target}'.`;
  }
}

export class ProjectSpeechWorkspaceScanner extends Context.Service<
  ProjectSpeechWorkspaceScanner,
  {
    readonly scan: (
      workspaceRoot: string,
    ) => Effect.Effect<ProjectSpeechWorkspaceScanResult, ProjectSpeechWorkspaceScanError>;
  }
>()("t3/speech/ProjectSpeechWorkspaceScanner") {}

interface PendingDirectory {
  readonly absolutePath: string;
  readonly relativePath: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

export const make = (
  options: { readonly entryLimit?: number } = {},
): Effect.Effect<ProjectSpeechWorkspaceScanner["Service"], never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const entryLimit = Math.max(1, Math.floor(options.entryLimit ?? DEFAULT_ENTRY_LIMIT));

    const readDirectory = Effect.fn("ProjectSpeechWorkspaceScanner.readDirectory")(function* (
      workspaceRoot: string,
      directory: PendingDirectory,
    ) {
      return yield* Effect.tryPromise({
        try: () => NodeFSP.readdir(directory.absolutePath, { withFileTypes: true }),
        catch: (cause) =>
          new ProjectSpeechWorkspaceScanError({
            workspaceRoot,
            relativePath: directory.relativePath,
            cause,
          }),
      });
    });

    const scan: ProjectSpeechWorkspaceScanner["Service"]["scan"] = Effect.fn(
      "ProjectSpeechWorkspaceScanner.scan",
    )(function* (workspaceRoot) {
      const entries: ProjectEntry[] = [];
      const pendingDirectories: PendingDirectory[] = [
        { absolutePath: workspaceRoot, relativePath: "" },
      ];
      let nextDirectoryIndex = 0;
      let truncated = false;

      while (nextDirectoryIndex < pendingDirectories.length && !truncated) {
        const directory = pendingDirectories[nextDirectoryIndex];
        nextDirectoryIndex += 1;
        if (directory === undefined) break;

        const directoryEntries =
          directory.relativePath.length === 0
            ? yield* readDirectory(workspaceRoot, directory)
            : yield* readDirectory(workspaceRoot, directory).pipe(Effect.orElseSucceed(() => []));
        directoryEntries.sort((left, right) => compareText(left.name, right.name));

        for (const entry of directoryEntries) {
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory() && isIgnoredProjectSpeechDirectoryName(entry.name)) continue;
          if (!entry.isDirectory() && !entry.isFile()) continue;
          if (entries.length === entryLimit) {
            truncated = true;
            break;
          }

          const relativePath = normalizeRelativePath(
            directory.relativePath.length === 0
              ? entry.name
              : path.join(directory.relativePath, entry.name),
          );
          if (entry.isDirectory()) {
            entries.push({ path: relativePath, kind: "directory" });
            pendingDirectories.push({
              absolutePath: path.join(directory.absolutePath, entry.name),
              relativePath,
            });
            continue;
          }
          entries.push({ path: relativePath, kind: "file" });
        }
      }

      return { entries, truncated };
    });

    return ProjectSpeechWorkspaceScanner.of({ scan });
  });

export const layer = Layer.effect(ProjectSpeechWorkspaceScanner, make());
