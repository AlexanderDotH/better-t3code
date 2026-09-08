import {
  CommandId,
  PROJECT_AGENT_MAX_PEERS,
  ProjectAgentClaimConflict,
  ProjectAgentCoordinationOperationError,
  ProjectAgentCoordinationUnavailableError,
  ProjectAgentMessageId,
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
  type TurnId,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionProjectAgentCoordinationRepository } from "../persistence/Services/ProjectionProjectAgentCoordination.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { normalizeProjectAgentClaims } from "./claimRules.ts";

export interface ProjectAgentCoordinatorShape {
  readonly list: (
    threadId: ThreadId,
  ) => Effect.Effect<ProjectAgentListResult, ProjectAgentCoordinationError>;
  readonly claim: (
    threadId: ThreadId,
    input: ProjectAgentClaimSetInput,
  ) => Effect.Effect<ProjectAgentClaimSetResult, ProjectAgentCoordinationError>;
  readonly send: (
    threadId: ThreadId,
    input: ProjectAgentMessageSendInput,
  ) => Effect.Effect<ProjectAgentMessageSendResult, ProjectAgentCoordinationError>;
  readonly inbox: (
    threadId: ThreadId,
    input: ProjectAgentInboxInput,
  ) => Effect.Effect<ProjectAgentInboxResult, ProjectAgentCoordinationError>;
}

export class ProjectAgentCoordinator extends Context.Service<
  ProjectAgentCoordinator,
  ProjectAgentCoordinatorShape
>()("t3/projectAgent/ProjectAgentCoordinator") {}

const decodeConflicts = Schema.decodeUnknownEffect(Schema.Array(ProjectAgentClaimConflict));
const isOrchestrationCommandInvariantError = Schema.is(OrchestrationCommandInvariantError);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function isAvailableThread(thread: {
  readonly archivedAt: string | null;
  readonly deletedAt?: string | null;
}): boolean {
  return (
    thread.archivedAt === null && (thread.deletedAt === undefined || thread.deletedAt === null)
  );
}

function isActiveThread(thread: {
  readonly archivedAt: string | null;
  readonly deletedAt?: string | null;
  readonly session: { readonly status: string; readonly activeTurnId: TurnId | null } | null;
  readonly latestTurn: { readonly state: string; readonly turnId: TurnId } | null;
}): boolean {
  return (
    isAvailableThread(thread) &&
    (thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      thread.latestTurn?.state === "running")
  );
}

function activeTurnId(thread: {
  readonly session: { readonly status: string; readonly activeTurnId: TurnId | null } | null;
  readonly latestTurn: { readonly state: string; readonly turnId: TurnId } | null;
}): TurnId | null {
  if (
    (thread.session?.status === "starting" || thread.session?.status === "running") &&
    thread.session.activeTurnId !== null
  ) {
    return thread.session.activeTurnId;
  }
  return thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null;
}

