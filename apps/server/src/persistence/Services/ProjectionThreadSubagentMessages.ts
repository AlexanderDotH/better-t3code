import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  OrchestrationMessageRole,
  SubagentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSubagentMessage = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  messageId: MessageId,
  turnId: Schema.NullOr(TurnId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  isStreaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadSubagentMessage = typeof ProjectionThreadSubagentMessage.Type;

export const GetProjectionThreadSubagentMessageInput = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
  messageId: MessageId,
});
export type GetProjectionThreadSubagentMessageInput =
  typeof GetProjectionThreadSubagentMessageInput.Type;

export const ListProjectionThreadSubagentMessagesInput = Schema.Struct({
  threadId: ThreadId,
  subagentId: SubagentId,
});
export type ListProjectionThreadSubagentMessagesInput =
  typeof ListProjectionThreadSubagentMessagesInput.Type;

export const DeleteProjectionThreadSubagentMessagesInput =
  ListProjectionThreadSubagentMessagesInput;
export type DeleteProjectionThreadSubagentMessagesInput =
  typeof DeleteProjectionThreadSubagentMessagesInput.Type;

export const DeleteProjectionThreadSubagentMessagesByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadSubagentMessagesByThreadInput =
  typeof DeleteProjectionThreadSubagentMessagesByThreadInput.Type;

export interface ProjectionThreadSubagentMessageRepositoryShape {
  readonly upsert: (
    message: ProjectionThreadSubagentMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionThreadSubagentMessageInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadSubagentMessage>, ProjectionRepositoryError>;
  readonly listBySubagentId: (
    input: ListProjectionThreadSubagentMessagesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadSubagentMessage>, ProjectionRepositoryError>;
  readonly deleteBySubagentId: (
    input: DeleteProjectionThreadSubagentMessagesInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSubagentMessagesByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadSubagentMessageRepository extends Context.Service<
  ProjectionThreadSubagentMessageRepository,
  ProjectionThreadSubagentMessageRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadSubagentMessages/ProjectionThreadSubagentMessageRepository",
) {}
