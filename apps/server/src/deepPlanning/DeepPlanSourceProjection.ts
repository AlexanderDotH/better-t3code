export const deepPlanSourceProjectionCtes = `
source_v2_threads AS (
  SELECT current.* FROM orchestration_v2_projection_threads current
  WHERE NOT EXISTS (SELECT 1 FROM orchestration_v2_legacy_imports legacy
    WHERE legacy.thread_id = current.thread_id AND legacy.transcript_imported_at IS NULL)
), source_threads AS (
  SELECT thread_id, project_id, title, archived_at, deleted_at, updated_at, fork_json, json_extract(fork_json, '$.provenance.sourceThreadId') AS fork_source_thread_id
  FROM projection_threads old
  WHERE NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_threads current WHERE current.thread_id = old.thread_id)
  UNION ALL
  SELECT current.thread_id, current.project_id, current.title, current.archived_at, current.deleted_at, current.updated_at, old.fork_json,
    COALESCE(json_extract(current.payload_json, '$.forkedFrom.threadId'), json_extract(old.fork_json, '$.provenance.sourceThreadId'), CASE WHEN json_extract(current.payload_json, '$.lineage.relationshipToParent') = 'fork' THEN json_extract(current.payload_json, '$.lineage.parentThreadId') ELSE NULL END)
  FROM orchestration_v2_projection_threads current LEFT JOIN projection_threads old ON old.thread_id = current.thread_id
), source_messages AS (
  SELECT message_id, thread_id, role, text, turn_id, attachments_json, context_json, history_origin_json, is_streaming, created_at, updated_at, NULL AS reply_to_json, NULL AS reply_topic_id
  FROM projection_thread_messages old
  WHERE NOT EXISTS (SELECT 1 FROM source_v2_threads current WHERE current.thread_id = old.thread_id)
  UNION ALL
  SELECT old.message_id, mapped.thread_id, old.role, old.text, old.turn_id, old.attachments_json, old.context_json, NULL, old.is_streaming, old.created_at, old.updated_at, old.reply_to_json, old.reply_topic_id
  FROM orchestration_v2_legacy_subagent_threads mapped
  JOIN projection_thread_subagent_messages old ON old.thread_id = mapped.source_thread_id AND old.subagent_id = mapped.subagent_id
  WHERE EXISTS (SELECT 1 FROM orchestration_v2_legacy_imports legacy WHERE legacy.thread_id = mapped.thread_id AND legacy.transcript_imported_at IS NULL)
  UNION ALL
  SELECT current.message_id, current.thread_id, current.role, json_extract(current.payload_json, '$.text'), NULL,
    json_extract(current.payload_json, '$.attachments'), json_extract(current.payload_json, '$.context'), old.history_origin_json,
    current.streaming,
    current.created_at, current.updated_at, json_extract(current.payload_json, '$.replyTo'), json_extract(current.payload_json, '$.replyTopicId')
  FROM orchestration_v2_projection_messages current LEFT JOIN projection_thread_messages old ON old.thread_id = current.thread_id AND old.message_id = current.message_id
  WHERE EXISTS (SELECT 1 FROM source_v2_threads authoritative WHERE authoritative.thread_id = current.thread_id)
), source_activities AS (
  SELECT activity_id, thread_id, tone, kind, summary, payload_json, turn_id, sequence, history_origin_json, created_at
  FROM legacy_v1_projection_thread_activities old
  WHERE NOT EXISTS (SELECT 1 FROM source_v2_threads current WHERE current.thread_id = old.thread_id)
    OR EXISTS (SELECT 1 FROM orchestration_v2_legacy_imports legacy WHERE legacy.thread_id = old.thread_id)
  UNION ALL
  SELECT old.activity_id, mapped.thread_id, old.tone, old.kind, old.summary, old.payload_json, old.turn_id, old.sequence, NULL, old.created_at
  FROM orchestration_v2_legacy_subagent_threads mapped
  JOIN projection_thread_subagent_activities old ON old.thread_id = mapped.source_thread_id AND old.subagent_id = mapped.subagent_id
  UNION ALL
  SELECT turn_item_id, thread_id, 'info', type,
    COALESCE(json_extract(payload_json, '$.summary'), json_extract(payload_json, '$.title'), type),
    payload_json, NULL, ordinal, NULL, COALESCE(json_extract(payload_json, '$.createdAt'), updated_at)
  FROM orchestration_v2_projection_turn_items
  WHERE type NOT IN ('user_message', 'assistant_message') AND EXISTS
    (SELECT 1 FROM source_v2_threads current WHERE current.thread_id = orchestration_v2_projection_turn_items.thread_id)
)`;
