import { MessageId, SubagentId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAttachmentOwnerKind = Schema.Literals(["thread", "subagent"]);
export type ProjectionAttachmentOwnerKind = typeof ProjectionAttachmentOwnerKind.Type;

export const ProjectionAttachmentMessage = Schema.Struct({
  ownerKind: ProjectionAttachmentOwnerKind,
  threadId: ThreadId,
  subagentId: Schema.NullOr(SubagentId),
  messageId: MessageId,
  attachmentIds: Schema.Array(TrimmedNonEmptyString),
});
export type ProjectionAttachmentMessage = typeof ProjectionAttachmentMessage.Type;

export const ProjectionAttachmentThread = Schema.Struct({
  threadId: ThreadId,
});
export type ProjectionAttachmentThread = typeof ProjectionAttachmentThread.Type;

export const ProjectionAttachmentId = Schema.Struct({
  attachmentId: TrimmedNonEmptyString,
});
export type ProjectionAttachmentId = typeof ProjectionAttachmentId.Type;

export interface ProjectionAttachmentReferenceRepositoryShape {
  readonly replaceMessage: (
    input: ProjectionAttachmentMessage,
  ) => Effect.Effect<ReadonlyArray<string>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: ProjectionAttachmentThread,
  ) => Effect.Effect<ReadonlyArray<string>, ProjectionRepositoryError>;
  readonly hasReference: (
    input: ProjectionAttachmentId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
}

export class ProjectionAttachmentReferenceRepository extends Context.Service<
  ProjectionAttachmentReferenceRepository,
  ProjectionAttachmentReferenceRepositoryShape
>()(
  "t3/persistence/Services/ProjectionAttachmentReferences/ProjectionAttachmentReferenceRepository",
) {}
