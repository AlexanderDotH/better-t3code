import * as Effect from "effect/Effect";
import type { KnowledgeStore } from "../persistence/KnowledgeStore.ts";
import type {
  KnowledgeRecordKind,
  KnowledgeRecordMap,
  KnowledgePage,
} from "../persistence/KnowledgeStoreTypes.ts";
const BATCH_SIZE = 128;

export const listExtractedProjectFiles = Effect.fn("listExtractedProjectFiles")(function* (
  store: KnowledgeStore,
  revision: number,
  afterId?: string,
  limit = BATCH_SIZE,
) {
  const page = yield* store.listJobs({
    revision,
    kind: "extract",
    state: "completed",
    limit,
    ...(afterId === undefined ? {} : { afterId }),
  });
  const items: KnowledgeRecordMap["files"][] = [];
  for (const job of page.items) {
    const file = yield* store.getRecord("files", job.filePath, revision);
    if (file?.status === "indexed" && file.contentHash === job.contentHash) items.push(file);
  }
  return { ...page, items };
});

export const collectProjectIndexRecords = Effect.fn("collectProjectIndexRecords")(function* <
  Kind extends KnowledgeRecordKind,
>(store: KnowledgeStore, revision: number, kind: Kind, filePath: string) {
  const records: Array<KnowledgeRecordMap[Kind]> = [];
  let cursor: string | null = null;
  do {
    const page: KnowledgePage<KnowledgeRecordMap[Kind]> = yield* store.listRecords({
      kind,
      revision,
      limit: BATCH_SIZE,
      filePath,
      ...(cursor === null ? {} : { afterId: cursor }),
    });
    records.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return records;
});
