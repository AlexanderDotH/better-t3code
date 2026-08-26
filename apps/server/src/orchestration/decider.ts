import {
  EventId,
  MessageId,
  PROJECT_AGENT_MAX_ACTIVITY_PREVIEW_CHARS,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  listThreadsByProjectId,
  requireActiveProjectWorkspaceRootAbsent,
  requireProject,
  requireProjectAbsent,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import { projectEvent } from "./projector.ts";
import { findProjectAgentClaimConflicts } from "../projectAgent/claimRules.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

// Session adoption takes seconds; a user message still unadopted after this
// window is a failed/stale start, not pending work. Mirrors the client's
// QUEUED_TURN_START_GRACE_MS in client-runtime threadSettled.ts.
const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

function isAvailableProjectAgentThread(thread: OrchestrationReadModel["threads"][number]): boolean {
  return thread.deletedAt === null && thread.archivedAt === null;
}

function isActiveProjectAgentThread(thread: OrchestrationReadModel["threads"][number]): boolean {
  return (
    isAvailableProjectAgentThread(thread) &&
    (thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      thread.latestTurn?.state === "running")
  );
}

function activeProjectAgentTurnId(
  thread: OrchestrationReadModel["threads"][number],
): TurnId | null {
  if (
    (thread.session?.status === "starting" || thread.session?.status === "running") &&
    thread.session.activeTurnId !== null
  ) {
    return thread.session.activeTurnId;
  }
  return thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null;
}

function currentProjectAgentLease(
  readModel: OrchestrationReadModel,
  threadId: OrchestrationReadModel["threads"][number]["id"],
) {
  const thread = readModel.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return undefined;
  return readModel.projects
    .find((project) => project.id === thread.projectId)
    ?.coordinationClaims.find((lease) => lease.threadId === threadId);
}

/**
 * Blocked-on-you work derived from the thread's retained activities: an
 * approval or user-input request with no later resolution for the same
 * requestId. The server-side twin of the shell's hasPendingApprovals /
 * hasPendingUserInput flags, which the decider read model does not carry.
 * The clearing rules MUST match ProjectionPipeline's pending accounting —
 * resolved activities always clear, respond.failed clears only when the
 * failure detail marks the request stale/unknown — or settle would be
 * rejected on threads whose shell flags read as clear.
 */
function isStaleRequestFailureDetail(payload: Record<string, unknown> | null): boolean {
  const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
  if (detail === null) return false;
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request") ||
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

// Scans the read model's activities, which the projector caps at the most
// recent 500. That bound is safe here: an OPEN approval/user-input request
// blocks its turn, so the thread cannot accumulate hundreds of later
// activities while one is outstanding — a request that has scrolled out of
// the window is one whose turn kept running, i.e. it was resolved or went
// stale. (The projection pipeline's pendingApprovalCount reads the same
// capped stream and stays consistent with this view.)
function hasOpenBlockingRequest(thread: {
  readonly activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>;
}): boolean {
  const openRequestIds = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      openRequestIds.add(requestId);
    } else if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      openRequestIds.delete(requestId);
    } else if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStaleRequestFailureDetail(payload)
    ) {
      openRequestIds.delete(requestId);
    }
  }
  return openRequestIds.size > 0;
}

/**
 * A queued turn start — a user message no turn has picked up yet — is work
 * in flight even though session is still null (turn.start emits
 * message-sent + turn-start-requested; the session arrives later). Detection
 * mirrors the client's hasQueuedTurnStart: the newest user message is
 * strictly newer than every latestTurn timestamp (adoption stamps the new
 * turn's requestedAt with the message time, clearing this), and only within
 * the adoption grace window — historical threads whose last user message
 * postdates their turn timestamps (older-server data, mid-turn messages)
 * must not be blocked forever. A failed session start (status "error")
 * clears the block immediately.
 *
 * The age check is bounded on BOTH sides: message timestamps are
 * client-supplied, so a client clock ahead of the server yields a negative
 * age. Without the lower bound that negative age satisfies `<= grace` for
 * as long as the skew lasts, extending the block far past the intended two
 * minutes.
 */
