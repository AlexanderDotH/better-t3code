import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "../../composerDraftStore";
import {
  buildContextWindowSliderState,
  shouldRenderContextWindowControl,
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
  it("tracks the selected context size and falls back to the model default", () => {
    expect(
      buildContextWindowSliderState({ ...CONTEXT_WINDOW_DESCRIPTOR, currentValue: "262144" }),
    ).toMatchObject({ currentIndex: 1, currentLabel: "256K", progressPercent: 100 });
    expect(
      buildContextWindowSliderState({ ...CONTEXT_WINDOW_DESCRIPTOR, currentValue: "removed" }),
    ).toMatchObject({ currentIndex: 0, currentLabel: "Model default", progressPercent: 0 });
  });

  it("offers the control only when the selected Codex model advertises context choices", () => {
    const input = {
      provider: CODEX,
      draftId: DraftId.make("context-menu"),
      models: MODELS,
      model: MODEL,
    };
    expect(shouldRenderContextWindowControl(input)).toBe(true);
    expect(
      shouldRenderContextWindowControl({
        ...input,
        provider: ProviderDriverKind.make("claudeAgent"),
      }),
    ).toBe(false);
    expect(
      shouldRenderContextWindowControl({ ...input, models: [{ ...MODELS[0]!, capabilities: {} }] }),
    ).toBe(false);
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
