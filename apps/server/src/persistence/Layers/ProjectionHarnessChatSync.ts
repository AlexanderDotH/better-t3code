import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionHarnessChatSyncLinkByContinuationSessionInput,
  GetProjectionHarnessChatSyncLinkBySourceSessionInput,
  GetProjectionHarnessChatSyncLinkByThreadInput,
  GetProjectionHarnessChatSyncMessageLinkInput,
  ListProjectionHarnessChatSyncLinksByContinuationInput,
  ListProjectionHarnessChatSyncLinksBySourceInput,
  ListProjectionHarnessChatSyncMessageLinksInput,
  ProjectionHarnessChatSyncLink,
  ProjectionHarnessChatSyncMessageLink,
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncRepositoryShape,
} from "../Services/ProjectionHarnessChatSync.ts";

const makeProjectionHarnessChatSyncRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertLinkRow = SqlSchema.void({
    Request: ProjectionHarnessChatSyncLink,
    execute: (link) => sql`
      INSERT INTO projection_harness_chat_sync_links (
        thread_id,
        project_id,
        source_id,
        continuation_key,
        native_session_id,
        provider_instance_id,
        provider_label,
        activity,
        source_updated_at,
        last_synced_at
      ) VALUES (
        ${link.threadId},
        ${link.projectId},
        ${link.sourceId},
        ${link.continuationKey},
        ${link.nativeSessionId},
        ${link.providerInstanceId},
        ${link.providerLabel},
        ${link.activity},
        ${link.sourceUpdatedAt},
        ${link.lastSyncedAt}
      )
      ON CONFLICT (thread_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        source_id = excluded.source_id,
        continuation_key = excluded.continuation_key,
        native_session_id = excluded.native_session_id,
        provider_instance_id = excluded.provider_instance_id,
        provider_label = excluded.provider_label,
        activity = excluded.activity,
        source_updated_at = excluded.source_updated_at,
        last_synced_at = excluded.last_synced_at
      WHERE excluded.last_synced_at >= projection_harness_chat_sync_links.last_synced_at
    `,
  });

  const getLinkByThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionHarnessChatSyncLinkByThreadInput,
    Result: ProjectionHarnessChatSyncLink,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source_id AS "sourceId",
        continuation_key AS "continuationKey",
        native_session_id AS "nativeSessionId",
        provider_instance_id AS "providerInstanceId",
        provider_label AS "providerLabel",
        activity,
        source_updated_at AS "sourceUpdatedAt",
        last_synced_at AS "lastSyncedAt"
      FROM projection_harness_chat_sync_links
      WHERE thread_id = ${threadId}
      LIMIT 1
    `,
  });
  const getLinkBySourceSessionRow = SqlSchema.findOneOption({
    Request: GetProjectionHarnessChatSyncLinkBySourceSessionInput,
    Result: ProjectionHarnessChatSyncLink,
    execute: ({ sourceId, nativeSessionId }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source_id AS "sourceId",
        continuation_key AS "continuationKey",
        native_session_id AS "nativeSessionId",
        provider_instance_id AS "providerInstanceId",
        provider_label AS "providerLabel",
        activity,
        source_updated_at AS "sourceUpdatedAt",
        last_synced_at AS "lastSyncedAt"
      FROM projection_harness_chat_sync_links
      WHERE source_id = ${sourceId}
        AND native_session_id = ${nativeSessionId}
      LIMIT 1
    `,
  });
  const getLinkByContinuationSessionRow = SqlSchema.findOneOption({
    Request: GetProjectionHarnessChatSyncLinkByContinuationSessionInput,
    Result: ProjectionHarnessChatSyncLink,
    execute: ({ continuationKey, nativeSessionId }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source_id AS "sourceId",
        continuation_key AS "continuationKey",
        native_session_id AS "nativeSessionId",
        provider_instance_id AS "providerInstanceId",
        provider_label AS "providerLabel",
        activity,
        source_updated_at AS "sourceUpdatedAt",
        last_synced_at AS "lastSyncedAt"
      FROM projection_harness_chat_sync_links
      WHERE continuation_key = ${continuationKey}
        AND native_session_id = ${nativeSessionId}
      LIMIT 1
    `,
  });
  const listLinksByContinuationRows = SqlSchema.findAll({
    Request: ListProjectionHarnessChatSyncLinksByContinuationInput,
    Result: ProjectionHarnessChatSyncLink,
    execute: ({ continuationKey }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source_id AS "sourceId",
        continuation_key AS "continuationKey",
        native_session_id AS "nativeSessionId",
        provider_instance_id AS "providerInstanceId",
        provider_label AS "providerLabel",
        activity,
        source_updated_at AS "sourceUpdatedAt",
        last_synced_at AS "lastSyncedAt"
      FROM projection_harness_chat_sync_links
      WHERE continuation_key = ${continuationKey}
      ORDER BY native_session_id ASC, thread_id ASC
    `,
  });
  const listLinksBySourceRows = SqlSchema.findAll({
    Request: ListProjectionHarnessChatSyncLinksBySourceInput,
    Result: ProjectionHarnessChatSyncLink,
    execute: ({ sourceId }) => sql`
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source_id AS "sourceId",
        continuation_key AS "continuationKey",
        native_session_id AS "nativeSessionId",
        provider_instance_id AS "providerInstanceId",
        provider_label AS "providerLabel",
        activity,
        source_updated_at AS "sourceUpdatedAt",
        last_synced_at AS "lastSyncedAt"
      FROM projection_harness_chat_sync_links
      WHERE source_id = ${sourceId}
      ORDER BY native_session_id ASC, thread_id ASC
    `,
  });

  const upsertMessageLinkRow = SqlSchema.void({
    Request: ProjectionHarnessChatSyncMessageLink,
    execute: (link) => sql`
      INSERT INTO projection_harness_chat_sync_message_links (
        thread_id,
        native_message_id,
        message_id,
        linked_at
      ) VALUES (
        ${link.threadId},
        ${link.nativeMessageId},
        ${link.messageId},
        ${link.linkedAt}
      )
      ON CONFLICT (thread_id, native_message_id) DO NOTHING
    `,
  });
  const getMessageLinkRow = SqlSchema.findOneOption({
    Request: GetProjectionHarnessChatSyncMessageLinkInput,
    Result: ProjectionHarnessChatSyncMessageLink,
    execute: ({ threadId, nativeMessageId }) => sql`
      SELECT
        thread_id AS "threadId",
        native_message_id AS "nativeMessageId",
        message_id AS "messageId",
        linked_at AS "linkedAt"
      FROM projection_harness_chat_sync_message_links
      WHERE thread_id = ${threadId}
        AND native_message_id = ${nativeMessageId}
      LIMIT 1
    `,
  });
  const listMessageLinkRows = SqlSchema.findAll({
    Request: ListProjectionHarnessChatSyncMessageLinksInput,
    Result: ProjectionHarnessChatSyncMessageLink,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        native_message_id AS "nativeMessageId",
        message_id AS "messageId",
        linked_at AS "linkedAt"
      FROM projection_harness_chat_sync_message_links
      WHERE thread_id = ${threadId}
      ORDER BY linked_at ASC, native_message_id ASC
    `,
  });

  const upsertLink: ProjectionHarnessChatSyncRepositoryShape["upsertLink"] = (link) =>
    upsertLinkRow(link).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionHarnessChatSyncRepository.upsertLink")),
    );
  const getLinkByThreadId: ProjectionHarnessChatSyncRepositoryShape["getLinkByThreadId"] = (
    input,
  ) =>
    getLinkByThreadRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionHarnessChatSyncRepository.getLinkByThreadId"),
      ),
    );
  const getLinkBySourceSession: ProjectionHarnessChatSyncRepositoryShape["getLinkBySourceSession"] =
    (input) =>
      getLinkBySourceSessionRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionHarnessChatSyncRepository.getLinkBySourceSession"),
        ),
      );
  const getLinkByContinuationSession: ProjectionHarnessChatSyncRepositoryShape["getLinkByContinuationSession"] =
    (input) =>
      getLinkByContinuationSessionRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionHarnessChatSyncRepository.getLinkByContinuationSession"),
        ),
      );
  const listLinksByContinuationKey: ProjectionHarnessChatSyncRepositoryShape["listLinksByContinuationKey"] =
    (input) =>
      listLinksByContinuationRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionHarnessChatSyncRepository.listLinksByContinuationKey"),
        ),
      );
  const listLinksBySourceId: ProjectionHarnessChatSyncRepositoryShape["listLinksBySourceId"] = (
    input,
  ) =>
    listLinksBySourceRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionHarnessChatSyncRepository.listLinksBySourceId"),
      ),
    );
  const upsertMessageLink: ProjectionHarnessChatSyncRepositoryShape["upsertMessageLink"] = (link) =>
    upsertMessageLinkRow(link).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionHarnessChatSyncRepository.upsertMessageLink"),
      ),
    );
  const getMessageLink: ProjectionHarnessChatSyncRepositoryShape["getMessageLink"] = (input) =>
    getMessageLinkRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionHarnessChatSyncRepository.getMessageLink")),
    );
  const listMessageLinksByThreadId: ProjectionHarnessChatSyncRepositoryShape["listMessageLinksByThreadId"] =
    (input) =>
      listMessageLinkRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionHarnessChatSyncRepository.listMessageLinksByThreadId"),
        ),
      );

  return {
    upsertLink,
    getLinkByThreadId,
    getLinkBySourceSession,
    getLinkByContinuationSession,
    listLinksByContinuationKey,
    listLinksBySourceId,
    upsertMessageLink,
    getMessageLink,
    listMessageLinksByThreadId,
  } satisfies ProjectionHarnessChatSyncRepositoryShape;
});

export const ProjectionHarnessChatSyncRepositoryLive = Layer.effect(
  ProjectionHarnessChatSyncRepository,
  makeProjectionHarnessChatSyncRepository,
);
