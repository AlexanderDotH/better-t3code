import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { projectThreadDetailSnapshot } from "./ActivityPayloadProjection.ts";
import { cleanupFailedUploadedAttachments, normalizeDispatchCommand } from "./Normalizer.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "./Services/ThreadDeletionReactor.ts";
import { makeOrchestrationCommandDispatcher } from "./orchestrationCommandDispatcher.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { ProjectSetupScriptRunner } from "../project/ProjectSetupScriptRunner.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const threadDeletionReactor = yield* ThreadDeletionReactor;

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.orchestration.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          // Serve the lightweight command read model (thread bodies empty)
          // instead of the fully hydrated snapshot. Hydrating every message
          // and activity payload in the database has OOM-killed servers, and
          // the route's only consumer (the project CLI) reads projects alone —
          // UI clients load the shell and per-thread snapshots instead.
          return yield* projectionSnapshotQuery
            .getCommandReadModel()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* projectionSnapshotQuery
            .getShellSnapshot()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(
              args.params.threadId,
              args.payload.turnLimit === undefined
                ? undefined
                : {
                    turnLimit: args.payload.turnLimit,
                    ...(args.payload.beforeCursor !== undefined
                      ? { beforeCursor: args.payload.beforeCursor }
                      : {}),
                  },
            )
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
              ),
            );
          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("thread_not_found");
          }
          return projectThreadDetailSnapshot(snapshot.value);
        }),
      )
      .handle(
        "subagentSnapshot",
        Effect.fn("environment.orchestration.subagentSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);

          const snapshot = yield* projectionSnapshotQuery
            .getSubagentDetailSnapshot(
              args.params.threadId,
              args.params.subagentId,
              args.payload.activityLimit === undefined
                ? undefined
                : {
                    activityLimit: args.payload.activityLimit,
                    ...(args.payload.beforeCursor !== undefined
                      ? { beforeCursor: args.payload.beforeCursor }
                      : {}),
                  },
            )
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_subagent_snapshot_failed", cause),
              ),
            );
          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("subagent_not_found");
          }
          return snapshot.value;
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          const dispatcher =
            args.payload.type === "thread.turn.start"
              ? yield* Effect.gen(function* () {
                  const crypto = yield* Crypto.Crypto;
                  const gitWorkflow = yield* GitWorkflowService;
                  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
                  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
                  return makeOrchestrationCommandDispatcher({
                    dispatch: orchestrationEngine.dispatch,
                    randomUuid: crypto.randomUUIDv4,
                    nowIso: DateTime.now.pipe(Effect.map(DateTime.formatIso)),
                    gitWorkflow,
                    projectSetupScriptRunner,
                    drainThreadDeletionThrough: threadDeletionReactor.drainThrough,
                    refreshGitStatus: (cwd) =>
                      vcsStatusBroadcaster
                        .refreshStatus(cwd)
                        .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid),
                    resolveThread: (threadId) =>
                      projectionSnapshotQuery
                        .getThreadShellById(threadId)
                        .pipe(Effect.map(Option.getOrUndefined)),
                    resolveProject: (projectId) =>
                      projectionSnapshotQuery
                        .getProjectShellById(projectId)
                        .pipe(Effect.map(Option.getOrUndefined)),
                  });
                })
              : undefined;
          if (
            args.payload.type === "thread.turn.start" &&
            args.payload.bootstrap === undefined &&
            dispatcher !== undefined
          ) {
            yield* dispatcher
              .prepareTurnWorkspace({
                commandId: args.payload.commandId,
                threadId: args.payload.threadId,
                messageText: args.payload.message.text,
                attachmentCount: args.payload.message.attachments.length,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  failEnvironmentInternal("orchestration_dispatch_failed", Cause.squash(cause)),
                ),
              );
          }
          const normalizedCommand = yield* normalizeDispatchCommand(args.payload).pipe(
            Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")),
          );
          return yield* Effect.gen(function* () {
            if (normalizedCommand.type === "thread.turn.start" && dispatcher !== undefined) {
              return yield* dispatcher.dispatch(normalizedCommand);
            }
            return yield* orchestrationEngine.dispatch(normalizedCommand);
          }).pipe(
            Effect.tapError(() =>
              cleanupFailedUploadedAttachments(args.payload, normalizedCommand),
            ),
            Effect.catchCause((cause) =>
              failEnvironmentInternal("orchestration_dispatch_failed", Cause.squash(cause)),
            ),
          );
        }),
      );
  }),
);
