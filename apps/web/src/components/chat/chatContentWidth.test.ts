import { describe, expect, it } from "vite-plus/test";

import {
  resolveChatContentMaxWidth,
  resolveChatContentPreviewWidthPercent,
} from "./chatContentWidth";

describe("resolveChatContentMaxWidth", () => {
  it("preserves the T3 Code default until customization changes it", () => {
    expect(resolveChatContentMaxWidth(false, 100)).toBe("48rem");
    expect(resolveChatContentMaxWidth(true, 0)).toBe("48rem");
  });

  it("maps the signed endpoints to half width and the full chat area", () => {
    expect(resolveChatContentMaxWidth(true, -100)).toBe("24rem");
    expect(resolveChatContentMaxWidth(true, 100)).toBe("100%");
  });

  it("interpolates wider values from the default width toward the available area", () => {
    expect(resolveChatContentMaxWidth(true, 50)).toBe("calc(24rem + 50%)");
  });
});

describe("resolveChatContentPreviewWidthPercent", () => {
  it("keeps the preview at the representative default width while customization is off", () => {
    expect(resolveChatContentPreviewWidthPercent(false, 100)).toBe(60);
    expect(resolveChatContentPreviewWidthPercent(true, 0)).toBe(60);
  });

  it("maps the endpoints and wider midpoint onto the preview canvas", () => {
    expect(resolveChatContentPreviewWidthPercent(true, -100)).toBe(30);
    expect(resolveChatContentPreviewWidthPercent(true, 50)).toBe(80);
    expect(resolveChatContentPreviewWidthPercent(true, 100)).toBe(100);
  });
});
