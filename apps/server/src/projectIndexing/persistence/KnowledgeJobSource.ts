import * as Effect from "effect/Effect";

import { hashProjectSourceFile } from "../privacy/WorkspacePrivacy.ts";
import { asStoreError, KnowledgeStoreError } from "./KnowledgeStoreSchema.ts";
import type { KnowledgeJob } from "./KnowledgeStoreTypes.ts";

export const validateKnowledgeJobSource = Effect.fn("validateKnowledgeJobSource")(function* (
  workspaceRoot: string,
  job: Pick<KnowledgeJob, "filePath" | "contentHash">,
) {
  if (job.filePath === "" || job.contentHash === "") return;
  const currentHash = yield* hashProjectSourceFile(workspaceRoot, job.filePath).pipe(
    Effect.catch((error) =>
      error.code === "source-unavailable" &&
      error.cause instanceof Error &&
      "code" in error.cause &&
      error.cause.code === "ENOENT"
        ? Effect.succeed(null)
        : Effect.fail(error),
    ),
    Effect.mapError(asStoreError("validate job source")),
  );
  if (currentHash !== job.contentHash)
    return yield* new KnowledgeStoreError({
      code: "stale-source",
      detail: `The source changed while indexing ${job.filePath}.`,
    });
});
