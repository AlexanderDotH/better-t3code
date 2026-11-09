import { describe, expect, it } from "vite-plus/test";
import {
  resolveThreadListShelfPreferences,
  toggleSettledShelfPreference,
  toggleSnoozedShelfPreference,
} from "./thread-list-shelf-preferences";

describe("thread shelf preference compatibility", () => {
  it("retains fork defaults before settings load", () => {
    expect(resolveThreadListShelfPreferences(undefined)).toEqual({
      snoozedShelfExpanded: false,
      settledShelfExpanded: true,
    });
  });
  it("reads existing fork choices", () => {
    expect(
      resolveThreadListShelfPreferences({
        threadListV2SnoozedShelfExpanded: true,
        threadListV2SettledShelfExpanded: false,
      }),
    ).toEqual({ snoozedShelfExpanded: true, settledShelfExpanded: false });
  });
  it("prefers updated upstream fields over legacy choices", () => {
    expect(
      resolveThreadListShelfPreferences({
        threadListSnoozedShelfExpanded: false,
        threadListSettledShelfExpanded: true,
        threadListV2SnoozedShelfExpanded: true,
        threadListV2SettledShelfExpanded: false,
      }),
    ).toEqual({ snoozedShelfExpanded: false, settledShelfExpanded: true });
  });
  it("toggles from the resolved choice so unset and legacy shelves flip once", () => {
    expect(toggleSettledShelfPreference({})).toEqual({ threadListSettledShelfExpanded: false });
    expect(toggleSnoozedShelfPreference({})).toEqual({ threadListSnoozedShelfExpanded: true });
    expect(toggleSettledShelfPreference({ threadListV2SettledShelfExpanded: false })).toEqual({
      threadListSettledShelfExpanded: true,
    });
    expect(toggleSnoozedShelfPreference({ threadListV2SnoozedShelfExpanded: true })).toEqual({
      threadListSnoozedShelfExpanded: false,
    });
  });
});
