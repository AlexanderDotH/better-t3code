import {
  ChatAttachment,
  DeepPlanSourceError,
  EventId,
  IsoDateTime,
  MessageId,
  ProjectId,
  MessageReplyReference,
  OrchestrationHistoryOrigin,
  OrchestrationMessageContext,
  OrchestrationMessageRole,
  OrchestrationThreadActivityTone,
  SubagentId,
  ThreadId,
  TurnId,
  type DeepPlanSourceRecord,
  type DeepPlanSourceRef,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import {
  canonicalSourceJson,
  sourceContentHash,
  sourceRecordContentHash,
  sourceRecordId,
} from "./DeepPlanSourceContent.ts";

const CAPTURE_PAGE_SIZE = 128;
const CAPTURE_PAGE_BYTES = 4 * 1024 * 1024;
const ATTACHMENT_CHUNK_BYTES = 18 * 1024;
const CONTENT_CHUNK_CHARS = 8 * 1024;
const INLINE_CONTENT_BYTES = 32 * 1024;

const MessageRow = Schema.Struct({
  rowKey: Schema.String,
  id: MessageId,
  subagentId: Schema.NullOr(SubagentId),
  role: OrchestrationMessageRole,
  text: Schema.String,
  turnId: Schema.NullOr(TurnId),
  attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  context: Schema.NullOr(Schema.fromJsonString(OrchestrationMessageContext)),
  historyOrigin: Schema.NullOr(Schema.fromJsonString(OrchestrationHistoryOrigin)),
  replyTo: Schema.NullOr(Schema.fromJsonString(MessageReplyReference)),
  replyTopicId: Schema.NullOr(SubagentId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
const ActivityRow = Schema.Struct({
  rowKey: Schema.String,
  id: EventId,
  subagentId: Schema.NullOr(SubagentId),
  tone: OrchestrationThreadActivityTone,
  kind: Schema.String,
  summary: Schema.String,
  payload: Schema.fromJsonString(Schema.Unknown),
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.NullOr(Schema.Number),
  historyOrigin: Schema.NullOr(Schema.fromJsonString(OrchestrationHistoryOrigin)),
  createdAt: IsoDateTime,
});
const decodeMessageRows = Schema.decodeUnknownEffect(Schema.Array(MessageRow));
const decodeActivityRows = Schema.decodeUnknownEffect(Schema.Array(ActivityRow));

function compareCaptureRows(
  left: { readonly createdAt: string; readonly rowKey: string },
  right: { readonly createdAt: string; readonly rowKey: string },
) {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return Buffer.compare(Buffer.from(left.rowKey), Buffer.from(right.rowKey));
}

function messageFromRow(row: typeof MessageRow.Type): OrchestrationMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    turnId: row.turnId,
    streaming: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.attachments === null ? {} : { attachments: row.attachments }),
    ...(row.context === null ? {} : { context: row.context }),
    ...(row.historyOrigin === null ? {} : { historyOrigin: row.historyOrigin }),
    ...(row.replyTo === null ? {} : { replyTo: row.replyTo }),
    ...(row.replyTopicId === null && row.subagentId === null
      ? {}
      : { replyTopicId: row.replyTopicId ?? row.subagentId! }),
  };
}

function activityFromRow(row: typeof ActivityRow.Type): OrchestrationThreadActivity {
  return {
    id: row.id,
    tone: row.tone,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload,
    turnId: row.turnId,
    createdAt: row.createdAt,
    ...(row.sequence === null ? {} : { sequence: row.sequence }),
    ...(row.historyOrigin === null ? {} : { historyOrigin: row.historyOrigin }),
    ...(row.subagentId === null ? {} : { replyTopicId: row.subagentId }),
  };
}

function withContentIdentity(record: DeepPlanSourceRecord): DeepPlanSourceRecord {
  const contentHash = sourceRecordContentHash(record);
  return { ...record, recordId: sourceRecordId(record.origin, contentHash), contentHash };
}

export const captureSourceRecords = Effect.fn("DeepPlanSources.captureSourceRecords")(function* <
  E,
  R,
>(input: {
  readonly origin: DeepPlanSourceRef;
  readonly attachmentsDir: string;
  readonly onRecord: (record: DeepPlanSourceRecord) => Effect.Effect<void, E, R>;
}) {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  let messageCount = 0;
  let activityCount = 0;
  let attachmentCount = 0;
  let recordCount = 0;
  const attachmentIds = new Set<string>();
  const originProjects = new Map<ThreadId, ProjectId>();
  const recordOrigin = Effect.fnUntraced(function* (
    historyOrigin: OrchestrationHistoryOrigin | null,
    recordId: string,
  ) {
    const threadId = historyOrigin?.sourceThreadId ?? input.origin.threadId;
    let projectId = originProjects.get(threadId);
    if (projectId === undefined) {
      const projects = yield* sql<{
        readonly projectId: ProjectId;
      }>`SELECT project_id AS "projectId" FROM projection_threads WHERE thread_id = ${threadId}`;
      projectId = projects[0]?.projectId ?? input.origin.projectId;
      originProjects.set(threadId, projectId);
    }
    return { ...input.origin, projectId, threadId, recordId: historyOrigin?.sourceId ?? recordId };
  });
  const append = Effect.fnUntraced(function* (record: DeepPlanSourceRecord) {
    yield* input.onRecord(withContentIdentity(record));
    recordCount += 1;
  });

  const appendContent = Effect.fnUntraced(function* (
    origin: DeepPlanSourceRecord["origin"],
    data: string,
    mediaType: string,
    requiredForAnalysis: boolean,
  ) {
    const contentId = sourceContentHash([origin, mediaType, data]);
    const totalChunks = Math.max(1, Math.ceil(data.length / CONTENT_CHUNK_CHARS));
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      yield* append({
        kind: "content",
        recordId: "",
        contentHash: "",
        contentId,
        mediaType,
        origin: { ...origin, recordId: `${origin.recordId}:content:${chunkIndex}` },
        chunkIndex,
        totalChunks,
        data: data.slice(chunkIndex * CONTENT_CHUNK_CHARS, (chunkIndex + 1) * CONTENT_CHUNK_CHARS),
        requiredForAnalysis,
      });
    }
    return contentId;
  });

  const appendAttachment = Effect.fnUntraced(function* (
    attachment: ChatAttachment,
    messageOrigin: DeepPlanSourceRecord["origin"],
  ) {
    if (attachmentIds.has(attachment.id)) return;
    attachmentIds.add(attachment.id);
    const path = resolveAttachmentPath({ attachmentsDir: input.attachmentsDir, attachment });
    if (path === null) {
      return yield* new DeepPlanSourceError({
        code: "source-unavailable",
        message: `Unsupported source attachment: ${attachment.id}`,
      });
    }
    const info = yield* fs.stat(path);
    const size = Number(info.size);
    if (size !== attachment.sizeBytes) {
      return yield* new DeepPlanSourceError({
        code: "source-unavailable",
        message: `Source attachment size changed: ${attachment.id}`,
      });
    }
    const totalChunks = Math.max(1, Math.ceil(size / ATTACHMENT_CHUNK_BYTES));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(path, { flag: "r" });
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const expectedBytes = Math.min(
            ATTACHMENT_CHUNK_BYTES,
            size - chunkIndex * ATTACHMENT_CHUNK_BYTES,
          );
          const data = new Uint8Array(expectedBytes);
          let filled = 0;
          while (filled < expectedBytes) {
            const part = Option.getOrElse(
              yield* file.readAlloc(expectedBytes - filled),
              () => new Uint8Array(),
            );
            if (part.byteLength === 0)
              return yield* new DeepPlanSourceError({
                code: "source-unavailable",
                message: `Source attachment is incomplete: ${attachment.id}`,
              });
            data.set(part, filled);
            filled += part.byteLength;
          }
          yield* append({
            kind: "attachment",
            recordId: "",
            origin: { ...messageOrigin, recordId: `attachment:${attachment.id}:${chunkIndex}` },
            contentHash: "",
            attachmentId: attachment.id,
            mimeType: attachment.mimeType,
            name: attachment.name,
            chunkIndex,
            totalChunks,
            dataBase64: Buffer.from(data).toString("base64"),
          });
        }
      }),
    );
    attachmentCount += 1;
  });

  let afterCreatedAt = "";
  let afterRowKey = "";
  // Keep key pages outside payload joins so SQLite cannot scan all subagent bodies.
  while (true) {
    const rows = yield* sql`
        WITH root_page AS (
          SELECT message_id AS id, created_at AS "createdAt", 'message:' || message_id AS "rowKey"
          FROM projection_thread_messages
          WHERE thread_id = ${input.origin.threadId} AND is_streaming = 0
            AND created_at >= ${afterCreatedAt}
            AND (created_at > ${afterCreatedAt} OR 'message:' || message_id > ${afterRowKey})
          ORDER BY created_at, message_id LIMIT ${CAPTURE_PAGE_SIZE}
        ), subagent_page AS (
          SELECT message_id AS id, subagent_id AS "subagentId", created_at AS "createdAt",
            'subagent:' || subagent_id || ':' || message_id AS "rowKey"
          FROM projection_thread_subagent_messages
          WHERE thread_id = ${input.origin.threadId} AND is_streaming = 0
            AND created_at >= ${afterCreatedAt}
            AND (created_at > ${afterCreatedAt} OR 'subagent:' || subagent_id || ':' || message_id > ${afterRowKey})
          ORDER BY created_at, "rowKey" LIMIT ${CAPTURE_PAGE_SIZE}
        ), page AS MATERIALIZED (
          SELECT id, NULL AS "subagentId", "createdAt", "rowKey" FROM root_page
          UNION ALL
          SELECT id, "subagentId", "createdAt", "rowKey" FROM subagent_page
          ORDER BY "createdAt", "rowKey" LIMIT ${CAPTURE_PAGE_SIZE}
        ), sizes AS (
          SELECT p.*, octet_length(m.text) + COALESCE(octet_length(m.attachments_json), 0)
            + COALESCE(octet_length(m.context_json), 0) AS bytes
          FROM page p CROSS JOIN projection_thread_messages m ON m.message_id = p.id
          WHERE p."subagentId" IS NULL
          UNION ALL
          SELECT p.*, octet_length(m.text) + COALESCE(octet_length(m.attachments_json), 0)
            + COALESCE(octet_length(m.context_json), 0)
          FROM page p CROSS JOIN projection_thread_subagent_messages m
            ON m.thread_id = ${input.origin.threadId} AND m.subagent_id = p."subagentId" AND m.message_id = p.id
        ), budgets AS (
          SELECT *, SUM(bytes) OVER (ORDER BY "createdAt", "rowKey") AS "totalBytes",
            ROW_NUMBER() OVER (ORDER BY "createdAt", "rowKey") AS position FROM sizes
        ), bounded_page AS MATERIALIZED (
          SELECT * FROM budgets WHERE "totalBytes" <= ${CAPTURE_PAGE_BYTES} OR position = 1
        )
        SELECT p."rowKey", m.message_id AS id, p."subagentId", m.role, m.text,
          m.turn_id AS "turnId", m.attachments_json AS attachments, m.context_json AS context,
          m.history_origin_json AS "historyOrigin", NULL AS "replyTo", NULL AS "replyTopicId",
          m.created_at AS "createdAt", m.updated_at AS "updatedAt"
        FROM bounded_page p CROSS JOIN projection_thread_messages m ON m.message_id = p.id
        WHERE p."subagentId" IS NULL
        UNION ALL
        SELECT p."rowKey", m.message_id, p."subagentId", m.role, m.text,
          m.turn_id, m.attachments_json, m.context_json, NULL, m.reply_to_json, m.reply_topic_id,
          m.created_at, m.updated_at
        FROM bounded_page p CROSS JOIN projection_thread_subagent_messages m
          ON m.thread_id = ${input.origin.threadId} AND m.subagent_id = p."subagentId" AND m.message_id = p.id
      `;
    // Sort only page-sized references; sorting payloads in SQLite can spill gigabytes to disk.
    const decoded = (yield* decodeMessageRows(rows)).toSorted(compareCaptureRows);
    if (decoded.length === 0) break;
    for (const row of decoded) {
      const origin = yield* recordOrigin(
        row.historyOrigin,
        row.subagentId === null ? row.id : row.rowKey,
      );
      const message = messageFromRow(row);
      const messageJson = canonicalSourceJson(message);
      const detailsContentId =
        Buffer.byteLength(messageJson) > INLINE_CONTENT_BYTES &&
        Buffer.byteLength(canonicalSourceJson({ ...message, text: "" })) > INLINE_CONTENT_BYTES
          ? yield* appendContent(origin, messageJson, "application/json", true)
          : undefined;
      const textContentId =
        Buffer.byteLength(canonicalSourceJson(message.text)) > INLINE_CONTENT_BYTES &&
        detailsContentId === undefined
          ? yield* appendContent(origin, message.text, "text/plain", true)
          : undefined;
      yield* append({
        kind: "message",
        recordId: "",
        origin,
        contentHash: "",
        message:
          detailsContentId !== undefined
            ? {
                id: message.id,
                role: message.role,
                text: "",
                turnId: message.turnId,
                streaming: false,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
              }
            : textContentId === undefined
              ? message
              : { ...message, text: "" },
        ...(textContentId === undefined ? {} : { textContentId }),
        ...(detailsContentId === undefined ? {} : { detailsContentId }),
      });
      messageCount += 1;
      for (const attachment of row.attachments ?? []) yield* appendAttachment(attachment, origin);
      afterCreatedAt = row.createdAt;
      afterRowKey = row.rowKey;
    }
  }

  afterCreatedAt = "";
  afterRowKey = "";
  while (true) {
    const rows = yield* sql`
        WITH root_page AS (
          SELECT activity_id AS id, created_at AS "createdAt", 'activity:' || activity_id AS "rowKey"
          FROM projection_thread_activities
          WHERE thread_id = ${input.origin.threadId} AND created_at >= ${afterCreatedAt}
            AND (created_at > ${afterCreatedAt} OR 'activity:' || activity_id > ${afterRowKey})
          ORDER BY created_at, activity_id LIMIT ${CAPTURE_PAGE_SIZE}
        ), subagent_page AS (
          SELECT activity_id AS id, subagent_id AS "subagentId", created_at AS "createdAt",
            'subagent-activity:' || subagent_id || ':' || activity_id AS "rowKey"
          FROM projection_thread_subagent_activities
          WHERE thread_id = ${input.origin.threadId} AND created_at >= ${afterCreatedAt}
            AND (created_at > ${afterCreatedAt} OR 'subagent-activity:' || subagent_id || ':' || activity_id > ${afterRowKey})
          ORDER BY created_at, "rowKey" LIMIT ${CAPTURE_PAGE_SIZE}
        ), page AS MATERIALIZED (
          SELECT id, NULL AS "subagentId", "createdAt", "rowKey" FROM root_page
          UNION ALL
          SELECT id, "subagentId", "createdAt", "rowKey" FROM subagent_page
          ORDER BY "createdAt", "rowKey" LIMIT ${CAPTURE_PAGE_SIZE}
        ), sizes AS (
          SELECT p.*, octet_length(a.payload_json) + octet_length(a.summary) AS bytes
          FROM page p CROSS JOIN projection_thread_activities a ON a.activity_id = p.id
          WHERE p."subagentId" IS NULL
          UNION ALL
          SELECT p.*, octet_length(a.payload_json) + octet_length(a.summary)
          FROM page p CROSS JOIN projection_thread_subagent_activities a
            ON a.thread_id = ${input.origin.threadId} AND a.subagent_id = p."subagentId" AND a.activity_id = p.id
        ), budgets AS (
          SELECT *, SUM(bytes) OVER (ORDER BY "createdAt", "rowKey") AS "totalBytes",
            ROW_NUMBER() OVER (ORDER BY "createdAt", "rowKey") AS position FROM sizes
        ), bounded_page AS MATERIALIZED (
          SELECT * FROM budgets WHERE "totalBytes" <= ${CAPTURE_PAGE_BYTES} OR position = 1
        )
        SELECT p."rowKey", a.activity_id AS id, p."subagentId", a.tone, a.kind, a.summary,
          a.payload_json AS payload, a.turn_id AS "turnId", a.sequence,
          a.history_origin_json AS "historyOrigin", a.created_at AS "createdAt"
        FROM bounded_page p CROSS JOIN projection_thread_activities a ON a.activity_id = p.id
        WHERE p."subagentId" IS NULL
        UNION ALL
        SELECT p."rowKey", a.activity_id, p."subagentId", a.tone, a.kind, a.summary,
          a.payload_json, a.turn_id, a.sequence, NULL, a.created_at
        FROM bounded_page p CROSS JOIN projection_thread_subagent_activities a
          ON a.thread_id = ${input.origin.threadId} AND a.subagent_id = p."subagentId" AND a.activity_id = p.id
      `;
    const decoded = (yield* decodeActivityRows(rows)).toSorted(compareCaptureRows);
    if (decoded.length === 0) break;
    for (const row of decoded) {
      const origin = yield* recordOrigin(
        row.historyOrigin,
        row.subagentId === null ? row.id : row.rowKey,
      );
      const activity = activityFromRow(row);
      const payloadJson = canonicalSourceJson(activity.payload);
      const detailsContentId =
        Buffer.byteLength(canonicalSourceJson({ ...activity, payload: null })) >
        INLINE_CONTENT_BYTES
          ? yield* appendContent(origin, canonicalSourceJson(activity), "application/json", true)
          : undefined;
      const contentId =
        Buffer.byteLength(payloadJson) > INLINE_CONTENT_BYTES && detailsContentId === undefined
          ? yield* appendContent(origin, payloadJson, "application/json", false)
          : undefined;
      yield* append({
        kind: "activity",
        recordId: "",
        origin,
        contentHash: "",
        activity:
          detailsContentId !== undefined
            ? {
                id: activity.id,
                tone: activity.tone,
                kind: activity.kind,
                summary: "Activity content is available through its frozen reference.",
                payload: { deepPlanContentRef: detailsContentId },
                turnId: activity.turnId,
                createdAt: activity.createdAt,
              }
            : contentId === undefined
              ? activity
              : { ...activity, payload: { deepPlanContentRef: contentId } },
        ...(detailsContentId === undefined ? {} : { detailsContentId }),
      });
      activityCount += 1;
      afterCreatedAt = row.createdAt;
      afterRowKey = row.rowKey;
    }
  }
  return { messageCount, activityCount, attachmentCount, recordCount };
});
