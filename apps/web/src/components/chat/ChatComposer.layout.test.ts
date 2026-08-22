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
    const traitsPickerIndex = footerSource.indexOf("{providerTraitsPicker}");
    const contextWindowPickerIndex = footerSource.indexOf("{providerContextWindowPicker}");

    expect(footerStart).toBeGreaterThanOrEqual(0);
    expect(traitsPickerIndex).toBeGreaterThanOrEqual(0);
    expect(contextWindowPickerIndex).toBeGreaterThan(traitsPickerIndex);
    expect(footerSource).toContain(
      "{isComposerFooterCompact ? providerContextWindowPicker : null}",
    );
  });
});
