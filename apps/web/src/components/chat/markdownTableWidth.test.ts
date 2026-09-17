import { describe, expect, it } from "vite-plus/test";

import {
  resolveDefaultExpandedMarkdownTableWidth,
  resolveDraggedMarkdownTableWidth,
  resolveMarkdownTableWidthBounds,
} from "./markdownTableWidth";

describe("markdown table width", () => {
  it("opens at 150% of the message width when the chat column has room", () => {
    const bounds = resolveMarkdownTableWidthBounds(768, 1600);

    expect(bounds).toEqual({ minWidth: 768, maxWidth: 1560 });
    expect(resolveDefaultExpandedMarkdownTableWidth(768, bounds)).toBe(1152);
  });

  it("caps the initial width inside the chat column gutter", () => {
    const bounds = resolveMarkdownTableWidthBounds(768, 1000);

    expect(resolveDefaultExpandedMarkdownTableWidth(768, bounds)).toBe(960);
  });

  it("keeps either dragged edge under the pointer while resizing around the center", () => {
    const bounds = { minWidth: 768, maxWidth: 1560 };

    expect(
      resolveDraggedMarkdownTableWidth({ bounds, deltaX: 50, edge: "right", startWidth: 1152 }),
    ).toBe(1252);
    expect(
      resolveDraggedMarkdownTableWidth({ bounds, deltaX: -50, edge: "left", startWidth: 1152 }),
    ).toBe(1252);
  });

  it("clamps drag resizing to the normal width and available chat area", () => {
    const bounds = { minWidth: 768, maxWidth: 1560 };

    expect(
      resolveDraggedMarkdownTableWidth({ bounds, deltaX: -500, edge: "right", startWidth: 1152 }),
    ).toBe(768);
    expect(
      resolveDraggedMarkdownTableWidth({ bounds, deltaX: 500, edge: "right", startWidth: 1152 }),
    ).toBe(1560);
  });
});
