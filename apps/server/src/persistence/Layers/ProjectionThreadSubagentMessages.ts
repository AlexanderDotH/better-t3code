import { ChatAttachment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadSubagentMessagesByThreadInput,
  DeleteProjectionThreadSubagentMessagesInput,
  GetProjectionThreadSubagentMessageInput,
  ListProjectionThreadSubagentMessagesInput,
  ProjectionThreadSubagentMessage,
  ProjectionThreadSubagentMessageRepository,
  type ProjectionThreadSubagentMessageRepositoryShape,
} from "../Services/ProjectionThreadSubagentMessages.ts";

const ProjectionThreadSubagentMessageDbRow = ProjectionThreadSubagentMessage.mapFields(
  Struct.assign({
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    isStreaming: Schema.Number,
  }),
);

const toRepositoryError = (sqlOperation: string, decodeOperation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(decodeOperation)(cause)
    : toPersistenceSqlError(sqlOperation)(cause);

function toProjectionThreadSubagentMessage(
  row: typeof ProjectionThreadSubagentMessageDbRow.Type,
): ProjectionThreadSubagentMessage {
  return {
    threadId: row.threadId,
    subagentId: row.subagentId,
    messageId: row.messageId,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    isStreaming: row.isStreaming === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const makeProjectionThreadSubagentMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadSubagentMessage,
    execute: (row) => {
      const attachmentsJson =
        row.attachments === undefined ? null : JSON.stringify(row.attachments);
      return sql`
        INSERT INTO projection_thread_subagent_messages (
          thread_id,
          subagent_id,
          message_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.subagentId},
          ${row.messageId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          COALESCE(
            ${attachmentsJson},
            (
              SELECT attachments_json
              FROM projection_thread_subagent_messages
              WHERE thread_id = ${row.threadId}
                AND subagent_id = ${row.subagentId}
                AND message_id = ${row.messageId}
            )
          ),
          ${row.isStreaming ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id, subagent_id, message_id)
        DO UPDATE SET
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_subagent_messages.attachments_json
          ),
          is_streaming = excluded.is_streaming,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadSubagentMessageInput,
    Result: ProjectionThreadSubagentMessageDbRow,
    execute: ({ threadId, subagentId, messageId }) => sql`
      SELECT
        thread_id AS "threadId",
        subagent_id AS "subagentId",
        message_id AS "messageId",
        turn_id AS "turnId",
        role,
        text,
        attachments_json AS "attachments",
        is_streaming AS "isStreaming",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_thread_subagent_messages
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
        AND message_id = ${messageId}
      LIMIT 1
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionThreadSubagentMessagesInput,
    Result: ProjectionThreadSubagentMessageDbRow,
    execute: ({ threadId, subagentId }) => sql`
      SELECT
        thread_id AS "threadId",
        subagent_id AS "subagentId",
        message_id AS "messageId",
        turn_id AS "turnId",
        role,
        text,
        attachments_json AS "attachments",
        is_streaming AS "isStreaming",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_thread_subagent_messages
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
      ORDER BY created_at ASC, message_id ASC
    `,
  });

  const deleteRows = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentMessagesInput,
    execute: ({ threadId, subagentId }) => sql`
      DELETE FROM projection_thread_subagent_messages
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
    `,
  });

  const deleteRowsByThread = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentMessagesByThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_subagent_messages
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadSubagentMessageRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentMessageRepository.upsert:query",
          "ProjectionThreadSubagentMessageRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ProjectionThreadSubagentMessageRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentMessageRepository.getById:query",
          "ProjectionThreadSubagentMessageRepository.getById:decodeRow",
        ),
      ),
      Effect.map(Option.map(toProjectionThreadSubagentMessage)),
    );

  const listBySubagentId: ProjectionThreadSubagentMessageRepositoryShape["listBySubagentId"] = (
    input,
  ) =>
    listRows(input).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentMessageRepository.listBySubagentId:query",
          "ProjectionThreadSubagentMessageRepository.listBySubagentId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(toProjectionThreadSubagentMessage)),
    );

  const deleteBySubagentId: ProjectionThreadSubagentMessageRepositoryShape["deleteBySubagentId"] = (
    input,
  ) =>
    deleteRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentMessageRepository.deleteBySubagentId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadSubagentMessageRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentMessageRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getById,
    listBySubagentId,
    deleteBySubagentId,
    deleteByThreadId,
  } satisfies ProjectionThreadSubagentMessageRepositoryShape;
});

export const ProjectionThreadSubagentMessageRepositoryLive = Layer.effect(
  ProjectionThreadSubagentMessageRepository,
  makeProjectionThreadSubagentMessageRepository,
);
