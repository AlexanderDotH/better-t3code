import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";

import { writeFileStringAtomically } from "../../atomicWrite.ts";

export interface NativeHarnessHistoryFiles {
  readonly read: (sessionId: string) => Effect.Effect<string | undefined, PlatformError>;
  readonly write: (sessionId: string, contents: string) => Effect.Effect<void, PlatformError>;
}

function safeSessionFileName(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error("Native harness session ids must be safe file-name segments.");
  }
  return `${sessionId}.json`;
}

export const makeNativeHarnessHistoryFiles = Effect.fn("makeNativeHarnessHistoryFiles")(function* (
  directory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = (sessionId: string) => path.join(directory, safeSessionFileName(sessionId));
  return {
    read: (sessionId: string) => {
      const target = filePath(sessionId);
      return fileSystem
        .exists(target)
        .pipe(
          Effect.flatMap((exists) =>
            exists ? fileSystem.readFileString(target) : Effect.sync((): undefined => undefined),
          ),
        );
    },
    write: (sessionId: string, contents: string) =>
      writeFileStringAtomically({ filePath: filePath(sessionId), contents }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
  } satisfies NativeHarnessHistoryFiles;
});
