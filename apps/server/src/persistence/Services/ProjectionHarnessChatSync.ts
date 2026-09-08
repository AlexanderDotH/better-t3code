import {
  HarnessChatActivity,
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  IsoDateTime,
  MessageId,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const HarnessChatNativeMessageId = TrimmedNonEmptyString.pipe(
  Schema.brand("HarnessChatNativeMessageId"),
);
export type HarnessChatNativeMessageId = typeof HarnessChatNativeMessageId.Type;

export const ProjectionHarnessChatSyncLink = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  sourceId: HarnessChatSyncSourceId,
  continuationKey: HarnessChatContinuationKey,
  nativeSessionId: HarnessChatSessionId,
  providerInstanceId: ProviderInstanceId,
  providerLabel: TrimmedNonEmptyString,
  activity: HarnessChatActivity,
  sourceUpdatedAt: Schema.NullOr(IsoDateTime),
  lastSyncedAt: IsoDateTime,
});
export type ProjectionHarnessChatSyncLink = typeof ProjectionHarnessChatSyncLink.Type;

export const ProjectionHarnessChatSyncMessageLink = Schema.Struct({
  threadId: ThreadId,
  nativeMessageId: HarnessChatNativeMessageId,
  messageId: MessageId,
  linkedAt: IsoDateTime,
});
export type ProjectionHarnessChatSyncMessageLink = typeof ProjectionHarnessChatSyncMessageLink.Type;

export const GetProjectionHarnessChatSyncLinkByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export const GetProjectionHarnessChatSyncLinkBySourceSessionInput = Schema.Struct({
  sourceId: HarnessChatSyncSourceId,
  nativeSessionId: HarnessChatSessionId,
});
export const GetProjectionHarnessChatSyncLinkByContinuationSessionInput = Schema.Struct({
  continuationKey: HarnessChatContinuationKey,
  nativeSessionId: HarnessChatSessionId,
});
export const ListProjectionHarnessChatSyncLinksByContinuationInput = Schema.Struct({
  continuationKey: HarnessChatContinuationKey,
});
export const ListProjectionHarnessChatSyncLinksBySourceInput = Schema.Struct({
  sourceId: HarnessChatSyncSourceId,
});
export const GetProjectionHarnessChatSyncMessageLinkInput = Schema.Struct({
  threadId: ThreadId,
  nativeMessageId: HarnessChatNativeMessageId,
});
export const ListProjectionHarnessChatSyncMessageLinksInput = Schema.Struct({
  threadId: ThreadId,
});

export interface ProjectionHarnessChatSyncRepositoryShape {
  readonly upsertLink: (
    link: ProjectionHarnessChatSyncLink,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getLinkByThreadId: (
    input: typeof GetProjectionHarnessChatSyncLinkByThreadInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionHarnessChatSyncLink>, ProjectionRepositoryError>;
  readonly getLinkBySourceSession: (
    input: typeof GetProjectionHarnessChatSyncLinkBySourceSessionInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionHarnessChatSyncLink>, ProjectionRepositoryError>;
  readonly getLinkByContinuationSession: (
    input: typeof GetProjectionHarnessChatSyncLinkByContinuationSessionInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionHarnessChatSyncLink>, ProjectionRepositoryError>;
  readonly listLinksByContinuationKey: (
    input: typeof ListProjectionHarnessChatSyncLinksByContinuationInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionHarnessChatSyncLink>, ProjectionRepositoryError>;
  readonly listLinksBySourceId: (
    input: typeof ListProjectionHarnessChatSyncLinksBySourceInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionHarnessChatSyncLink>, ProjectionRepositoryError>;
  readonly upsertMessageLink: (
    link: ProjectionHarnessChatSyncMessageLink,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getMessageLink: (
    input: typeof GetProjectionHarnessChatSyncMessageLinkInput.Type,
  ) => Effect.Effect<
    Option.Option<ProjectionHarnessChatSyncMessageLink>,
    ProjectionRepositoryError
  >;
  readonly listMessageLinksByThreadId: (
    input: typeof ListProjectionHarnessChatSyncMessageLinksInput.Type,
  ) => Effect.Effect<
    ReadonlyArray<ProjectionHarnessChatSyncMessageLink>,
    ProjectionRepositoryError
  >;
}

export class ProjectionHarnessChatSyncRepository extends Context.Service<
  ProjectionHarnessChatSyncRepository,
  ProjectionHarnessChatSyncRepositoryShape
>()("t3/persistence/Services/ProjectionHarnessChatSync/ProjectionHarnessChatSyncRepository") {}
