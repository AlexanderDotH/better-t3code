import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ThreadTranscriptExport } from "../Services/ThreadTranscriptExport.ts";
import { ThreadTranscriptExportLive } from "./ThreadTranscriptExport.ts";

const threadId = ThreadId.make("thread-export-service");
const projectId = ProjectId.make("project-export-service");

const thread: OrchestrationThread = {
  id: threadId,
  projectId,
  title: "Service export",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: "/workspace",
  latestTurn: null,
  createdAt: "2026-07-12T10:00:00.000Z",
  updatedAt: "2026-07-12T10:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/workspace",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-07-12T10:00:00.000Z",
  updatedAt: "2026-07-12T10:00:00.000Z",
};

function queryLayer(input: {
  readonly thread: Option.Option<OrchestrationThread>;
  readonly project: Option.Option<OrchestrationProjectShell>;
}) {
  return Layer.succeed(
    ProjectionSnapshotQuery,
    ProjectionSnapshotQuery.of({
      getCommandReadModel: () => Effect.die("unused"),
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getArchivedShellSnapshot: () => Effect.die("unused"),
      getSnapshotSequence: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
      getProjectShellById: () => Effect.succeed(input.project),
      getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
      hasActiveProjectAgentPeer: () => Effect.die("unused"),
      getThreadCheckpointContext: () => Effect.die("unused"),
      getFullThreadDiffContext: () => Effect.die("unused"),
      getThreadShellById: () => Effect.die("unused"),
      getThreadDetailById: () => Effect.succeed(input.thread),
    }),
  );
}

function transactionLayer(onTransaction?: () => void) {
  return Layer.succeed(SqlClient.SqlClient, {
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      onTransaction?.();
      return effect;
    },
  } as unknown as SqlClient.SqlClient);
}

it.effect("exports a complete thread from the projection query", () => {
  let transactionCount = 0;
  return Effect.gen(function* () {
    const exporter = yield* ThreadTranscriptExport;
    const result = yield* exporter.exportThread(threadId);

    assert.strictEqual(result.formatVersion, 1);
    assert.include(result.content, "# Service export");
    assert.include(result.content, '"workspaceRoot": "/workspace"');
    assert.strictEqual(transactionCount, 1);
  }).pipe(
    Effect.provide(
      ThreadTranscriptExportLive.pipe(
        Layer.provide(queryLayer({ thread: Option.some(thread), project: Option.some(project) })),
        Layer.provide(
          transactionLayer(() => {
            transactionCount += 1;
          }),
        ),
      ),
    ),
  );
});

it.effect("returns a typed error when the thread does not exist", () =>
  Effect.gen(function* () {
    const exporter = yield* ThreadTranscriptExport;
    const error = yield* Effect.flip(exporter.exportThread(threadId));

    assert.strictEqual(error._tag, "OrchestrationThreadTranscriptNotFoundError");
  }).pipe(
    Effect.provide(
      ThreadTranscriptExportLive.pipe(
        Layer.provide(queryLayer({ thread: Option.none(), project: Option.some(project) })),
        Layer.provide(transactionLayer()),
      ),
    ),
  ),
);
