import { hostPreviewMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { toSafeThreadAttachmentSegment } from "../attachmentStore.ts";

// Agents save chat screenshots to temp folders that a reboot clears, so T3 keeps its own copy.
const MEDIA_SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
const MEDIA_SNAPSHOT_MIME = /^(?:image|video|audio)\//;

export const mediaSnapshotDirectory = (
  path: Path.Path,
  attachmentsDir: string,
  threadId: string,
): string | null => {
  const segment = toSafeThreadAttachmentSegment(threadId);
  return segment === null ? null : path.join(attachmentsDir, "media-snapshots", segment);
};

export const mediaSnapshotPath = Effect.fn("MediaSnapshots.mediaSnapshotPath")(function* (input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly requestedPath: string;
}) {
  const path = yield* Path.Path;
  const directory = mediaSnapshotDirectory(path, input.attachmentsDir, input.threadId);
  if (directory === null) return null;
  const digest = yield* (yield* Crypto.Crypto).digest(
    "SHA-256",
    new TextEncoder().encode(input.requestedPath),
  );
  return path.join(directory, Hex.encode(digest).slice(0, 40), path.basename(input.requestedPath));
});

const isSnapshotMedia = (path: Path.Path, filePath: string): boolean =>
  MEDIA_SNAPSHOT_MIME.test(hostPreviewMimeTypeFromExtension(path.extname(filePath)) ?? "");

export const snapshotMediaFile = Effect.fn("MediaSnapshots.snapshotMediaFile")(function* (input: {
  readonly sourcePath: string;
  readonly snapshotPath: string;
  readonly fileRevision: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!isSnapshotMedia(path, input.sourcePath)) return;
  const revisionPath = path.join(path.dirname(input.snapshotPath), ".revision");
  const stored = yield* fileSystem
    .readFileString(revisionPath)
    .pipe(Effect.orElseSucceed(() => null));
  if (stored === input.fileRevision) return;
  const info = yield* fileSystem.stat(input.sourcePath);
  if (Number(info.size) > MEDIA_SNAPSHOT_MAX_BYTES) return;
  yield* fileSystem.makeDirectory(path.dirname(input.snapshotPath), { recursive: true });
  const partial = `${input.snapshotPath}.part`;
  yield* fileSystem.copyFile(input.sourcePath, partial);
  yield* fileSystem.rename(partial, input.snapshotPath);
  yield* fileSystem.writeFileString(revisionPath, input.fileRevision);
});
