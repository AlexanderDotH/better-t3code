import type { ProviderInteractionMode } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerInteractionModeSelect } from "./ComposerInteractionModeSelect";

describe("ComposerInteractionModeSelect", () => {
  it.each([
    ["default", "Build"],
    ["plan", "Plan"],
  ] as const)("renders the %s mode as a select trigger", (value, label) => {
    const html = renderToStaticMarkup(
      <ComposerInteractionModeSelect
        value={value satisfies ProviderInteractionMode}
        onValueChange={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Interaction mode"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain(label);
  });
});