function threadHasQueuedTurnStart(
  thread: {
    readonly messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }>;
    readonly latestTurn: {
      readonly requestedAt: string;
      readonly startedAt: string | null;
      readonly completedAt: string | null;
    } | null;
    readonly session: { readonly status: string } | null;
  },
  occurredAt: string,
): boolean {
  const latestUserMessageAtMs = thread.messages.reduce(
    (latest, message) =>
      message.role === "user" ? Math.max(latest, Date.parse(message.createdAt)) : latest,
    Number.NEGATIVE_INFINITY,
  );
  const latestTurnAtMs =
    thread.latestTurn === null
      ? Number.NEGATIVE_INFINITY
      : Math.max(
          ...[
            thread.latestTurn.requestedAt,
            thread.latestTurn.startedAt,
            thread.latestTurn.completedAt,
          ].map((candidate) =>
            candidate == null ? Number.NEGATIVE_INFINITY : Date.parse(candidate),
          ),
        );
  const queuedAgeMs = Date.parse(occurredAt) - latestUserMessageAtMs;
  return (
    thread.session?.status !== "error" &&
    Number.isFinite(latestUserMessageAtMs) &&
    latestUserMessageAtMs > latestTurnAtMs &&
    Math.abs(queuedAgeMs) <= QUEUED_TURN_START_GRACE_MS
  );
}

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Effect.Effect<
  Omit<OrchestrationEvent, "sequence" | "type" | "payload">,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Crypto.Crypto.pipe(
    Effect.flatMap((crypto) =>
      crypto.randomUUIDv4.pipe(
        Effect.map((eventId) => ({
          eventId: EventId.make(eventId),
          aggregateKind: input.aggregateKind,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
          causationEventId: null,
          correlationId: input.commandId,
          metadata: input.metadata ?? {},
        })),
      ),
    ),
  );
}

const makeThreadLifecycleResetEvents = Effect.fn("makeThreadLifecycleResetEvents")(
  function* (input: {
    readonly thread: OrchestrationReadModel["threads"][number];
    readonly occurredAt: string;
    readonly commandId: OrchestrationCommand["commandId"];
  }): Effect.fn.Return<
    ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
    PlatformError.PlatformError,
    Crypto.Crypto
  > {
    const events: Array<Omit<OrchestrationEvent, "sequence">> = [];
    if (input.thread.settledOverride !== null) {
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: input.thread.id,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: input.thread.id,
          reason: "activity",
          updatedAt: input.occurredAt,
        },
      });
    }
    if (input.thread.snoozedUntil != null) {
      events.push({
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: input.thread.id,
          occurredAt: input.occurredAt,
          commandId: input.commandId,
        })),
        type: "thread.unsnoozed",
        payload: {
          threadId: input.thread.id,
          reason: "activity",
          updatedAt: input.occurredAt,
        },
      });
    }
    return events;
  },
);

type PlannedOrchestrationEvent = Omit<OrchestrationEvent, "sequence">;

type DecideOrchestrationCommandResult =
  | PlannedOrchestrationEvent
  | ReadonlyArray<PlannedOrchestrationEvent>;