const makeCoordinator = Effect.gen(function* () {
  const snapshots = yield* ProjectionSnapshotQuery;
  const repository = yield* ProjectionProjectAgentCoordinationRepository;
  const orchestration = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const hostPlatform = yield* HostProcessPlatform;
  const settings = yield* ServerSettingsService;
  const coordinatorScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );

  const nextId = (prefix: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((value) => `${prefix}-${value}`),
    );

  const operationError = (operation: "list" | "claim" | "send" | "inbox", cause: unknown) =>
    new ProjectAgentCoordinationOperationError({ operation, cause });

  const ensureFeatureEnabled = Effect.fn("ProjectAgentCoordinator.ensureFeatureEnabled")(function* (
    operation: "list" | "claim" | "send" | "inbox",
  ) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => operationError(operation, cause)),
    );
    if (!resolveBetterT3FeatureFlag(current.betterT3Environment, "agent.projectCoordination")) {
      return yield* operationError(
        operation,
        new Error("Project-agent coordination is disabled in Better T3 settings."),
      );
    }
  });

  const readCommandModel = Effect.fn("ProjectAgentCoordinator.readCommandModel")(function* () {
    return yield* snapshots.getCommandReadModel().pipe(
      Effect.mapError(
        (cause) =>
          new ProjectAgentCoordinationUnavailableError({
            reason: "projection_unavailable",
            cause,
          }),
      ),
    );
  });

  const resolveScope = Effect.fn("ProjectAgentCoordinator.resolveScope")(function* (
    threadId: ThreadId,
  ) {
    const readModel = yield* readCommandModel();
    const thread = readModel.threads.find((candidate) => candidate.id === threadId);
    if (!thread || !isActiveThread(thread)) {
      return yield* new ProjectAgentCoordinationUnavailableError({
        reason: "thread_unavailable",
      });
    }
    const project = readModel.projects.find(
      (candidate) => candidate.id === thread.projectId && candidate.deletedAt === null,
    );
    if (!project) {
      return yield* new ProjectAgentCoordinationUnavailableError({
        reason: "project_unavailable",
      });
    }
    return { readModel, project, thread, turnId: activeTurnId(thread) } as const;
  });

  const list: ProjectAgentCoordinatorShape["list"] = Effect.fn("ProjectAgentCoordinator.list")(
    function* (threadId) {
      yield* ensureFeatureEnabled("list");
      const scope = yield* resolveScope(threadId);
      const [shell, unreadCounts] = yield* Effect.all([
        snapshots
          .getShellSnapshot()
          .pipe(Effect.mapError((cause) => operationError("list", cause))),
        repository
          .listUnreadCountsByProjectId(scope.project.id)
          .pipe(Effect.mapError((cause) => operationError("list", cause))),
      ]);
      const { readModel, project } = scope;

      const shellByThread = new Map(shell.threads.map((candidate) => [candidate.id, candidate]));
      const leaseByThread = new Map(
        project.coordinationClaims.map((lease) => [lease.threadId, lease]),
      );
      const projectPeers = readModel.threads
        .filter((candidate) => candidate.projectId === project.id && isAvailableThread(candidate))
        .toSorted((left, right) => {
          if (left.id === threadId) return -1;
          if (right.id === threadId) return 1;
          const activeOrder = Number(isActiveThread(right)) - Number(isActiveThread(left));
          if (activeOrder !== 0) return activeOrder;
          return (
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id)
          );
        });
      const peers = projectPeers.slice(0, PROJECT_AGENT_MAX_PEERS).map((candidate) => {
        const shellThread = shellByThread.get(candidate.id);
        const lease = leaseByThread.get(candidate.id);
        const waiting =
          shellThread?.hasPendingApprovals === true || shellThread?.hasPendingUserInput === true;
        return {
          threadId: candidate.id,
          self: candidate.id === threadId,
          phase: !isActiveThread(candidate)
            ? ("offline" as const)
            : waiting
              ? ("waiting" as const)
              : candidate.session?.status === "starting"
                ? ("starting" as const)
                : ("working" as const),
          title: candidate.title,
          model: candidate.modelSelection.model,
          branch: candidate.branch,
          worktreePath: candidate.worktreePath,
          summary: lease?.summary ?? null,
          claims: lease?.claims ?? [],
          unreadCount: unreadCounts.get(candidate.id) ?? 0,
        };
      });
      return { peers, truncated: projectPeers.length > peers.length };
    },
  );

  const claim: ProjectAgentCoordinatorShape["claim"] = Effect.fn("ProjectAgentCoordinator.claim")(
    function* (threadId, input) {
      if (input.action !== "release") yield* ensureFeatureEnabled("claim");
      const { project, turnId } = yield* resolveScope(threadId);
      const timestamp = yield* nowIso;
      if (input.action === "release") {
        const lease = project.coordinationClaims.find(
          (candidate) => candidate.threadId === threadId,
        );
        yield* orchestration
          .dispatch({
            type: "project.agent.claim.release",
            commandId: CommandId.make(yield* nextId("project-agent-claim-release")),
            projectId: project.id,
            threadId,
            ...(lease !== undefined || turnId !== null
              ? { expectedTurnId: lease?.turnId ?? turnId! }
              : {}),
            releasedAt: timestamp,
          })
          .pipe(Effect.mapError((cause) => operationError("claim", cause)));
        return { accepted: true, lease: null };
      }
      if (turnId === null) {
        return yield* new ProjectAgentCoordinationUnavailableError({
          reason: "thread_unavailable",
        });
      }
      const claims = yield* Effect.try({
        try: () =>
          normalizeProjectAgentClaims(input.claims, {
            caseInsensitivePaths: hostPlatform === "win32" || hostPlatform === "darwin",
          }),
        catch: (cause) => operationError("claim", cause),
      });
      const lease = {
        projectId: project.id,
        threadId,
        turnId,
        summary: input.summary,
        claims,
        updatedAt: timestamp,
      } as const;
      const dispatchResult = yield* Effect.result(
        orchestration.dispatch({
          type: "project.agent.claim.set",
          commandId: CommandId.make(yield* nextId("project-agent-claim-set")),
          projectId: project.id,
          threadId,
          turnId,
          summary: input.summary,
          claims,
          claimedAt: timestamp,
        }),
      );
      if (dispatchResult._tag === "Success") {
        return { accepted: true, lease };
      }
      const cause = dispatchResult.failure;
      if (
        isOrchestrationCommandInvariantError(cause) &&
        cause.code === "project_agent_claim_conflict" &&
        typeof cause.context === "object" &&
        cause.context !== null &&
        "conflicts" in cause.context
      ) {
        const conflicts = yield* decodeConflicts(
          (cause.context as { readonly conflicts: unknown }).conflicts,
        ).pipe(Effect.mapError((decodeCause) => operationError("claim", decodeCause)));
        return { accepted: false, conflicts };
      }
      return yield* operationError("claim", cause);
    },
  );

  const send: ProjectAgentCoordinatorShape["send"] = Effect.fn("ProjectAgentCoordinator.send")(
    function* (threadId, input) {
      yield* ensureFeatureEnabled("send");
      const { readModel, project } = yield* resolveScope(threadId);
      const projectPeers = readModel.threads.filter(
        (candidate) =>
          candidate.projectId === project.id &&
          candidate.id !== threadId &&
          isAvailableThread(candidate),
      );
      const activePeers = projectPeers.filter(isActiveThread);
      let recipientThreadIds: ReadonlyArray<ThreadId>;
      const target = input.target;
      if ("broadcast" in target) {
        if (activePeers.length === 0) {
          return yield* new ProjectAgentCoordinationUnavailableError({
            reason: "no_active_recipients",
          });
        }
        if (activePeers.length > PROJECT_AGENT_MAX_PEERS) {
          return yield* operationError("send", new Error("Too many active project agents."));
        }
        recipientThreadIds = activePeers.map((peer) => peer.id);
      } else {
        if (target.threadId === threadId) {
          return yield* new ProjectAgentCoordinationUnavailableError({ reason: "self_target" });
        }
        const recipient = projectPeers.find((peer) => peer.id === target.threadId);
        if (!recipient) {
          return yield* new ProjectAgentCoordinationUnavailableError({
            reason: "target_unavailable",
          });
        }
        recipientThreadIds = [recipient.id];
      }
      const timestamp = yield* nowIso;
      const messageId = ProjectAgentMessageId.make(yield* nextId("project-agent-message"));
      yield* orchestration
        .dispatch({
          type: "project.agent.message.send",
          commandId: CommandId.make(yield* nextId("project-agent-message-send")),
          projectId: project.id,
          messageId,
          senderThreadId: threadId,
          recipientThreadIds,
          kind: input.kind,
          body: input.body,
          sentAt: timestamp,
        })
        .pipe(Effect.mapError((cause) => operationError("send", cause)));
      return { messageId, recipientThreadIds, createdAt: timestamp };
    },
  );

  const inbox: ProjectAgentCoordinatorShape["inbox"] = Effect.fn("ProjectAgentCoordinator.inbox")(
    function* (threadId, input) {
      yield* ensureFeatureEnabled("inbox");
      const { project } = yield* resolveScope(threadId);
      if (input.acknowledgeThrough !== undefined) {
        const timestamp = yield* nowIso;
        yield* orchestration
          .dispatch({
            type: "project.agent.inbox.acknowledge",
            commandId: CommandId.make(yield* nextId("project-agent-inbox-acknowledge")),
            projectId: project.id,
            threadId,
            acknowledgeThrough: input.acknowledgeThrough,
            acknowledgedAt: timestamp,
          })
          .pipe(Effect.mapError((cause) => operationError("inbox", cause)));
      }
      const page = yield* repository
        .readInbox({ projectId: project.id, threadId, limit: input.limit })
        .pipe(Effect.mapError((cause) => operationError("inbox", cause)));
      const lastSequence = page.messages.at(-1)?.sequence ?? page.cursor;
      return {
        messages: page.messages,
        cursor: page.cursor,
        nextAcknowledgeThrough: Math.max(page.cursor, lastSequence),
        hasMore: page.hasMore,
        historyTruncated:
          page.minRetainedSequence !== null && page.cursor < page.minRetainedSequence - 1,
      };
    },
  );

  const releaseActiveClaims = Effect.fn("ProjectAgentCoordinator.releaseActiveClaims")(
    function* () {
      const readModel = yield* readCommandModel();
      const releasedAt = yield* nowIso;
      yield* Effect.forEach(
        readModel.projects,
        (project) =>
          Effect.forEach(
            project.coordinationClaims,
            (lease) =>
              Effect.gen(function* () {
                yield* orchestration.dispatch({
                  type: "project.agent.claim.release",
                  commandId: CommandId.make(yield* nextId("project-agent-feature-disabled")),
                  projectId: project.id,
                  threadId: lease.threadId,
                  expectedTurnId: lease.turnId,
                  releasedAt,
                });
              }),
            { concurrency: 1, discard: true },
          ),
        { concurrency: 1, discard: true },
      );
    },
  );

  yield* settings.streamChanges.pipe(
    Stream.map((next) =>
      resolveBetterT3FeatureFlag(next.betterT3Environment, "agent.projectCoordination"),
    ),
    Stream.changes,
    Stream.filter((enabled) => !enabled),
    Stream.runForEach(() => releaseActiveClaims()),
    Effect.catchCause((cause) =>
      Effect.logWarning("Project-agent feature reconciliation failed", {
        cause: Cause.pretty(cause),
      }),
    ),
    Effect.forkIn(coordinatorScope),
  );

  return ProjectAgentCoordinator.of({ list, claim, send, inbox });
});

export const ProjectAgentCoordinatorLive = Layer.effect(ProjectAgentCoordinator, makeCoordinator);
