import { describe, expect, it } from "vite-plus/test";

import {
  RIGHT_PANEL_INLINE_LAYOUT_MAX_WIDTH,
  SUBAGENT_DEDICATED_PANE_MIN_WIDTH,
  resolveSubagentPresentationMode,
} from "./rightPanelLayout";

describe("resolveSubagentPresentationMode", () => {
  it("hides agent navigation at and below the compact layout boundary", () => {
    expect(resolveSubagentPresentationMode(RIGHT_PANEL_INLINE_LAYOUT_MAX_WIDTH)).toBe("hidden");
  });

  it("uses the singleton right-panel surface on regular desktop widths", () => {
    expect(resolveSubagentPresentationMode(RIGHT_PANEL_INLINE_LAYOUT_MAX_WIDTH + 1)).toBe(
      "right-panel",
    );
    expect(resolveSubagentPresentationMode(1920)).toBe("right-panel");
    expect(resolveSubagentPresentationMode(SUBAGENT_DEDICATED_PANE_MIN_WIDTH - 1)).toBe(
      "right-panel",
    );
  });

  it("uses a dedicated transcript split only at the ultrawide boundary", () => {
    expect(resolveSubagentPresentationMode(SUBAGENT_DEDICATED_PANE_MIN_WIDTH)).toBe(
      "dedicated-pane",
    );
  });
});
