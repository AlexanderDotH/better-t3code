import {
  OrchestrationV2ConversationMessageJson,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2TurnItem,
  ThreadId,
  type MessageId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export type FrozenForkMessages = ReadonlyMap<
  ThreadId,
  ReadonlyMap<MessageId, OrchestrationV2ConversationMessage>
>;
const decodeMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ConversationMessageJson),
);

export const frozenMessageEditsQuery = (
  sql: SqlClient.SqlClient,
  sourceId: ThreadId,
  cutoff: number,
) => sql<{ payload_json: string }>`
  SELECT event.payload_json FROM orchestration_command_receipts receipt INDEXED BY idx_orch_receipts_frozen_message_edits
  CROSS JOIN orchestration_events event INDEXED BY idx_orch_events_command_id ON event.command_id = receipt.command_id
  WHERE receipt.aggregate_kind = 'thread' AND receipt.aggregate_id = ${sourceId}
    AND receipt.command_type = 'message.edit' AND receipt.status = 'accepted'
    AND receipt.result_sequence > ${cutoff}
    AND event.application_event_version = 2 AND event.event_type = 'message.updated'
  ORDER BY event.sequence ASC
`;

export const readForkLineage = Effect.fn("FrozenMessageHistory.readForkLineage")(function* (
  threadId: ThreadId,
) {
  const sql = yield* SqlClient.SqlClient;
  const lineage: Array<{ sourceId: ThreadId; cutoff: number | null }> = [];
  const seen = new Set<ThreadId>();
  let targetId = threadId;
  while (!seen.has(targetId)) {
    seen.add(targetId);
    const rows = yield* sql<{ source_thread_id: string | null; fork_sequence: number | null }>`
      SELECT COALESCE(
        CASE WHEN json_extract(thread.payload_json, '$.forkedFrom.type') = 'run'
          THEN json_extract(thread.payload_json, '$.forkedFrom.threadId') ELSE NULL END,
        (SELECT transfer.source_thread_id FROM orchestration_v2_projection_context_transfers transfer
          WHERE transfer.target_thread_id = thread.thread_id AND transfer.type = 'fork'
          ORDER BY transfer.updated_at ASC LIMIT 1)
      ) AS source_thread_id,
      (SELECT MIN(event.sequence) FROM orchestration_events event INDEXED BY orchestration_events_v2_created_threads_idx
        WHERE event.application_event_version = 2 AND event.aggregate_kind = 'thread'
          AND event.stream_id = thread.thread_id AND event.event_type = 'thread.created') AS fork_sequence
      FROM orchestration_v2_projection_threads thread WHERE thread.thread_id = ${targetId}
    `;
    const edge = rows[0];
    if (edge?.source_thread_id == null || seen.has(ThreadId.make(edge.source_thread_id))) break;
    const sourceId = ThreadId.make(edge.source_thread_id);
    lineage.push({ sourceId, cutoff: edge.fork_sequence });
    targetId = sourceId;
  }
  return lineage;
});

export const readFrozenForkMessages = Effect.fn("FrozenMessageHistory.readFrozenForkMessages")(
  function* (threadId: ThreadId) {
    const sql = yield* SqlClient.SqlClient;
    const frozen = new Map<ThreadId, Map<MessageId, OrchestrationV2ConversationMessage>>();
    for (const { sourceId, cutoff } of yield* readForkLineage(threadId)) {
      if (cutoff === null) continue;
      const edits = yield* frozenMessageEditsQuery(sql, sourceId, cutoff);
      const messages = new Map<MessageId, OrchestrationV2ConversationMessage>();
      for (const row of edits) {
        const message = yield* decodeMessage(row.payload_json);
        if (!messages.has(message.id)) messages.set(message.id, message);
      }
      if (messages.size > 0) frozen.set(sourceId, messages);
    }
    return frozen;
  },
);

export function frozenConversationItem(
  item: OrchestrationV2TurnItem,
  frozen: FrozenForkMessages,
): OrchestrationV2TurnItem {
  if (item.type !== "user_message" && item.type !== "assistant_message") return item;
  const previous = frozen.get(item.threadId)?.get(item.messageId);
  if (!previous) return item;
  return item.type === "user_message"
    ? {
        ...item,
        text: previous.text,
        attachments: previous.attachments,
        context: previous.context,
        replyTo: previous.replyTo,
        replyTopicId: previous.replyTopicId,
        updatedAt: previous.updatedAt,
      }
    : {
        ...item,
        text: previous.text,
        attachments: previous.attachments,
        replyTo: previous.replyTo,
        replyTopicId: previous.replyTopicId,
        updatedAt: previous.updatedAt,
      };
}

const encodeAttachmentIds = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