const decideCommandSequence = Effect.fn("decideCommandSequence")(function* ({
  commands,
  readModel,
}: {
  readonly commands: ReadonlyArray<OrchestrationCommand>;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  let nextReadModel = readModel;
  let nextSequence = readModel.snapshotSequence;
  const plannedEvents: PlannedOrchestrationEvent[] = [];

  for (const nextCommand of commands) {
    const decided = yield* decideOrchestrationCommand({
      command: nextCommand,
      readModel: nextReadModel,
    });
    const nextEvents = Array.isArray(decided) ? decided : [decided];
    for (const nextEvent of nextEvents) {
      plannedEvents.push(nextEvent);
      nextSequence += 1;
      nextReadModel = yield* projectEvent(nextReadModel, {
        ...nextEvent,
        sequence: nextSequence,
      }).pipe(Effect.orDie);
    }
  }

  return plannedEvents;
});

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireActiveProjectWorkspaceRootAbsent({
        readModel,
        command,
        workspaceRoot: command.workspaceRoot,
        exceptProjectId: command.projectId,
      });

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          checkpointsEnabled: true,
          faviconPath: null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      if (command.workspaceRoot !== undefined) {
        yield* requireActiveProjectWorkspaceRootAbsent({
          readModel,
          command,
          workspaceRoot: command.workspaceRoot,
          exceptProjectId: command.projectId,
        });
      }
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.defaultThreadEnvMode !== undefined
            ? { defaultThreadEnvMode: command.defaultThreadEnvMode }
            : {}),
          ...(command.checkpointsEnabled !== undefined
            ? { checkpointsEnabled: command.checkpointsEnabled }
            : {}),
          ...(command.faviconPath !== undefined ? { faviconPath: command.faviconPath } : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const activeThreads = listThreadsByProjectId(readModel, command.projectId).filter(
        (thread) => thread.deletedAt === null,
      );
      if (activeThreads.length > 0 && command.force !== true) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Project '${command.projectId}' is not empty and cannot be deleted without force=true.`,
        });
      }
      if (activeThreads.length > 0) {
        return yield* decideCommandSequence({
          readModel,
          commands: [
            ...activeThreads.map(
              (thread): Extract<OrchestrationCommand, { type: "thread.delete" }> => ({
                type: "thread.delete",
                commandId: command.commandId,
                threadId: thread.id,
              }),
            ),
            {
              type: "project.delete",
              commandId: command.commandId,
              projectId: command.projectId,
            },
          ],
        });
      }

      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "project.deleted" as const,
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "project.agent.claim.set": {
      const project = yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (
        project.deletedAt !== null ||
        thread.projectId !== command.projectId ||
        !isActiveProjectAgentThread(thread) ||
        activeProjectAgentTurnId(thread) !== command.turnId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Claiming thread is not active in the requested project turn.",
        });
      }

      const conflicts = project.coordinationClaims.flatMap((lease) => {
        if (lease.threadId === command.threadId) return [];
        const peer = readModel.threads.find((candidate) => candidate.id === lease.threadId);
        if (!peer || !isActiveProjectAgentThread(peer)) return [];
        return findProjectAgentClaimConflicts(command.claims, lease.claims).map((conflict) => ({
          threadId: lease.threadId,
          threadTitle: peer.title,
          summary: lease.summary,
          ...conflict,
        }));
      });
      if (conflicts.length > 0) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Requested coordination claims overlap an active project agent.",
          code: "project_agent_claim_conflict",
          context: { conflicts },
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.claimedAt,
          commandId: command.commandId,
        })),
        type: "project.agent-claim-set",
        payload: {
          projectId: command.projectId,
          threadId: command.threadId,
          turnId: command.turnId,
          summary: command.summary,
          claims: command.claims,
          updatedAt: command.claimedAt,
        },
      };
    }

    case "project.agent.claim.release": {
      yield* requireProject({ readModel, command, projectId: command.projectId });
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (thread.projectId !== command.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Releasing thread does not belong to the requested project.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.releasedAt,
          commandId: command.commandId,
        })),
        type: "project.agent-claim-released",
        payload: {
          projectId: command.projectId,
          threadId: command.threadId,
          expectedTurnId: command.expectedTurnId ?? null,
          releasedAt: command.releasedAt,
        },
      };
    }

    case "project.agent.message.send": {
      const sender = yield* requireThread({
        readModel,
        command,
        threadId: command.senderThreadId,
      });
      if (sender.projectId !== command.projectId || !isActiveProjectAgentThread(sender)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Sending thread is not active in the requested project.",
        });
      }
      const recipientIds = Array.from(new Set(command.recipientThreadIds));
      const recipients = recipientIds.map((threadId) =>
        readModel.threads.find((thread) => thread.id === threadId),
      );
      if (
        recipientIds.includes(command.senderThreadId) ||
        recipients.some(
          (recipient) =>
            !recipient ||
            recipient.projectId !== command.projectId ||
            !isAvailableProjectAgentThread(recipient),
        )
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "One or more coordination message recipients are unavailable.",
        });
      }

      const preview = command.body.slice(0, PROJECT_AGENT_MAX_ACTIVITY_PREVIEW_CHARS);
      const makeActivityEvent = Effect.fn("makeProjectAgentActivityEvent")(function* (input: {
        readonly threadId: typeof command.senderThreadId;
        readonly kind: "coordination.message.sent" | "coordination.message.received";
        readonly summary: string;
        readonly turnId: TurnId | null;
      }) {
        const base = yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: input.threadId,
          occurredAt: command.sentAt,
          commandId: command.commandId,
        });
        return {
          ...base,
          type: "thread.activity-appended" as const,
          payload: {
            threadId: input.threadId,
            activity: {
              id: base.eventId,
              tone: "info" as const,
              kind: input.kind,
              summary: input.summary,
              payload: {
                messageId: command.messageId,
                messageKind: command.kind,
                detail: preview,
                preview,
                senderThreadId: command.senderThreadId,
                recipientThreadIds: recipientIds,
              },
              turnId: input.turnId,
              createdAt: command.sentAt,
            },
          },
        };
      });
      const senderActivity = yield* makeActivityEvent({
        threadId: command.senderThreadId,
        kind: "coordination.message.sent",
        summary: `Sent ${command.kind} to ${recipientIds.length} project agent${recipientIds.length === 1 ? "" : "s"}`,
        turnId: activeProjectAgentTurnId(sender),
      });
      const recipientActivities = yield* Effect.forEach(
        recipients as ReadonlyArray<NonNullable<(typeof recipients)[number]>>,
        (recipient) =>
          makeActivityEvent({
            threadId: recipient.id,
            kind: "coordination.message.received",
            summary: `Received ${command.kind} from ${sender.title}`,
            turnId: activeProjectAgentTurnId(recipient),
          }),
      );
      const messageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.sentAt,
          commandId: command.commandId,
        })),
        type: "project.agent-message-sent",
        payload: {
          projectId: command.projectId,
          messageId: command.messageId,
          senderThreadId: command.senderThreadId,
          recipientThreadIds: recipientIds,
          kind: command.kind,
          body: command.body,
          sentAt: command.sentAt,
        },
      };
      const inactiveRecipients = (
        recipients as ReadonlyArray<NonNullable<(typeof recipients)[number]>>
      ).filter(
        (recipient) =>
          !isActiveProjectAgentThread(recipient) &&
          !threadHasQueuedTurnStart(recipient, command.sentAt),
      );
      const wakeEvents = yield* Effect.forEach(inactiveRecipients, (recipient) =>
        Effect.gen(function* () {
          const lifecycleResetEvents = yield* makeThreadLifecycleResetEvents({
            thread: recipient,
            occurredAt: command.sentAt,
            commandId: command.commandId,
          });
          const wakeMessageBase = yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: recipient.id,
            occurredAt: command.sentAt,
            commandId: command.commandId,
          });
          const wakeMessageId = MessageId.make(wakeMessageBase.eventId);
          const wakeMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
            ...wakeMessageBase,
            type: "thread.message-sent",
            payload: {
              threadId: recipient.id,
              messageId: wakeMessageId,
              role: "user",
              text: [
                `Project agent ${sender.title} (${sender.id}) sent you a ${command.kind} message while this chat was idle:`,
                command.body,
                "Handle the message, reply with project_agent_send when useful, and acknowledge it through project_agent_inbox after processing it.",
              ].join("\n\n"),
              attachments: [],
              turnId: null,
              streaming: false,
              createdAt: command.sentAt,
              updatedAt: command.sentAt,
            },
          };
          const wakeTurnBase = yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: recipient.id,
            occurredAt: command.sentAt,
            commandId: command.commandId,
          });
          const wakeTurnEvent: Omit<OrchestrationEvent, "sequence"> = {
            ...wakeTurnBase,
            causationEventId: wakeMessageEvent.eventId,
            type: "thread.turn-start-requested",
            payload: {
              threadId: recipient.id,
              messageId: wakeMessageId,
              modelSelection: recipient.modelSelection,
              runtimeMode: recipient.runtimeMode,
              interactionMode: recipient.interactionMode,
              createdAt: command.sentAt,
            },
          };
          return [...lifecycleResetEvents, wakeMessageEvent, wakeTurnEvent];
        }),
      );
      return [senderActivity, ...recipientActivities, messageEvent, ...wakeEvents.flat()];
    }

    case "project.agent.inbox.acknowledge": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (thread.projectId !== command.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: "Inbox thread does not belong to the requested project.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.acknowledgedAt,
          commandId: command.commandId,
        })),
        type: "project.agent-inbox-acknowledged",
        payload: {
          projectId: command.projectId,
          threadId: command.threadId,
          acknowledgeThrough: command.acknowledgeThrough,
          acknowledgedAt: command.acknowledgedAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.fork":
      return yield* new OrchestrationCommandInvariantError({
        commandType: command.type,
        detail: "Thread forks must be planned from the persisted source event stream.",
      });

    case "thread.delete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      const deletedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
      const lease = currentProjectAgentLease(readModel, command.threadId);
      if (!lease) return deletedEvent;
      return [
        deletedEvent,
        {
          ...(yield* withEventBase({
            aggregateKind: "project",
            aggregateId: thread.projectId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "project.agent-claim-released",
          payload: {
            projectId: thread.projectId,
            threadId: command.threadId,
            expectedTurnId: lease.turnId,
            releasedAt: occurredAt,
          },
        },
      ];
    }

    case "thread.archive": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      const archivedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
      const lease = currentProjectAgentLease(readModel, command.threadId);
      if (!lease) return archivedEvent;
      return [
        archivedEvent,
        {
          ...(yield* withEventBase({
            aggregateKind: "project",
            aggregateId: thread.projectId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "project.agent-claim-released",
          payload: {
            projectId: thread.projectId,
            threadId: command.threadId,
            expectedTurnId: lease.turnId,
            releasedAt: occurredAt,
          },
        },
      ];
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.settle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Server-side twin of the client's canSettle session check: a stale
      // or raced client must not settle a thread whose session is coming
      // alive or working.
      if (thread.session?.status === "starting" || thread.session?.status === "running") {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has an active session and cannot be settled`,
          }),
        );
      }
      // Pending approval / user-input requests are blocked-on-you work: a
      // raced or stale client must not park them behind a settled override
      // that would surface only after the request resolves.
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be settled`,
          }),
        );
      }
      const occurredAt = yield* nowIso;
      // Settling inside the adoption window would hide just-requested work.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be settled`,
          }),
        );
      }
      // Settling an already-settled thread re-emits with the original
      // settledAt: the engine rejects zero-event commands, and bulk-settle /
      // double-click must stay silent no-ops rather than surface errors.
      const alreadySettled = thread.settledOverride === "settled" && thread.settledAt !== null;
      const settledEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.settled" as const,
        payload: {
          threadId: command.threadId,
          settledAt: alreadySettled ? thread.settledAt : occurredAt,
          // A re-emission is a projected no-op: keep the existing updatedAt
          // so duplicate settles neither rewind nor churn ordering. A fresh
          // settle stamps the command time.
          updatedAt: alreadySettled ? thread.updatedAt : occurredAt,
        },
      };
      // Settling is "I'm done with this": clear states that would keep the
      // row pinned or snoozed instead of showing the new settled state.
      const companionEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];
      if (thread.pinnedAt != null) {
        companionEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.unpinned" as const,
          payload: {
            threadId: command.threadId,
            updatedAt: occurredAt,
          },
        });
      }
      if (thread.snoozedUntil != null) {
        companionEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.unsnoozed",
          payload: {
            threadId: command.threadId,
            reason: "user",
            updatedAt: occurredAt,
          },
        });
      }
      return companionEvents.length > 0 ? [settledEvent, ...companionEvents] : settledEvent;
    }

    case "thread.unsettle": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): reducing the event a
      // second time lands on the same override state. A re-emission keeps
      // the existing updatedAt so duplicates do not churn ordering.
      const alreadyPinnedActive = thread.settledOverride === "active";
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyPinnedActive ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.snooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      // A wake time in the past would create a thread that is snoozed and
      // woken at once — the row would never leave the inbox but still carry
      // snooze state. Reject instead of silently normalizing. The negated
      // comparison also catches unparseable wake times (IsoDateTime is
      // structurally just a string): NaN fails every comparison, and an
      // unparseable snoozedUntil must never persist.
      if (!(Date.parse(command.snoozedUntil) > Date.parse(occurredAt))) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} snooze wake time ${command.snoozedUntil} is not in the future`,
          }),
        );
      }
      // Blocked-on-you work must not be snoozed away: a pending approval or
      // user-input request is the agent waiting on the user, and hiding it
      // defeats the request. (A running session IS snoozable — snooze only
      // affects visibility, never the agent.)
      if (hasOpenBlockingRequest(thread)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a pending approval or user-input request and cannot be snoozed`,
          }),
        );
      }
      // A queued turn start — a user message no turn has adopted yet — is
      // invisible pending work: no session, no pending flags. Snoozing in
      // that window would hide a just-requested turn exactly the way settle
      // would.
      if (threadHasQueuedTurnStart(thread, occurredAt)) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} has a queued turn start and cannot be snoozed`,
          }),
        );
      }
      // Re-snoozing an already-snoozed thread to the SAME wake time is a
      // duplicate (double-click, raced clients): re-emit with the original
      // timestamps so the projection is a no-op. A different wake time is a
      // real change and stamps fresh.
      const existingSnoozedAt =
        thread.snoozedUntil === command.snoozedUntil && thread.snoozedAt != null
          ? thread.snoozedAt
          : null;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.snoozed",
        payload: {
          threadId: command.threadId,
          snoozedUntil: command.snoozedUntil,
          snoozedAt: existingSnoozedAt ?? occurredAt,
          updatedAt: existingSnoozedAt !== null ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.unsnooze": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): waking a thread that
      // is not snoozed lands on the same null state without churning
      // updatedAt.
      const alreadyAwake = thread.snoozedUntil == null;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unsnoozed",
        payload: {
          threadId: command.threadId,
          reason: command.reason,
          updatedAt: alreadyAwake ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.pin": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      // Re-pinning an already-pinned thread is a duplicate (double-click,
      // raced clients): re-emit with the original timestamps so the
      // projection is a no-op. Pinning has no lifecycle invariants — a pin
      // only ever promotes visibility, so it can never hide pending work.
      const existingPinnedAt = thread.pinnedAt ?? null;
      const pinnedEvent = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.pinned" as const,
        payload: {
          threadId: command.threadId,
          pinnedAt: existingPinnedAt ?? occurredAt,
          // A fresh pin takes the client's slot in the arranged order; on a
          // re-pin the existing key wins so raced duplicates cannot move a
          // thread the user already placed.
          ...(existingPinnedAt === null && command.orderKey !== undefined
            ? { pinOrderKey: command.orderKey }
            : {}),
          updatedAt: existingPinnedAt !== null ? thread.updatedAt : occurredAt,
        },
      };
      // Pinning is a promotion: it clears the parked states rather than
      // silently outranking them. An explicit settle un-settles (reason
      // "user", same override the un-settle button stamps), and a snooze's
      // return ticket is spent — the thread is on top NOW, not on Tuesday.
      const promotionEvents: Array<Omit<OrchestrationEvent, "sequence">> = [];
      if (thread.settledOverride === "settled") {
        promotionEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.unsettled",
          payload: {
            threadId: command.threadId,
            reason: "user",
            updatedAt: occurredAt,
          },
        });
      }
      if (thread.snoozedUntil != null) {
        promotionEvents.push({
          ...(yield* withEventBase({
            aggregateKind: "thread",
            aggregateId: command.threadId,
            occurredAt,
            commandId: command.commandId,
          })),
          type: "thread.unsnoozed",
          payload: {
            threadId: command.threadId,
            reason: "user",
            updatedAt: occurredAt,
          },
        });
      }
      return promotionEvents.length > 0 ? [pinnedEvent, ...promotionEvents] : pinnedEvent;
    }

    case "thread.unpin": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Idempotent by re-emission (see thread.settle): unpinning a thread
      // that is not pinned lands on the same null state without churning
      // updatedAt.
      const alreadyUnpinned = thread.pinnedAt == null;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.unpinned",
        payload: {
          threadId: command.threadId,
          updatedAt: alreadyUnpinned ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.pin.reorder": {
      const thread = yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Only pinned threads have a slot in the arranged order. Rejecting
      // (rather than silently pinning) keeps a raced reorder-after-unpin
      // from resurrecting a pin the user just cleared.
      if (thread.pinnedAt == null) {
        return yield* Effect.fail(
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: `thread ${command.threadId} is not pinned and cannot be reordered`,
          }),
        );
      }
      // Idempotent by re-emission (see thread.settle): a duplicate drop on
      // the same slot keeps the existing updatedAt so it projects as a no-op.
      const keyUnchanged = thread.pinOrderKey === command.orderKey;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.pin-reordered",
        payload: {
          threadId: command.threadId,
          orderKey: command.orderKey,
          updatedAt: keyUnchanged ? thread.updatedAt : occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const branch =
        command.branch !== undefined &&
        command.expectedBranch !== undefined &&
        thread.branch !== command.expectedBranch
          ? thread.branch
          : command.branch;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.regenerateTitle === true
            ? {
                regenerateTitle: true as const,
                previousTitle: thread.title,
                titleRegeneration: {
                  requestId: command.commandId,
                  startedAt: occurredAt,
                },
              }
            : {}),
          ...(command.title !== undefined && thread.titleRegeneration != null
            ? { titleRegeneration: null }
            : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(branch !== undefined ? { branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.title.regeneration.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestIsCurrent = thread.titleRegeneration?.requestId === command.requestId;
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(requestIsCurrent && command.title !== undefined ? { title: command.title } : {}),
          ...(requestIsCurrent ? { titleRegeneration: null } : {}),
          updatedAt: requestIsCurrent ? occurredAt : thread.updatedAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = yield* nowIso;
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        })),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (targetThread.harnessSync?.activity === "active") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' is active in another harness and cannot start a turn.`,
        });
      }
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      const sourcePlan =
        sourceProposedPlan && sourceThread
          ? sourceThread.proposedPlans.find((entry) => entry.id === sourceProposedPlan.planId)
          : null;
      if (sourceProposedPlan && !sourcePlan) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan.planId}' does not exist on thread '${sourceProposedPlan.threadId}'.`,
        });
      }
      if (sourcePlan?.historyOrigin !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourcePlan.id}' belongs to frozen fork history and cannot be implemented.`,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.fetchMode !== undefined ? { fetchMode: command.fetchMode } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      // Real activity resets ANY override: it wakes an explicitly settled
      // thread, and it clears a keep-active pin back to neutral so the
      // thread can auto-settle again after this burst of work goes stale.
      // A snooze clears the same way — sending a message to a snoozed
      // thread is the user re-engaging, so the return ticket is spent.
      const lifecycleResetEvents = yield* makeThreadLifecycleResetEvents({
        thread: targetThread,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      return [...lifecycleResetEvents, userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.retry": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (targetThread.harnessSync?.activity === "active") {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' is active in another harness and cannot retry a turn.`,
        });
      }

      const latestTurn = targetThread.latestTurn;
      const latestUserMessage = targetThread.messages.findLast(
        (message) => message.role === "user" && message.historyOrigin === undefined,
      );
      const latestLocalMessage = targetThread.messages.findLast(
        (message) => message.historyOrigin === undefined,
      );
      const hasAssistantOutput = targetThread.messages.some(
        (message) =>
          command.turnId !== null &&
          message.role === "assistant" &&
          message.turnId === command.turnId &&
          message.historyOrigin === undefined,
      );
      const sessionBusy =
        targetThread.session?.status === "starting" ||
        targetThread.session?.status === "running" ||
        targetThread.session?.abortState != null;
      const concreteInterruptedRetry =
        command.turnId !== null &&
        latestTurn !== null &&
        latestTurn.turnId === command.turnId &&
        latestTurn.state === "interrupted" &&
        latestTurn.assistantMessageId === null &&
        latestTurn.historyOrigin === undefined &&
        latestUserMessage?.id === command.messageId &&
        !latestUserMessage.streaming &&
        Date.parse(latestUserMessage.createdAt) <= Date.parse(latestTurn.requestedAt) &&
        !hasAssistantOutput &&
        !sessionBusy;
      const resultlessPendingRetry =
        command.turnId === null &&
        latestUserMessage?.id === command.messageId &&
        !latestUserMessage.streaming &&
        latestLocalMessage?.id === command.messageId &&
        targetThread.session !== null &&
        targetThread.session.activeTurnId === null &&
        !sessionBusy &&
        Date.parse(targetThread.session.updatedAt) >= Date.parse(latestUserMessage.createdAt) &&
        (latestTurn === null ||
          Date.parse(latestTurn.requestedAt) < Date.parse(latestUserMessage.createdAt));
      if (!concreteInterruptedRetry && !resultlessPendingRetry) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Retry target for user message '${command.messageId}' is not an interrupted result-less turn.`,
        });
      }

      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          resultOnly: true,
          ...(command.turnId !== null ? { retryOfTurnId: command.turnId } : {}),
          ...(command.fetchMode !== undefined ? { fetchMode: command.fetchMode } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(concreteInterruptedRetry && latestTurn?.sourceProposedPlan !== undefined
            ? { sourceProposedPlan: latestTurn.sourceProposedPlan }
            : {}),
          createdAt: command.createdAt,
        },
      };
      const lifecycleResetEvents = yield* makeThreadLifecycleResetEvents({
        thread: targetThread,
        occurredAt: command.createdAt,
        commandId: command.commandId,
      });
      return [...lifecycleResetEvents, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        })),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const targetCheckpoint = thread.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === command.turnCount,
      );
      if (targetCheckpoint?.historyOrigin !== undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Checkpoint turn ${command.turnCount} belongs to frozen fork history and cannot be reverted.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      // Settle-cleanup stops are conditional: between the settle landing and
      // this command, another client may have re-engaged the thread (a turn
      // start unsettles it and brings the session alive). Commands are
      // decided serially against this read model, so checking here — not in
      // the dispatcher's pre-settle snapshot — closes that race.
      if (command.onlyIfSettled === true) {
        const sessionComingAlive =
          thread.session?.status === "starting" || thread.session?.status === "running";
        if (
          thread.settledOverride !== "settled" ||
          sessionComingAlive ||
          threadHasQueuedTurnStart(thread, command.createdAt)
        ) {
          return yield* Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `thread ${command.threadId} was re-engaged after settle; skipping session stop`,
            }),
          );
        }
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sessionSetEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        })),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
        },
      };
      // Only a session coming alive is activity worth waking a settled thread
      // for — status writes like ready/stopped/error arrive after the fact and
      // must not fight a user's explicit settle. Snooze is deliberately NOT
      // cleared here: snooze never pauses the agent, so its session starting
      // or erroring is not the user re-engaging. Blocked/failed work still
      // surfaces immediately — effectiveSnoozed refuses to classify a thread
      // with a raised hand (approval / input / failure / fresh completion)
      // as snoozed, without spending the return ticket.
      const isSessionActivity =
        command.session.status === "starting" || command.session.status === "running";
      // Real activity resets ANY override (settled wakes, active unpins).
      const lease = currentProjectAgentLease(readModel, command.threadId);
      const releasesLease =
        lease !== undefined &&
        command.session.status !== "starting" &&
        command.session.status !== "running";
      const releaseEvent: Omit<OrchestrationEvent, "sequence"> | undefined = releasesLease
        ? {
            ...(yield* withEventBase({
              aggregateKind: "project",
              aggregateId: thread.projectId,
              occurredAt: command.createdAt,
              commandId: command.commandId,
            })),
            type: "project.agent-claim-released",
            payload: {
              projectId: thread.projectId,
              threadId: command.threadId,
              expectedTurnId: lease.turnId,
              releasedAt: command.createdAt,
            },
          }
        : undefined;
      if (thread.settledOverride === null || !isSessionActivity) {
        return releaseEvent ? [sessionSetEvent, releaseEvent] : sessionSetEvent;
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return releaseEvent
        ? [unsettledEvent, sessionSetEvent, releaseEvent]
        : [unsettledEvent, sessionSetEvent];
    }

    case "thread.fork.workspace.update": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (thread.fork === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' is not a fork.`,
        });
      }
      const validReady =
        command.status === "ready" && command.preparedAt !== null && command.lastError === null;
      const validError =
        command.status === "error" && command.preparedAt === null && command.lastError !== null;
      if (!validReady && !validError) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail:
            "Fork workspace readiness requires preparedAt without lastError; an error requires lastError without preparedAt.",
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.fork-workspace-updated",
        payload: {
          threadId: command.threadId,
          status: command.status,
          preparedAt: command.preparedAt,
          lastError: command.lastError,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.fork.handoff.complete": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      if (thread.fork === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Thread '${command.threadId}' is not a fork.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.completedAt,
          commandId: command.commandId,
        })),
        type: "thread.fork-handoff-completed",
        payload: {
          threadId: command.threadId,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.turn.abort.settle": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const abortState = thread.session?.abortState;
      if (
        thread.session === null ||
        abortState == null ||
        thread.session.runtimeSessionId !== command.runtimeSessionId ||
        abortState.runtimeSessionId !== command.runtimeSessionId ||
        abortState.targetTurnId !== command.turnId
      ) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Abort settlement for thread '${command.threadId}' does not match its active runtime and turn.`,
        });
      }
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.settledAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-abort-settled",
        payload: {
          threadId: command.threadId,
          runtimeSessionId: command.runtimeSessionId,
          turnId: command.turnId,
          outcome: command.outcome,
          ...(command.detail !== undefined ? { detail: command.detail } : {}),
          settledAt: command.settledAt,
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          ...(command.subagentId !== undefined ? { subagentId: command.subagentId } : {}),
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          ...(command.subagentId !== undefined ? { subagentId: command.subagentId } : {}),
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.import": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.message.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          ...(command.subagentId !== undefined ? { subagentId: command.subagentId } : {}),
          messageId: command.message.id,
          role: command.message.role,
          text: command.message.text,
          ...(command.message.attachments !== undefined
            ? { attachments: command.message.attachments }
            : {}),
          turnId: command.message.turnId,
          streaming: false,
          createdAt: command.message.createdAt,
          updatedAt: command.message.updatedAt,
        },
      };
    }

    case "thread.harness-sync.link": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.lastSyncedAt,
          commandId: command.commandId,
        })),
        type: "thread.harness-sync-linked",
        payload: {
          threadId: command.threadId,
          projectId: thread.projectId,
          sourceId: command.sourceId,
          continuationKey: command.continuationKey,
          nativeSessionId: command.nativeSessionId,
          providerInstanceId: thread.harnessSync?.providerInstanceId ?? command.providerInstanceId,
          providerLabel:
            thread.harnessSync !== undefined &&
            thread.harnessSync !== null &&
            thread.harnessSync.providerInstanceId !== command.providerInstanceId
              ? thread.harnessSync.providerLabel
              : command.providerLabel,
          activity: command.activity,
          sourceUpdatedAt: command.sourceUpdatedAt,
          lastSyncedAt: command.lastSyncedAt,
        },
      };
    }

    case "thread.harness-sync.message.import": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.message.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.harness-sync-message-imported",
        payload: {
          threadId: command.threadId,
          messageId: command.message.id,
          role: command.message.role,
          text: command.message.text,
          ...(command.message.attachments !== undefined
            ? { attachments: command.message.attachments }
            : {}),
          turnId: command.message.turnId,
          streaming: false,
          createdAt: command.message.createdAt,
          updatedAt: command.message.updatedAt,
          nativeMessageId: command.nativeMessageId,
          linkedAt: command.linkedAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          ...(command.subagentId !== undefined ? { subagentId: command.subagentId } : {}),
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      const thread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      const activityAppendedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        })),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          ...(command.subagentId !== undefined ? { subagentId: command.subagentId } : {}),
          activity: command.activity,
        },
      };
      // An approval or user-input request is blocked-on-you work — it must
      // never stay hidden inside a settled slim row.
      const wakesSettledThread =
        command.activity.kind === "approval.requested" ||
        command.activity.kind === "user-input.requested";
      // Real activity resets ANY override (settled wakes, active unpins).
      if (thread.settledOverride === null || !wakesSettledThread) {
        return activityAppendedEvent;
      }
      const unsettledEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.unsettled",
        payload: {
          threadId: command.threadId,
          reason: "activity",
          updatedAt: command.createdAt,
        },
      };
      return [unsettledEvent, activityAppendedEvent];
    }

    case "thread.subagent.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.subagent-upserted",
        payload: {
          threadId: command.threadId,
          subagent: command.subagent,
        },
      };
    }

    case "thread.subagent.state.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "thread.subagent-state-set",
        payload: {
          threadId: command.threadId,
          subagentId: command.subagentId,
          status: command.status,
          statusMessage: command.statusMessage,
          updatedAt: command.updatedAt,
        },
      };
    }

    case "thread.subagent.progress.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.updatedAt,
          commandId: command.commandId,
        })),
        type: "thread.subagent-progress-set",
        payload: {
          threadId: command.threadId,
          subagentId: command.subagentId,
          progress: command.progress,
          updatedAt: command.updatedAt,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
