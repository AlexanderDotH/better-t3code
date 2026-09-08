import { describe, expect, it } from "vite-plus/test";
import { resolveThreadListShelfPreferences } from "./thread-list-shelf-preferences";

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
});
