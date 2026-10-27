// @vitest-environment jsdom
import type { ChatVisualMode } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children?: ReactNode }) => createElement("div", {}, children),
  Pressable: (props: {
    children?: ReactNode;
    disabled?: boolean;
    onPress: () => void;
    accessibilityState: { checked: boolean };
  }) =>
    createElement(
      "button",
      {
        disabled: props.disabled,
        onClick: props.onPress,
        role: "radio",
        "aria-checked": props.accessibilityState.checked,
      },
      props.children,
    ),
}));
vi.mock("../../../../components/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => createElement("span", {}, children),
}));
vi.mock("../../../../components/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../../../components/ThemedSwitch", () => ({
  ThemedSwitch: (props: {
    value: boolean;
    disabled?: boolean;
    accessibilityLabel: string;
    onValueChange: (value: boolean) => void;
  }) =>
    createElement("input", {
      type: "checkbox",
      checked: props.value,
      disabled: props.disabled,
      "aria-label": props.accessibilityLabel,
      onChange: () => props.onValueChange(!props.value),
    }),
}));
vi.mock("../../components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children?: ReactNode }) =>
    createElement("section", {}, children),
}));
vi.mock("../../../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "de", locale: "de-DE" }),
}));
vi.mock("../AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => {
    const [chatVisualMode, setChatVisualMode] = useState<ChatVisualMode>("current");
    const [presentationMotion, setPresentationMotion] = useState(true);
    return {
      isReady: true,
      chatVisualMode,
      setChatVisualMode,
      presentationMotion,
      setPresentationMotion,
      chatVisualModeSyncStatus: {
        isSyncing: false,
        isLocalOnly: true,
        failedEnvironmentLabels: [],
        deferredEnvironmentLabels: [],
        unsupportedEnvironmentLabels: [],
      },
    };
  },
}));

import { ChatVisualsAppearanceSection } from "./ChatVisualsAppearanceSection";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps the native transition preference when switching modes and explains the local choice", async () => {
  await act(() => root.render(<ChatVisualsAppearanceSection />));
  const choices = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const motion = container.querySelector<HTMLInputElement>(
    'input[aria-label="Better-T3-Übergänge"]',
  )!;
  expect(choices).toHaveLength(3);
  expect(choices[0]!.getAttribute("aria-checked")).toBe("true");
  expect(choices[2]!.textContent).toContain("Better T3");
  expect(container.textContent).toContain("Auf diesem Gerät gespeichert");
  expect(motion.checked).toBe(true);
  await act(() => choices[2]!.click());
  expect(choices[2]!.getAttribute("aria-checked")).toBe("true");
  expect(motion.checked).toBe(true);
  await act(() => motion.click());
  await act(() => choices[1]!.click());
  expect(choices[1]!.getAttribute("aria-checked")).toBe("true");
  expect(motion.checked).toBe(false);
  expect(container.textContent).not.toContain("Zeichen-Streaming");
});
