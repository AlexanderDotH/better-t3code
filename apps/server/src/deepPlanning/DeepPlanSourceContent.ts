// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type { DeepPlanSourceRecord } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!Predicate.isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, sortedJsonValue(value[key])]),
  );
}

export function canonicalSourceJson(value: unknown): string {
  return encodeJson(sortedJsonValue(value));
}

export function sourceContentHash(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(canonicalSourceJson(value)).digest("hex");
}

export function sourceOriginKey(origin: DeepPlanSourceRecord["origin"]): string {
  return canonicalSourceJson(origin);
}

export function sourceRecordId(
  origin: DeepPlanSourceRecord["origin"],
  contentHash: string,
): string {
  return sourceContentHash([sourceOriginKey(origin), contentHash]);
}

/** Fork-local row IDs and update timestamps do not create new content versions. */
export function sourceRecordContentHash(record: DeepPlanSourceRecord): string {
  switch (record.kind) {
    case "message":
      return sourceContentHash({
        kind: record.kind,
        role: record.message.role,
        text: record.message.text,
        textContentId: record.textContentId,
        detailsContentId: record.detailsContentId,
        attachments: record.message.attachments,
        context: record.message.context,
        replyTo: record.message.replyTo,
        replyTopicId: record.message.replyTopicId,
      });
    case "activity":
      return sourceContentHash({
        kind: record.kind,
        tone: record.activity.tone,
        kindName: record.activity.kind,
        summary: record.activity.summary,
        payload: record.activity.payload,
        detailsContentId: record.detailsContentId,
      });
    case "attachment":
      return sourceContentHash({
        kind: record.kind,
        attachmentId: record.attachmentId,
        mimeType: record.mimeType,
        name: record.name,
        chunkIndex: record.chunkIndex,
        totalChunks: record.totalChunks,
        dataBase64: record.dataBase64,
      });
    case "content":
      return sourceContentHash({
        kind: record.kind,
        contentId: record.contentId,
        mediaType: record.mediaType,
        chunkIndex: record.chunkIndex,
        totalChunks: record.totalChunks,
        data: record.data,
        requiredForAnalysis: record.requiredForAnalysis,
      });
  }
}

export function sourceManifestHasher() {
  const hash = NodeCrypto.createHash("sha256");
  return {
    add: (record: Pick<DeepPlanSourceRecord, "recordId" | "contentHash">) => {
      hash.update(`${record.recordId}:${record.contentHash}\n`);
    },
    finish: () => hash.digest("hex"),
  };
}

export function sourceChunkHash(records: ReadonlyArray<unknown>): string {
  return sourceContentHash(records);
}
