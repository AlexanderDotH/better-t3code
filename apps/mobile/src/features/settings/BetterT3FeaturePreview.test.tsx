import { buildBetterT3SettingsPreviewModel } from "@t3tools/client-runtime/better-t3-settings-preview";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({ reducedMotion: false }));

type NativeProps = {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { expanded?: boolean };
  entering?: unknown;
};

vi.mock("react-native", () => ({
  View: ({ children }: NativeProps) => createElement("div", {}, children),
  Pressable: (props: NativeProps) =>
    createElement(
      "button",
      {
        onClick: props.onPress,
        "aria-label": props.accessibilityLabel,
        "aria-expanded": props.accessibilityState?.expanded,
      },
      props.children,
    ),
}));
vi.mock("react-native-reanimated", () => {
  const animation = {
    duration: () => animation,
    delay: () => animation,
    reduceMotion: () => animation,
  };
  return {
    default: {
      View: (props: NativeProps) =>
        createElement("div", { "data-animated": Boolean(props.entering) }, props.children),
    },
    FadeIn: animation,
    FadeInDown: animation,
    ZoomIn: animation,
    ReduceMotion: { System: "system" },
    useReducedMotion: () => fixture.reducedMotion,
  };
});
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: NativeProps) => createElement("span", {}, children),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));
vi.mock("./appearance/components/SettingsPreviews", () => ({
  ThreadListSettingsPreview: () => null,
}));

import { BetterT3FeaturePreview } from "./BetterT3FeaturePreview";

const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
const dispose: Array<() => Promise<void>> = [];

function setup() {
  fixture.reducedMotion = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  dispose.push(async () => {
    await act(() => root.unmount());
    container.remove();
  });
  const model = buildBetterT3SettingsPreviewModel({
    features: [],
    chatVisualMode: "better-t3",
    contextWindowSelector: "better-t3",
    sidebarPosition: "left",
  });
  return { container, root, model };
}

afterEach(async () => {
  for (const cleanup of dispose.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

it("replays the current prompt example on tap and updates it when the setting changes", async () => {
  const { container, root, model } = setup();
  const render = (enabled: boolean) =>
    act(() =>
      root.render(
        <BetterT3FeaturePreview
          group="composer-input"
          model={{ ...model, agent: { ...model.agent, promptImprovement: enabled } }}
          controls={[
            { id: "agent.promptImprovement", value: enabled },
            { id: "voice.outputLanguage", value: enabled ? "english" : "native" },
          ]}
        />,
      ),
    );
  await render(true);
  const button = container.querySelector<HTMLButtonElement>("button")!;
  expect(button).not.toBeNull();
  expect(button.getAttribute("aria-label")).toContain(translator.message("mobile.prefs.replay"));
  const before = button.querySelector('[data-animated="true"]');
  expect(before).not.toBeNull();
  await act(() => button.click());
  expect(button.querySelector('[data-animated="true"]')).not.toBe(before);
  expect(container.textContent).toContain(translator.message("mobile.prefs.improvedPrompt"));
  expect(container.textContent).toContain(translator.message("mobile.prefs.voiceResult"));

  await render(false);
  expect(container.textContent).not.toContain(translator.message("mobile.prefs.improvedPrompt"));
  expect(container.textContent).toContain(translator.message("mobile.prefs.samplePrompt"));
  expect(container.textContent).not.toContain(translator.message("mobile.prefs.voiceResult"));
});

it.each(["chat.workspaceCardDeck", "chat.messageEditing"] as const)(
  "toggles the %s example without changing the saved setting and honors reduced motion",
  async (featureId) => {
    const { container, root, model } = setup();
    fixture.reducedMotion = true;
    await act(() =>
      root.render(
        <BetterT3FeaturePreview
          group="composer-cards"
          model={{ ...model, chat: { ...model.chat, workspaceCardDeck: true, cardMorphing: true } }}
          controls={[{ id: featureId, value: true }]}
        />,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>("button")!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
  },
);
