import { EventId, SubagentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  decodeSubagentActivityPageCursor,
  encodeSubagentActivityPageCursor,
} from "./subagentActivityCursor.ts";

describe("subagentActivityCursor", () => {
  it("round-trips sequenced and legacy activity boundaries", () => {
    const sequenced = {
      threadId: ThreadId.make("thread-1"),
      subagentId: SubagentId.make("agent-1"),
      sequence: 42,
      createdAt: "2026-08-14T20:00:00.000Z",
      activityId: EventId.make("activity-42"),
    };
    const legacy = { ...sequenced, sequence: null, activityId: EventId.make("activity-legacy") };

    expect(decodeSubagentActivityPageCursor(encodeSubagentActivityPageCursor(sequenced))).toEqual(
      sequenced,
    );
    expect(decodeSubagentActivityPageCursor(encodeSubagentActivityPageCursor(legacy))).toEqual(
      legacy,
    );
  });

  it("rejects malformed cursors", () => {
    expect(decodeSubagentActivityPageCursor("not-base64-json")).toBeNull();
    expect(decodeSubagentActivityPageCursor(Buffer.from("[]").toString("base64url"))).toBeNull();
    expect(
      decodeSubagentActivityPageCursor(
        Buffer.from(JSON.stringify({ t: "thread-1", s: "agent-1", q: -1 })).toString("base64url"),
      ),
    ).toBeNull();
  });
});
