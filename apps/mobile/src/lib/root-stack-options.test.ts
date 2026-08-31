import { describe, expect, it } from "vite-plus/test";

import { rootHomeContentStyle } from "./root-stack-options";

describe("root stack options", () => {
  it("keeps the Android home destination opaque during predictive back", () => {
    expect(rootHomeContentStyle("android")).toBeUndefined();
  });

  it("preserves transparent iOS content for native glass", () => {
    expect(rootHomeContentStyle("ios")).toEqual({ backgroundColor: "transparent" });
  });
});
