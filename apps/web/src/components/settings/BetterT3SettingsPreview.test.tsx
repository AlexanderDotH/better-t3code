import type { ContextWindowSelector } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { BetterT3FeatureChoice } from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";

const translate = createInterfaceTranslator({ language: "de", locale: "de-DE" }).message;

function ContextWindowChoiceHarness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<ContextWindowSelector>("better-t3");
  return (
    <BetterT3FeatureChoice
      featureId="chat.contextWindowSelector"
      disabled={disabled}
      model={buildBetterT3SettingsPreviewModel({
        features: [],
        chatVisualMode: "current",
        sidebarPosition: "left",
        contextWindowSelector: value,
      })}
      translate={translate}
      value={value}
      onChange={(nextValue) => {
        if (nextValue !== "native" && nextValue !== "better-t3") {
          throw new Error("Unexpected context window selector value");
        }
        setValue(nextValue);
      }}
    />
  );
}

describe("context window visual choice", () => {
  it("switches between two translated cards and preserves the selection while disabled", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<ContextWindowChoiceHarness />);
      });
      const radios = () => renderer!.root.findAllByProps({ role: "radio" });
      const selection = () => radios().map((radio) => radio.props["aria-checked"]);

      expect(radios()).toHaveLength(2);
      expect(renderer!.root.findAllByType("button")).toHaveLength(2);
      expect(JSON.stringify(renderer!.toJSON())).toContain("Natives T3 Code");
      expect(JSON.stringify(renderer!.toJSON())).toContain("Better T3");
      expect(selection()).toEqual([false, true]);

      await act(() => radios()[0]!.props.onClick());
      expect(selection()).toEqual([true, false]);
      await act(() => radios()[1]!.props.onClick());
      expect(selection()).toEqual([false, true]);

      await act(() => renderer!.update(<ContextWindowChoiceHarness disabled />));
      expect(radios().every((radio) => radio.props.disabled === true)).toBe(true);
      expect(selection()).toEqual([false, true]);

      await act(() => renderer!.update(<ContextWindowChoiceHarness />));
      expect(radios().every((radio) => radio.props.disabled === false)).toBe(true);
      await act(() => radios()[0]!.props.onClick());
      expect(selection()).toEqual([true, false]);
    } finally {
      await act(() => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
