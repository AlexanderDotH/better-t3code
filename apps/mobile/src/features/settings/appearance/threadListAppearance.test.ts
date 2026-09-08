import { describe, expect, it } from "vite-plus/test";

import {
  mobileThreadListLayoutPatch,
  resolveMobileThreadListLayout,
  THREAD_LIST_LAYOUT_OPTIONS,
} from "./threadListAppearance";

describe("mobile thread list appearance", () => {
  it("offers Current and Classic as explicit layout choices", () => {
    expect(THREAD_LIST_LAYOUT_OPTIONS.map(({ layout, label }) => ({ layout, label }))).toEqual([
      { layout: "current", label: "Current" },
      { layout: "classic", label: "Classic" },
    ]);
  });

  it("keeps Current as the default for a device without a saved choice", () => {
    expect(resolveMobileThreadListLayout(undefined)).toBe("current");
    expect(resolveMobileThreadListLayout(false)).toBe("current");
  });

  it("maps both layouts onto the existing device-local legacy preference", () => {
    expect(resolveMobileThreadListLayout(true)).toBe("classic");
    expect(mobileThreadListLayoutPatch("current")).toEqual({ legacyThreadListEnabled: false });
    expect(mobileThreadListLayoutPatch("classic")).toEqual({ legacyThreadListEnabled: true });
  });
});
