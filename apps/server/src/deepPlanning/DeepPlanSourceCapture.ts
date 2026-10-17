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
  while (true) {
    const rows = yield* sql`
        WITH messages AS (
          SELECT 'message:' || message_id AS "rowKey", message_id AS id,
            NULL AS "subagentId", role, text, turn_id AS "turnId",
            attachments_json AS attachments, context_json AS context,
            history_origin_json AS "historyOrigin", NULL AS "replyTo", NULL AS "replyTopicId",
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM projection_thread_messages
          WHERE thread_id = ${input.origin.threadId} AND is_streaming = 0
          UNION ALL
          SELECT 'subagent:' || subagent_id || ':' || message_id, message_id,
            subagent_id, role, text, turn_id, attachments_json, context_json,
            NULL, reply_to_json, reply_topic_id, created_at, updated_at
          FROM projection_thread_subagent_messages
          WHERE thread_id = ${input.origin.threadId} AND is_streaming = 0
        )
        SELECT * FROM messages
        WHERE "createdAt" > ${afterCreatedAt}
          OR ("createdAt" = ${afterCreatedAt} AND "rowKey" > ${afterRowKey})
        ORDER BY "createdAt", "rowKey" LIMIT ${CAPTURE_PAGE_SIZE}
      `;
    const decoded = yield* decodeMessageRows(rows);
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
        WITH activities AS (
          SELECT 'activity:' || activity_id AS "rowKey", activity_id AS id,
            NULL AS "subagentId", tone, kind, summary, payload_json AS payload,
            turn_id AS "turnId", sequence, history_origin_json AS "historyOrigin", created_at AS "createdAt"
          FROM projection_thread_activities WHERE thread_id = ${input.origin.threadId}
          UNION ALL
          SELECT 'subagent-activity:' || subagent_id || ':' || activity_id, activity_id,
            subagent_id, tone, kind, summary, payload_json, turn_id, sequence, NULL, created_at
          FROM projection_thread_subagent_activities WHERE thread_id = ${input.origin.threadId}
        )
        SELECT * FROM activities
        WHERE "createdAt" > ${afterCreatedAt}
          OR ("createdAt" = ${afterCreatedAt} AND "rowKey" > ${afterRowKey})
        ORDER BY "createdAt", "rowKey" LIMIT ${CAPTURE_PAGE_SIZE}
      `;
    const decoded = yield* decodeActivityRows(rows);
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
