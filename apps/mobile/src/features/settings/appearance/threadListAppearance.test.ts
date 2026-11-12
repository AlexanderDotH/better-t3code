import { describe, expect, it } from "vite-plus/test";

import {
  mobileThreadListLayoutPatch,
  resolveMobileThreadListLayout,
  THREAD_LIST_LAYOUT_OPTIONS,
} from "./threadListAppearance";

describe("mobile thread list appearance", () => {
  it("offers Standard, Classic and Boring as explicit layout choices", () => {
    expect(THREAD_LIST_LAYOUT_OPTIONS.map(({ layout, label }) => ({ layout, label }))).toEqual([
      { layout: "current", label: "Standard" },
      { layout: "classic", label: "Classic" },
      { layout: "boring", label: "Boring" },
    ]);
  });

  it("keeps Current as the default for a device without a saved choice", () => {
    expect(resolveMobileThreadListLayout(undefined)).toBe("current");
    expect(resolveMobileThreadListLayout(false)).toBe("current");
  });

  it("maps both layouts onto the existing device-local legacy preference", () => {
    expect(resolveMobileThreadListLayout(true)).toBe("classic");
    expect(resolveMobileThreadListLayout(false, true)).toBe("boring");
    expect(mobileThreadListLayoutPatch("current")).toEqual({
      legacyThreadListEnabled: false,
      boringThreadListEnabled: false,
    });
    expect(mobileThreadListLayoutPatch("classic")).toEqual({
      legacyThreadListEnabled: true,
      boringThreadListEnabled: false,
    });
    expect(mobileThreadListLayoutPatch("boring")).toEqual({
      legacyThreadListEnabled: false,
      boringThreadListEnabled: true,
    });
  });
});
