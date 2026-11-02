import {
  PROJECT_AGENT_MAX_PEERS,
  ProjectAgentCoordinationOperationError,
  ProjectAgentCoordinationUnavailableError,
  ProjectAgentMessageId,
  TurnId,
  resolveBetterT3FeatureFlag,
  type ProjectAgentClaimSetInput,
  type ProjectAgentClaimSetResult,
  type ProjectAgentCoordinationError,
  type ProjectAgentInboxInput,
  type ProjectAgentInboxResult,
  type ProjectAgentListResult,
  type ProjectAgentMessageSendInput,
  type ProjectAgentMessageSendResult,
  type ThreadId,
  type SubagentId,
  type ProviderInstanceId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { Platform } from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProjectionProjectAgentCoordinationRepository } from "../persistence/Services/ProjectionProjectAgentCoordination.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { findProjectAgentClaimConflicts, normalizeProjectAgentClaims } from "./claimRules.ts";

export interface ProjectAgentReplyExecution {
  readonly replyTopicId: SubagentId;
  readonly turnId: TurnId;
  readonly providerInstanceId: ProviderInstanceId;
}
export interface ProjectAgentCoordinatorShape {
  readonly list: (
    threadId: ThreadId,
    reply?: ProjectAgentReplyExecution,
  ) => Effect.Effect<ProjectAgentListResult, ProjectAgentCoordinationError>;
  readonly claim: (
    threadId: ThreadId,
    input: ProjectAgentClaimSetInput,
    reply?: ProjectAgentReplyExecution,
  ) => Effect.Effect<ProjectAgentClaimSetResult, ProjectAgentCoordinationError>;
  readonly send: (
    threadId: ThreadId,
    input: ProjectAgentMessageSendInput,
    reply?: ProjectAgentReplyExecution,
  ) => Effect.Effect<ProjectAgentMessageSendResult, ProjectAgentCoordinationError>;
  readonly inbox: (
    threadId: ThreadId,
    input: ProjectAgentInboxInput,
    reply?: ProjectAgentReplyExecution,
  ) => Effect.Effect<ProjectAgentInboxResult, ProjectAgentCoordinationError>;
}
export class ProjectAgentCoordinator extends Context.Service<
  ProjectAgentCoordinator,
  ProjectAgentCoordinatorShape
>()("t3/projectAgent/ProjectAgentCoordinator") {}

