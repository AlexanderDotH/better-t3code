import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "../../composerDraftStore";
import {
  ContextWindowMenuContent,
  shouldStopContextWindowSliderKeyPropagation,
} from "./ContextWindowPicker";

const CODEX = ProviderDriverKind.make("codex");
const MODEL = "gpt-context-test";

const CONTEXT_WINDOW_DESCRIPTOR: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "contextWindow",
  label: "Context window",
  type: "select",
  currentValue: "default",
  options: [
    { id: "default", label: "Model default", isDefault: true },
    { id: "262144", label: "256K" },
  ],
};

const MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: MODEL,
    name: MODEL,
    isCustom: false,
    capabilities: { optionDescriptors: [CONTEXT_WINDOW_DESCRIPTOR] },
  },
];

describe("ContextWindowMenuContent", () => {
  it("renders the current value and native slider inline without a nested popover", () => {
    const markup = renderToStaticMarkup(
      <ContextWindowMenuContent
        provider={CODEX}
        draftId={DraftId.make("context-menu")}
        models={MODELS}
        model={MODEL}
        modelOptions={[{ id: "contextWindow", value: "262144" }]}
      />,
    );

    expect(markup).toContain('data-chat-context-window-menu-content="true"');
    expect(markup).toContain('class="w-full px-2 py-1.5"');
    expect(markup).not.toContain('class="w-72 px-2 py-1.5"');
    expect(markup).toContain("Context window");
    expect(markup).toContain("256K");
    expect(markup).toContain('type="range"');
    expect(markup).toContain('aria-label="Context window size"');
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="1"');
    expect(markup).toContain("Model default");
    expect(markup).not.toContain('data-slot="popover-trigger"');
    expect(markup).not.toContain('data-slot="popover-popup"');
  });

  it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"])(
    "isolates the %s adjustment key from the parent menu",
    (key) => {
      expect(shouldStopContextWindowSliderKeyPropagation(key)).toBe(true);
    },
  );

  it.each(["Escape", "Tab"])("allows the parent menu to handle %s", (key) => {
    expect(shouldStopContextWindowSliderKeyPropagation(key)).toBe(false);
  });
});
