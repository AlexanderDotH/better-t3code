import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ActivityPayloadFromJsonString } from "./activityPayload.ts";

const encode = Schema.encodeSync(ActivityPayloadFromJsonString);
const decode = Schema.decodeUnknownSync(ActivityPayloadFromJsonString);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it("preserves legacy and independently supplied canonical data", () => {
  for (const value of [
    { data: { output: "visible" }, canonicalPayload: { data: { output: "original" } } },
    { data: undefined, canonicalPayload: { data: undefined } },
    { $t3CanonicalDataReference: 1, data: "root", canonicalPayload: { data: "original" } },
    { arbitrary: ["value", null, 1] },
  ]) {
    assert.deepStrictEqual(decode(encode(value)), JSON.parse(JSON.stringify(value)));
    assert.deepStrictEqual(decode(JSON.stringify(value)), JSON.parse(JSON.stringify(value)));
  }
});

it("stores repeated canonical tool data once and restores the complete payload", () => {
  const data = { output: "large-result".repeat(100_000) };
  const payload = {
    itemId: "storage-tool",
    data,
    canonicalPayload: { itemType: "mcp_tool_call", status: "completed", data },
  };
  const stored = encode(payload);
  assert.isBelow(stored.length, encodeJson(payload).length * 0.6);
  assert.deepStrictEqual(decode(stored), payload);
});
