import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ProjectCheckpointControls } from "./ProjectCheckpointControls";

describe("ProjectCheckpointControls", () => {
  it("offers both deterministic normalization actions for a mixed group", () => {
    const markup = renderToStaticMarkup(
      <ProjectCheckpointControls
        setting={{ state: "mixed", effectiveEnabled: false }}
        isSaving={false}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Mixed");
    expect(markup).toContain("Disable all");
    expect(markup).toContain("Enable all");
    expect(markup).not.toContain('aria-label="Create checkpoints after turns"');
  });

  it("uses the switch for a normalized group and disables it while saving", () => {
    const markup = renderToStaticMarkup(
      <ProjectCheckpointControls
        setting={{ state: "enabled", effectiveEnabled: true }}
        isSaving
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Create checkpoints after turns"');
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Enable all");
    expect(markup).not.toContain("Disable all");
  });
});
