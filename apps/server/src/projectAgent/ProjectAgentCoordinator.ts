import {
  PROJECT_AGENT_MAX_PEERS,
  CommandId,
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
  type ProjectId,
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
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProjectionProjectAgentCoordinationRepository } from "../persistence/Services/ProjectionProjectAgentCoordination.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { findProjectAgentClaimConflicts, normalizeProjectAgentClaims } from "./claimRules.ts";
import { activeRepliesBySource, isAvailableThread, isRootThread } from "./projectAgentThreads.ts";

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
  const outbox = yield* EffectOutbox.EffectOutboxV2;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const operationError = (operation: "list" | "claim" | "send" | "inbox", cause: unknown) =>
    new ProjectAgentCoordinationOperationError({ operation, cause });
  const activeNativeTurnId = Effect.fn("ProjectAgentCoordinator.activeNativeTurnId")(function* (
    thread: OrchestrationV2ThreadShell,
  ) {
    if (thread.activeRunId === null) return null;
    const { runs } = yield* orchestration.getThreadRecords(thread.id, ["runs"], {
      runIds: [thread.activeRunId],
    });
    const attemptId = runs.find((run) => run.id === thread.activeRunId)?.activeAttemptId;
    if (attemptId == null) return null;
    const { providerTurns } = yield* orchestration.getThreadRecords(thread.id, ["providerTurns"], {
      providerTurnAttemptIds: [attemptId],
    });
    const nativeId = providerTurns.at(-1)?.nativeTurnRef?.nativeId;
    return nativeId == null ? null : TurnId.make(nativeId);
  });
  const activeClaims = Effect.fn("ProjectAgentCoordinator.activeClaims")(function* (
    projectId: ProjectId,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) {
    const claims = yield* repository.listClaimsByProjectId(projectId);
    if (claims.length === 0) return claims;
    const threadById = new Map(
      threads
        .filter(
          (thread) =>
            thread.projectId === projectId && isAvailableThread(thread) && isRootThread(thread),
        )
        .map((thread) => [thread.id, thread]),
    );
    const replies = activeRepliesBySource(threads);
    return yield* Effect.filter(claims, (lease) => {
      const thread = threadById.get(lease.threadId);
      if (thread === undefined) return Effect.succeed(false);
      if (
        replies
          .get(thread.id)
          ?.some(
            (reply) =>
              reply.activeRunId !== null && TurnId.make(reply.activeRunId) === lease.turnId,
          )
      )
        return Effect.succeed(true);
      return activeNativeTurnId(thread).pipe(
        Effect.map((turnId) => turnId !== null && turnId === lease.turnId),
      );
    });
  });
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
    const called = yield* orchestration
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => operationError("list", cause)));
    if (called === null)
      return yield* new ProjectAgentCoordinationUnavailableError({ reason: "thread_unavailable" });
    const snapshot = yield* orchestration
      .getShellSnapshot({ projectId: called.projectId })
      .pipe(Effect.mapError((cause) => operationError("list", cause)));
    const caller = snapshot.threads.find((candidate) => candidate.id === threadId);
    // A reply topic coordinates under its source chat's identity while its own run is current.
    const replyThread =
      reply !== undefined
        ? snapshot.threads.find(
            (candidate) =>
              candidate.messageReply?.sourceThreadId === threadId &&
              candidate.messageReply.replyTopicId === reply.replyTopicId,
          )
        : caller?.messageReply !== undefined
          ? caller
          : undefined;
    const thread =
      reply === undefined && replyThread?.messageReply !== undefined
        ? snapshot.threads.find(
            (candidate) => candidate.id === replyThread.messageReply?.sourceThreadId,
          )
        : caller;
    const replyRunId = replyThread?.activeRunId ?? null;
    if (
      !thread ||
      !isAvailableThread(thread) ||
      !isRootThread(thread) ||
      (replyThread === undefined
        ? reply !== undefined || thread.activeRunId === null
        : !isAvailableThread(replyThread) ||
          replyRunId === null ||
          (reply !== undefined &&
            (TurnId.make(replyRunId) !== reply.turnId ||
              replyThread.providerInstanceId !== reply.providerInstanceId)))
    )
      return yield* new ProjectAgentCoordinationUnavailableError({ reason: "thread_unavailable" });
    const project = yield* projects
      .get(thread.projectId)
      .pipe(Effect.mapError((cause) => operationError("list", cause)));
    if (Option.isNone(project))
      return yield* new ProjectAgentCoordinationUnavailableError({ reason: "project_unavailable" });
    const turnId =
      replyRunId !== null
        ? TurnId.make(replyRunId)
        : yield* activeNativeTurnId(thread).pipe(
            Effect.mapError((cause) => operationError("list", cause)),
          );
    const replies = activeRepliesBySource(snapshot.threads);
    const peers = snapshot.threads.filter(
      (candidate) =>
        candidate.projectId === thread.projectId &&
        isAvailableThread(candidate) &&
        isRootThread(candidate),
    );
    return { thread, project: project.value, threads: snapshot.threads, peers, replies, turnId };
  });
  /** The thread whose run speaks for a peer: its own run, else a running reply topic. */
  const workingThread = (
    current: { readonly replies: ReadonlyMap<ThreadId, ReadonlyArray<OrchestrationV2ThreadShell>> },
    thread: OrchestrationV2ThreadShell,
  ) => (thread.activeRunId !== null ? thread : current.replies.get(thread.id)?.[0]);
  const list: ProjectAgentCoordinatorShape["list"] = Effect.fn("ProjectAgentCoordinator.list")(
    function* (threadId, reply) {
      const current = yield* scope(threadId, reply);
      const [leases, unread] = yield* Effect.all([
        activeClaims(current.project.projectId, current.threads),
        repository.listUnreadCountsByProjectId(current.project.projectId),
      ]).pipe(Effect.mapError((cause) => operationError("list", cause)));
      const peers = current.peers.toSorted(
        (left, right) =>
          Number(right.id === current.thread.id) - Number(left.id === current.thread.id) ||
          Number(workingThread(current, right) !== undefined) -
            Number(workingThread(current, left) !== undefined) ||
          DateTime.Order(right.updatedAt, left.updatedAt),
      );
      return {
        peers: peers.slice(0, PROJECT_AGENT_MAX_PEERS).map((thread) => {
          const lease = leases.find((entry) => entry.threadId === thread.id);
          const working = workingThread(current, thread);
          return {
            threadId: thread.id,
            self: thread.id === current.thread.id,
            phase:
              working === undefined
                ? ("offline" as const)
                : working.pendingRuntimeRequest
                  ? ("waiting" as const)
                  : working.status === "starting"
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
            const leases = yield* activeClaims(current.project.projectId, current.threads);
            const conflicts = leases
              .filter(
                (other) =>
                  other.threadId !== current.thread.id &&
                  current.peers.some(
                    (thread) =>
                      thread.id === other.threadId && workingThread(current, thread) !== undefined,
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
      const peers = current.peers.filter((thread) => thread.id !== current.thread.id);
      const target = input.target;
      const recipients =
        "broadcast" in target
          ? peers.filter((thread) => workingThread(current, thread) !== undefined)
          : peers.filter((thread) => thread.id === target.threadId);
      if (recipients.length === 0 || recipients.length > PROJECT_AGENT_MAX_PEERS)
        return yield* new ProjectAgentCoordinationUnavailableError({
          reason: "target_unavailable",
        });
      const messageId = ProjectAgentMessageId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie));
      const createdAt = yield* nowIso;
      const recipientThreadIds = recipients.map((thread) => thread.id);
      const commandId = CommandId.make(`project-agent-message:${messageId}`);
      const deliveryEffects: ReadonlyArray<EffectOutbox.PendingOrchestrationEffectV2> = [
        { thread: current.thread, direction: "sent" as const },
        ...recipients.map((thread) => ({ thread, direction: "received" as const })),
      ].map(({ thread, direction }) => ({
        id: `${commandId}:${thread.id}:${direction}`,
        commandId,
        threadId: thread.id,
        request: {
          type: "project-agent.message.deliver",
          projectId: current.project.projectId,
          messageId,
          senderThreadId: current.thread.id,
          senderTitle: current.thread.title,
          kind: input.kind,
          body: input.body,
          sentAt: createdAt,
          direction,
          recipientCount: recipients.length,
          ...(direction === "received" && !("broadcast" in target) && thread.activeRunId === null
            ? { wake: { latestRunId: thread.latestRunId } }
            : {}),
        },
      }));
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
            yield* outbox.enqueue(deliveryEffects);
          }),
        )
        .pipe(
          Effect.andThen(outbox.notifyAvailable(deliveryEffects.length)),
          Effect.uninterruptible,
          Effect.mapError((cause) => operationError("send", cause)),
        );
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
        const sourceThreadId = records.thread.messageReply?.sourceThreadId;
        if (sourceThreadId !== undefined) {
          yield* repository.releaseClaim({
            projectId: records.thread.projectId,
            threadId: sourceThreadId,
            expectedTurnId: TurnId.make(event.payload.id),
          });
          return;
        }
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
