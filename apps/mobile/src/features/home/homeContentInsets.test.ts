import { describe, expect, it } from "vite-plus/test";

import {
  getAndroidHomeFabLayout,
  getHomeContentBottomPadding,
  type HomeContentSurface,
} from "./homeContentInsets";

const homeSurfaces = [
  "empty",
  "thread-list-v1",
  "thread-list-v2",
] as const satisfies readonly HomeContentSurface[];

describe("Android Home FAB layout", () => {
  it("derives the button offset and content clearance from the same geometry", () => {
    expect(getAndroidHomeFabLayout(0)).toEqual({
      buttonBottom: 32,
      buttonSize: 56,
      contentBottomPadding: 104,
    });
    expect(getAndroidHomeFabLayout(34)).toEqual({
      buttonBottom: 50,
      buttonSize: 56,
      contentBottomPadding: 122,
    });
  });

  it("reserves the same FAB clearance for both thread lists and the empty state", () => {
    const paddings = homeSurfaces.map((surface) =>
      getHomeContentBottomPadding({
        platform: "android",
        safeAreaBottom: 34,
        iosBottomToolbarClearance: 44,
        surface,
      }),
    );

    expect(paddings).toEqual([122, 122, 122]);
  });

  it("preserves the existing iOS padding for each Home surface", () => {
    const paddings = homeSurfaces.map((surface) =>
      getHomeContentBottomPadding({
        platform: "ios",
        safeAreaBottom: 0,
        iosBottomToolbarClearance: 44,
        surface,
      }),
    );

    expect(paddings).toEqual([68, 92, 164]);
  });
});
