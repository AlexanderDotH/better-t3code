import { ProjectId, type HarnessChatTargetProject } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const resolveHarnessChatTargetProject = Effect.fn("resolveHarnessChatTargetProject")(
  function* (input: {
    readonly cwd: string | null;
    readonly projects: ReadonlyArray<{
      readonly id: ProjectId;
      readonly workspaceRoot: string;
    }>;
  }): Effect.fn.Return<HarnessChatTargetProject, never, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceCwd = input.cwd?.trim();
    if (!sourceCwd) return { kind: "unresolved", sourceCwd: null };

    const normalizedCwd = path.resolve(sourceCwd);
    const existing = input.projects.find(
      (project) => path.resolve(project.workspaceRoot) === normalizedCwd,
    );
    if (existing) return { kind: "existing", projectId: existing.id };

    const isDirectory = yield* fileSystem.stat(normalizedCwd).pipe(
      Effect.map((stat) => stat.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!isDirectory) return { kind: "unresolved", sourceCwd: normalizedCwd };

    return {
      kind: "create",
      rootPath: normalizedCwd,
      suggestedName: path.basename(normalizedCwd).trim() || "Imported project",
    };
  },
);