export const referencedAttachmentIds = Effect.fn("FrozenMessageHistory.referencedAttachmentIds")(
  function* (attachmentIds: ReadonlyArray<string>) {
    if (attachmentIds.length === 0) return new Set<string>();
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ attachment_id: string }>`
    WITH RECURSIVE edges AS MATERIALIZED (
      SELECT thread.thread_id AS target_id,
        COALESCE(CASE WHEN json_extract(thread.payload_json, '$.forkedFrom.type') = 'run'
          THEN json_extract(thread.payload_json, '$.forkedFrom.threadId') ELSE NULL END,
          (SELECT transfer.source_thread_id FROM orchestration_v2_projection_context_transfers transfer
            WHERE transfer.target_thread_id = thread.thread_id AND transfer.type = 'fork'
            ORDER BY transfer.updated_at ASC LIMIT 1)) AS source_id,
        (SELECT MIN(event.sequence) FROM orchestration_events event INDEXED BY orchestration_events_v2_created_threads_idx
          WHERE event.application_event_version = 2 AND event.aggregate_kind = 'thread'
            AND event.stream_id = thread.thread_id AND event.event_type = 'thread.created') AS cutoff,
        thread.deleted_at
      FROM orchestration_v2_projection_threads thread
    ), ancestors(root_id, source_id, cutoff) AS (
      SELECT target_id, source_id, cutoff FROM edges WHERE deleted_at IS NULL AND source_id IS NOT NULL
      UNION
      SELECT ancestor.root_id, edge.source_id, edge.cutoff
        FROM ancestors ancestor JOIN edges edge ON edge.target_id = ancestor.source_id
        WHERE edge.source_id IS NOT NULL
    ), owners(thread_id) AS (
      SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL
      UNION SELECT source_id FROM ancestors
      UNION SELECT old.thread_id FROM projection_threads old WHERE old.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_threads current WHERE current.thread_id = old.thread_id)
    ), edit_events AS MATERIALIZED (
      SELECT receipt.aggregate_id AS source_id, receipt.result_sequence, event.sequence,
        json_extract(event.payload_json, '$.id') AS message_id
      FROM orchestration_command_receipts receipt INDEXED BY idx_orch_receipts_frozen_message_edits
      CROSS JOIN orchestration_events event INDEXED BY idx_orch_events_command_id ON event.command_id = receipt.command_id
      WHERE receipt.aggregate_kind = 'thread' AND receipt.command_type = 'message.edit' AND receipt.status = 'accepted'
        AND event.application_event_version = 2 AND event.event_type = 'message.updated'
    ), versions AS (
      SELECT event.sequence, ROW_NUMBER() OVER (
        PARTITION BY ancestor.root_id, ancestor.source_id, event.message_id ORDER BY event.sequence ASC
      ) AS rank
      FROM ancestors ancestor JOIN edit_events event ON event.source_id = ancestor.source_id
        AND ancestor.cutoff IS NOT NULL AND event.result_sequence > ancestor.cutoff
    ), frozen_events AS (SELECT DISTINCT sequence FROM versions WHERE rank = 1), references_to_keep(attachment_id) AS (
      SELECT json_extract(attachment.value, '$.id') FROM orchestration_v2_projection_messages message
        JOIN owners owner ON owner.thread_id = message.thread_id, json_each(message.payload_json, '$.attachments') attachment
      UNION
      SELECT json_extract(attachment.value, '$.id') FROM frozen_events frozen
        JOIN orchestration_events event ON event.sequence = frozen.sequence, json_each(event.payload_json, '$.attachments') attachment
      UNION
      SELECT reference.attachment_id FROM projection_attachment_references reference JOIN owners owner ON owner.thread_id = reference.thread_id
        WHERE NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_threads current WHERE current.thread_id = owner.thread_id)
          OR EXISTS (SELECT 1 FROM orchestration_v2_legacy_imports legacy WHERE legacy.thread_id = owner.thread_id AND legacy.transcript_imported_at IS NULL)
      UNION
      SELECT json_extract(attachment.value, '$.id') FROM orchestration_v2_projection_turn_items item
        JOIN owners owner ON owner.thread_id = item.thread_id,
        json_each(item.payload_json, '$.questionAnswer.attachmentsByQuestionId') question,
        json_each(question.value) attachment
      UNION
      SELECT json_extract(attachment.value, '$.id') FROM orchestration_v2_projection_threads thread
        JOIN owners owner ON owner.thread_id = thread.thread_id,
        json_each(thread.payload_json, '$.guestShare.messages') message, json_each(message.value, '$.attachments') attachment
      UNION
      SELECT json_extract(attachment.value, '$.id') FROM orchestration_v2_projection_context_handoffs handoff
        JOIN owners owner ON owner.thread_id = handoff.thread_id,
        json_each(handoff.payload_json, '$.history.messages') message, json_each(message.value, '$.attachments') attachment
      UNION
      SELECT wanted.value FROM json_each(${encodeAttachmentIds(attachmentIds)}) wanted
        JOIN orchestration_v2_projection_turn_items item ON item.type = 'dynamic_tool'
        JOIN owners owner ON owner.thread_id = item.thread_id
        WHERE (item.payload_json LIKE '%htmlRender%' OR item.payload_json LIKE '%viewedImagePath%')
          AND instr(item.payload_json, wanted.value) > 0
    )
    SELECT DISTINCT reference.attachment_id FROM references_to_keep reference
      JOIN json_each(${encodeAttachmentIds(attachmentIds)}) wanted ON wanted.value = reference.attachment_id
  `;
    return new Set(rows.map((row) => row.attachment_id));
  },
);
