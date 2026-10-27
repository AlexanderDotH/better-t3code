import { describe, expect, it } from "vite-plus/test";

import {
  createMobileChatVisualModeRecord,
  mobileChatVisualModePreferencePatch,
  nextMobileChatVisualModeUpdatedAt,
  resolveMobileChatVisualMode,
} from "./chat-visual-mode-preference";

describe("mobile chat visual mode preference", () => {
  it("resolves an absent synchronized record to Current", () => {
    expect(resolveMobileChatVisualMode(undefined)).toBe("current");
  });

  it("creates and persists an explicit Classic record", () => {
    const record = createMobileChatVisualModeRecord("classic", 1_787_178_400_000, "mobile:classic");

    expect(mobileChatVisualModePreferencePatch(record)).toEqual({
      chatVisualModeSyncRecord: record,
      chatVisualModeSyncRecordV2: record,
    });
  });

  it("persists Current explicitly instead of deleting the record", () => {
    const record = createMobileChatVisualModeRecord("current", 1_787_178_400_001, "mobile:current");

    expect(mobileChatVisualModePreferencePatch(record)).toEqual({
      chatVisualModeSyncRecord: record,
      chatVisualModeSyncRecordV2: record,
    });
  });

  it("mints a timestamp newer than wall time, the winner, and the previous local write", () => {
    expect(
      nextMobileChatVisualModeUpdatedAt({
        now: 100,
        winnerUpdatedAt: 105,
        previousLocalUpdatedAt: 110,
      }),
    ).toBe(111);
  });
});

it("stores Better T3 with a compatible Current mirror sharing its clock", () => {
  const record = createMobileChatVisualModeRecord("better-t3", 200, "mobile:better");
  expect(mobileChatVisualModePreferencePatch(record)).toEqual({
    chatVisualModeSyncRecordV2: record,
    chatVisualModeSyncRecord: { ...record, mode: "current" },
  });
});
