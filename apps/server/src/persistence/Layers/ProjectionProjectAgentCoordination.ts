import {
  NonNegativeInt,
  ProjectAgentClaim,
  ProjectAgentLease,
  ProjectAgentMessage,
  PROJECT_AGENT_MESSAGE_HISTORY_LIMIT,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionProjectAgentCoordinationRepository,
  type ProjectionProjectAgentCoordinationRepositoryShape,
  type ProjectionProjectAgentRecordedMessage,
} from "../Services/ProjectionProjectAgentCoordination.ts";

const ProjectAgentClaimDbRow = ProjectAgentLease.mapFields(
  Struct.assign({ claims: Schema.fromJsonString(Schema.Array(ProjectAgentClaim)) }),
);

const ProjectAgentMessageDbRow = ProjectAgentMessage;

const CursorRow = Schema.Struct({ acknowledgedSequence: NonNegativeInt });
const MinimumSequenceRow = Schema.Struct({ minSequence: Schema.NullOr(NonNegativeInt) });
const UnreadCountRow = Schema.Struct({ threadId: ThreadId, unreadCount: NonNegativeInt });

const ProjectRequest = Schema.Struct({ projectId: ProjectId });
const InboxRequest = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  limit: NonNegativeInt,
});

const toRepositoryError = (sqlOperation: string, decodeOperation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(decodeOperation)(cause)
    : toPersistenceSqlError(sqlOperation)(cause);

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertClaimRow = SqlSchema.void({
    Request: ProjectAgentLease,
    execute: (lease) => sql`
      INSERT INTO projection_project_agent_claims (
        project_id,
        thread_id,
        turn_id,
        summary,
        claims_json,
        updated_at
      )
      VALUES (
        ${lease.projectId},
        ${lease.threadId},
        ${lease.turnId},
        ${lease.summary},
        ${JSON.stringify(lease.claims)},
        ${lease.updatedAt}
      )
      ON CONFLICT (project_id, thread_id)
      DO UPDATE SET
        turn_id = excluded.turn_id,
        summary = excluded.summary,
        claims_json = excluded.claims_json,
        updated_at = excluded.updated_at
    `,
  });

  const listClaims = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectAgentClaimDbRow,
    execute: () => sql`
      SELECT
        project_id AS "projectId",
        thread_id AS "threadId",
        turn_id AS "turnId",
        summary,
        claims_json AS "claims",
        updated_at AS "updatedAt"
      FROM projection_project_agent_claims
      ORDER BY project_id ASC, updated_at DESC, thread_id ASC
    `,
  });

  const listClaimsForProject = SqlSchema.findAll({
    Request: ProjectRequest,
    Result: ProjectAgentClaimDbRow,
    execute: ({ projectId }) => sql`
      SELECT
        project_id AS "projectId",
        thread_id AS "threadId",
        turn_id AS "turnId",
        summary,
        claims_json AS "claims",
        updated_at AS "updatedAt"
      FROM projection_project_agent_claims
      WHERE project_id = ${projectId}
      ORDER BY updated_at DESC, thread_id ASC
    `,
  });

  const readInboxRows = SqlSchema.findAll({
    Request: InboxRequest,
    Result: ProjectAgentMessageDbRow,
    execute: ({ projectId, threadId, limit }) => sql`
      SELECT
        message.sequence,
        message.message_id AS "messageId",
        message.project_id AS "projectId",
        message.sender_thread_id AS "senderThreadId",
        recipient.recipient_thread_id AS "recipientThreadId",
        message.kind,
        message.body,
        message.created_at AS "createdAt"
      FROM projection_project_agent_message_recipients AS recipient
      INNER JOIN projection_project_agent_messages AS message
        ON message.sequence = recipient.message_sequence
      WHERE recipient.project_id = ${projectId}
        AND recipient.recipient_thread_id = ${threadId}
        AND recipient.message_sequence > COALESCE(
          (
            SELECT acknowledged_sequence
            FROM projection_project_agent_inbox_cursors
            WHERE project_id = ${projectId}
              AND thread_id = ${threadId}
          ),
          0
        )
      ORDER BY recipient.message_sequence ASC
      LIMIT ${limit + 1}
    `,
  });

  const readCursor = SqlSchema.findOneOption({
    Request: Schema.Struct({ projectId: ProjectId, threadId: ThreadId }),
    Result: CursorRow,
    execute: ({ projectId, threadId }) => sql`
      SELECT acknowledged_sequence AS "acknowledgedSequence"
      FROM projection_project_agent_inbox_cursors
      WHERE project_id = ${projectId}
        AND thread_id = ${threadId}
      LIMIT 1
    `,
  });

  const readMinimumSequence = SqlSchema.findOne({
    Request: ProjectRequest,
    Result: MinimumSequenceRow,
    execute: ({ projectId }) => sql`
      SELECT MIN(sequence) AS "minSequence"
      FROM projection_project_agent_messages
      WHERE project_id = ${projectId}
    `,
  });

  const readUnreadCounts = SqlSchema.findAll({
    Request: ProjectRequest,
    Result: UnreadCountRow,
    execute: ({ projectId }) => sql`
      SELECT
        recipient.recipient_thread_id AS "threadId",
        COUNT(*) AS "unreadCount"
      FROM projection_project_agent_message_recipients AS recipient
      LEFT JOIN projection_project_agent_inbox_cursors AS cursor
        ON cursor.project_id = recipient.project_id
        AND cursor.thread_id = recipient.recipient_thread_id
      WHERE recipient.project_id = ${projectId}
        AND recipient.message_sequence > COALESCE(cursor.acknowledged_sequence, 0)
      GROUP BY recipient.recipient_thread_id
      ORDER BY recipient.recipient_thread_id ASC
    `,
  });

  const upsertClaim: ProjectionProjectAgentCoordinationRepositoryShape["upsertClaim"] = (lease) =>
    upsertClaimRow(lease).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionProjectAgentCoordinationRepository.upsertClaim:query",
          "ProjectionProjectAgentCoordinationRepository.upsertClaim:encodeRequest",
        ),
      ),
    );

  const releaseClaim: ProjectionProjectAgentCoordinationRepositoryShape["releaseClaim"] = (input) =>
    (input.expectedTurnId === null
      ? sql`
          DELETE FROM projection_project_agent_claims
          WHERE project_id = ${input.projectId}
            AND thread_id = ${input.threadId}
        `
      : sql`
          DELETE FROM projection_project_agent_claims
          WHERE project_id = ${input.projectId}
            AND thread_id = ${input.threadId}
            AND turn_id = ${input.expectedTurnId}
        `
    ).pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ProjectionProjectAgentCoordinationRepository.releaseClaim:query"),
      ),
    );

  const listClaimsByProjectId: ProjectionProjectAgentCoordinationRepositoryShape["listClaimsByProjectId"] =
    (projectId) =>
      listClaimsForProject({ projectId }).pipe(
        Effect.mapError(
          toRepositoryError(
            "ProjectionProjectAgentCoordinationRepository.listClaimsByProjectId:query",
            "ProjectionProjectAgentCoordinationRepository.listClaimsByProjectId:decodeRows",
          ),
        ),
      );

  const releaseClaimsByThreadId: ProjectionProjectAgentCoordinationRepositoryShape["releaseClaimsByThreadId"] =
    (threadId) =>
      sql`
        DELETE FROM projection_project_agent_claims
        WHERE thread_id = ${threadId}
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionProjectAgentCoordinationRepository.releaseClaimsByThreadId:query",
          ),
        ),
      );

  const releaseClaimsByProjectId: ProjectionProjectAgentCoordinationRepositoryShape["releaseClaimsByProjectId"] =
    (projectId) =>
      sql`
        DELETE FROM projection_project_agent_claims
        WHERE project_id = ${projectId}
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionProjectAgentCoordinationRepository.releaseClaimsByProjectId:query",
          ),
        ),
      );

  const listAllClaims: ProjectionProjectAgentCoordinationRepositoryShape["listAllClaims"] = () =>
    listClaims(undefined).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionProjectAgentCoordinationRepository.listAllClaims:query",
          "ProjectionProjectAgentCoordinationRepository.listAllClaims:decodeRows",
        ),
      ),
    );

  const recordMessage: ProjectionProjectAgentCoordinationRepositoryShape["recordMessage"] = (
    message: ProjectionProjectAgentRecordedMessage,
  ) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO projection_project_agent_messages (
          sequence,
          message_id,
          project_id,
          sender_thread_id,
          kind,
          body,
          created_at
        )
        VALUES (
          ${message.sequence},
          ${message.messageId},
          ${message.projectId},
          ${message.senderThreadId},
          ${message.kind},
          ${message.body},
          ${message.createdAt}
        )
        ON CONFLICT (sequence)
        DO UPDATE SET
          message_id = excluded.message_id,
          project_id = excluded.project_id,
          sender_thread_id = excluded.sender_thread_id,
          kind = excluded.kind,
          body = excluded.body,
          created_at = excluded.created_at
      `;
      yield* sql`
        DELETE FROM projection_project_agent_message_recipients
        WHERE message_sequence = ${message.sequence}
      `;
      yield* Effect.forEach(
        message.recipientThreadIds,
        (recipientThreadId) => sql`
          INSERT INTO projection_project_agent_message_recipients (
            message_sequence,
            project_id,
            recipient_thread_id
          )
          VALUES (${message.sequence}, ${message.projectId}, ${recipientThreadId})
          ON CONFLICT (message_sequence, recipient_thread_id) DO NOTHING
        `,
        { concurrency: 1, discard: true },
      );
      yield* sql`
        DELETE FROM projection_project_agent_messages
        WHERE project_id = ${message.projectId}
          AND sequence NOT IN (
            SELECT sequence
            FROM projection_project_agent_messages
            WHERE project_id = ${message.projectId}
            ORDER BY sequence DESC
            LIMIT ${PROJECT_AGENT_MESSAGE_HISTORY_LIMIT}
          )
      `;
    }).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionProjectAgentCoordinationRepository.recordMessage:query"),
      ),
    );

  const acknowledgeInbox: ProjectionProjectAgentCoordinationRepositoryShape["acknowledgeInbox"] = (
    input,
  ) =>
    sql`
        INSERT INTO projection_project_agent_inbox_cursors (
          project_id,
          thread_id,
          acknowledged_sequence,
          updated_at
        )
        VALUES (
          ${input.projectId},
          ${input.threadId},
          MIN(
            ${input.acknowledgeThrough},
            COALESCE(
              (
                SELECT MAX(message_sequence)
                FROM projection_project_agent_message_recipients
                WHERE project_id = ${input.projectId}
                  AND recipient_thread_id = ${input.threadId}
              ),
              0
            )
          ),
          ${input.acknowledgedAt}
        )
        ON CONFLICT (project_id, thread_id)
        DO UPDATE SET
          acknowledged_sequence = MAX(
            projection_project_agent_inbox_cursors.acknowledged_sequence,
            excluded.acknowledged_sequence
          ),
          updated_at = CASE
            WHEN excluded.acknowledged_sequence >=
              projection_project_agent_inbox_cursors.acknowledged_sequence
            THEN excluded.updated_at
            ELSE projection_project_agent_inbox_cursors.updated_at
          END
      `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError(
          "ProjectionProjectAgentCoordinationRepository.acknowledgeInbox:query",
        ),
      ),
    );

  const readInbox: ProjectionProjectAgentCoordinationRepositoryShape["readInbox"] = (input) =>
    Effect.all([
      readInboxRows(input),
      readCursor(input),
      readMinimumSequence({ projectId: input.projectId }),
    ]).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionProjectAgentCoordinationRepository.readInbox:query",
          "ProjectionProjectAgentCoordinationRepository.readInbox:decodeRows",
        ),
      ),
      Effect.map(([rows, cursorRow, minimumRow]) => ({
        messages: rows.slice(0, input.limit),
        cursor: cursorRow._tag === "Some" ? cursorRow.value.acknowledgedSequence : 0,
        hasMore: rows.length > input.limit,
        minRetainedSequence: minimumRow.minSequence,
      })),
    );

  const listUnreadCountsByProjectId: ProjectionProjectAgentCoordinationRepositoryShape["listUnreadCountsByProjectId"] =
    (projectId) =>
      readUnreadCounts({ projectId }).pipe(
        Effect.mapError(
          toRepositoryError(
            "ProjectionProjectAgentCoordinationRepository.listUnreadCountsByProjectId:query",
            "ProjectionProjectAgentCoordinationRepository.listUnreadCountsByProjectId:decodeRows",
          ),
        ),
        Effect.map((rows) => new Map(rows.map((row) => [row.threadId, row.unreadCount]))),
      );

  return {
    upsertClaim,
    releaseClaim,
    releaseClaimsByThreadId,
    releaseClaimsByProjectId,
    listClaimsByProjectId,
    listAllClaims,
    recordMessage,
    acknowledgeInbox,
    readInbox,
    listUnreadCountsByProjectId,
  } satisfies ProjectionProjectAgentCoordinationRepositoryShape;
});

export const ProjectionProjectAgentCoordinationRepositoryLive = Layer.effect(
  ProjectionProjectAgentCoordinationRepository,
  makeRepository,
);
