import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionAttachmentId,
  ProjectionAttachmentMessage,
  ProjectionAttachmentReferenceRepository,
  type ProjectionAttachmentReferenceRepositoryShape,
  ProjectionAttachmentThread,
} from "../Services/ProjectionAttachmentReferences.ts";

const AttachmentIdRow = Schema.Struct({ attachmentId: Schema.String });
const AttachmentReferenceCountRow = Schema.Struct({ count: Schema.Number });

const makeProjectionAttachmentReferenceRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listMessageAttachmentIds = SqlSchema.findAll({
    Request: ProjectionAttachmentMessage,
    Result: AttachmentIdRow,
    execute: ({ ownerKind, threadId, subagentId, messageId }) => sql`
      SELECT attachment_id AS "attachmentId"
      FROM projection_attachment_references
      WHERE owner_kind = ${ownerKind}
        AND thread_id = ${threadId}
        AND subagent_id = ${subagentId ?? ""}
        AND message_id = ${messageId}
    `,
  });
  const deleteMessageReferences = SqlSchema.void({
    Request: ProjectionAttachmentMessage,
    execute: ({ ownerKind, threadId, subagentId, messageId }) => sql`
      DELETE FROM projection_attachment_references
      WHERE owner_kind = ${ownerKind}
        AND thread_id = ${threadId}
        AND subagent_id = ${subagentId ?? ""}
        AND message_id = ${messageId}
    `,
  });
  const insertMessageReference = SqlSchema.void({
    Request: Schema.Struct({
      ...ProjectionAttachmentMessage.fields,
      attachmentId: Schema.String,
    }),
    execute: ({ ownerKind, threadId, subagentId, messageId, attachmentId }) => sql`
      INSERT OR IGNORE INTO projection_attachment_references (
        owner_kind,
        thread_id,
        subagent_id,
        message_id,
        attachment_id
      ) VALUES (
        ${ownerKind},
        ${threadId},
        ${subagentId ?? ""},
        ${messageId},
        ${attachmentId}
      )
    `,
  });
  const listThreadAttachmentIds = SqlSchema.findAll({
    Request: ProjectionAttachmentThread,
    Result: AttachmentIdRow,
    execute: ({ threadId }) => sql`
      SELECT DISTINCT attachment_id AS "attachmentId"
      FROM projection_attachment_references
      WHERE thread_id = ${threadId}
    `,
  });
  const deleteThreadReferences = SqlSchema.void({
    Request: ProjectionAttachmentThread,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_attachment_references
      WHERE thread_id = ${threadId}
    `,
  });
  const countReferences = SqlSchema.findOne({
    Request: ProjectionAttachmentId,
    Result: AttachmentReferenceCountRow,
    execute: ({ attachmentId }) => sql`
      SELECT COUNT(*) AS count
      FROM projection_attachment_references
      WHERE attachment_id = ${attachmentId}
    `,
  });

  const replaceMessage: ProjectionAttachmentReferenceRepositoryShape["replaceMessage"] = (input) =>
    Effect.gen(function* () {
      const previous = yield* listMessageAttachmentIds(input);
      const nextIds = new Set(input.attachmentIds);
      yield* deleteMessageReferences(input);
      yield* Effect.forEach(
        nextIds,
        (attachmentId) => insertMessageReference({ ...input, attachmentId }),
        { concurrency: 1, discard: true },
      );
      return previous
        .map(({ attachmentId }) => attachmentId)
        .filter((attachmentId) => !nextIds.has(attachmentId));
    }).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAttachmentReferenceRepository.replaceMessage:query"),
      ),
    );

  const deleteByThreadId: ProjectionAttachmentReferenceRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const previous = yield* listThreadAttachmentIds(input);
      yield* deleteThreadReferences(input);
      return previous.map(({ attachmentId }) => attachmentId);
    }).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAttachmentReferenceRepository.deleteByThreadId:query"),
      ),
    );

  const hasReference: ProjectionAttachmentReferenceRepositoryShape["hasReference"] = (input) =>
    countReferences(input).pipe(
      Effect.map(({ count }) => count > 0),
      Effect.mapError(
        toPersistenceSqlError("ProjectionAttachmentReferenceRepository.hasReference:query"),
      ),
    );

  return {
    replaceMessage,
    deleteByThreadId,
    hasReference,
  } satisfies ProjectionAttachmentReferenceRepositoryShape;
});

export const ProjectionAttachmentReferenceRepositoryLive = Layer.effect(
  ProjectionAttachmentReferenceRepository,
  makeProjectionAttachmentReferenceRepository,
);
