import type {
  IsoDateTime,
  ProjectAgentLease,
  ProjectAgentMessage,
  ProjectAgentMessageId,
  ProjectAgentMessageKind,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface ProjectionProjectAgentRecordedMessage {
  readonly sequence: number;
  readonly projectId: ProjectId;
  readonly messageId: ProjectAgentMessageId;
  readonly senderThreadId: ThreadId;
  readonly recipientThreadIds: ReadonlyArray<ThreadId>;
  readonly kind: ProjectAgentMessageKind;
  readonly body: string;
  readonly createdAt: IsoDateTime;
}

export interface ProjectionProjectAgentInboxPage {
  readonly messages: ReadonlyArray<ProjectAgentMessage>;
  readonly cursor: number;
  readonly hasMore: boolean;
  readonly minRetainedSequence: number | null;
}

export interface ProjectionProjectAgentCoordinationRepositoryShape {
  readonly upsertClaim: (
    lease: ProjectAgentLease,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly releaseClaim: (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly expectedTurnId: TurnId | null;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly releaseClaimsByThreadId: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly releaseClaimsByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listClaimsByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyArray<ProjectAgentLease>, ProjectionRepositoryError>;
  readonly listAllClaims: () => Effect.Effect<
    ReadonlyArray<ProjectAgentLease>,
    ProjectionRepositoryError
  >;
  readonly recordMessage: (
    message: ProjectionProjectAgentRecordedMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly acknowledgeInbox: (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly acknowledgeThrough: number;
    readonly acknowledgedAt: IsoDateTime;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly readInbox: (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly limit: number;
  }) => Effect.Effect<ProjectionProjectAgentInboxPage, ProjectionRepositoryError>;
  readonly listUnreadCountsByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyMap<ThreadId, number>, ProjectionRepositoryError>;
}

export class ProjectionProjectAgentCoordinationRepository extends Context.Service<
  ProjectionProjectAgentCoordinationRepository,
  ProjectionProjectAgentCoordinationRepositoryShape
>()(
  "t3/persistence/Services/ProjectionProjectAgentCoordination/ProjectionProjectAgentCoordinationRepository",
) {}
