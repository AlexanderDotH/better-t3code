import {
  OrchestrationThreadTranscriptExportError,
  OrchestrationThreadTranscriptNotFoundError,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadTranscriptExport,
  type ThreadTranscriptExportShape,
} from "../Services/ThreadTranscriptExport.ts";
import { renderThreadTranscriptMarkdown } from "../threadTranscript.ts";

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const sql = yield* SqlClient.SqlClient;

  const exportThread: ThreadTranscriptExportShape["exportThread"] = Effect.fn(
    "ThreadTranscriptExport.exportThread",
  )(function* (threadId: ThreadId) {
    const snapshot = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const thread = yield* projectionSnapshotQuery.getThreadDetailById(threadId).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationThreadTranscriptExportError({
                  message: `Failed to load thread ${threadId} for export`,
                  cause,
                }),
            ),
          );
          if (Option.isNone(thread)) {
            return yield* new OrchestrationThreadTranscriptNotFoundError({ threadId });
          }

          const project = yield* projectionSnapshotQuery
            .getProjectShellById(thread.value.projectId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationThreadTranscriptExportError({
                    message: `Failed to load project ${thread.value.projectId} for export`,
                    cause,
                  }),
              ),
            );
          if (Option.isNone(project)) {
            return yield* new OrchestrationThreadTranscriptExportError({
              message: `Project ${thread.value.projectId} was not found for thread export`,
            });
          }
          return { thread: thread.value, project: project.value };
        }),
      )
      .pipe(
        Effect.mapError((cause) => {
          if (
            cause._tag === "OrchestrationThreadTranscriptNotFoundError" ||
            cause._tag === "OrchestrationThreadTranscriptExportError"
          ) {
            return cause;
          }
          return new OrchestrationThreadTranscriptExportError({
            message: `Failed to read a consistent snapshot for thread ${threadId}`,
            cause,
          });
        }),
      );

    const generatedAt = DateTime.formatIso(yield* DateTime.now);
    return yield* Effect.try({
      try: () =>
        renderThreadTranscriptMarkdown({
          thread: snapshot.thread,
          project: snapshot.project,
          generatedAt,
        }),
      catch: (cause) =>
        new OrchestrationThreadTranscriptExportError({
          message: `Failed to render thread ${threadId} transcript`,
          cause,
        }),
    });
  });

  return ThreadTranscriptExport.of({ exportThread });
});

export const ThreadTranscriptExportLive = Layer.effect(ThreadTranscriptExport, make);
