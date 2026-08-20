import type { EventId, SubagentId, ThreadId } from "@t3tools/contracts";

/** Exclusive keyset boundary for the next older subagent-activity page. */
export interface SubagentActivityPageCursor {
  readonly threadId: ThreadId;
  readonly subagentId: SubagentId;
  readonly sequence: number | null;
  readonly createdAt: string;
  readonly activityId: EventId;
}

export function encodeSubagentActivityPageCursor(cursor: SubagentActivityPageCursor): string {
  return Buffer.from(
    JSON.stringify({
      t: cursor.threadId,
      s: cursor.subagentId,
      q: cursor.sequence,
      c: cursor.createdAt,
      i: cursor.activityId,
    }),
  ).toString("base64url");
}

/** Returns null for malformed cursors; callers degrade those to a first page. */
export function decodeSubagentActivityPageCursor(
  encoded: string,
): SubagentActivityPageCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.t !== "string" ||
    record.t.length === 0 ||
    typeof record.s !== "string" ||
    record.s.length === 0 ||
    (record.q !== null &&
      (typeof record.q !== "number" || !Number.isSafeInteger(record.q) || record.q < 0)) ||
    typeof record.c !== "string" ||
    record.c.length === 0 ||
    typeof record.i !== "string" ||
    record.i.length === 0
  ) {
    return null;
  }
  return {
    threadId: record.t as ThreadId,
    subagentId: record.s as SubagentId,
    sequence: record.q as number | null,
    createdAt: record.c,
    activityId: record.i as EventId,
  };
}