const make = Effect.gen(function* () {
  const orchestration = yield* OrchestratorV2;
  const projects = yield* ProjectStoreV2;
  const repository = yield* ProjectionProjectAgentCoordinationRepository;
  const settings = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const platform = yield* Platform;
  const sql = yield* SqlClient.SqlClient;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const operationError = (operation: "list" | "claim" | "send" | "inbox", cause: unknown) =>
    new ProjectAgentCoordinationOperationError({ operation, cause });
  const scope = Effect.fn("ProjectAgentCoordinator.scope")(function* (
    threadId: ThreadId,
    reply?: ProjectAgentReplyExecution,
    requireEnabled = true,
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => operationError("list", cause)),
    );
    if (
      requireEnabled &&
      !resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.projectCoordination")
    )
      return yield* operationError(
        "list",
        new Error("Project-agent coordination is disabled in Better T3 settings."),
      );
    const snapshot = yield* orchestration
      .getShellSnapshot()
      .pipe(Effect.mapError((cause) => operationError("list", cause)));
    const thread = snapshot.threads.find((candidate) =>
      reply === undefined
        ? candidate.id === threadId
        : candidate.messageReply?.sourceThreadId === threadId &&
          candidate.messageReply.replyTopicId === reply.replyTopicId,
    );
    if (
      !thread ||
      thread.activeRunId === null ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      (reply !== undefined && thread.providerInstanceId !== reply.providerInstanceId)
    )
      return yield* new ProjectAgentCoordinationUnavailableError({ reason: "thread_unavailable" });
    const project = yield* projects
      .get(thread.projectId)
      .pipe(Effect.mapError((cause) => operationError("list", cause)));
    if (Option.isNone(project))
      return yield* new ProjectAgentCoordinationUnavailableError({ reason: "project_unavailable" });
    const records = yield* orchestration
      .getThreadRecords(thread.id, ["providerTurns", "runs"])
      .pipe(Effect.mapError((cause) => operationError("list", cause)));
    const run = records.runs.find((candidate) => candidate.id === thread.activeRunId);
    const turn = records.providerTurns
      .filter((candidate) => candidate.runAttemptId === run?.activeAttemptId)
      .at(-1);
    const turnId =
      turn?.nativeTurnRef?.nativeId == null ? null : TurnId.make(turn.nativeTurnRef.nativeId);
    if (reply !== undefined && turnId !== reply.turnId)
      return yield* new ProjectAgentCoordinationUnavailableError({ reason: "thread_unavailable" });
    return { thread, project: project.value, threads: snapshot.threads, turnId };
  });
  const activePeers = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
    threads.filter((thread) => thread.activeRunId !== null);
  const list: ProjectAgentCoordinatorShape["list"] = Effect.fn("ProjectAgentCoordinator.list")(
    function* (threadId, reply) {
      const current = yield* scope(threadId, reply);
      const [leases, unread] = yield* Effect.all([
        repository.listClaimsByProjectId(current.project.projectId),
        repository.listUnreadCountsByProjectId(current.project.projectId),
      ]).pipe(Effect.mapError((cause) => operationError("list", cause)));
      const peers = current.threads
        .filter(
          (thread) =>
            thread.projectId === current.project.projectId &&
            thread.deletedAt === null &&
            thread.archivedAt === null,
        )
        .toSorted(
          (left, right) =>
            Number(right.id === current.thread.id) - Number(left.id === current.thread.id) ||
            Number(right.activeRunId !== null) - Number(left.activeRunId !== null) ||
            DateTime.Order(right.updatedAt, left.updatedAt),
        );
      return {
        peers: peers.slice(0, PROJECT_AGENT_MAX_PEERS).map((thread) => {
          const lease = leases.find((entry) => entry.threadId === thread.id);
          return {
            threadId: thread.id,
            self: thread.id === current.thread.id,
            phase:
              thread.activeRunId === null
                ? ("offline" as const)
                : thread.pendingRuntimeRequest
                  ? ("waiting" as const)
                  : thread.status === "starting"
                    ? ("starting" as const)
                    : ("working" as const),
            title: thread.title,
            model: thread.modelSelection.model,
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            summary: lease?.summary ?? null,
            claims: lease?.claims ?? [],
            unreadCount: unread.get(thread.id) ?? 0,
          };
        }),
        truncated: peers.length > PROJECT_AGENT_MAX_PEERS,
      };
    },
  );
  const claim: ProjectAgentCoordinatorShape["claim"] = Effect.fn("ProjectAgentCoordinator.claim")(
    function* (threadId, input, reply) {
      const current = yield* scope(threadId, reply, input.action !== "release");
      if (input.action === "release") {
        yield* repository
          .releaseClaimsByThreadId(current.thread.id)
          .pipe(Effect.mapError((cause) => operationError("claim", cause)));
        return { accepted: true, lease: null };
      }
      if (current.turnId === null)
        return yield* new ProjectAgentCoordinationUnavailableError({
          reason: "thread_unavailable",
        });
      const claims = yield* Effect.try({
        try: () =>
          normalizeProjectAgentClaims(input.claims, {
            caseInsensitivePaths: platform === "darwin" || platform === "win32",
          }),
        catch: (cause) => operationError("claim", cause),
      });
      const lease = {
        projectId: current.project.projectId,
        threadId: current.thread.id,
        turnId: current.turnId,
        summary: input.summary,
        claims,
        updatedAt: yield* nowIso,
      };
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const leases = yield* repository.listClaimsByProjectId(current.project.projectId);
            const conflicts = leases
              .filter(
                (other) =>
                  other.threadId !== current.thread.id &&
                  current.threads.some(
                    (thread) => thread.id === other.threadId && thread.activeRunId !== null,
                  ),
              )
              .flatMap((other) =>
                findProjectAgentClaimConflicts(claims, other.claims).map((pair) => ({
                  ...pair,
                  threadId: other.threadId,
                  threadTitle: current.threads.find((thread) => thread.id === other.threadId)!
                    .title,
                  summary: other.summary,
                })),
              );
            if (conflicts.length > 0) return { accepted: false as const, conflicts };
            yield* repository.upsertClaim(lease);
            return { accepted: true as const, lease };
          }),
        )
        .pipe(Effect.mapError((cause) => operationError("claim", cause)));
    },
  );
  const send: ProjectAgentCoordinatorShape["send"] = Effect.fn("ProjectAgentCoordinator.send")(
    function* (threadId, input, reply) {
      const current = yield* scope(threadId, reply);
      const peers = current.threads.filter(
        (thread) =>
          thread.projectId === current.project.projectId &&
          thread.id !== current.thread.id &&
          thread.deletedAt === null &&
          thread.archivedAt === null,
      );
      const target = input.target;
      const recipients =
        "broadcast" in target
          ? activePeers(peers)
          : peers.filter((thread) => thread.id === target.threadId);
      if (recipients.length === 0 || recipients.length > PROJECT_AGENT_MAX_PEERS)
        return yield* new ProjectAgentCoordinationUnavailableError({
          reason: "target_unavailable",
        });
      const messageId = ProjectAgentMessageId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
      const createdAt = yield* nowIso;
      const recipientThreadIds = recipients.map((thread) => thread.id);
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<{
              sequence: number;
            }>`SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM projection_project_agent_messages`;
            yield* repository.recordMessage({
              sequence: rows[0]!.sequence,
              projectId: current.project.projectId,
              messageId,
              senderThreadId: current.thread.id,
              recipientThreadIds,
              kind: input.kind,
              body: input.body,
              createdAt,
            });
          }),
        )
        .pipe(Effect.mapError((cause) => operationError("send", cause)));
      return { messageId, recipientThreadIds, createdAt };
    },
  );
  const inbox: ProjectAgentCoordinatorShape["inbox"] = Effect.fn("ProjectAgentCoordinator.inbox")(
    function* (threadId, input, reply) {
      const current = yield* scope(threadId, reply);
      if (input.acknowledgeThrough !== undefined)
        yield* repository
          .acknowledgeInbox({
            projectId: current.project.projectId,
            threadId: current.thread.id,
            acknowledgeThrough: input.acknowledgeThrough,
            acknowledgedAt: yield* nowIso,
          })
          .pipe(Effect.mapError((cause) => operationError("inbox", cause)));
      const page = yield* repository
        .readInbox({
          projectId: current.project.projectId,
          threadId: current.thread.id,
          limit: input.limit,
        })
        .pipe(Effect.mapError((cause) => operationError("inbox", cause)));
      return {
        messages: page.messages,
        cursor: page.cursor,
        nextAcknowledgeThrough: Math.max(
          page.cursor,
          page.messages.at(-1)?.sequence ?? page.cursor,
        ),
        hasMore: page.hasMore,
        historyTruncated:
          page.minRetainedSequence !== null && page.cursor < page.minRetainedSequence - 1,
      };
    },
  );
  const afterSequence = (yield* orchestration.getShellSnapshot()).snapshotSequence;
  yield* orchestration.streamStoredEventsFrom({ afterSequence, eventType: "run.updated" }).pipe(
    Stream.runForEach(
      Effect.fn("ProjectAgentCoordinator.releaseCompletedLease")(function* (stored) {
        const event = stored.event;
        if (
          event.type !== "run.updated" ||
          !["completed", "failed", "cancelled", "interrupted"].includes(event.payload.status)
        )
          return;
        const records = yield* orchestration.getThreadRecords(event.threadId, ["providerTurns"]);
        const turn = records.providerTurns.findLast(
          (turn) => turn.runAttemptId === event.payload.activeAttemptId,
        );
        const nativeTurnId = turn?.nativeTurnRef?.nativeId;
        if (nativeTurnId == null) return;
        yield* repository.releaseClaim({
          projectId: records.thread.projectId,
          threadId: event.threadId,
          expectedTurnId: TurnId.make(nativeTurnId),
        });
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Project-agent claim cleanup failed", { cause }),
    ),
    Effect.forkScoped,
  );
  yield* settings.streamChanges.pipe(
    Stream.map((current) =>
      resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.projectCoordination"),
    ),
    Stream.changes,
    Stream.filter((enabled) => !enabled),
    Stream.runForEach(
      Effect.fn("ProjectAgentCoordinator.releaseDisabledLeases")(function* () {
        for (const lease of yield* repository.listAllClaims())
          yield* repository.releaseClaim({
            projectId: lease.projectId,
            threadId: lease.threadId,
            expectedTurnId: lease.turnId,
          });
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Project-agent feature cleanup failed", { cause }),
    ),
    Effect.forkScoped,
  );
  return ProjectAgentCoordinator.of({ list, claim, send, inbox });
});
export const ProjectAgentCoordinatorLive = Layer.effect(ProjectAgentCoordinator, make);
