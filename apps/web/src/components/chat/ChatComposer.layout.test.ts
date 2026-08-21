import { describe, expect, it } from "vite-plus/test";

import chatComposerSource from "./ChatComposer.tsx?raw";

describe("ChatComposer footer layout", () => {
  it("includes the Codex context control in the compact-width decision", () => {
    expect(chatComposerSource).toContain(
      "const composerFooterHasContextWindowControl = Boolean(providerContextWindowPicker);",
    );
    expect(chatComposerSource).toContain(
      "hasContextWindowControl: composerFooterHasContextWindowControl,",
    );
  });

  it("renders Codex reasoning before the context-window selector", () => {
    const footerStart = chatComposerSource.indexOf('data-chat-composer-footer="true"');
    const footerSource = chatComposerSource.slice(footerStart);

    expect(footerStart).toBeGreaterThanOrEqual(0);
    expect(footerSource).toMatch(
      /\{isComposerFooterCompact \? \([\s\S]*?<CompactComposerControlsMenu[\s\S]*?\) : \(\s*providerTraitsPicker\s*\)\}\s*\{providerContextWindowPicker\}/,
    );
  });
});
